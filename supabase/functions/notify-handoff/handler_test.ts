import { providerToken, sendAlert } from '../_shared/apns.ts';
import { APNS_PARALLEL, handle, PUSH_MAX_AGE_H } from './handler.ts';

const USER = '0199a3b4-0000-7000-8000-000000000001';
const HANDOFF = '0199a3b4-0000-7000-8000-0000000000a1';

function assertEq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

/** Klucz testowy P-256 w PEM (jak plik .p8 z Apple) i jego klucz publiczny do niezależnej weryfikacji podpisu. */
async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let s = '';
  for (const b of der) s += String.fromCharCode(b);
  // Znaczniki PEM składane w locie: klucz powstaje w teście, a gitleaks (reguła apple-p8-private-key) nie myli szablonu z sekretem.
  const tag = (edge: string) => `-----${edge} ${'PRIVATE'} KEY-----`;
  const pem = `${tag('BEGIN')}\n${btoa(s).match(/.{1,64}/g)!.join('\n')}\n${tag('END')}`;
  return { pem, pub: pair.publicKey };
}
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

Deno.test('token dostawcy: ES256 z kid i iss, podpis weryfikowalny kluczem publicznym', async () => {
  const { pem, pub } = await testKey();
  // Klucz wklejony do sekretu w jednej linii z literalnymi \n — też działa.
  for (const p8 of [pem, pem.replaceAll('\n', '\\n')]) {
    const jwt = await providerToken(p8, 'KEY123', 'TEAM45', 1_800_000_000);
    const [h, c, sig] = jwt.split('.');
    assertEq(JSON.parse(new TextDecoder().decode(unb64url(h!))), { alg: 'ES256', kid: 'KEY123' });
    assertEq(JSON.parse(new TextDecoder().decode(unb64url(c!))), { iss: 'TEAM45', iat: 1_800_000_000 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig!), new TextEncoder().encode(`${h}.${c}`));
    assertEq(ok, true);
  }
});

Deno.test('APNs: 200 wysłane, 410 i BadDeviceToken do usunięcia, reszta błąd', async () => {
  const at = (status: number, body = '{}') => (() => Promise.resolve(new Response(body, { status }))) as typeof fetch;
  const a = { env: 'production' as const, token: 'ab'.repeat(32), jwt: 'j', topic: 'io.x', title: 'T', body: 'B' };
  assertEq(await sendAlert(a, at(200)), 'sent');
  assertEq(await sendAlert(a, at(410)), 'drop');
  assertEq(await sendAlert(a, at(400, '{"reason":"BadDeviceToken"}')), 'drop');
  assertEq(await sendAlert(a, at(400, '{"reason":"BadTopic"}')), 'error');
  assertEq(await sendAlert(a, at(429, 'nie json')), 'error');
  assertEq(await sendAlert(a, (() => Promise.reject(new Error('sieć'))) as typeof fetch), 'error');
});

async function world(claim: object | null, apns: number[] = [], claimStatus = 200, userStatus = 200, user: object = { id: USER }, rate: boolean | null = true) {
  const { pem } = await testKey();
  const env = {
    get: (k: string) =>
      ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"d":"pub"}', SUPABASE_SECRET_KEYS: '{"d":"sec"}', APNS_KEY_P8: pem, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'io.github.lkarwowski494.organizer' } as Record<string, string>)[k],
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  let n = 0;
  const f = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify(user), { status: userStatus }));
    // null = baza bez licznika (404, przed migracją 20261008392000).
    if (url.endsWith('/rpc/notify_rate_hit')) return Promise.resolve(rate === null ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(rate), { status: 200 }));
    if (url.endsWith('/rpc/handoff_push_claim') || url.endsWith('/rpc/assignment_push_claim')) return Promise.resolve(new Response(JSON.stringify(claim), { status: claimStatus }));
    if (url.endsWith('/rpc/drop_push_token') || url.endsWith('/rpc/push_claim_release')) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response('{"reason":"Unregistered"}', { status: apns[n++] ?? 200 }));
  }) as typeof fetch;
  return { env, f, calls };
}
const post = (body: object, auth = 'Bearer jwt') => new Request('https://fn/notify-handoff', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) });

Deno.test('wysyła do tokenów odbiorcy, usuwa nieaktualny', async () => {
  const claim = { title: 'Łukasz przekazuje Ci', body: 'Logopeda', tokens: [{ token: 'aa'.repeat(32), env: 'production' }, { token: 'bb'.repeat(32), env: 'sandbox' }] };
  const { env, f, calls } = await world(claim, [200, 410]);
  const r = await handle(post({ handoffId: HANDOFF }), env, f, 1_800_000_000);
  assertEq(r.status, 200);
  // M-185: odpowiedź nie mówi, ile urządzeń ma odbiorca.
  assertEq(await r.json(), { ok: true });
  assertEq(calls.map((c) => c.url), [
    'https://x.supabase.co/auth/v1/user',
    'https://x.supabase.co/rest/v1/rpc/notify_rate_hit',
    'https://x.supabase.co/rest/v1/rpc/handoff_push_claim',
    `https://api.push.apple.com/3/device/${'aa'.repeat(32)}`,
    `https://api.sandbox.push.apple.com/3/device/${'bb'.repeat(32)}`,
    'https://x.supabase.co/rest/v1/rpc/drop_push_token',
  ]);
  assertEq(JSON.parse(String(calls[1]!.init!.body)), { p_user: USER });
  assertEq(JSON.parse(String(calls[2]!.init!.body)), { p_handoff: HANDOFF, p_user: USER, p_max_age_h: PUSH_MAX_AGE_H });
  assertEq((calls[2]!.init!.headers as Record<string, string>).authorization, 'Bearer sec');
  assertEq(JSON.parse(String(calls[3]!.init!.body)), { aps: { alert: { title: 'Łukasz przekazuje Ci', body: 'Logopeda' }, sound: 'default' } });
  assertEq((calls[3]!.init!.headers as Record<string, string>)['apns-topic'], 'io.github.lkarwowski494.organizer');
  assertEq(JSON.parse(String(calls[5]!.init!.body)), { p_token: 'bb'.repeat(32) });
});

Deno.test('nic do wysłania, błędy wejścia, sesji i konfiguracji', async () => {
  const none = await world(null);
  assertEq(await (await handle(post({ handoffId: HANDOFF }), none.env, none.f)).json(), { ok: true });
  assertEq(none.calls.length, 3);
  const cases: [Request, Awaited<ReturnType<typeof world>>, number][] = [
    [new Request('https://fn', { method: 'GET' }), await world(null), 405],
    [post({ handoffId: HANDOFF }, ''), await world(null), 401],
    [post({ handoffId: 'x' }), await world(null), 400],
    [new Request('https://fn', { method: 'POST', headers: { authorization: 'Bearer j' }, body: 'nie json' }), await world(null), 400],
    [post({ handoffId: HANDOFF }), await world(null, [], 200, 401), 401],
    [post({ handoffId: HANDOFF }), await world(null, [], 200, 200, { id: 'zły' }), 401],
    [post({ handoffId: HANDOFF }), await world(null, [], 500), 502],
  ];
  for (const [req, w, status] of cases) assertEq((await handle(req, w.env, w.f)).status, status);
  const w = await world(null);
  const noApns = { get: (k: string) => (k === 'APNS_KEY_P8' ? undefined : w.env.get(k)) };
  assertEq((await handle(post({ handoffId: HANDOFF }), noApns, w.f)).status, 500);
  const noKeys = { get: (k: string) => (k.startsWith('SUPABASE_') && k !== 'SUPABASE_URL' ? undefined : w.env.get(k)) };
  assertEq((await handle(post({ handoffId: HANDOFF }), noKeys, w.f)).status, 500);
});

Deno.test('PWD-16: ścieżka sprawy w treści APNs (klucz „body”), bez niej — treść jak dotąd', async () => {
  const claim = { title: 'Łukasz przypisuje Ci zadanie', body: 'Śmieci', tokens: [{ token: 'aa'.repeat(32), env: 'production' }], key: 'assign|x', path: 'task/t1' };
  const w = await world(claim, [200]);
  await handle(post({ activityId: HANDOFF }), w.env, w.f, 1_800_000_000);
  assertEq(JSON.parse(String(w.calls[3]!.init!.body)), { aps: { alert: { title: 'Łukasz przypisuje Ci zadanie', body: 'Śmieci' }, sound: 'default' }, body: { path: 'task/t1' } });
});

Deno.test('przypisanie: activityId → assignment_push_claim; oba albo żaden id — błąd', async () => {
  const claim = { title: 'Łukasz przypisuje Ci zadanie', body: 'Śmieci', tokens: [{ token: 'aa'.repeat(32), env: 'production' }] };
  const w = await world(claim, [200]);
  const r = await handle(post({ activityId: HANDOFF }), w.env, w.f, 1_800_000_000);
  assertEq(await r.json(), { ok: true });
  assertEq(w.calls[2]!.url, 'https://x.supabase.co/rest/v1/rpc/assignment_push_claim');
  assertEq(JSON.parse(String(w.calls[2]!.init!.body)), { p_activity: HANDOFF, p_user: USER, p_max_age_h: PUSH_MAX_AGE_H });
  const both = await world(null);
  assertEq((await handle(post({ activityId: HANDOFF, handoffId: HANDOFF }), both.env, both.f)).status, 400);
  assertEq((await handle(post({}), both.env, both.f)).status, 400);
});

Deno.test('audyt 2 (N-15): APNs nie przyjął nigdzie — zwolnienie zaznaczenia i 502; doszło choć raz — 200 bez zwalniania', async () => {
  const tokens = [{ token: 'aa'.repeat(32), env: 'production' }, { token: 'bb'.repeat(32), env: 'production' }];
  const claim = { title: 'Łukasz przekazuje Ci', body: 'Basen', tokens, key: `handoff|${HANDOFF}|pending` };
  // 503 i 429: nic nie doszło.
  const down = await world(claim, [503, 429]);
  const r = await handle(post({ handoffId: HANDOFF }), down.env, down.f, 1_800_000_000);
  assertEq(r.status, 502);
  assertEq(await r.json(), { error: 'apns_failed' });
  assertEq(down.calls.at(-1)!.url, 'https://x.supabase.co/rest/v1/rpc/push_claim_release');
  assertEq(JSON.parse(String(down.calls.at(-1)!.init!.body)), { p_key: `handoff|${HANDOFF}|pending` });
  // Jedno urządzenie przyjęło, drugie nie — bez ponowienia.
  const half = await world(claim, [200, 503]);
  const ok = await handle(post({ handoffId: HANDOFF }), half.env, half.f, 1_800_000_000);
  assertEq(await ok.json(), { ok: true });
  assertEq(half.calls.some((c) => c.url.endsWith('/rpc/push_claim_release')), false);
  // Token nieaktualny i błąd: nic nie doszło — zwolnienie (nieaktualny już usunięty, ponowienie trafi do reszty).
  const mixed = await world(claim, [410, 500]);
  assertEq((await handle(post({ handoffId: HANDOFF }), mixed.env, mixed.f, 1_800_000_000)).status, 502);
  assertEq(mixed.calls.map((c) => c.url.split('/').at(-1)), ['user', 'notify_rate_hit', 'handoff_push_claim', 'aa'.repeat(32), 'bb'.repeat(32), 'drop_push_token', 'push_claim_release']);
  // Same nieaktualne tokeny albo brak tokenów — 200, bez zwalniania (nie ma czego ponawiać).
  const gone = await world(claim, [410, 410]);
  assertEq(await (await handle(post({ handoffId: HANDOFF }), gone.env, gone.f, 1_800_000_000)).json(), { ok: true });
  assertEq(gone.calls.some((c) => c.url.endsWith('/rpc/push_claim_release')), false);
  // Baza sprzed migracji (bez „key”) — 502 bez zwalniania.
  const legacy = await world({ ...claim, key: undefined }, [503, 503]);
  assertEq((await handle(post({ activityId: HANDOFF }), legacy.env, legacy.f, 1_800_000_000)).status, 502);
  assertEq(legacy.calls.some((c) => c.url.endsWith('/rpc/push_claim_release')), false);
});

Deno.test('audyt 2 (M-185): limit próśb na konto, baza bez licznika, wysyłka po APNS_PARALLEL naraz', async () => {
  const claim = { title: 'T', body: 'B', tokens: Array.from({ length: APNS_PARALLEL + 2 }, (_, i) => ({ token: String(i).repeat(64), env: 'production' })) };
  // Ponad limit: 429, bez pytania o odbiorców i bez APNs.
  const limited = await world(claim, [], 200, 200, { id: USER }, false);
  const r = await handle(post({ handoffId: HANDOFF }), limited.env, limited.f, 1_800_000_000);
  assertEq(r.status, 429);
  assertEq(limited.calls.map((c) => c.url.split('/').at(-1)), ['user', 'notify_rate_hit']);
  // Starsza baza bez licznika — wysyłka jak dotąd.
  const old = await world(claim, [], 200, 200, { id: USER }, null);
  assertEq((await handle(post({ handoffId: HANDOFF }), old.env, old.f, 1_800_000_000)).status, 200);
  assertEq(old.calls.filter((c) => c.url.startsWith('https://api.push.apple.com')).length, APNS_PARALLEL + 2);
});
