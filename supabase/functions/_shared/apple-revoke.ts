/**
 * Unieważnienie tokenu Sign in with Apple przy usuwaniu konta (wymóg Apple: „Apps that support Sign in with Apple
 * should use the Sign in with Apple REST API to revoke user tokens”,
 * https://developer.apple.com/support/offering-account-deletion-in-your-app/; O-036, ADR 0016).
 * 1. client secret: JWT ES256, nagłówek kid, claims iss = Team ID, iat, exp (≤ 6 mies.), aud = https://appleid.apple.com,
 *    sub = identyfikator aplikacji (bundle ID) — dokumentacja „Creating a client secret”.
 * 2. POST https://appleid.apple.com/auth/token (client_id, client_secret, code, grant_type=authorization_code) → refresh_token;
 *    kod jest jednorazowy i ważny 5 minut — „Generate and validate tokens”.
 * 3. POST https://appleid.apple.com/auth/revoke (token, token_type_hint=refresh_token) → 200 — „Revoke tokens”.
 */
import { signEs256 } from './jwt.ts';

export type AppleKeys = { p8: string; keyId: string; teamId: string; clientId: string };
export type RevokeResult = 'revoked' | 'exchange_failed' | 'revoke_failed';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

export async function revokeAppleToken(code: string, k: AppleKeys, nowSec: number, fetchFn: typeof fetch = fetch): Promise<RevokeResult> {
  const secret = await signEs256(k.p8, { alg: 'ES256', kid: k.keyId }, { iss: k.teamId, iat: nowSec, exp: nowSec + 300, aud: 'https://appleid.apple.com', sub: k.clientId });
  const tokenRes = await fetchFn('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: k.clientId, client_secret: secret, code, grant_type: 'authorization_code' }).toString(),
  });
  const refresh = tokenRes.ok ? ((await tokenRes.json()) as { refresh_token?: string }).refresh_token : undefined;
  if (!refresh) return 'exchange_failed';
  const rev = await fetchFn('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: k.clientId, client_secret: secret, token: refresh, token_type_hint: 'refresh_token' }).toString(),
  });
  return rev.ok ? 'revoked' : 'revoke_failed';
}
