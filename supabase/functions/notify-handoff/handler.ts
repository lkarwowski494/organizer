/**
 * Powiadomienie o przekazaniu (D70 „push + w aplikacji”, ADR 0015). Telefon woła po wysłaniu przekazania albo decyzji.
 * 1. Kto pyta: GET /auth/v1/user z JWT użytkownika.
 * 2. Komu i co: public.handoff_push_claim (baza sprawdza, czy pytający jest stroną, czy stan już powiadomiony,
 *    i zaznacza wysyłkę) — kluczem tajnym przez PostgREST.
 * 3. APNs do każdego tokenu odbiorcy; nieaktualne tokeny usuwane (public.drop_push_token).
 */
import { type ApnsEnv, cachedProviderToken, sendAlert } from '../_shared/apns.ts';
import { type Env, firstKey } from '../_shared/keys.ts';

/** Starszych przekazań nie powiadamiamy (np. sprzed instalacji wersji z push). Równe config.PUSH_MAX_AGE_H (test kontraktowy). */
export const PUSH_MAX_AGE_H = 24;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Claim = { title: string; body: string; tokens: { token: string; env: ApnsEnv }[] } | null;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, nowSec = Math.floor(Date.now() / 1000)): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return json(401, { error: 'unauthorized' });
  const input = (await req.json().catch(() => ({}))) as { handoffId?: unknown };
  if (typeof input.handoffId !== 'string' || !UUID.test(input.handoffId)) return json(400, { error: 'bad_request' });
  const url = env.get('SUPABASE_URL');
  const p8 = env.get('APNS_KEY_P8');
  const keyId = env.get('APNS_KEY_ID');
  const teamId = env.get('APNS_TEAM_ID');
  const topic = env.get('APNS_BUNDLE_ID');
  let publishable: string;
  let secret: string;
  try {
    publishable = firstKey(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    secret = firstKey(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  } catch {
    return json(500, { error: 'config' });
  }
  if (!url || !p8 || !keyId || !teamId || !topic) return json(500, { error: 'config' });

  const who = await fetchFn(`${url}/auth/v1/user`, { headers: { authorization: auth, apikey: publishable } });
  if (!who.ok) return json(401, { error: 'unauthorized' });
  const user = (await who.json()) as { id?: string };
  if (!user.id || !UUID.test(user.id)) return json(401, { error: 'unauthorized' });

  const rpc = (name: string, args: object) =>
    fetchFn(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, apikey: secret, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const claimRes = await rpc('handoff_push_claim', { p_handoff: input.handoffId, p_user: user.id, p_max_age_h: PUSH_MAX_AGE_H });
  if (!claimRes.ok) return json(502, { error: 'claim_failed' });
  const claim = (await claimRes.json()) as Claim;
  if (!claim) return json(200, { sent: 0 });

  const jwt = await cachedProviderToken(p8, keyId, teamId, nowSec);
  let sent = 0;
  for (const t of claim.tokens) {
    const r = await sendAlert({ env: t.env, token: t.token, jwt, topic, title: claim.title, body: claim.body }, fetchFn);
    if (r === 'sent') sent++;
    if (r === 'drop') await rpc('drop_push_token', { p_token: t.token });
  }
  return json(200, { sent });
}
