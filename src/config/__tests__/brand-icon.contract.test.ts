/**
 * Ikona „Wstążki” jako dane (src/config/brand-icon.ts) = plik ikony aplikacji assets/icon.svg: animacja przy starcie
 * (ADR-0045) składa dokładnie te ścieżki, kolory i grubości, więc ostatnia klatka to ikona z ekranu początkowego iPhone’a.
 * Kontrast wstążek do teł motywów — korpus z Pythona (scripts/gen-intro-corpus.py).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrastRatio } from '../../domain/contrast';
import corpus from '../../domain/__tests__/fixtures/intro.json';
import { brandIcon, pathD, splashBackground } from '../brand-icon';
import { contrastMin, palettes } from '../theme';

const root = join(__dirname, '../../..');
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));

describe('ikona aplikacji = dane ikony (brand-icon.ts)', () => {
  const svg = readFileSync(join(root, 'assets/icon.svg'), 'utf8');

  it('assets/icon.svg: viewBox, tło i dokładnie trzy ścieżki — te same d, kolory, grubość, zaokrąglone końce, w tej kolejności', () => {
    expect(attrs(svg.match(/<svg [^>]*>/)![0]).viewBox).toBe(`0 0 ${brandIcon.VIEWBOX} ${brandIcon.VIEWBOX}`);
    const rects = [...svg.matchAll(/<rect [^>]*\/>/g)].map((m) => attrs(m[0]));
    expect(rects).toEqual([{ width: String(brandIcon.VIEWBOX), height: String(brandIcon.VIEWBOX), fill: brandIcon.BACKGROUND }]);
    const paths = [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => attrs(m[0]));
    expect(paths).toEqual(
      brandIcon.ribbons.map((r) => ({ d: pathD(r.path), stroke: r.color, 'stroke-width': String(brandIcon.STROKE_WIDTH), fill: 'none', 'stroke-linecap': brandIcon.LINECAP })),
    );
  });

  it('pathD: zapis „M x y C …” z danych', () => {
    expect(pathD({ start: [1, 2], curves: [[[3, 4], [5, 6], [7, 8]], [[9, 10], [11, 12], [13, 14]]] })).toBe('M1 2 C3 4 5 6 7 8 C9 10 11 12 13 14');
    expect(pathD({ start: [1, 2], curves: [] })).toBe('M1 2');
  });

  it('tło ikony i ekranu startowego = tło motywu (jasny i ciemny)', () => {
    expect(brandIcon.BACKGROUND).toBe(palettes.light.ground);
    expect(splashBackground('light')).toBe(palettes.light.ground);
    expect(splashBackground('dark')).toBe(palettes.dark.ground);
  });

  it('tryb ciemny: każda wstążka ≥ 3:1 do ciemnego tła (WCAG SC 1.4.11) — odcienie ikony bez zmian; wartości = korpus z Pythona', () => {
    for (const r of brandIcon.ribbons) {
      const want = (corpus.contrast as Record<string, { light: number; dark: number }>)[r.key]!;
      expect(contrastRatio(r.color, palettes.dark.ground)).toBeCloseTo(want.dark, 8);
      expect(contrastRatio(r.color, palettes.light.ground)).toBeCloseTo(want.light, 8);
      expect(want.dark).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
    }
  });
});
