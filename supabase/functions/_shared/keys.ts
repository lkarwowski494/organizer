/**
 * Klucze Supabase w Edge Functions (https://supabase.com/docs/guides/functions/secrets, „Default secrets”):
 * słowniki JSON SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS albo starsze SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
 */
export type Env = { get(name: string): string | undefined };

export function firstKey(env: Env, dict: string, legacy: string): string {
  const raw = env.get(dict);
  if (raw) {
    const values = Object.values(JSON.parse(raw) as Record<string, string>);
    if (values[0]) return values[0];
  }
  const l = env.get(legacy);
  if (!l) throw new Error(`brak klucza ${dict} / ${legacy}`);
  return l;
}
