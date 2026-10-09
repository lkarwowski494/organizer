import { contrastRatio } from '../../domain/contrast';
import { contrastMin, contrastPairs, fontScale, groupLines, highContrastPairs, layout, paletteOf, palettes, radius, type Scheme, sizes, tabBar } from '../theme';
import corpus from './fixtures/theme-contrast.json';

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

/**
 * Audyt 3 (N-68, N-200): progi sprawdzane na wartościach z NIEZALEŻNEJ implementacji (scripts/gen-theme-contrast-corpus.py,
 * Python czyta kolory wprost z theme.ts; aktualność korpusu pilnuje `npm run check:corpus`) — we wszystkich motywach.
 */
describe.each([
  ['light', false],
  ['dark', false],
  ['light', true],
  ['dark', true],
] as [Scheme, boolean][])('korpus kontrastu motywu %s (Zwiększ kontrast: %s)', (scheme, increased) => {
  const p = paletteOf(scheme, increased);
  const table = (corpus as Record<string, Record<string, number>>)[`${scheme}${increased ? '+hc' : ''}`]!;
  const ratio = (a: string, b: string) => table[[a.toUpperCase(), b.toUpperCase()].sort().join(' ')];
  const pairs = [
    ...contrastPairs(p),
    ...(increased ? highContrastPairs(p) : []),
    ...groupLines.flatMap((g) => [p.ground, p.surface].flatMap((bg) => [
      { fg: g[scheme].line, bg, kind: 'NON_TEXT' as const, use: `linia ${g.key}` },
      { fg: g[scheme].ink, bg, kind: 'TEXT' as const, use: `nazwa grupy ${g.key}` },
    ])),
  ];

  it.each(pairs.map((x) => [`${x.use} (${x.fg} na ${x.bg})`, x]))('%s', (_use, x) => {
    const expected = ratio(x.fg, x.bg);
    expect(expected).toBeDefined();
    expect(expected).toBeGreaterThanOrEqual(contrastMin[x.kind]);
    expect(contrastRatio(x.fg, x.bg)).toBeCloseTo(expected!, 8);
  });

  it('wybrana zakładka (N-68): pigułka ≥ 3:1 do paska, napis ≥ 4,5:1 do pigułki, napis niewybranej ≥ 4,5:1 do paska', () => {
    const t = tabBar.colors(p);
    expect(ratio(t.pillOn, t.bar)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
    expect(ratio(t.inkOn, t.pillOn)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    expect(ratio(t.inkOff, t.bar)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    expect(ratio(t.badgeRing, t.pillOn)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
  });

  it('stan offline i baner filtra (N-200): obwódka i kropka ≥ 3:1 do tła stanu, tła ekranu i karty', () => {
    for (const bg of [p.warnBg, p.ground, p.surface]) expect(ratio(p.warnBorder, bg)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
  });
});

describe('pasek zakładek (N-67, Q11 A)', () => {
  /**
   * Najszerszy napis „Moje sprawy” w Atkinson Hyperlegible Next 700 przy 12 pt: 70,3 pt (suma szerokości glifów z tabeli
   * hmtx pliku AtkinsonHyperlegibleNext_700Bold.ttf, fontTools, unitsPerEm 1000). Na iPhonie 375 pt mieści się w jednej
   * linii; węższy ekran (Slide Over 320 pt) łamie napis na dwie linie zamiast go zmniejszać.
   */
  const WIDEST_LABEL_PT = 70.3;
  const room = (screenWidth: number) => (screenWidth - 2 * tabBar.BAR_PAD_H) / 4 - 2 * tabBar.PILL_PAD_H;

  it('napis 12 pt (≥ minimum HIG 11 pt) mieści się w jednej linii od 375 pt szerokości ekranu', () => {
    expect(sizes.TAB).toBe(12);
    expect(sizes.TAB).toBeGreaterThanOrEqual(sizes.MIN_TEXT);
    expect(room(375)).toBeGreaterThanOrEqual(WIDEST_LABEL_PT);
    expect(room(320)).toBeLessThan(WIDEST_LABEL_PT);
    expect(tabBar.LABEL_LINES).toBe(2);
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
    expect(Object.entries(sizes).filter(([k, v]) => k !== 'TOUCH_TARGET' && v < sizes.MIN_TEXT)).toEqual([]);
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
