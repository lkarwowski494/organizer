import * as fc from 'fast-check';

import { contrastRatio, relativeLuminance } from '../contrast';
import corpus from './fixtures/contrast.json';

const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);

describe('kontrast WCAG 2.2', () => {
  it('zgodny z niezależną implementacją (scripts/gen-contrast-corpus.py)', () => {
    expect(corpus.length).toBeGreaterThan(200);
    for (const { a, b, ratio } of corpus) expect(contrastRatio(a, b)).toBeCloseTo(ratio, 8);
  });

  it('wartości brzegowe ze specyfikacji: czerń–biel 21, kolor z samym sobą 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 12);
  });

  it('próg 0.04045: tuż poniżej liniowo, tuż powyżej potęga', () => {
    // 10/255 = 0.0392 ≤ 0.04045, 11/255 = 0.0431 > 0.04045
    expect(relativeLuminance('#0A0A0A')).toBeCloseTo(10 / 255 / 12.92, 15);
    expect(relativeLuminance('#0B0B0B')).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 15);
  });

  it('wagi kanałów 0.2126 / 0.7152 / 0.0722', () => {
    expect(relativeLuminance('#FF0000')).toBeCloseTo(0.2126, 12);
    expect(relativeLuminance('#00FF00')).toBeCloseTo(0.7152, 12);
    expect(relativeLuminance('#0000FF')).toBeCloseTo(0.0722, 12);
  });

  it('własności: symetria, zakres 1–21, kolor z samym sobą = 1', () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const r = contrastRatio(a, b);
        expect(r).toBe(contrastRatio(b, a));
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(21);
        expect(contrastRatio(a, a)).toBe(1);
      }),
    );
  });

  it('małe litery w zapisie działają, zły zapis zgłaszany wprost', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    for (const bad of ['#FFF', 'FFFFFF', '#GGGGGG', '#FFFFFF0', '']) {
      expect(() => relativeLuminance(bad)).toThrow('oczekiwano koloru');
    }
  });
});
