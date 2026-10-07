/**
 * JWT ES256 podpisywany kluczem .p8 z Apple (PKCS#8, krzywa P-256) — WebCrypto, bez zależności.
 * Używany przez APNs (token dostawcy) i Sign in with Apple (client secret). JWS ES256 wymaga podpisu r||s (64 bajty),
 * a WebCrypto zwraca ECDSA właśnie w tym formacie (RFC 7518, sekcja 3.4: https://www.rfc-editor.org/rfc/rfc7518#section-3.4).
 */
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

export async function signEs256(p8: string, header: Record<string, string>, claims: Record<string, string | number>): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = new TextEncoder();
  const input = `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(claims)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)));
  return `${input}.${base64url(sig)}`;
}
