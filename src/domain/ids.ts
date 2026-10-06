/**
 * Identyfikatory UUIDv7 nadawane na telefonie (R3), także offline.
 * Format wg RFC 9562, sekcja 5.7: 48 bitów czasu uniksowego w milisekundach,
 * 4 bity wersji (0111), 12 bitów losowych, 2 bity wariantu (10), 62 bity losowe.
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
