/**
 * Usunięcie konta (wymóg App Store 5.1.1(v); D5, D49, ADR 0004).
 * 1. Kto pyta: GET /auth/v1/user z JWT użytkownika (Supabase Auth sprawdza podpis i ważność).
 * 2. DELETE /auth/v1/admin/users/{id} kluczem tajnym — wyzwalacz bazy private.on_auth_user_deleted
 *    przekazuje grupy, zaciera imię w historii i usuwa grupę osobistą.
 * 1a. Konto z tożsamością Apple (identities[].provider = 'apple') potwierdza usunięcie świeżym kodem autoryzacji
 *     (`appleAuthorizationCode`, okno Apple na telefonie) — audyt 2 M-303 / PWD-34 A: przechwycony token sesji (1 h)
 *     nie wystarcza do nieodwracalnego usunięcia. Kod sprawdza Apple (_shared/apple-revoke.ts, checkAppleCode), a `sub`
 *     z tokenu tożsamości musi być identyfikatorem Apple tego konta: w Supabase Auth to `id` tożsamości — „ProviderID
 *     string json:"id" db:"provider_id"” (https://github.com/supabase/auth/blob/master/internal/models/identity.go).
 *     Brak kodu → 403 apple_code_required, zły kod → 403 apple_code_invalid, Apple niedostępne → 502 apple_unavailable.
 *     Potem unieważniamy token Apple (O-036, ADR 0016); nieudane unieważnienie nie blokuje usunięcia — wynik w odpowiedzi.
 *     Bez klucza Sign in with Apple w sekretach (APPLE_SIWA_KEY_P8 / APPLE_SIWA_KEY_ID) albo ze złym kluczem kodu nie da
 *     się sprawdzić: wymagamy wtedy samej obecności kodu i usuwamy z „not_configured” — błąd konfiguracji nie może
 *     zablokować prawa do usunięcia konta (App Store 5.1.1(v)).
 * 1b. Konto bez Apple (dawne logowanie linkiem z e-maila, wyłączone w becie — D177): wystarcza sesja; ponownego
 *     potwierdzenia e-mailem nie ma, bo wysyłka linków jest wyłączona.
 * Endpointy: https://github.com/supabase/auth/blob/master/openapi.yaml (/user, /admin/users/{userId}).
 * Zmienne środowiska Edge Functions (https://supabase.com/docs/guides/functions/secrets, „Default secrets”):
 * SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS (słowniki JSON), starsze SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY.
 */
import { checkAppleCode, revokeAppleToken } from '../_shared/apple-revoke.ts';
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
  const user = (await who.json()) as { id?: string; identities?: { provider?: unknown; id?: unknown }[] };
  if (!user.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return json(401, { error: 'unauthorized' });
  const appleIds = (Array.isArray(user.identities) ? user.identities : []).filter((i) => i?.provider === 'apple' && typeof i.id === 'string').map((i) => i.id as string);
  const input = (await req.json().catch(() => ({}))) as { appleAuthorizationCode?: unknown };
  const code = typeof input.appleAuthorizationCode === 'string' && input.appleAuthorizationCode !== '' ? input.appleAuthorizationCode : null;
  let apple: 'not_apple' | 'not_configured' | 'revoked' | 'revoke_failed' = 'not_apple';
  if (appleIds.length) {
    if (!code) return json(403, { error: 'apple_code_required' });
    const p8 = env.get('APPLE_SIWA_KEY_P8');
    const keyId = env.get('APPLE_SIWA_KEY_ID');
    const teamId = env.get('APNS_TEAM_ID');
    const clientId = env.get('APNS_BUNDLE_ID');
    if (p8 && keyId && teamId && clientId) {
      const checked = await checkAppleCode(code, { p8, keyId, teamId, clientId }, nowSec, fetchFn).catch(() => ({ ok: false, reason: 'unavailable' }) as const);
      if (checked.ok) {
        if (!appleIds.includes(checked.sub)) return json(403, { error: 'apple_code_invalid' });
        apple = await revokeAppleToken(checked.refreshToken, checked.secret, clientId, fetchFn).catch(() => 'revoke_failed' as const);
      } else if (checked.reason === 'invalid') return json(403, { error: 'apple_code_invalid' });
      else if (checked.reason === 'unavailable') return json(502, { error: 'apple_unavailable' });
      else apple = 'not_configured';
    } else apple = 'not_configured';
  }
  const del = await fetchFn(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}`, apikey: secret } });
  if (!del.ok) return json(502, { error: 'delete_failed', status: del.status });
  return json(200, { deleted: true, apple });
}
