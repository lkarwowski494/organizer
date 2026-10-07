/**
 * Usunięcie konta (wymóg App Store 5.1.1(v); D5, D49, ADR 0004).
 * 1. Kto pyta: GET /auth/v1/user z JWT użytkownika (Supabase Auth sprawdza podpis i ważność).
 * 2. DELETE /auth/v1/admin/users/{id} kluczem tajnym — wyzwalacz bazy private.on_auth_user_deleted
 *    przekazuje grupy, zaciera imię w historii i usuwa grupę osobistą.
 * Endpointy: https://github.com/supabase/auth/blob/master/openapi.yaml (/user, /admin/users/{userId}).
 * Zmienne środowiska Edge Functions (https://supabase.com/docs/guides/functions/secrets, „Default secrets”):
 * SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS (słowniki JSON), starsze SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY.
 */
export type Env = { get(name: string): string | undefined };

function firstKey(env: Env, dict: string, legacy: string): string {
  const raw = env.get(dict);
  if (raw) {
    const values = Object.values(JSON.parse(raw) as Record<string, string>);
    if (values[0]) return values[0];
  }
  const l = env.get(legacy);
  if (!l) throw new Error(`brak klucza ${dict} / ${legacy}`);
  return l;
}

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch): Promise<Response> {
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
  const del = await fetchFn(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}`, apikey: secret } });
  if (!del.ok) return json(502, { error: 'delete_failed', status: del.status });
  return json(200, { deleted: true });
}
