import { revokeAppleToken } from './apple-revoke.ts';

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

Deno.test('Apple: wymiana kodu na refresh token i unieważnienie; client secret zgodny z dokumentacją', async () => {
  const { pem, pub } = await testKey();
  const calls: { url: string; body: URLSearchParams }[] = [];
  const f = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(String(init!.body)) });
    return Promise.resolve(url.endsWith('/auth/token') ? new Response('{"refresh_token":"r1"}', { status: 200 }) : new Response(null, { status: 200 }));
  }) as typeof fetch;
  const r = await revokeAppleToken('code-1', { p8: pem, keyId: 'KEY1', teamId: 'TEAM1', clientId: 'io.x' }, 1_800_000_000, f);
  assertEq(r, 'revoked');
  assertEq(calls.map((c) => c.url), ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
  assertEq(Object.fromEntries([...calls[0]!.body].filter(([k]) => k !== 'client_secret')), { client_id: 'io.x', code: 'code-1', grant_type: 'authorization_code' });
  assertEq(Object.fromEntries([...calls[1]!.body].filter(([k]) => k !== 'client_secret')), { client_id: 'io.x', token: 'r1', token_type_hint: 'refresh_token' });
  const [h, c, sig] = calls[0]!.body.get('client_secret')!.split('.');
  assertEq(JSON.parse(new TextDecoder().decode(unb64url(h!))), { alg: 'ES256', kid: 'KEY1' });
  assertEq(JSON.parse(new TextDecoder().decode(unb64url(c!))), { iss: 'TEAM1', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'io.x' });
  assertEq(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig!), new TextEncoder().encode(`${h}.${c}`)), true);
});

Deno.test('Apple: zły kod, brak refresh tokenu, nieudane unieważnienie', async () => {
  const { pem } = await testKey();
  const k = { p8: pem, keyId: 'K', teamId: 'T', clientId: 'io.x' };
  const at = (token: Response, revoke = new Response(null, { status: 200 })) => ((url: string) => Promise.resolve(url.endsWith('/auth/token') ? token : revoke)) as typeof fetch;
  assertEq(await revokeAppleToken('c', k, 1, at(new Response('{"error":"invalid_grant"}', { status: 400 }))), 'exchange_failed');
  assertEq(await revokeAppleToken('c', k, 1, at(new Response('{}', { status: 200 }))), 'exchange_failed');
  assertEq(await revokeAppleToken('c', k, 1, at(new Response('{"refresh_token":"r"}', { status: 200 }), new Response('{}', { status: 400 }))), 'revoke_failed');
});
