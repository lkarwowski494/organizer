import { handle } from './handler.ts';

const ID = '0199a3b4-0000-7000-8000-000000000001';

function env(vars: Record<string, string>) {
  return { get: (k: string) => vars[k] };
}
const ENV = env({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"default":"pub"}', SUPABASE_SECRET_KEYS: '{"default":"sec"}' });

function fakeFetch(userStatus = 200, user: object = { id: ID }, delStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify(user), { status: userStatus }));
    return Promise.resolve(new Response('{}', { status: url.includes('/admin/users/') ? delStatus : 200 }));
  }) as typeof fetch;
  return { f, calls };
}
const post = (auth?: string) => new Request('https://fn/delete-account', { method: 'POST', headers: auth ? { authorization: auth } : {} });

function assertEq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

Deno.test('usuwa zalogowanego użytkownika kluczem tajnym', async () => {
  const { f, calls } = fakeFetch();
  const r = await handle(post('Bearer jwt'), ENV, f);
  assertEq(r.status, 200);
  assertEq(calls.map((c) => c.url), ['https://x.supabase.co/auth/v1/user', 'https://x.supabase.co/rest/v1/rpc/prepare_account_deletion', `https://x.supabase.co/auth/v1/admin/users/${ID}`]);
  assertEq((calls[0]!.init!.headers as Record<string, string>).authorization, 'Bearer jwt');
  assertEq((calls[0]!.init!.headers as Record<string, string>).apikey, 'pub');
  // Wybór zapisany sesją użytkownika (RLS i auth.uid() po stronie bazy), bez wyboru — false.
  assertEq((calls[1]!.init!.headers as Record<string, string>).authorization, 'Bearer jwt');
  assertEq(calls[1]!.init!.body, '{"delete_entries":false}');
  assertEq(calls[2]!.init!.method, 'DELETE');
  assertEq((calls[2]!.init!.headers as Record<string, string>).authorization, 'Bearer sec');
});

Deno.test('N-71: „Usuń też moje wpisy” trafia do bazy przed usunięciem; bez zapisu wyboru konto zostaje', async () => {
  const withBody = (body: object) => new Request('https://fn/delete-account', { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify(body) });
  const yes = fakeFetch();
  assertEq((await handle(withBody({ deleteEntries: true }), ENV, yes.f)).status, 200);
  assertEq(yes.calls[1]!.init!.body, '{"delete_entries":true}');
  // Tylko prawdziwe true — inne wartości to brak wyboru.
  const odd = fakeFetch();
  await handle(withBody({ deleteEntries: 'tak' }), ENV, odd.f);
  assertEq(odd.calls[1]!.init!.body, '{"delete_entries":false}');
  const calls: string[] = [];
  const failing = ((url: string) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify({ id: ID }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: url.includes('/rpc/') ? 404 : 200 }));
  }) as typeof fetch;
  const r = await handle(withBody({ deleteEntries: true }), ENV, failing);
  assertEq([r.status, (await r.json()).error], [502, 'delete_failed']);
  assertEq(calls.some((u) => u.includes('/admin/users/')), false);
});

Deno.test('bez sesji, zła metoda, nieważny JWT, dziwne id: nic nie usuwa', async () => {
  for (const [req, f, status] of [
    [post(), fakeFetch(), 401],
    [new Request('https://fn', { method: 'GET' }), fakeFetch(), 405],
    [post('Bearer jwt'), fakeFetch(401), 401],
    [post('Bearer jwt'), fakeFetch(200, { id: '../../x' }), 401],
    [post('Bearer jwt'), fakeFetch(200, {}), 401],
  ] as const) {
    const r = await handle(req, ENV, f.f);
    assertEq(r.status, status);
    assertEq(f.calls.some((c) => c.init?.method === 'DELETE'), false);
  }
});

Deno.test('błąd usuwania i brak konfiguracji; starsze nazwy kluczy działają', async () => {
  assertEq((await handle(post('Bearer jwt'), ENV, fakeFetch(200, { id: ID }, 500).f)).status, 502);
  assertEq((await handle(post('Bearer jwt'), env({}), fakeFetch().f)).status, 500);
  assertEq((await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'u' }), fakeFetch().f)).status, 500);
  const legacy = fakeFetch();
  const r = await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv' }), legacy.f);
  assertEq(r.status, 200);
  assertEq((legacy.calls[1]!.init!.headers as Record<string, string>).apikey, 'anon');
  assertEq((legacy.calls[2]!.init!.headers as Record<string, string>).apikey, 'srv');
  const empty = fakeFetch();
  assertEq((await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'https://x', SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_ANON_KEY: 'a', SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 's' }), empty.f)).status, 200);
});

const b64url = (o: object) => btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const idToken = (sub: string) => `${b64url({ alg: 'RS256' })}.${b64url({ iss: 'https://appleid.apple.com', aud: 'io.x', sub })}.sig`;

Deno.test('konto z Apple (M-303): świeży kod sprawdzony w Apple i zgodny z kontem, potem unieważnienie i usunięcie', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let b = '';
  for (const x of der) b += String.fromCharCode(x);
  const tag = (edge: string) => `-----${edge} ${'PRIVATE'} KEY-----`;
  const withApple = env({
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"default":"pub"}', SUPABASE_SECRET_KEYS: '{"default":"sec"}',
    APPLE_SIWA_KEY_P8: `${tag('BEGIN')}\n${btoa(b)}\n${tag('END')}`, APPLE_SIWA_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'io.x',
  });
  const appleUser = { id: ID, identities: [{ provider: 'apple', id: 'apple-sub-1' }] };
  const server = (user: object, token: () => Response) => {
    const urls: string[] = [];
    const f = ((url: string) => {
      urls.push(url);
      if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify(user), { status: 200 }));
      if (url.endsWith('/auth/token')) return Promise.resolve(token());
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    return { f, urls };
  };
  const good = () => new Response(JSON.stringify({ refresh_token: 'r', id_token: idToken('apple-sub-1') }), { status: 200 });
  const req = (body?: object) => new Request('https://fn/delete-account', { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: body ? JSON.stringify(body) : undefined });
  const deleted = (urls: string[]) => urls.includes(`https://x.supabase.co/auth/v1/admin/users/${ID}`);

  let s = server(appleUser, good);
  let r = await handle(req({ appleAuthorizationCode: 'c1' }), withApple, s.f);
  assertEq(await r.json(), { deleted: true, apple: 'revoked' });
  assertEq(s.urls, ['https://x.supabase.co/auth/v1/user', 'https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke', 'https://x.supabase.co/rest/v1/rpc/prepare_account_deletion', `https://x.supabase.co/auth/v1/admin/users/${ID}`]);

  // Sama sesja nie wystarcza: bez kodu, ze złym kodem albo kodem innego Apple ID — konto zostaje.
  for (const [body, token, status, error] of [
    [undefined, good, 403, 'apple_code_required'],
    [{ appleAuthorizationCode: '' }, good, 403, 'apple_code_required'],
    [{ appleAuthorizationCode: 'stary' }, () => new Response('{"error":"invalid_grant"}', { status: 400 }), 403, 'apple_code_invalid'],
    [{ appleAuthorizationCode: 'cudzy' }, () => new Response(JSON.stringify({ refresh_token: 'r', id_token: idToken('inny') }), { status: 200 }), 403, 'apple_code_invalid'],
    [{ appleAuthorizationCode: 'c' }, () => new Response('', { status: 503 }), 502, 'apple_unavailable'],
  ] as const) {
    s = server(appleUser, token);
    r = await handle(req(body), withApple, s.f);
    assertEq([r.status, (await r.json()).error], [status, error]);
    assertEq(deleted(s.urls), false);
  }
  // Apple nieosiągalne (wyjątek sieci) — też bez usunięcia.
  const down = ((url: string) => (url.endsWith('/auth/v1/user') ? Promise.resolve(new Response(JSON.stringify(appleUser), { status: 200 })) : Promise.reject(new Error('net')))) as typeof fetch;
  assertEq((await handle(req({ appleAuthorizationCode: 'c' }), withApple, down)).status, 502);

  // Bez klucza albo ze złym kluczem (błąd konfiguracji) — kod wymagany, konto usuwane z „not_configured”.
  s = server(appleUser, good);
  r = await handle(req({ appleAuthorizationCode: 'c1' }), ENV, s.f);
  assertEq(await r.json(), { deleted: true, apple: 'not_configured' });
  // N-99: brak klucza widać w zgłoszeniach błędów (kluczem tajnym, bez konta), a nieudany zapis zgłoszenia nic nie psuje.
  assertEq(s.urls.at(-1), 'https://x.supabase.co/rest/v1/client_errors');
  const noReport = ((url: string) => (url.endsWith('/client_errors') ? Promise.reject(new Error('net')) : server(appleUser, good).f(url))) as typeof fetch;
  assertEq(await (await handle(req({ appleAuthorizationCode: 'c1' }), ENV, noReport)).json(), { deleted: true, apple: 'not_configured' });
  assertEq((await handle(req(), ENV, server(appleUser, good).f)).status, 403);
  const broken = { get: (k: string) => (k === 'APPLE_SIWA_KEY_P8' ? 'zły' : withApple.get(k)) };
  r = await handle(req({ appleAuthorizationCode: 'c1' }), broken, server(appleUser, good).f);
  assertEq(await r.json(), { deleted: true, apple: 'not_configured' });
  r = await handle(req({ appleAuthorizationCode: 'c1' }), withApple, server(appleUser, () => new Response('{"error":"invalid_client"}', { status: 400 })).f);
  assertEq(await r.json(), { deleted: true, apple: 'not_configured' });
  // Nieudane unieważnienie nie blokuje usunięcia.
  const revokeFails = ((url: string) => {
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify(appleUser), { status: 200 }));
    if (url.endsWith('/auth/token')) return Promise.resolve(good());
    if (url.endsWith('/auth/revoke')) return Promise.reject(new Error('net'));
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  r = await handle(req({ appleAuthorizationCode: 'c1' }), withApple, revokeFails);
  assertEq(await r.json(), { deleted: true, apple: 'revoke_failed' });

  // Konto bez Apple (dawne logowanie e-mailem, D177): sama sesja; kod ignorowany; dziwne identities bez znaczenia.
  for (const user of [{ id: ID, identities: [{ provider: 'email', id: 'x' }] }, { id: ID, identities: 'zle' }, { id: ID, identities: [null, { provider: 'apple', id: 5 }] }]) {
    s = server(user, good);
    r = await handle(req({ appleAuthorizationCode: 'c1' }), withApple, s.f);
    assertEq(await r.json(), { deleted: true, apple: 'not_apple' });
    assertEq(s.urls.some((u) => u.includes('appleid')), false);
  }
});
