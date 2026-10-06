import { randomBytes as nodeRandomBytes } from 'node:crypto';
import * as fc from 'fast-check';
import { isUuidv7, uuidv7, uuidv7Timestamp } from '../ids';

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
