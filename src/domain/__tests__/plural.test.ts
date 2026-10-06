import * as fc from 'fast-check';
import { plural, pluralCategory } from '../plural';

const zadanie = { one: 'zadanie', few: 'zadania', many: 'zadań' };

describe('pluralCategory — reguły CLDR dla polskiego', () => {
  it.each([
    [1, 'one'],
    [0, 'many'],
    [2, 'few'],
    [3, 'few'],
    [4, 'few'],
    [5, 'many'],
    [11, 'many'],
    [12, 'many'],
    [13, 'many'],
    [14, 'many'],
    [21, 'many'],
    [22, 'few'],
    [24, 'few'],
    [25, 'many'],
    [101, 'many'],
    [102, 'few'],
    [112, 'many'],
    [1001, 'many'],
    [1.5, 'other'],
  ] as const)('%p → %s', (n, expected) => {
    expect(pluralCategory(n)).toBe(expected);
  });

  it('odrzuca NaN i nieskończoność', () => {
    expect(() => pluralCategory(Number.NaN)).toThrow(RangeError);
    expect(() => pluralCategory(Infinity)).toThrow(RangeError);
  });

  it('własność: kategoria zależy tylko od dwóch ostatnich cyfr (dla n ≥ 2)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 1_000_000 }), (n) => {
        expect(pluralCategory(n)).toBe(pluralCategory(100 + (n % 100)));
      }),
    );
  });
});

describe('plural', () => {
  it('dobiera właściwą formę', () => {
    expect(plural(1, zadanie)).toBe('zadanie');
    expect(plural(3, zadanie)).toBe('zadania');
    expect(plural(5, zadanie)).toBe('zadań');
    expect(plural(1.5, zadanie)).toBe('zadania');
    expect(plural(1.5, { ...zadanie, other: 'X' })).toBe('X');
  });
});
