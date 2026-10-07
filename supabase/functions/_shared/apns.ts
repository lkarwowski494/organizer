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
export const APNS_HOSTS = { sandbox: 'api.sandbox.push.apple.com', production: 'api.push.apple.com' } as const;
export type ApnsEnv = keyof typeof APNS_HOSTS;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Klucz .p8 to PKCS#8 w PEM. Wklejony do sekretu mógł stracić znaki nowej linii — bierzemy samo base64. */
function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function providerToken(p8: string, keyId: string, teamId: string, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const claims = base64url(enc.encode(JSON.stringify({ iss: teamId, iat: nowSec })));
  const input = `${header}.${claims}`;
  // WebCrypto zwraca podpis ECDSA jako r||s (64 bajty) — dokładnie format JWS ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)));
  return `${input}.${base64url(sig)}`;
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

/** Jedno powiadomienie. `drop` — token do usunięcia (410 albo 400 BadDeviceToken). */
export async function sendAlert(a: { env: ApnsEnv; token: string; jwt: string; topic: string; title: string; body: string }, fetchFn: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetchFn(`https://${APNS_HOSTS[a.env]}/3/device/${a.token}`, {
      method: 'POST',
      headers: { authorization: `bearer ${a.jwt}`, 'apns-topic': a.topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
      body: JSON.stringify({ aps: { alert: { title: a.title, body: a.body }, sound: 'default' } }),
    });
    if (res.status === 200) return 'sent';
    const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason;
    return res.status === 410 || (res.status === 400 && reason === 'BadDeviceToken') ? 'drop' : 'error';
  } catch {
    return 'error';
  }
}
