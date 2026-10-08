import { checkAppleCode, revokeAppleToken } from './apple-revoke.ts';

function assertEq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let s = '';
  for (const b of der) s += String.fromCharCode(b);
  // Znaczniki PEM składane w locie (gitleaks, reguła apple-p8-private-key); klucz powstaje w teście.
  const tag = (edge: string) => `-----${edge} ${'PRIVATE'} KEY-----`;
  return { pem: `${tag('BEGIN')}\n${btoa(s)}\n${tag('END')}`, pub: pair.publicKey };
}
const unb64url = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const b64url = (o: object) => btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
/** Token tożsamości jak z /auth/token (podpis bez znaczenia — przychodzi wprost z Apple po TLS). */
const idToken = (claims: object) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const GOOD = { iss: 'https://appleid.apple.com', aud: 'io.x', sub: '001234.abcd' };

Deno.test('Apple: sprawdzenie kodu (sub z tokenu tożsamości) i unieważnienie; client secret zgodny z dokumentacją', async () => {
  const { pem, pub } = await testKey();
  const calls: { url: string; body: URLSearchParams }[] = [];
  const f = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init!.body)) });
    return Promise.resolve(url.endsWith('/auth/token') ? new Response(JSON.stringify({ refresh_token: 'r1', id_token: idToken(GOOD) }), { status: 200 }) : new Response(null, { status: 200 }));
  }) as typeof fetch;
  const k = { p8: pem, keyId: 'KEY1', teamId: 'TEAM1', clientId: 'io.x' };
  const checked = await checkAppleCode('code-1', k, 1_800_000_000, f);
  if (!checked.ok) throw new Error('kod odrzucony');
  assertEq([checked.sub, checked.refreshToken], ['001234.abcd', 'r1']);
  assertEq(await revokeAppleToken(checked.refreshToken, checked.secret, 'io.x', f), 'revoked');
  assertEq(calls.map((c) => c.url), ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
  assertEq(Object.fromEntries([...calls[0]!.body].filter(([k]) => k !== 'client_secret')), { client_id: 'io.x', code: 'code-1', grant_type: 'authorization_code' });
  assertEq(Object.fromEntries([...calls[1]!.body].filter(([k]) => k !== 'client_secret')), { client_id: 'io.x', token: 'r1', token_type_hint: 'refresh_token' });
  const [h, c, sig] = calls[0]!.body.get('client_secret')!.split('.');
  assertEq(JSON.parse(new TextDecoder().decode(unb64url(h!))), { alg: 'ES256', kid: 'KEY1' });
  assertEq(JSON.parse(new TextDecoder().decode(unb64url(c!))), { iss: 'TEAM1', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'io.x' });
  assertEq(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig!), new TextEncoder().encode(`${h}.${c}`)), true);
});

Deno.test('Apple: zły albo użyty kod, obcy token, błąd Apple, zły klucz, nieudane unieważnienie', async () => {
  const { pem } = await testKey();
  const k = { p8: pem, keyId: 'K', teamId: 'T', clientId: 'io.x' };
  const at = (token: Response) => (() => Promise.resolve(token)) as unknown as typeof fetch;
  const ok = (claims: object, extra: object = {}) => new Response(JSON.stringify({ refresh_token: 'r', id_token: idToken(claims), ...extra }), { status: 200 });
  const reason = async (r: Response) => {
    const x = await checkAppleCode('c', k, 1, at(r));
    return x.ok ? 'ok' : x.reason;
  };
  assertEq(await reason(new Response('{"error":"invalid_grant"}', { status: 400 })), 'invalid');
  assertEq(await reason(new Response('{"error":"invalid_client"}', { status: 400 })), 'config');
  assertEq(await reason(new Response('nie json', { status: 500 })), 'unavailable');
  assertEq(await reason(new Response('{}', { status: 200 })), 'unavailable');
  assertEq(await reason(new Response(JSON.stringify({ refresh_token: 'r', id_token: 'bez-kropek' }), { status: 200 })), 'unavailable');
  assertEq(await reason(new Response(JSON.stringify({ refresh_token: 'r', id_token: 'a.%%%.c' }), { status: 200 })), 'unavailable');
  assertEq(await reason(ok({ ...GOOD, aud: 'inna.aplikacja' })), 'invalid');
  assertEq(await reason(ok({ ...GOOD, iss: 'https://zly.example' })), 'invalid');
  assertEq(await reason(ok({ ...GOOD, sub: '' })), 'invalid');
  assertEq(await reason(ok(GOOD)), 'ok');
  assertEq((await checkAppleCode('c', { ...k, p8: 'zły' }, 1, at(ok(GOOD)))).ok ? 'ok' : 'config', 'config');
  assertEq(await revokeAppleToken('r', 's', 'io.x', at(new Response('{}', { status: 400 }))), 'revoke_failed');
});
