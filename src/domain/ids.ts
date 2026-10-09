/**
 * Identyfikatory UUIDv7 nadawane na telefonie (R3), także offline.
 * Format wg RFC 9562, sekcja 5.7: 48 bitów czasu uniksowego w milisekundach,
 * 4 bity wersji (0111), 12 bitów losowych, 2 bity wariantu (10), 62 bity losowe.
 * https://www.rfc-editor.org/rfc/rfc9562#section-5.7: „UUIDv7 values are created by allocating a Unix timestamp in
 * milliseconds in the most significant 48 bits and filling the remaining 74 bits, excluding the required version and
 * variant bits, with random bits”.
 *
 * Domena nie importuje Reacta ani Expo — źródło losowości i zegar są wstrzykiwane,
 * dzięki czemu testy są deterministyczne.
 */
export type RandomBytes = (length: number) => Uint8Array;
export type Clock = () => number;

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuidv7(randomBytes: RandomBytes, now: Clock = Date.now): string {
  const ms = now();
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffffffffffff) {
    throw new RangeError(`uuidv7: znacznik czasu poza zakresem 48 bitów: ${ms}`);
  }
  const rand = randomBytes(10);
  if (rand.length !== 10) {
    throw new RangeError('uuidv7: źródło losowości musi zwrócić 10 bajtów');
  }

  const b = new Uint8Array(16);
  // 48 bitów czasu, big-endian. Dzielenie zamiast przesunięć bitowych, bo JS przesuwa tylko 32 bity.
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(rand, 6);
  b[6] = 0x70 | (rand[0]! & 0x0f); // wersja 7
  b[8] = 0x80 | (rand[2]! & 0x3f); // wariant RFC 9562

  let s = '';
  for (let i = 0; i < 16; i++) {
    s += HEX[b[i]!];
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
  }
  return s;
}

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: string): boolean {
  return UUIDV7_RE.test(value);
}

/** Odczytuje znacznik czasu (ms) zapisany w UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  if (!isUuidv7(id)) throw new TypeError(`To nie jest UUIDv7: ${id}`);
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/**
 * SHA-1 (FIPS 180-4, https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf, sekcja 6.1) — tylko do UUIDv5,
 * który RFC 9562 definiuje na SHA-1 (identyfikator, nie zabezpieczenie).
 */
export function sha1(data: Uint8Array): Uint8Array {
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(data);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0; // prettier-ignore
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4; // prettier-ignore
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h));
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * UUIDv5 (RFC 9562, sekcja 5.5, https://www.rfc-editor.org/rfc/rfc9562#section-5.5: „computing an SHA-1 hash … over a
 * given Namespace ID value … concatenated with the desired name value … The most significant, leftmost 128 bits of the
 * SHA-1 value are then used”): SHA-1 z przestrzeni nazw i nazwy, wersja 5, wariant RFC. Ten sam wynik na każdym
 * telefonie — kopie stałych zadań serii mają identyfikator z definicji i daty wystąpienia (D65), więc się nie dublują.
 */
export function uuidv5(namespace: string, name: string): string {
  const ns = namespace.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(ns)) throw new TypeError(`uuidv5: zła przestrzeń nazw ${namespace}`);
  const nsBytes = Uint8Array.from(ns.match(/../g)!.map((x) => parseInt(x, 16)));
  const nameBytes = utf8(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(nsBytes);
  input.set(nameBytes, 16);
  const b = sha1(input).slice(0, 16);
  b[6] = 0x50 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += HEX[b[i]!];
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
  }
  return s;
}
