/**
 * Powiadomienie o przekazaniu (D70 „push + w aplikacji”, ADR 0015) albo przypisaniu (D81, ADR 0017). Telefon woła
 * z `handoffId` po wysłaniu przekazania albo decyzji, z `activityId` po przypisaniu zadania lub zakupów komuś.
 * 1. Kto pyta: GET /auth/v1/user z JWT użytkownika.
 * 2. Komu i co: public.handoff_push_claim / assignment_push_claim (baza sprawdza, czy pytający jest stroną albo
 *    autorem, czy już powiadomione, wyciszenie grupy, i zaznacza wysyłkę) — kluczem tajnym przez PostgREST.
 * 3. APNs do każdego tokenu odbiorcy; nieaktualne tokeny usuwane (public.drop_push_token).
 * 4. Audyt 2 (N-15): gdy żadne urządzenie nie przyjęło powiadomienia z powodu błędu APNs (500/503/429,
 *    ExpiredProviderToken, sieć), zaznaczenie z claim jest zwalniane (public.push_claim_release) i odpowiedź to 502 —
 *    telefon ponawia przy powrocie do aplikacji albo następnym uruchomieniu, a baza znów pozwala wysłać raz.
 * 5. Audyt 2 (M-185, D183): najwyżej config.quotas.NOTIFY_PER_HOUR próśb na konto na godzinę (public.notify_rate_hit,
 *    przed pytaniem o odbiorców) — ponad limit 429 bez wysyłki; odpowiedź nie mówi, ile urządzeń ma odbiorca ({ ok: true });
 *    wysyłka do urządzeń odbiorcy po APNS_PARALLEL naraz (tokenów jest najwyżej config.quotas.PUSH_TOKENS na konto).
 */
import { type ApnsEnv, cachedProviderToken, sendAlert } from '../_shared/apns.ts';
import { type Env, firstKey } from '../_shared/keys.ts';

/** Starszych przekazań nie powiadamiamy (np. sprzed instalacji wersji z push). Równe config.PUSH_MAX_AGE_H (test kontraktowy). */
export const PUSH_MAX_AGE_H = 24;

/** Ile wysyłek do APNs naraz. Wybór projektowy, bez źródła: kilka równoległych żądań HTTP/2 skraca czas działania funkcji. */
export const APNS_PARALLEL = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `key` — do zwolnienia zaznaczenia; `path` — co otwiera dotknięcie (PWD-16): obie od migracji 20261008350000, starsza
 * baza ich nie podaje — wtedy bez zwalniania i bez ścieżki (dotknięcie otwiera aplikację jak dotąd).
 */
type Claim = { title: string; body: string; tokens: { token: string; env: ApnsEnv }[]; key?: string; path?: string } | null;

export async function handle(req: Request, env: Env, fetchFn: typeof fetch = fetch, nowSec = Math.floor(Date.now() / 1000)): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = req.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) return json(401, { error: 'unauthorized' });
  const input = (await req.json().catch(() => ({}))) as { handoffId?: unknown; activityId?: unknown };
  const byHandoff = typeof input.handoffId === 'string' && UUID.test(input.handoffId);
  const byActivity = typeof input.activityId === 'string' && UUID.test(input.activityId);
  if (byHandoff === byActivity) return json(400, { error: 'bad_request' });
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
  // Starsza baza (bez migracji 20261008482000) nie zna licznika — 404; wtedy bez limitu, jak dotąd.
  const rate = await rpc('notify_rate_hit', { p_user: user.id });
  if (rate.ok && (await rate.json()) === false) return json(429, { error: 'rate_limited' });
  const claimRes = byHandoff
    ? await rpc('handoff_push_claim', { p_handoff: input.handoffId, p_user: user.id, p_max_age_h: PUSH_MAX_AGE_H })
    : await rpc('assignment_push_claim', { p_activity: input.activityId, p_user: user.id, p_max_age_h: PUSH_MAX_AGE_H });
  if (!claimRes.ok) return json(502, { error: 'claim_failed' });
  const claim = (await claimRes.json()) as Claim;
  if (!claim) return json(200, { ok: true });

  const jwt = await cachedProviderToken(p8, keyId, teamId, nowSec);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < claim.tokens.length; i += APNS_PARALLEL) {
    await Promise.all(
      claim.tokens.slice(i, i + APNS_PARALLEL).map(async (t) => {
        const r = await sendAlert({ env: t.env, token: t.token, jwt, topic, title: claim.title, body: claim.body, ...(claim.path ? { data: { path: claim.path } } : {}) }, fetchFn);
        if (r === 'sent') sent++;
        else if (r === 'drop') await rpc('drop_push_token', { p_token: t.token });
        else failed++;
      }),
    );
  }
  // Doszło choć na jedno urządzenie — bez ponowienia (inaczej to urządzenie dostałoby je drugi raz).
  if (sent === 0 && failed > 0) {
    if (claim.key) await rpc('push_claim_release', { p_key: claim.key });
    return json(502, { error: 'apns_failed' });
  }
  return json(200, { ok: true });
}
