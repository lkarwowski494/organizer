/**
 * Spike S1 (Etap 0): czy Edge Function Supabase wyśle żądanie do APNs (HTTP/2 + token JWT ES256).
 * Funkcja tymczasowa — po spike'u usuwana z projektu Supabase; wnioski trafiają do docs/adr.
 *
 * Źródła (przeczytane 6.10.2026):
 *  - APNs wymaga HTTP/2 i TLS; hosty api.sandbox.push.apple.com / api.push.apple.com; nagłówki
 *    apns-topic, apns-push-type, authorization: bearer <JWT>:
 *    https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 *  - token JWT: alg ES256, kid = Key ID, iss = Team ID, iat; odświeżać nie częściej niż co 20 min,
 *    nie starszy niż 1 h:
 *    https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 *  - przykład node:http2 w Edge Function Supabase (szczebel 4, tylko wskazówka):
 *    https://github.com/launchtodayhq/expo-push-notifications
 *
 * Wywołanie: POST {"deviceToken"?: string, "env"?: "sandbox" | "production", "transport"?: "fetch" | "http2" | "both"}
 * Bez deviceToken wysyła na fałszywy token (64 zera). Interpretacja odpowiedzi APNs:
 *  - 400 BadDeviceToken  → HTTP/2 działa i APNs przyjął nasz JWT (klucz .p8, Key ID, Team ID poprawne),
 *  - 403 InvalidProviderToken → połączenie działa, ale klucz / Key ID / Team ID są złe,
 *  - błąd połączenia → transport nie obsługuje HTTP/2 do APNs.
 */
import { connect } from 'node:http2';

const HOSTS = {
  sandbox: 'api.sandbox.push.apple.com',
  production: 'api.push.apple.com',
} as const;

type Env = keyof typeof HOSTS;
type Result = { transport: string; ok: boolean; status?: number; body?: string; error?: string; ms: number };

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Klucz .p8 to PKCS#8 w PEM. Wklejony do sekretu mógł stracić znaki nowej linii — bierzemy samo base64. */
function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function providerToken(p8: string, keyId: string, teamId: string, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(p8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const claims = base64url(enc.encode(JSON.stringify({ iss: teamId, iat: nowSec })));
  const signingInput = `${header}.${claims}`;
  // WebCrypto zwraca podpis ECDSA w formacie r||s (64 bajty) — dokładnie tym, którego wymaga JWS ES256.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)),
  );
  return `${signingInput}.${base64url(sig)}`;
}

function headersFor(jwt: string, topic: string): Record<string, string> {
  return {
    authorization: `bearer ${jwt}`,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  };
}

const PAYLOAD = JSON.stringify({ aps: { alert: { title: 'Organizer', body: 'Test powiadomienia (spike S1)' } } });

async function viaFetch(host: string, token: string, headers: Record<string, string>): Promise<Result> {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://${host}/3/device/${token}`, { method: 'POST', headers, body: PAYLOAD });
    const body = await res.text();
    return { transport: 'fetch', ok: true, status: res.status, body, ms: Date.now() - t0 };
  } catch (e) {
    return { transport: 'fetch', ok: false, error: String(e), ms: Date.now() - t0 };
  }
}

function viaHttp2(host: string, token: string, headers: Record<string, string>): Promise<Result> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const done = (r: Omit<Result, 'transport' | 'ms'>) => {
      client.close();
      resolve({ transport: 'http2', ms: Date.now() - t0, ...r });
    };
    const client = connect(`https://${host}`);
    client.on('error', (e: unknown) => done({ ok: false, error: String(e) }));
    const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, ...headers });
    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (h: Record<string, unknown>) => {
      status = Number(h[':status']);
    });
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => done({ ok: true, status, body }));
    req.on('error', (e: unknown) => done({ ok: false, error: String(e) }));
    req.end(PAYLOAD);
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const input = await req.json().catch(() => ({}));
  const env: Env = input.env === 'production' ? 'production' : 'sandbox';
  const deviceToken: string = typeof input.deviceToken === 'string' ? input.deviceToken : '0'.repeat(64);
  const transport: string = input.transport ?? 'both';

  const p8 = Deno.env.get('APNS_KEY_P8');
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const topic = Deno.env.get('APNS_BUNDLE_ID');
  if (!p8 || !keyId || !teamId || !topic) {
    return Response.json({ error: 'Brak sekretów APNS_*' }, { status: 500 });
  }

  let jwt: string;
  try {
    jwt = await providerToken(p8, keyId, teamId, Math.floor(Date.now() / 1000));
  } catch (e) {
    return Response.json({ error: `Nie udało się podpisać JWT (zły format klucza .p8?): ${e}` }, { status: 500 });
  }

  const host = HOSTS[env];
  const headers = headersFor(jwt, topic);
  const results: Result[] = [];
  if (transport === 'fetch' || transport === 'both') results.push(await viaFetch(host, deviceToken, headers));
  if (transport === 'http2' || transport === 'both') results.push(await viaHttp2(host, deviceToken, headers));

  // Do odpowiedzi nie trafia ani JWT, ani klucz — tylko statusy APNs.
  return Response.json({ env, host, fakeToken: input.deviceToken === undefined, results });
});
