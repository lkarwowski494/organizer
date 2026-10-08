/**
 * Wysyłka do APNs (D6, ADR 0002: tylko `fetch`, sprawdzony spike'iem S1 w obu środowiskach).
 * Źródła (przeczytane 6.10.2026):
 *  - żądanie: POST /3/device/<token>, nagłówki apns-topic, apns-push-type, authorization: bearer <JWT>;
 *    410 = token nieaktualny, 400 BadDeviceToken = zły token:
 *    https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 *    https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
 *  - token dostawcy: ES256, kid = Key ID, iss = Team ID, iat; odświeżać nie częściej niż co 20 min, nie starszy niż 1 h:
 *    https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 */
import { signEs256 } from './jwt.ts';

export const APNS_HOSTS = { sandbox: 'api.sandbox.push.apple.com', production: 'api.push.apple.com' } as const;
export type ApnsEnv = keyof typeof APNS_HOSTS;

/** Token dostawcy APNs: ES256, kid = Key ID, iss = Team ID, iat. */
export function providerToken(p8: string, keyId: string, teamId: string, nowSec: number): Promise<string> {
  return signEs256(p8, { alg: 'ES256', kid: keyId }, { iss: teamId, iat: nowSec });
}

/** Token dostawcy trzymany w ciepłej instancji funkcji przez 30 min (Apple: nie częściej niż co 20 min, nie dłużej niż 1 h). */
const REUSE_SEC = 30 * 60;
let cached: { key: string; jwt: string; iat: number } | null = null;
export async function cachedProviderToken(p8: string, keyId: string, teamId: string, nowSec: number): Promise<string> {
  const k = `${keyId}|${teamId}`;
  if (cached && cached.key === k && nowSec - cached.iat < REUSE_SEC) return cached.jwt;
  const jwt = await providerToken(p8, keyId, teamId, nowSec);
  cached = { key: k, jwt, iat: nowSec };
  return jwt;
}

export type SendResult = 'sent' | 'drop' | 'error';

/**
 * Jedno powiadomienie. `drop` — token do usunięcia (410 albo 400 BadDeviceToken). `data` — własne pola obok „aps”
 * pod kluczem „body”: expo-notifications na iPhonie podaje je aplikacji jako `content.data` (dla powiadomień push czyta
 * `userInfo["body"]`, expo-notifications 57 ios/…/NotificationRecords.swift); starsze buildy je pomijają.
 */
export async function sendAlert(a: { env: ApnsEnv; token: string; jwt: string; topic: string; title: string; body: string; data?: Record<string, string> }, fetchFn: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetchFn(`https://${APNS_HOSTS[a.env]}/3/device/${a.token}`, {
      method: 'POST',
      headers: { authorization: `bearer ${a.jwt}`, 'apns-topic': a.topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
      body: JSON.stringify({ aps: { alert: { title: a.title, body: a.body }, sound: 'default' }, ...(a.data ? { body: a.data } : {}) }),
    });
    if (res.status === 200) return 'sent';
    const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason;
    return res.status === 410 || (res.status === 400 && reason === 'BadDeviceToken') ? 'drop' : 'error';
  } catch {
    return 'error';
  }
}
