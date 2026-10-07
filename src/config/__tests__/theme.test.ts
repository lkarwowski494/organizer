import { contrastRatio } from '../../domain/contrast';
import { colors, contrastMin, contrastPairs, groupLines, sizes } from '../theme';

describe('motyw „Linie” spełnia progi czytelności', () => {
  it.each(contrastPairs.map((p) => [p.use, p]))('%s', (_use, p) => {
    expect(contrastRatio(p.fg, p.bg)).toBeGreaterThanOrEqual(contrastMin[p.kind]);
  });

  it.each(groupLines.map((g) => [g.key, g]))('linia %s: kropka ≥ 3:1, nazwa ≥ 4,5:1 na tle i na kartach', (_k, g) => {
    for (const bg of [colors.ground, colors.surface]) {
      expect(contrastRatio(g.line, bg)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
      expect(contrastRatio(g.ink, bg)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    }
  });

  it('osiem różnych linii o unikalnych kluczach i kolorach', () => {
    expect(new Set(groupLines.map((g) => g.key)).size).toBe(8);
    expect(new Set(groupLines.map((g) => g.line)).size).toBe(8);
  });

  it('progi i rozmiary ze źródeł (WCAG 2.2, Apple HIG)', () => {
    expect(contrastMin).toEqual({ TEXT: 4.5, NON_TEXT: 3 });
    expect(sizes.TOUCH_TARGET).toBe(44);
    expect(sizes.BODY).toBe(17);
    for (const s of [sizes.META, sizes.SECTION, sizes.BODY, sizes.TITLE]) expect(s).toBeGreaterThanOrEqual(sizes.MIN_TEXT);
  });

  it('test łapie słabą parę (kontrola samego testu)', () => {
    expect(contrastRatio('#94A3B8', colors.surface)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio('#D97706', colors.ground)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio(colors.inkTab, colors.ground)).toBeLessThan(contrastMin.TEXT);
  });
});
