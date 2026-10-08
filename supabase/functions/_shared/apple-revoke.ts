/**
 * Sign in with Apple przy usuwaniu konta: sprawdzenie świeżego kodu autoryzacji i unieważnienie tokenu Apple (wymóg
 * Apple: „Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens”,
 * https://developer.apple.com/support/offering-account-deletion-in-your-app/; O-036, ADR 0016; audyt 2 M-303 / PWD-34 A).
 * 1. client secret: JWT ES256, nagłówek kid, claims iss = Team ID, iat, exp (≤ 6 mies.), aud = https://appleid.apple.com,
 *    sub = identyfikator aplikacji (bundle ID) — dokumentacja „Creating a client secret”.
 * 2. POST https://appleid.apple.com/auth/token (client_id, client_secret, code, grant_type=authorization_code) — „Validate
 *    an authorization grant code delivered to your app to obtain tokens”; kod „is single-use only and valid for five
 *    minutes”; odpowiedź: „the endpoint returns the identity token, an access token, and a refresh token”
 *    (https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens). Odrzucony kod:
 *    `invalid_grant` — „invalid code (expired or previously used authorization code)”
 *    (https://developer.apple.com/documentation/signinwithapplerestapi/errorresponse).
 * 3. Token tożsamości z tej odpowiedzi: `sub` — „the unique identifier for the user”, `aud` — „the client_id from your
 *    developer account”, `iss` — „https://appleid.apple.com”
 *    (https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token). Podpisu nie sprawdzamy:
 *    token przyszedł wprost z punktu końcowego Apple po TLS — OpenID Connect Core 1.0, 3.1.3.7: „If the ID Token is
 *    received via direct communication between the Client and the Token Endpoint …, the TLS server validation MAY be
 *    used to validate the issuer in place of checking the token signature”
 *    (https://openid.net/specs/openid-connect-core-1_0.html).
 * 4. POST https://appleid.apple.com/auth/revoke (token, token_type_hint=refresh_token) → 200 — „Revoke tokens”.
 */
import { signEs256 } from './jwt.ts';

export type AppleKeys = { p8: string; keyId: string; teamId: string; clientId: string };
export type RevokeResult = 'revoked' | 'revoke_failed';
/**
 * `invalid` — Apple odrzucił kod (zły, użyty, po 5 min) albo token nie pasuje; `unavailable` — Apple nie odpowiedział
 * poprawnie; `config` — nasz klucz jest zły (nie da się podpisać albo Apple zwraca `invalid_client` — „invalid client
 * secret (expired token, malformed claims, or invalid signature)”, errorresponse wyżej).
 */
export type CodeCheck = { ok: true; sub: string; refreshToken: string; secret: string } | { ok: false; reason: 'invalid' | 'unavailable' | 'config' };

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ISSUER = 'https://appleid.apple.com';

function claims(jwt: unknown): { sub?: unknown; aud?: unknown; iss?: unknown } | null {
  if (typeof jwt !== 'string') return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const bin = atob(part.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (part.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Kod autoryzacji z telefonu → identyfikator użytkownika Apple (sub) i refresh token do unieważnienia. */
export async function checkAppleCode(code: string, k: AppleKeys, nowSec: number, fetchFn: typeof fetch = fetch): Promise<CodeCheck> {
  let secret: string;
  try {
    secret = await signEs256(k.p8, { alg: 'ES256', kid: k.keyId }, { iss: k.teamId, iat: nowSec, exp: nowSec + 300, aud: ISSUER, sub: k.clientId });
  } catch {
    return { ok: false, reason: 'config' };
  }
  const res = await fetchFn(`${ISSUER}/auth/token`, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: k.clientId, client_secret: secret, code, grant_type: 'authorization_code' }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: unknown; id_token?: unknown; error?: unknown };
  if (!res.ok) return { ok: false, reason: body.error === 'invalid_grant' ? 'invalid' : body.error === 'invalid_client' ? 'config' : 'unavailable' };
  const c = claims(body.id_token);
  if (typeof body.refresh_token !== 'string' || !c) return { ok: false, reason: 'unavailable' };
  if (c.iss !== ISSUER || c.aud !== k.clientId || typeof c.sub !== 'string' || !c.sub) return { ok: false, reason: 'invalid' };
  return { ok: true, sub: c.sub, refreshToken: body.refresh_token, secret };
}

export async function revokeAppleToken(refreshToken: string, secret: string, clientId: string, fetchFn: typeof fetch = fetch): Promise<RevokeResult> {
  const rev = await fetchFn(`${ISSUER}/auth/revoke`, {
    method: 'POST',
    headers: FORM,
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, token: refreshToken, token_type_hint: 'refresh_token' }).toString(),
  });
  return rev.ok ? 'revoked' : 'revoke_failed';
}
