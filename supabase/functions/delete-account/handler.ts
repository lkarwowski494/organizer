/**
 * Usunięcie konta (wymóg App Store 5.1.1(v); D5, D49, ADR 0004).
 * 1. Kto pyta: GET /auth/v1/user z JWT użytkownika (Supabase Auth sprawdza podpis i ważność).
 * 2. DELETE /auth/v1/admin/users/{id} kluczem tajnym — wyzwalacz bazy private.on_auth_user_deleted
 *    przekazuje grupy, zaciera imię w historii i usuwa grupę osobistą.
 * 1a. Konto z Apple: telefon podaje świeży kod autoryzacji (`appleAuthorizationCode`) — unieważniamy token Apple
 *     (src/_shared/apple-revoke.ts; O-036, ADR 0016). Klucz Sign in with Apple w sekretach APPLE_SIWA_KEY_P8 /
 *     APPLE_SIWA_KEY_ID; bez nich konto i tak jest usuwane, a odpowiedź mówi „not_configured”. Nieudane
 *     unieważnienie też nie blokuje usunięcia (prawo do usunięcia konta jest ważniejsze) — wynik jest w odpowiedzi.
 * Endpointy: https://github.com/supabase/auth/blob/master/openapi.yaml (/user, /admin/users/{userId}).
 * Zmienne środowiska Edge Functions (https://supabase.com/docs/guides/functions/secrets, „Default secrets”):
 * SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS (słowniki JSON), starsze SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY.
 */
import { revokeAppleToken } from '../_shared/apple-revoke.ts';
import { type Env, firstKey } from '../_shared/keys.ts';

export type { Env };

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, nowSec = Math.floor(Date.now() / 1000)): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return json(401, { error: 'unauthorized' });
  const url = env.get('SUPABASE_URL');
  if (!url) return json(500, { error: 'config' });
  let publishable: string;
  let secret: string;
  try {
    publishable = firstKey(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    secret = firstKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch {
    return json(500, { error: 'config' });
  }
  const who = await fetchFn(`${url}/auth/v1/user`, { headers: { authorization: auth, apikey: publishable } });
  if (!who.ok) return json(401, { error: 'unauthorized' });
  const user = (await who.json()) as { id?: string };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return json(401, { error: 'unauthorized' });
  const input = (await req.json().catch(() => ({}))) as { appleAuthorizationCode?: unknown };
  const code = typeof input.appleAuthorizationCode === 'string' && input.appleAuthorizationCode !== '' ? input.appleAuthorizationCode : null;
  const p8 = env.get('APPLE_SIWA_KEY_P8');
  const keyId = env.get('APPLE_SIWA_KEY_ID');
  const teamId = env.get('APNS_TEAM_ID');
  const clientId = env.get('APNS_BUNDLE_ID');
  const apple = !code ? 'not_apple' : p8 && keyId && teamId && clientId ? await revokeAppleToken(code, { p8, keyId, teamId, clientId }, nowSec, fetchFn).catch(() => 'revoke_failed' as const) : 'not_configured';
  const del = await fetchFn(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}`, apikey: secret } });
  if (!del.ok) return json(502, { error: 'delete_failed', status: del.status });
  return json(200, { deleted: true, apple });
}
