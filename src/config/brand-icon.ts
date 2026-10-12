/**
 * Ikona aplikacji „Wstążki” (D72, kolory piasek + terakota D74) jako dane — jedno źródło geometrii i kolorów dla animacji
 * przy starcie (src/ui/Intro.tsx, ADR-0045) i ekranu startowego iOS (scripts/brand/splash.mjs → assets/splash*.png).
 * Jednostki = viewBox 0 0 260 260 pliku assets/icon.svg; test src/config/__tests__/brand-icon.contract.test.ts sprawdza,
 * że assets/icon.svg ma dokładnie te ścieżki, kolory, grubość i zakończenia (a assets/icon.png powstaje z tego pliku).
 *
 * Kolejność wstążek = kolejność rysowania w pliku (niebieska pod spodem, terakota na wierzchu) i kolejność w animacji.
 * Kolory wstążek są te same w trybie ciemnym (tło ekranu startowego = palettes.dark.ground): kontrast każdej wstążki do
 * ciemnego tła ≥ 3:1 (WCAG 2.2 SC 1.4.11, https://www.w3.org/TR/WCAG22/#non-text-contrast — „a contrast ratio of at least
 * 3:1 against adjacent color(s)”; test i korpus z Pythona: brand-icon.contract.test.ts, scripts/gen-intro-corpus.py), więc
 * nie zmieniamy odcieni ikony. W trybie jasnym pomarańczowa wstążka ma do tła 1,8:1 — tak wygląda ikona aplikacji
 * (decyzja właściciela D72/D74); animacja jest dekoracją bez informacji (SC 1.4.11 nie dotyczy grafiki dekoracyjnej:
 * „Graphical objects that … are not required for understanding the content”), a ostatnia klatka to ta sama ikona, którą
 * iOS pokazuje na ekranie początkowym.
 */
import { palettes, type Scheme } from './theme';

export type Pt = readonly [number, number];
/** Ścieżka SVG „M start C c1 c2 end C …”: punkt startowy i kolejne krzywe sześcienne Béziera (punkty kontrolne i koniec). */
export type RibbonPath = { readonly start: Pt; readonly curves: readonly (readonly [Pt, Pt, Pt])[] };
export type Ribbon = { readonly key: 'blue' | 'orange' | 'terracotta'; readonly color: string; readonly path: RibbonPath };

export const brandIcon = {
  /** Bok viewBox (kwadrat). */
  VIEWBOX: 260,
  /** Grubość wstążki (stroke-width), zakończenia zaokrąglone (stroke-linecap="round"). */
  STROKE_WIDTH: 30,
  LINECAP: 'round',
  /** Tło ikony = tło jasnego motywu aplikacji (assets/icon.svg: rect fill). */
  BACKGROUND: palettes.light.ground,
  ribbons: [
    {
      key: 'blue',
      color: '#3D7BFF',
      path: {
        start: [70, 160],
        curves: [
          [[70, 90], [120, 62], [160, 70]],
          [[200, 78], [210, 130], [190, 165]],
        ],
      },
    },
    { key: 'orange', color: '#F2A541', path: { start: [190, 165], curves: [[[170, 200], [110, 210], [80, 185]]] } },
    { key: 'terracotta', color: '#B4471F', path: { start: [80, 185], curves: [[[60, 170], [62, 150], [70, 132]]] } },
  ] as const satisfies readonly Ribbon[],
} as const;

/** Atrybut `d` ścieżki SVG (ten sam zapis co w assets/icon.svg). */
export function pathD(p: RibbonPath): string {
  const pt = (q: Pt) => `${q[0]} ${q[1]}`;
  return [`M${pt(p.start)}`, ...p.curves.map((c) => `C${c.map(pt).join(' ')}`)].join(' ');
}

/** Tło ekranu startowego i nakładki animacji w danym motywie systemu (= tło motywu aplikacji). */
export const splashBackground = (s: Scheme): string => palettes[s].ground;
