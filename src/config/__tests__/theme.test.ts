import { contrastRatio } from '../../domain/contrast';
import { contrastMin, contrastPairs, groupLines, palettes, type Scheme, sizes } from '../theme';

const schemes: Scheme[] = ['light', 'dark'];

describe.each(schemes)('motyw „Linie”, tryb %s, spełnia progi czytelności', (scheme) => {
  const c = palettes[scheme];

  it.each(contrastPairs(c).map((p) => [p.use, p]))('%s', (_use, p) => {
    expect(contrastRatio(p.fg, p.bg)).toBeGreaterThanOrEqual(contrastMin[p.kind]);
  });

  it.each(groupLines.map((g) => [g.key, g[scheme]]))('linia %s: kropka ≥ 3:1, nazwa ≥ 4,5:1 na tle i na kartach', (_k, g) => {
    for (const bg of [c.ground, c.surface]) {
      expect(contrastRatio(g.line, bg)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
      expect(contrastRatio(g.ink, bg)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    }
  });

  it('osiem różnych linii', () => {
    expect(new Set(groupLines.map((g) => g[scheme].line)).size).toBe(8);
  });
});

describe('motyw — reszta', () => {
  it('oba tryby mają te same klucze', () => {
    expect(Object.keys(palettes.dark).sort()).toEqual(Object.keys(palettes.light).sort());
  });

  it('unikalne klucze linii', () => {
    expect(new Set(groupLines.map((g) => g.key)).size).toBe(groupLines.length);
  });

  it('progi i rozmiary ze źródeł (WCAG 2.2, Apple HIG)', () => {
    expect(contrastMin).toEqual({ TEXT: 4.5, NON_TEXT: 3 });
    expect(sizes.TOUCH_TARGET).toBe(44);
    expect(sizes.BODY).toBe(17);
    for (const s of [sizes.META, sizes.SECTION, sizes.BODY, sizes.TITLE]) expect(s).toBeGreaterThanOrEqual(sizes.MIN_TEXT);
  });

  it('test łapie słabą parę (kontrola samego testu)', () => {
    expect(contrastRatio('#94A3B8', palettes.light.surface)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio('#D97706', palettes.light.ground)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio(palettes.light.inkTab, palettes.light.ground)).toBeLessThan(contrastMin.TEXT);
  });
});
