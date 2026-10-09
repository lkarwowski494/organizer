import { contrastRatio } from '../../domain/contrast';
import { contrastMin, contrastPairs, fontScale, groupLines, highContrastPairs, layout, paletteOf, palettes, radius, type Scheme, sizes } from '../theme';

const schemes: Scheme[] = ['light', 'dark'];

describe.each(schemes)('motyw „Wstążki”, tryb %s, spełnia progi czytelności', (scheme) => {
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

  // M-148 / D197: „Zwiększ kontrast” — obwódki ≥ 3:1, a wszystkie zwykłe pary dalej spełniają progi.
  it.each([...contrastPairs(paletteOf(scheme, true)), ...highContrastPairs(paletteOf(scheme, true))].map((p) => [p.use, p]))('Zwiększ kontrast: %s', (_use, p) => {
    expect(contrastRatio(p.fg, p.bg)).toBeGreaterThanOrEqual(contrastMin[p.kind]);
  });

  it('bez „Zwiększ kontrast” paleta bez zmian; z nim obwódka wyraźniejsza niż zwykła', () => {
    expect(paletteOf(scheme, false)).toBe(palettes[scheme]);
    const hc = paletteOf(scheme, true);
    expect(contrastRatio(hc.border, hc.surface)).toBeGreaterThan(contrastRatio(c.border, c.surface));
    expect(contrastRatio(hc.control, hc.surface)).toBeGreaterThan(contrastRatio(c.control, c.surface));
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

  it('role rozmiarów: jeden opis 13 pt (PWD-23 A), żadna rola poniżej minimum HIG, tytuł do 60 pt (AX5 Large Title)', () => {
    expect(sizes.META).toBe(13);
    for (const [k, v] of Object.entries(sizes)) if (k !== 'TOUCH_TARGET') expect([k, v >= sizes.MIN_TEXT]).toEqual([k, true]);
    expect(fontScale).toEqual({ FIXED_MAX: 2, TITLE_MAX_PT: 60, TITLE_LEADING: 1.2 });
    expect(sizes.TITLE * (fontScale.TITLE_MAX_PT / sizes.TITLE)).toBe(60);
  });

  it('promienie PWD-12 B i szerokość treści na iPadzie PWD-25 B', () => {
    expect(radius).toMatchObject({ CARD: 18, PANEL: 14, ROW: 14 });
    expect(layout.CONTENT_MAX_WIDTH).toBe(600);
  });

  it('test łapie słabą parę (kontrola samego testu)', () => {
    expect(contrastRatio('#94A3B8', palettes.light.surface)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio('#D97706', palettes.light.ground)).toBeLessThan(contrastMin.NON_TEXT);
    expect(contrastRatio(palettes.dark.inkMuted, palettes.light.surface)).toBeLessThan(contrastMin.TEXT);
    // Zwykła obwódka nie przeszłaby progu „Zwiększ kontrast” — test par HC naprawdę coś sprawdza.
    expect(contrastRatio(palettes.light.border, palettes.light.surface)).toBeLessThan(contrastMin.NON_TEXT);
  });
});
