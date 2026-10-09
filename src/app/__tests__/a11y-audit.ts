/**
 * Audyt dostępności drzewa ekranu w RNTL (audyt 2, M-46 / A-63, M-147 / A-34). Sprawdza na drzewie elementów
 * natywnych (host), co da się sprawdzić bez telefonu; resztę (odczyt VoiceOvera, rzeczywisty układ) sprawdza audyt
 * XCUITest na symulatorze (e2e/a11y, D186).
 *
 * Reguły i źródła:
 *  1. Rola z cechą iOS. React Native zamienia rolę na cechę UIAccessibilityTraits tylko dla: none, button, togglebutton,
 *     link, image, img, keyboardkey, key, text, search, adjustable, header, heading, imagebutton, summary, switch,
 *     tabbar, progressbar — inne („tab”, „checkbox”, „radio”, „tablist”, „alert”…) dają pustą cechę
 *     (`result = AccessibilityTraits::None`, react-native 0.86
 *     ReactCommon/react/renderer/components/view/accessibilityPropsConversions.h, fromString).
 *  2. Element dotykowy ma rolę i etykietę; cel dotyku ≥ 44 × 44 pt (Apple HIG, „at least 44x44 pt”) — z deklaracji
 *     stylu: wysokość (height / minHeight), szerokość liczbowa albo procentowa liczona od szerokości treści ekranu.
 *  3. Etykieta zawiera widoczny tekst elementu — WCAG 2.2 SC 2.5.3 Label in Name: „the name contains the text that is
 *     presented visually” (https://www.w3.org/TR/WCAG22/#label-in-name).
 *  4. Stan: przełączniki i pola wyboru mają accessibilityState.checked, zakładki i opcje — selected.
 *  5. Tekst ma kolor, a kontrast do najbliższego tła przodka ≥ 4,5:1 — WCAG 2.2 SC 1.4.3: „a contrast ratio of at least
 *     4.5:1” (https://www.w3.org/TR/WCAG22/#contrast-minimum; bez złagodzenia 3:1 dla dużego tekstu — ostrzej niż WCAG).
 *     Wyjątek z tego samego kryterium: „text … that [is] part of an inactive user interface component” — tekst
 *     w wyłączonym elemencie (accessibilityState.disabled) nie jest liczony.
 *  6. Elementy nietekstowe stanu (pole odhaczania, przełącznik): obwódka albo wypełnienie ≥ 3:1 do tła — WCAG 2.2
 *     SC 1.4.11: „Visual information required to identify user interface components and states” „at least 3:1”
 *     (https://www.w3.org/TR/WCAG22/#non-text-contrast).
 *  7. Dynamic Type: tekst nie wyłącza skalowania (allowFontScaling={false}, maxFontSizeMultiplier < 2 — poza tytułem, który
 *     i tak dochodzi do fontScale.TITLE_MAX_PT, rozmiaru „Large Title” przy AX5) — Apple HIG
 *     Typography: obsługa Dynamic Type; kontener tekstu nie ma stałej wysokości (height), bo powiększony tekst się w niej
 *     nie mieści.
 *  8. Ekran ma nagłówek (rola header) — HIG: tytuł to pierwsza informacja dla technologii wspomagających.
 *  9. Tekst ma rozmiar z motywu (M-42, M-152); zaznaczenie nie jest w kolorze przycisku głównego (M-151, D198).
 * Każda para (kolor, tło) z reguł 5 i 6 trafia do `pairs` — test sprawdza, że jest w korpusie contrastPairs
 * (src/config/theme.ts), więc korpus nie jest już listą spisaną z pamięci (M-147).
 */
import { StyleSheet } from 'react-native';

import { contrastMin, fontScale, type Palette } from '../../config/theme';
import { contrastRatio } from '../../domain/contrast';

export type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown; parent: Node | null };

/** Role, którym React Native nadaje cechę iOS (reguła 1). */
export const IOS_TRAIT_ROLES = new Set(['none', 'button', 'togglebutton', 'link', 'image', 'img', 'keyboardkey', 'key', 'text', 'search', 'adjustable', 'header', 'heading', 'imagebutton', 'summary', 'switch', 'tabbar', 'progressbar']);
const INTERACTIVE_ROLES = new Set(['button', 'togglebutton', 'link', 'imagebutton', 'switch', 'adjustable', 'search', 'keyboardkey', 'checkbox', 'radio', 'tab', 'menuitem']);
const CHECKED_ROLES = new Set(['checkbox', 'switch', 'togglebutton']);
const SELECTED_ROLES = new Set(['tab', 'radio']);
/** Szerokość treści ekranu w testach (harness: 390 pt minus marginesy Screen 2 × 20 pt). */
const CONTENT_WIDTH = 390 - 2 * 20;

export type Pair = { fg: string; bg: string; kind: 'TEXT' | 'NON_TEXT'; where: string };
export type AuditResult = { problems: string[]; pairs: Pair[] };

const style = (n: Node) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
const hosts = (root: Node) => {
  const out: Node[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === 'string' || !n) return;
    if (typeof n.type === 'string') out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
};
const hostParent = (n: Node): Node | null => {
  let p = n.parent;
  while (p && typeof p.type !== 'string') p = p.parent;
  return p;
};
const ancestors = (n: Node): Node[] => {
  const out: Node[] = [];
  for (let p = hostParent(n); p; p = hostParent(p)) out.push(p);
  return out;
};
const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join(' ');
/** Słowa (litery i cyfry) — znaki ozdobne („›”, „▾”, „+”, „·”) nie są częścią nazwy. */
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const isDisabled = (n: Node) => [n, ...ancestors(n)].some((a) => (a.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true);
const isTouchable = (n: Node) => typeof n.props.onClick === 'function' || typeof n.props.onResponderRelease === 'function' || typeof n.props.onPress === 'function';
const hidden = (n: Node) => [n, ...ancestors(n)].some((a) => a.props.accessibilityElementsHidden === true || a.props.importantForAccessibility === 'no-hide-descendants' || a.props.accessible === false);

/** Tło za elementem: pierwszy przodek (albo on sam, dla elementów nietekstowych) z kolorem tła, z przezroczystością. */
function backgroundOf(n: Node, includeSelf: boolean): string | null {
  for (const a of includeSelf ? [n, ...ancestors(n)] : ancestors(n)) {
    const bg = style(a).backgroundColor;
    if (typeof bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(bg)) return bg.toUpperCase();
  }
  return null;
}

/** Kolor po nałożeniu przezroczystości (opacity przodków) na tło — co widzi oko. */
function blend(fg: string, bg: string, alpha: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(alpha * ch(fg, i) + (1 - alpha) * ch(bg, i)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const opacityOf = (n: Node) => [n, ...ancestors(n)].reduce((o, a) => o * (typeof style(a).opacity === 'number' ? (style(a).opacity as number) : 1), 1);

export function audit(root: unknown, palette: Palette, where: string, opts: { screen?: boolean } = {}): AuditResult {
  const all = hosts(root as Node);
  const problems: string[] = [];
  const pairs: Pair[] = [];
  const say = (msg: string) => problems.push(`${where}: ${msg}`);
  for (const n of all) {
    const s = style(n);
    const role = n.props.accessibilityRole as string | undefined;
    const label = n.props.accessibilityLabel as string | undefined;
    const name = `${role ?? 'element'} „${String(label ?? textOf(n))}”`;
    if (role && !IOS_TRAIT_ROLES.has(role)) say(`rola „${role}” bez cechy iOS (${String(label ?? textOf(n))})`);
    const interactive = (role && INTERACTIVE_ROLES.has(role)) || (n.type === 'View' && isTouchable(n));
    if (interactive && !hidden(n)) {
      if (!role) say(`element dotykowy bez roli „${String(label ?? textOf(n))}”`);
      if (!label) say(`${role ?? 'element'} bez etykiety`);
      const h = Number(s.minHeight ?? s.height ?? 0);
      if (h < 44) say(`${name} ma ${h} pt wysokości`);
      const w = typeof s.width === 'number' ? s.width : typeof s.width === 'string' && s.width.endsWith('%') ? (parseFloat(s.width) / 100) * CONTENT_WIDTH : null;
      if (w !== null && w < 44) say(`${name} ma ${Math.round(w)} pt szerokości`);
      // Nazwą jest etykieta; widoczna wartość pola (accessibilityValue, np. „Wybierz godzinę”, „18:00”) to wartość, nie nazwa.
      const inLabel = new Set(words(`${label ?? ''} ${String((n.props.accessibilityValue as { text?: string } | undefined)?.text ?? '')}`));
      const missing = words(textOf(n)).filter((w) => !inLabel.has(w));
      if (label && missing.length) say(`etykieta „${label}” bez widocznych słów: ${missing.join(', ')}`);
      const state = (n.props.accessibilityState ?? {}) as { checked?: unknown; selected?: unknown };
      if (role && CHECKED_ROLES.has(role) && role !== 'togglebutton' && state.checked === undefined) say(`${name} bez stanu „zaznaczone”`);
      if (role && SELECTED_ROLES.has(role) && state.selected === undefined) say(`${name} bez stanu „wybrane”`);
      // Reguła 6: obwódka albo wypełnienie pola stanu do tła wokół.
      if (role && CHECKED_ROLES.has(role) && !isDisabled(n)) {
        const bg = backgroundOf(n, false);
        // Granica pola (obwódka), a bez obwódki — wypełnienie (np. odhaczone pole w kolorze „ok”).
        const mark = typeof s.borderColor === 'string' && Number(s.borderWidth ?? 0) > 0 ? String(s.borderColor) : typeof s.backgroundColor === 'string' && s.backgroundColor.toUpperCase() !== bg ? String(s.backgroundColor) : null;
        if (bg && mark) {
          pairs.push({ fg: mark.toUpperCase(), bg, kind: 'NON_TEXT', where: `${where}: ${name}` });
          if (contrastRatio(mark, bg) < contrastMin.NON_TEXT) say(`${name}: kontrast pola ${contrastRatio(mark, bg).toFixed(2)}:1 (< 3)`);
        }
      }
    }
    // Jeden wzór zaznaczenia (M-151, PW-52 A, D198): zaznaczony wybór nigdy w kolorze przycisku głównego.
    if (s.backgroundColor === palette.inverseBg && [n, ...ancestors(n)].some((a) => a.props.accessibilityRole !== 'tab' && ((a.props.accessibilityState as { selected?: boolean; checked?: boolean } | undefined)?.selected === true || (a.props.accessibilityState as { checked?: boolean } | undefined)?.checked === true))) say(`${name}: zaznaczenie w kolorze przycisku głównego`);
    if (n.type === 'Text') {
      const own = textOf(n).trim();
      // Zagnieżdżony Text dziedziczy kolor rodzica — kolor sprawdzamy na najbardziej zewnętrznym.
      const parentText = ancestors(n).find((a) => a.type === 'Text');
      const color = (s.color ?? (parentText ? style(parentText).color : undefined)) as string | undefined;
      if (n.props.allowFontScaling === false) say(`tekst „${own}” bez skalowania (allowFontScaling={false})`);
      // Limit niższy niż 200% tylko dla tytułu, który i tak dochodzi do „Large Title” przy AX5 (fontScale.TITLE_MAX_PT, M-43).
      const mult = n.props.maxFontSizeMultiplier;
      if (typeof mult === 'number' && mult < fontScale.FIXED_MAX && !(typeof s.fontSize === 'number' && Math.round(s.fontSize * mult) >= fontScale.TITLE_MAX_PT)) say(`tekst „${own}” z maxFontSizeMultiplier ${String(n.props.maxFontSizeMultiplier)}`);
      if (!own || parentText) continue;
      // Bez rozmiaru z motywu iOS rysuje systemowe 14 pt bez Dynamic Type z motywu (audyt 2, M-42, M-152).
      if (!s.fontSize) say(`tekst „${own}” bez rozmiaru`);
      if (!color) {
        say(`tekst „${own}” bez koloru`);
        continue;
      }
      const bg = backgroundOf(n, false);
      if (!bg || isDisabled(n)) continue;
      const seen = blend(color.toUpperCase(), bg, opacityOf(n));
      pairs.push({ fg: color.toUpperCase(), bg, kind: 'TEXT', where: `${where}: „${own.slice(0, 30)}”` });
      const r = contrastRatio(seen, bg);
      if (r < contrastMin.TEXT) say(`tekst „${own.slice(0, 30)}”: kontrast ${r.toFixed(2)}:1 (${color} na ${bg}${seen !== color.toUpperCase() ? `, widoczny ${seen}` : ''})`);
    }
    // Reguła 7: stała wysokość kontenera tekstu (nie dotyczy pól tekstowych — mają minHeight).
    if (n.type === 'View' && typeof s.height === 'number' && !s.minHeight && all.some((x) => x.type === 'Text' && words(textOf(x)).some((w) => /\p{L}{2}/u.test(w)) && ancestors(x).includes(n))) say(`kontener tekstu „${textOf(n).trim().slice(0, 30)}” ma stałą wysokość ${s.height} pt (Dynamic Type)`);
  }
  if (opts.screen && !all.some((n) => n.props.accessibilityRole === 'header' && !hidden(n))) say('ekran bez nagłówka (rola header)');
  return { problems, pairs };
}
