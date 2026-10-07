/**
 * Motyw „Linie” (D50, decyzja właściciela z 7.10.2026): każda grupa to kolorowa linia, a widok
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
 */
export const contrastMin = { TEXT: 4.5, NON_TEXT: 3 } as const;

export const colors = {
  ground: '#F5F6F8',
  surface: '#FFFFFF',
  ink: '#0F172A',
  inkMuted: '#475569',
  /** Nieaktywne zakładki — tylko na `surface` (na `ground` kontrast jest za niski). */
  inkTab: '#64748B',
  border: '#E2E8F0',
  /** Obwódka pól do odhaczania: element sterujący, więc ≥ 3:1. */
  control: '#64748B',
  ok: '#15803D',
  warnBg: '#FEF3C7',
  warnBorder: '#F59E0B',
  warnInk: '#78350F',
  pendingInk: '#92400E',
  inverseBg: '#0F172A',
  inverseInk: '#F8FAFC',
} as const;

/**
 * Kolory linii grup. `line` — kropka i odcinek linii (grafika, ≥ 3:1 do tła i powierzchni),
 * `ink` — nazwa grupy pisana tym kolorem (tekst, ≥ 4,5:1). Kolejność = kolejność nadawania nowym grupom.
 * Odrzucony przy pomiarze: bursztynowy #D97706 (2,95:1 do tła).
 */
export const groupLines = [
  { key: 'blue', line: '#1D4ED8', ink: '#1D4ED8' },
  { key: 'orange', line: '#EA580C', ink: '#C2410C' },
  { key: 'green', line: '#16A34A', ink: '#15803D' },
  { key: 'violet', line: '#7C3AED', ink: '#6D28D9' },
  { key: 'teal', line: '#0D9488', ink: '#0F766E' },
  { key: 'pink', line: '#DB2777', ink: '#BE185D' },
  { key: 'cyan', line: '#0891B2', ink: '#0E7490' },
  { key: 'red', line: '#DC2626', ink: '#B91C1C' },
] as const;

/** Pary tekst/tło i element/tło używane na ekranach — każda sprawdzana testem. */
export const contrastPairs: readonly { fg: string; bg: string; kind: keyof typeof contrastMin; use: string }[] = [
  { fg: colors.ink, bg: colors.ground, kind: 'TEXT', use: 'tytuły i treść' },
  { fg: colors.ink, bg: colors.surface, kind: 'TEXT', use: 'treść na kartach i pasku zakładek' },
  { fg: colors.inkMuted, bg: colors.ground, kind: 'TEXT', use: 'opisy, nagłówki sekcji' },
  { fg: colors.inkMuted, bg: colors.surface, kind: 'TEXT', use: 'opisy na kartach' },
  { fg: colors.inkTab, bg: colors.surface, kind: 'TEXT', use: 'nieaktywne zakładki' },
  { fg: colors.control, bg: colors.surface, kind: 'NON_TEXT', use: 'pole do odhaczania' },
  { fg: colors.control, bg: colors.ground, kind: 'NON_TEXT', use: 'pole do odhaczania na tle' },
  { fg: colors.ok, bg: colors.surface, kind: 'NON_TEXT', use: 'odhaczone pole' },
  { fg: colors.warnInk, bg: colors.warnBg, kind: 'TEXT', use: 'stan offline' },
  { fg: colors.pendingInk, bg: colors.ground, kind: 'TEXT', use: '„czeka na wysłanie”' },
  { fg: colors.inverseInk, bg: colors.inverseBg, kind: 'TEXT', use: 'pole szybkiego dodawania' },
];

export const fonts = {
  /** Nagłówki: Schibsted Grotesk, SIL OFL 1.1 (https://github.com/google/fonts/blob/main/ofl/schibstedgrotesk/OFL.txt). */
  display: { family: 'Schibsted Grotesk', weights: [500, 700, 800] },
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
