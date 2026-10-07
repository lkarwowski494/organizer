import { randomBytes as nodeRandomBytes } from 'node:crypto';
import * as fc from 'fast-check';
import { isUuidv7, uuidv7, uuidv7Timestamp, sha1, uuidv5 } from '../ids';

const rng = (n: number) => new Uint8Array(nodeRandomBytes(n));

describe('uuidv7', () => {
  it('ma format RFC 9562 (wersja 7, wariant 10)', () => {
    expect(isUuidv7(uuidv7(rng))).toBe(true);
  });

  it('jest deterministyczny przy wstrzykniętym zegarze i losowości', () => {
    const zeros = (n: number) => new Uint8Array(n);
    expect(uuidv7(zeros, () => 0x017f22e279b0)).toBe('017f22e2-79b0-7000-8000-000000000000');
  });

  it('własność: znacznik czasu da się odczytać z powrotem', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffffffff }), (ms) => {
        const id = uuidv7(rng, () => ms);
        expect(isUuidv7(id)).toBe(true);
        expect(uuidv7Timestamp(id)).toBe(ms);
      }),
    );
  });

  it('własność: późniejszy czas daje leksykograficznie większe id', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xfffffffffffe }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (ms, delta) => {
          const later = Math.min(ms + delta, 0xffffffffffff);
          fc.pre(later > ms);
          expect(uuidv7(rng, () => ms) < uuidv7(rng, () => later)).toBe(true);
        },
      ),
    );
  });

  it('nie powtarza się przy 10 000 wywołań w tej samej milisekundzie', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7(rng, () => 1)));
    expect(ids.size).toBe(10_000);
  });

  it('odrzuca czas spoza 48 bitów i złe źródło losowości', () => {
    expect(() => uuidv7(rng, () => -1)).toThrow(RangeError);
    expect(() => uuidv7(rng, () => 2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(() => new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('uuidv7Timestamp', () => {
  it('odrzuca identyfikator, który nie jest UUIDv7', () => {
    expect(() => uuidv7Timestamp('not-a-uuid')).toThrow(TypeError);
    expect(() => uuidv7Timestamp('00000000-0000-4000-8000-000000000000')).toThrow(TypeError);
  });
});

describe('SHA-1 i UUIDv5 (D65): wzorce policzone w Pythonie (hashlib, uuid.uuid5)', () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const bytes = (s: string) => new TextEncoder().encode(s);
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['a'.repeat(55), 'c1c8bbdc22796e28c0e15163d20899b65621d65a'],
    ['a'.repeat(56), 'c2db330f6083854c99d4b5bfb6e8f29f201be699'],
    ['a'.repeat(64), '0098ba824b5c16427bd7a1122a5a442a25ec644d'],
    ['a'.repeat(1000), '291e9a6c66994949b57ba5e650361e98fc36b1ba'],
  ])('sha1(%j)', (s, h) => expect(hex(sha1(bytes(s)))).toBe(h));

  it('uuidv5: przykład z RFC (DNS, www.example.com), daty wystąpień, polskie znaki; zła przestrzeń nazw', () => {
    expect(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidv5('0192f3a0-1c2b-7d4e-8f00-0123456789ab', '2026-10-12')).toBe('9554071f-332c-539c-8856-596eac35b231');
    expect(uuidv5('0192f3a0-1c2b-7d4e-8f00-0123456789ab', 'zażółć')).toBe('41f5085e-00e7-5cea-b752-2fa644039767');
    expect(() => uuidv5('nie-uuid', 'x')).toThrow(TypeError);
  });
});
