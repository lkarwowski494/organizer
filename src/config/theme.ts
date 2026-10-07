/**
 * Motyw „Wstążki” w kolorach „piasek + terakota” (D72, D74 — decyzje właściciela z 7.10.2026; następca „Linii” z D50): każda grupa to kolorowa wstążka, a widok
 * „Dotyczy mnie” to stacja przesiadkowa. Jedyne źródło kolorów, krojów i rozmiarów ekranów.
 *
 * Progi czytelności (test src/config/__tests__/theme.test.ts liczy kontrast każdej pary poniżej):
 *  - tekst: co najmniej 4,5:1, WCAG 2.2 SC 1.4.3 (https://www.w3.org/TR/WCAG22/#contrast-minimum):
 *    „text and images of text has a contrast ratio of at least 4.5:1”;
 *  - elementy sterujące i grafika niosąca informację: co najmniej 3:1, SC 1.4.11
 *    (https://www.w3.org/TR/WCAG22/#non-text-contrast): „a contrast ratio of at least 3:1 against adjacent color(s)”;
 *  - cel dotyku: 44 × 44 pt, Apple HIG Accessibility
 *    (https://developer.apple.com/design/human-interface-guidelines/accessibility): „iOS, iPadOS — Default control size 44x44 pt”;
 *  - tekst podstawowy: 17 pt, Apple HIG Typography
 *    (https://developer.apple.com/design/human-interface-guidelines/typography): „iOS, iPadOS — Default size 17 pt, Minimum size 11 pt”.
 * Kolor grupy nigdy nie jest jedynym nośnikiem informacji: obok kropki zawsze stoi nazwa grupy.
 * Tryb jasny i ciemny od pierwszej wersji (decyzja właściciela z 7.10.2026); oba sprawdzane tym samym testem.
 */
export const contrastMin = { TEXT: 4.5, NON_TEXT: 3 } as const;

export type Scheme = 'light' | 'dark';

export type Palette = {
  ground: string;
  surface: string;
  ink: string;
  inkMuted: string;
  /** Nieaktywne zakładki — tylko na `surface` (w jasnym trybie na `ground` kontrast jest za niski). */
  inkTab: string;
  border: string;
  /** Obwódka pól do odhaczania: element sterujący, więc ≥ 3:1. */
  control: string;
  /** Wyróżnienie aktywnej zakładki i przycisków-pigułek (motyw „Wstążki”, D72; kolor terakota, D74). */
  accentBg: string;
  accentInk: string;
  ok: string;
  warnBg: string;
  warnBorder: string;
  warnInk: string;
  pendingInk: string;
  danger: string;
  inverseBg: string;
  inverseInk: string;
};

export const palettes: Record<Scheme, Palette> = {
  light: {
    ground: '#F7F2EA',
    surface: '#FFFFFF',
    ink: '#221A12',
    inkMuted: '#5E5244',
    inkTab: '#6E6152',
    border: '#E8DFD2',
    control: '#8A7A66',
    accentBg: '#F6E3D8',
    accentInk: '#8F3412',
    ok: '#15803D',
    warnBg: '#FEF3C7',
    warnBorder: '#F59E0B',
    warnInk: '#78350F',
    pendingInk: '#92400E',
    danger: '#B91C1C',
    inverseBg: '#B4471F',
    inverseInk: '#FFFFFF',
  },
  dark: {
    ground: '#17140F',
    surface: '#221E18',
    ink: '#F5EFE6',
    inkMuted: '#C2B6A6',
    inkTab: '#AEA290',
    border: '#3A332A',
    control: '#A39684',
    accentBg: '#4A2A1C',
    accentInk: '#F6C9B3',
    ok: '#22C55E',
    warnBg: '#3A2A0A',
    warnBorder: '#F59E0B',
    warnInk: '#FCD34D',
    pendingInk: '#FBBF24',
    danger: '#FCA5A5',
    inverseBg: '#E07A4F',
    inverseInk: '#17140F',
  },
};

/**
 * Kolory linii grup. `line` — kropka i odcinek linii (grafika, ≥ 3:1 do tła i powierzchni),
 * `ink` — nazwa grupy pisana tym kolorem (tekst, ≥ 4,5:1). Kolejność = kolejność przydziału grupom.
 * Odrzucone przy pomiarze: bursztynowy #D97706 (2,95:1 do jasnego tła); zielony #16A34A na tle „Wstążek” #F3F1FB (2,95:1) i nazwa #15803D (4,49:1).
 */
export const groupLines = [
  { key: 'blue', light: { line: '#1D4ED8', ink: '#1D4ED8' }, dark: { line: '#60A5FA', ink: '#93C5FD' } },
  { key: 'orange', light: { line: '#EA580C', ink: '#C2410C' }, dark: { line: '#FB923C', ink: '#FDBA74' } },
  { key: 'green', light: { line: '#15803D', ink: '#166534' }, dark: { line: '#4ADE80', ink: '#86EFAC' } },
  { key: 'violet', light: { line: '#7C3AED', ink: '#6D28D9' }, dark: { line: '#A78BFA', ink: '#C4B5FD' } },
  { key: 'teal', light: { line: '#0D9488', ink: '#0F766E' }, dark: { line: '#2DD4BF', ink: '#5EEAD4' } },
  { key: 'pink', light: { line: '#DB2777', ink: '#BE185D' }, dark: { line: '#F472B6', ink: '#F9A8D4' } },
  { key: 'cyan', light: { line: '#0891B2', ink: '#0E7490' }, dark: { line: '#22D3EE', ink: '#67E8F9' } },
  { key: 'red', light: { line: '#DC2626', ink: '#B91C1C' }, dark: { line: '#F87171', ink: '#FCA5A5' } },
] as const;

export type ContrastPair = { fg: string; bg: string; kind: keyof typeof contrastMin; use: string };

/** Pary tekst/tło i element/tło używane na ekranach — każda sprawdzana testem w obu trybach. */
export function contrastPairs(c: Palette): ContrastPair[] {
  return [
    { fg: c.ink, bg: c.ground, kind: 'TEXT', use: 'tytuły i treść' },
    { fg: c.ink, bg: c.surface, kind: 'TEXT', use: 'treść na kartach i pasku zakładek' },
    { fg: c.inkMuted, bg: c.ground, kind: 'TEXT', use: 'opisy, nagłówki sekcji' },
    { fg: c.inkMuted, bg: c.surface, kind: 'TEXT', use: 'opisy na kartach' },
    { fg: c.inkTab, bg: c.surface, kind: 'TEXT', use: 'nieaktywne zakładki' },
    { fg: c.control, bg: c.surface, kind: 'NON_TEXT', use: 'pole do odhaczania' },
    { fg: c.control, bg: c.ground, kind: 'NON_TEXT', use: 'pole do odhaczania na tle' },
    { fg: c.ok, bg: c.surface, kind: 'NON_TEXT', use: 'odhaczone pole' },
    { fg: c.ok, bg: c.ground, kind: 'NON_TEXT', use: 'odhaczone pole na tle' },
    { fg: c.warnInk, bg: c.warnBg, kind: 'TEXT', use: 'stan offline' },
    { fg: c.pendingInk, bg: c.ground, kind: 'TEXT', use: '„czeka na wysłanie”' },
    { fg: c.danger, bg: c.ground, kind: 'TEXT', use: 'błąd, usuwanie' },
    { fg: c.danger, bg: c.surface, kind: 'TEXT', use: 'błąd na karcie' },
    { fg: c.inverseInk, bg: c.inverseBg, kind: 'TEXT', use: 'pole szybkiego dodawania' },
    { fg: c.inverseInk, bg: c.danger, kind: 'TEXT', use: 'plakietka „do potwierdzenia” na zakładce' },
    { fg: c.accentInk, bg: c.accentBg, kind: 'TEXT', use: 'aktywna zakładka' },
    { fg: c.inkTab, bg: c.accentBg, kind: 'TEXT', use: 'nieaktywna zakładka obok aktywnej' },
  ];
}

export const fonts = {
  /** Nagłówki: Bricolage Grotesque, SIL OFL 1.1 (https://github.com/google/fonts/blob/main/ofl/bricolagegrotesque/OFL.txt). */
  display: { family: 'Bricolage Grotesque', weights: [700, 800] },
  /**
   * Tekst: Atkinson Hyperlegible Next (Braille Institute), SIL OFL 1.1
   * (https://github.com/google/fonts/blob/main/ofl/atkinsonhyperlegiblenext/OFL.txt).
   */
  text: { family: 'Atkinson Hyperlegible Next', weights: [400, 600, 700] },
} as const;

export const sizes = {
  TOUCH_TARGET: 44,
  BODY: 17,
  META: 13,
  SECTION: 13,
  TITLE: 40,
  MIN_TEXT: 11,
} as const;
