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
 *  4. Stan: systemowy przełącznik ma accessibilityState.checked, zakładki i opcje — selected.
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
 *  7′. Wyjątek od 7 (audyt 3, N-67): stały rozmiar w elemencie z Large Content Viewer
 *     (accessibilityShowsLargeContentViewer), którego accessibilityLargeContentTitle zawiera napis — tylko pasek zakładek.
 *  8. Ekran ma nagłówek (rola header) — HIG: tytuł to pierwsza informacja dla technologii wspomagających.
 *  9. Tekst ma rozmiar z motywu (M-42, M-152); zaznaczenie nie jest w kolorze przycisku głównego (M-151, D198).
 * Audyt 3 (N-59, N-202) — luki, przez które test był zielony przy realnych błędach:
 * 10. Pole tekstowe ma etykietę (TextInput nie jest widokiem „View”, więc reguła 2 go nie widziała).
 * 11. Element dotykowy nie leży w środku elementu dostępnego (`accessible`): VoiceOver do niego nie dojdzie — RN 0.86
 *     (https://reactnative.dev/docs/0.86/accessibility#accessible): „VoiceOver disallowing nested accessibility
 *     elements”.
 * 12. `accessible={false}` niczego nie ukrywa: „On iOS, it translates into native isAccessibilityElement” (ta sama
 *     strona) — element przestaje być przystankiem, ale jego dzieci nadal nim są i są sprawdzane. Ukrywa dopiero
 *     `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"`.
 * 13. Kontrast liczony także dla zagnieżdżonego Text z własnym kolorem (nazwa grupy, godzina, „czeka na wysłanie”).
 * 14. Elementy dotykowe na ekranie mają różne etykiety — WCAG 2.2 SC 2.4.6: „Headings and labels describe topic or
 *     purpose” (https://www.w3.org/TR/WCAG22/#headings-and-labels); dwa „Dodaj” nie mówią, co dodają.
 * 15. Szerokość procentowa liczona od rodzica (bez jego marginesów wewnętrznych i obwódki), nie od całego ekranu.
 * 16. `adjustsFontSizeToFit` ma `minimumFontScale`, a najmniejszy rozmiar ≥ sizes.MIN_TEXT — Apple HIG Typography:
 *     „iOS, iPadOS — Default size 17 pt, Minimum size 11 pt” (cytat w src/config/theme.ts).
 * 17. Bez angielskich słów od React Native (N-9): na iOS RN dopisuje do wartości elementu „checked”/„unchecked”
 *     (accessibilityState.checked), „expanded”, „busy”, a dla ról „checkbox”/„radio” — „checkbox”/„radio button”
 *     (RCTViewComponentView.mm, accessibilityValue: RCTLocalizedString; pakiet pl.lproj w RN jest pusty). Stan
 *     podaje helper `buttonA11y` z src/ui/a11y.ts (cecha `selected` i polska wartość); `checked` tylko przy roli
 *     „switch” (systemowy przełącznik, wartość czyta UISwitch).
 *  6′. Reguła 6 dotyczy każdego elementu ze stanem zaznaczenia (accessibilityState.selected / checked), nie roli —
 *     po N-9 pole odhaczenia ma rolę „button” (N-202).
 * Każda para (kolor, tło) z reguł 5 i 6 trafia do `pairs` — test sprawdza, że jest w korpusie contrastPairs
 * (src/config/theme.ts), więc korpus nie jest już listą spisaną z pamięci (M-147).
 */
import { StyleSheet } from 'react-native';

import { contrastMin, fontScale, type Palette, sizes } from '../../config/theme';
import { contrastRatio } from '../../domain/contrast';

export type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown; parent: Node | null };

/** Role, którym React Native nadaje cechę iOS (reguła 1). */
export const IOS_TRAIT_ROLES = new Set(['none', 'button', 'togglebutton', 'link', 'image', 'img', 'keyboardkey', 'key', 'text', 'search', 'adjustable', 'header', 'heading', 'imagebutton', 'summary', 'switch', 'tabbar', 'progressbar']);
const INTERACTIVE_ROLES = new Set(['button', 'togglebutton', 'link', 'imagebutton', 'switch', 'adjustable', 'search', 'keyboardkey', 'checkbox', 'radio', 'tab', 'menuitem']);
const SELECTED_ROLES = new Set(['tab', 'radio']);
/** Szerokość ekranu w testach (harness: iPhone 390 pt); marginesy treści odejmuje reguła 15 z drzewa. */
const SCREEN_WIDTH = 390;

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
/** Ukryte przed VoiceOverem razem z dziećmi (reguła 12: samo accessible={false} nie ukrywa dzieci). */
const hidden = (n: Node) => [n, ...ancestors(n)].some((a) => a.props.accessibilityElementsHidden === true || a.props.importantForAccessibility === 'no-hide-descendants');
/** Przystanek VoiceOvera: nieukryty i nie `accessible={false}` (wtedy czynność ma inna droga, np. czynność wiersza, M-150). */
const isElement = (n: Node) => !hidden(n) && n.props.accessible !== false;
/** Element dostępny (`accessible`) nad elementem — VoiceOver czyta go w całości, dziecka nie wybierze (reguła 11). */
const groupAbove = (n: Node) => ancestors(n).find((a) => a.type !== 'Text' && a.props.accessible === true && !hidden(a));

/** Ekran, na którym leży element (testID „screen-…” z komponentu Screen); pasek zakładek i pasek „Cofnij” — bez ekranu. */
const screenOf = (n: Node) => ancestors(n).find((a) => typeof a.props.testID === 'string' && a.props.testID.startsWith('screen-'));

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

/** Suma poziomych odstępów stylu (margines wewnętrzny albo zewnętrzny, obwódka) z obu stron. */
function sides(s: Record<string, unknown>, kind: 'padding' | 'margin' | 'border'): number {
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  const all = kind === 'border' ? num('borderWidth') : num(kind);
  const h = kind === 'border' ? undefined : num(`${kind}Horizontal`);
  const side = (x: 'Left' | 'Right') => (kind === 'border' ? num(`border${x}Width`) : num(`${kind}${x}`)) ?? h ?? all ?? 0;
  return side('Left') + side('Right');
}

/**
 * Szerokość treści elementu w pt (reguła 15): stała szerokość, procent od treści rodzica albo treść rodzica bez
 * marginesów zewnętrznych; minus marginesy wewnętrzne i obwódka. Przewijana treść (ScrollView) — z contentContainerStyle.
 * Rodzeństwa w wierszu nie odejmujemy, więc wynik jest górną granicą (reguła nie zgłasza fałszywie).
 */
function innerWidth(n: Node | null): number {
  if (!n) return SCREEN_WIDTH;
  const s = style(n);
  const outer = typeof s.width === 'number' ? s.width : typeof s.width === 'string' && s.width.endsWith('%') ? (parseFloat(s.width) / 100) * innerWidth(hostParent(n)) : innerWidth(hostParent(n)) - sides(s, 'margin');
  const capped = typeof s.maxWidth === 'number' ? Math.min(outer, s.maxWidth) : outer;
  const content = (StyleSheet.flatten(n.props.contentContainerStyle as never) ?? {}) as Record<string, unknown>;
  return capped - sides(s, 'padding') - sides(s, 'border') - sides(content, 'padding');
}

export function audit(root: unknown, palette: Palette, where: string, opts: { screen?: boolean } = {}): AuditResult {
  const all = hosts(root as Node);
  const problems: string[] = [];
  const pairs: Pair[] = [];
  const say = (msg: string) => problems.push(`${where}: ${msg}`);
  const labels = new Map<string, number>();
  for (const n of all) {
    const s = style(n);
    const role = n.props.accessibilityRole as string | undefined;
    const label = n.props.accessibilityLabel as string | undefined;
    const name = `${role ?? 'element'} „${String(label ?? textOf(n))}”`;
    const state = (n.props.accessibilityState ?? {}) as { checked?: unknown; selected?: unknown; expanded?: unknown; busy?: unknown };
    if (role && !IOS_TRAIT_ROLES.has(role)) say(`rola „${role}” bez cechy iOS (${String(label ?? textOf(n))})`);
    // Reguła 17: stany, do których RN dopisuje angielskie słowa (poza systemowym przełącznikiem).
    for (const k of ['checked', 'expanded', 'busy'] as const) if (state[k] !== undefined && !(k === 'checked' && role === 'switch')) say(`${name}: stan „${k}” — RN dopisuje angielskie słowo (buttonA11y z src/ui/a11y.ts)`);
    // Reguła 10: pole tekstowe bez etykiety.
    if (n.type === 'TextInput' && isElement(n) && !label) say(`pole tekstowe bez etykiety („${String(n.props.placeholder ?? '')}”)`);
    const interactive = (role && INTERACTIVE_ROLES.has(role)) || (n.type === 'View' && isTouchable(n));
    if (interactive && isElement(n)) {
      if (!role) say(`element dotykowy bez roli „${String(label ?? textOf(n))}”`);
      if (!label) say(`${role ?? 'element'} bez etykiety`);
      const group = groupAbove(n);
      if (group) say(`${name} w środku elementu „${String(group.props.accessibilityLabel ?? textOf(group))}” — VoiceOver do niego nie dojdzie`);
      // Pasek nad klawiaturą (InputAccessoryView) jest widoczny tylko przy polu z fokusem — dwa pola liczbowe mają dwa
      // „Gotowe”, ale VoiceOver widzi naraz najwyżej jeden (RN: „pass that nativeID as the inputAccessoryViewID of whatever
      // TextInput you desire”, https://reactnative.dev/docs/0.86/inputaccessoryview).
      else if (label && !ancestors(n).some((a) => a.type === 'RCTInputAccessoryView')) {
        // Ekrany niżej na stosie są w drzewie testu, ale nie dla VoiceOvera — powtórzenia liczymy w obrębie jednego ekranu.
        const key = `${String(screenOf(n)?.props.testID ?? '')}\u0000${label}`;
        labels.set(key, (labels.get(key) ?? 0) + 1);
      }
      const h = Number(s.minHeight ?? s.height ?? 0);
      if (h < 44) say(`${name} ma ${h} pt wysokości`);
      const w = typeof s.width === 'number' ? s.width : typeof s.width === 'string' && s.width.endsWith('%') ? (parseFloat(s.width) / 100) * innerWidth(hostParent(n)) : null;
      if (w !== null && w < 44) say(`${name} ma ${Math.round(w)} pt szerokości`);
      // Nazwą jest etykieta; widoczna wartość pola (accessibilityValue, np. „Wybierz godzinę”, „18:00”) to wartość, nie nazwa.
      const inLabel = new Set(words(`${label ?? ''} ${String((n.props.accessibilityValue as { text?: string } | undefined)?.text ?? '')}`));
      const missing = words(textOf(n)).filter((w) => !inLabel.has(w));
      if (label && missing.length) say(`etykieta „${label}” bez widocznych słów: ${missing.join(', ')}`);
      if (role === 'switch' && state.checked === undefined) say(`${name} bez stanu „zaznaczone”`);
      if (role && SELECTED_ROLES.has(role) && state.selected === undefined) say(`${name} bez stanu „wybrane”`);
      // Reguła 6 (6′, N-202): obwódka albo wypełnienie elementu ze stanem zaznaczenia do tła wokół — według stanu, nie roli.
      if ((typeof state.selected === 'boolean' || typeof state.checked === 'boolean') && !isDisabled(n)) {
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
      // Zagnieżdżony Text dziedziczy kolor rodzica (reguła 13: własny kolor zagnieżdżonego też jest sprawdzany).
      const parentText = ancestors(n).find((a) => a.type === 'Text');
      const color = (s.color ?? (parentText ? style(parentText).color : undefined)) as string | undefined;
      // Reguła 7′ (audyt 3, N-67): wyjątek — element z Large Content Viewer, którego tytuł zawiera napis (zakładki;
      // Apple, UILargeContentViewerInteraction: „buttons in a tab bar remain small”, cytat w tabBar, src/config/theme.ts).
      const lcv = [n, ...ancestors(n)].find((a) => a.props.accessibilityShowsLargeContentViewer === true);
      if (n.props.allowFontScaling === false && !(lcv && String(lcv.props.accessibilityLargeContentTitle ?? '').includes(own))) say(`tekst „${own}” bez skalowania (allowFontScaling={false}${lcv ? ', tytuł Large Content Viewer bez tego napisu' : ''})`);
      // Limit niższy niż 200% tylko dla tytułu, który i tak dochodzi do „Large Title” przy AX5 (fontScale.TITLE_MAX_PT, M-43).
      const mult = n.props.maxFontSizeMultiplier;
      if (typeof mult === 'number' && mult < fontScale.FIXED_MAX && !(typeof s.fontSize === 'number' && Math.round(s.fontSize * mult) >= fontScale.TITLE_MAX_PT)) say(`tekst „${own}” z maxFontSizeMultiplier ${String(n.props.maxFontSizeMultiplier)}`);
      // Reguła 16: zmniejszanie do szerokości tylko do najmniejszego rozmiaru HIG.
      if (n.props.adjustsFontSizeToFit === true) {
        const min = Number(n.props.minimumFontScale ?? 0) * Number(s.fontSize ?? (parentText ? style(parentText).fontSize : 0));
        if (min < sizes.MIN_TEXT) say(`tekst „${own}” zmniejsza się do ${Math.round(min * 10) / 10} pt (adjustsFontSizeToFit, minimumFontScale < ${sizes.MIN_TEXT} pt)`);
      }
      if (!own) continue;
      if (parentText && (!s.color || s.color === style(parentText).color)) continue;
      // Bez rozmiaru z motywu iOS rysuje systemowe 14 pt bez Dynamic Type z motywu (audyt 2, M-42, M-152).
      if (!parentText && !s.fontSize) say(`tekst „${own}” bez rozmiaru`);
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
  // Reguła 14: ta sama etykieta na kilku elementach dotykowych.
  for (const [key, k] of labels) if (k > 1) say(`${k}× ta sama etykieta elementu dotykowego „${key.split('\u0000')[1]!}”`);
  if (opts.screen && !all.some((n) => n.props.accessibilityRole === 'header' && !hidden(n))) say('ekran bez nagłówka (rola header)');
  return { problems, pairs };
}
