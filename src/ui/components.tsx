/**
 * Klocki motywu „Wstążki” (D72, następca „Linii” z D50; makieta C: https://claude.ai/artifact/KS4HyYxYRQf3HfiS9Jvucx).
 * Każdy element dotykowy ma co najmniej sizes.TOUCH_TARGET (44 pt, Apple HIG), etykietę dostępności
 * i rolę; kolor grupy zawsze idzie w parze z jej nazwą.
 */
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { NavigationContext } from '@react-navigation/native';
import { createContext, type ReactNode, type Ref, type RefObject, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, InputAccessoryView, Keyboard, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import { fontScale } from '../config/theme';
import type { Indicator } from '../domain/sync-engine/scheduler';
import { strings } from '../i18n/strings.pl';
import { announce, buttonA11y, focusScreenTitle, spoken, useA11yFocus } from './a11y';
import { Glyph } from './glyph';
import { useTheme } from './theme';
import { useUndoBarHeight } from './undo';

export { Glyph } from './glyph';

/**
 * Wiersze z przesuwaniem na jednym ekranie (audyt 2, M-249; standard iOS): otwarty jest najwyżej jeden — otwarcie
 * następnego zamyka poprzedni, a przewinięcie ekranu zamyka otwarty.
 */
type SwipeGroup = { opened: (close: () => void) => void; closed: (close: () => void) => void; closeAll: () => void };
const SwipeContext = createContext<SwipeGroup | null>(null);

/**
 * Usuwanie przesunięciem jako czynność VoiceOvera wiersza (audyt 2, M-150; standard iOS — pokrętło „Czynności”):
 * wiersz w SwipeRow (StationRow, EventRow, NavRow) dostaje akcję „Usuń”/„Odwołaj”, a przycisk poza ekranem znika
 * z kolejności VoiceOvera (był dodatkowym przystankiem po każdym wierszu). RN 0.86 „accessibilityActions … custom
 * actions” (https://reactnative.dev/docs/0.86/accessibility#accessibility-actions).
 */
type SwipeAction = { label: string; run: () => void; claim: () => void };
const SwipeActionContext = createContext<SwipeAction | null>(null);

function useSwipeAction() {
  const act = useContext(SwipeActionContext);
  useEffect(() => act?.claim(), [act]);
  if (!act) return {};
  return {
    accessibilityActions: [{ name: 'delete', label: act.label }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => (e.nativeEvent.actionName === 'delete' ? act.run() : undefined),
  };
}

function useSwipeGroup(): SwipeGroup {
  const open = useRef<(() => void) | null>(null);
  return useMemo(
    () => ({
      opened: (close) => {
        if (open.current && open.current !== close) open.current();
        open.current = close;
      },
      closed: (close) => {
        if (open.current === close) open.current = null;
      },
      closeAll: () => {
        open.current?.();
        open.current = null;
      },
    }),
    [],
  );
}

/**
 * Ekran: przewijana treść na tle motywu. Audyt 2:
 *  - M-149: pod treścią ekranu stosu jest strefa wskaźnika Home (insets.bottom; na zakładkach zajmuje ją pasek zakładek),
 *    a przy widocznym pasku „Cofnij” — jeszcze jego wysokość, żeby ostatni przycisk dało się dotknąć;
 *  - M-294 (PWD-25 B): na iPadzie treść najwyżej layout.CONTENT_MAX_WIDTH szerokości, wyśrodkowana.
 * `refresh` — „przeciągnij, by odświeżyć” (PWD-10 A, audyt 2 M-279; zakładki i ekran listy): RefreshControl z React Native
 * (https://reactnative.dev/docs/refreshcontrol, właściwości `refreshing` i `onRefresh`). Kółko kręci się, dopóki trwa
 * pobieranie (`refreshing`).
 */
export function Screen({ children, scroll = true, testID, refresh }: { children: ReactNode; scroll?: boolean; testID?: string; refresh?: { refreshing: boolean; onRefresh: () => void } }) {
  const { c, space, layout } = useTheme();
  const insets = useSafeAreaInsets();
  const swipe = useSwipeGroup();
  // Wysokość paska zakładek, gdy ekran jest zakładką (React Navigation podaje ją tylko wewnątrz zakładek).
  const tabBar = useContext(BottomTabBarHeightContext);
  const undoBar = useUndoBarHeight();
  const bottom = space.SCREEN_BOTTOM + (tabBar === undefined ? insets.bottom : 0);
  // Pasek „Cofnij” stoi layout.UNDO_BAR_OFFSET nad strefą Home, liczoną od dołu okna (nad paskiem zakładek — mniej).
  const underBar = undoBar > 0 ? insets.bottom + layout.UNDO_BAR_OFFSET + undoBar - (tabBar ?? 0) + space.SCREEN_GAP : 0;
  const style = { flex: 1, backgroundColor: c.ground };
  const content: ViewStyle = { paddingTop: insets.top + 12, paddingBottom: Math.max(bottom, underBar), paddingHorizontal: space.SCREEN_SIDE, gap: space.SCREEN_GAP, width: '100%', maxWidth: layout.CONTENT_MAX_WIDTH + 2 * space.SCREEN_SIDE, alignSelf: 'center' };
  return (
    <SwipeContext.Provider value={swipe}>
      {scroll ? (
        // D102: klawiatura chowa się przy przewijaniu i po dotknięciu pustego miejsca (keyboardShouldPersistTaps „handled”).
        // D109: pas w kolorze tła pod zegarem i baterią — przewijana treść chowa się pod nim.
        // Audyt 2 (M-41): pole na dole ekranu nie zostaje pod klawiaturą — RN 0.86 (ScrollView, iOS): „automatically adjust
        // its contentInset and scrollViewInsets when the Keyboard changes its size”
        // (https://reactnative.dev/docs/0.86/scrollview#automaticallyadjustkeyboardinsets-ios).
        <View style={style}>
          <ScrollView
            testID={testID}
            style={style}
            contentContainerStyle={content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            onScrollBeginDrag={swipe.closeAll}
            refreshControl={refresh ? <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={c.inkMuted} accessibilityLabel={strings['common.refresh']} /> : undefined}
          >
            {children}
          </ScrollView>
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: c.ground }} />
        </View>
      ) : (
        <View testID={testID} style={[style, content]}>
          {children}
        </View>
      )}
    </SwipeContext.Provider>
  );
}

/** Mnożnik Dynamic Type dla tytułu o danym rozmiarze: najwyżej fontScale.TITLE_MAX_PT (M-43, src/config/theme.ts). */
export const titleScale = (pt: number) => fontScale.TITLE_MAX_PT / pt;

/**
 * Tytuł ekranu. Po wejściu na ekran (koniec przejścia na stosie, także powrót na ten ekran) VoiceOver zaczyna od tytułu,
 * nie od „Wróć” czy chipu synchronizacji (audyt 2, M-269; HIG: tytuł to pierwsza informacja po wejściu na stronę).
 * Przełączenie zakładki fokusu nie przenosi (zostaje na zakładce, jak w aplikacjach systemowych).
 * `a11yFocus` — fokus także po pojawieniu się tytułu na tym samym ekranie (np. ostatni krok Pierwszych kroków, M-44).
 * `role` — rola rozmiaru z motywu dla tytułów spoza zwykłych ekranów (logowanie, wprowadzenie); Dynamic Type do
 * fontScale.TITLE_MAX_PT, interlinia fontScale.TITLE_LEADING (M-43, M-270).
 */
export function Title({ children, a11yFocus, role = 'TITLE' }: { children: string; a11yFocus?: boolean; role?: 'TITLE' | 'BRAND' | 'INTRO' }) {
  const { c, font, size } = useTheme();
  const pt = size[role];
  const ref = useA11yFocus<Text>(null, !!a11yFocus);
  useScreenTitleFocus(ref);
  return (
    <Text ref={ref} accessibilityRole="header" maxFontSizeMultiplier={titleScale(pt)} style={{ fontFamily: font.display800, fontSize: pt, lineHeight: pt * fontScale.TITLE_LEADING, letterSpacing: role === 'BRAND' ? -1.5 : -1, color: c.ink }}>
      {children}
    </Text>
  );
}

/**
 * Fokus VoiceOvera na nagłówku ekranu po wejściu na ekran (M-269) — wspólne dla Title i nagłówków, które go zastępują
 * (linia grupy na ekranie zadania, ekran „brak obiektu” — audyt 3, N-63).
 */
function useScreenTitleFocus(ref: RefObject<Text | null>) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!navigation) return;
    let cancel = () => {};
    const subs: (() => void)[] = [];
    // Ekran zakładki leży w ekranie stosu „Tabs” — przejście ogłasza rodzic.
    for (let n: typeof navigation | undefined = navigation; n; n = n.getParent()) {
      subs.push(
        n.addListener('transitionEnd' as never, (e: { data?: { closing?: boolean } }) => {
          if (e.data?.closing || !navigation.isFocused()) return;
          cancel();
          cancel = focusScreenTitle(ref);
        }),
      );
    }
    return () => (subs.forEach((u) => u()), cancel());
  }, [navigation, ref]);
}

/**
 * Nagłówek panelu, który pojawia się w miejscu (pytanie, wybór osoby, wybór spotkania). Przycisk, który go otworzył,
 * zwykle znika, a iOS przenosi wtedy fokus na początek ekranu — więc fokus VoiceOvera przechodzi na nagłówek
 * (audyt 2, M-44). Ten sam wygląd co CardTitle (M-281).
 */
export function PanelTitle({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  const ref = useA11yFocus<Text>(children);
  return (
    <Text ref={ref} accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: size.CARD_TITLE, color: c.ink }}>
      {children}
    </Text>
  );
}

/** Pytanie potwierdzenia w miejscu przycisku („Wyjść z grupy?”) — jak Body, z fokusem VoiceOvera po pojawieniu (M-44). */
export function ConfirmText({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  const ref = useA11yFocus<Text>(children);
  return (
    <Text ref={ref} style={{ fontFamily: font.text400, fontSize: size.BODY, color: c.ink, lineHeight: size.BODY * 1.3 }}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const { c, font, size, space } = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontFamily: font.display700, fontSize: size.SECTION, letterSpacing: 1.2, textTransform: 'uppercase', color: c.inkMuted, marginTop: space.SECTION_TOP, marginBottom: 4 }}>
      {children}
    </Text>
  );
}

/** `a11yLabel` — wersja do czytania przez VoiceOver, gdy tekst z aplikacji ma symbole („·”, „1 h”, „śr.”; N-65). */
export function Body({ children, muted, style, testID, a11yLabel }: { children: ReactNode; muted?: boolean; style?: object; testID?: string; a11yLabel?: string }) {
  const { c, font, size } = useTheme();
  return <Text testID={testID} accessibilityLabel={a11yLabel} style={[{ fontFamily: font.text400, fontSize: size.BODY, color: muted ? c.inkMuted : c.ink, lineHeight: size.BODY * 1.3 }, style]}>{children}</Text>;
}

/**
 * Nagłówek karty i panelu — jeden wygląd na każdej karcie (audyt 2, M-281, PWD-12 B): krój tekstu 700, sizes.CARD_TITLE.
 */
export function CardTitle({ children, testID }: { children: ReactNode; testID?: string }) {
  const { c, font, size } = useTheme();
  return (
    <Text accessibilityRole="header" testID={testID} style={{ fontFamily: font.text700, fontSize: size.CARD_TITLE, color: c.ink }}>
      {children}
    </Text>
  );
}

/**
 * Karta (audyt 2, M-281; PWD-12 B): `card` — karta informacyjna (promień radius.CARD), `panel` — panel pod polem albo
 * wierszem i wpis na liście (radius.PANEL). Odstępy i obwódka z motywu (przy „Zwiększ kontrast” wyraźniejsza, D197).
 * `style` — tylko dodatki (np. pasek koloru grupy z lewej, czerwona obwódka błędu).
 */
export function Card({ children, kind = 'card', testID, style }: { children: ReactNode; kind?: 'card' | 'panel'; testID?: string; style?: ViewStyle }) {
  const { c, radius, space } = useTheme();
  const card = kind === 'card';
  return (
    <View testID={testID} style={[{ gap: card ? space.CARD_GAP : space.PANEL_GAP, padding: card ? space.CARD_PAD : space.PANEL_PAD, borderRadius: card ? radius.CARD : radius.PANEL, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }, style]}>
      {children}
    </View>
  );
}

/**
 * Nagłówek okresu (miesiąc, tydzień, dzień) — ten sam rozmiar w Kalendarzu, Moich sprawach i mini kalendarzu (M-152).
 * Zmiana okresu (strzałki, „Dziś”, przełącznik Dzień/Tydzień) jest ogłaszana (audyt 3, N-60; WCAG 2.2 SC 4.1.3 „Status
 * Messages”): fokus zostaje na strzałce, której etykieta się nie zmienia, więc bez ogłoszenia VoiceOver milczy.
 * Pierwsze pokazanie — bez ogłoszenia (wejście na ekran czyta tytuł ekranu).
 */
export function PeriodTitle({ children, testID }: { children: string; testID?: string }) {
  const { c, font, size } = useTheme();
  const shown = useRef(children);
  useEffect(() => {
    if (shown.current === children) return;
    shown.current = children;
    announce(children);
  }, [children]);
  return (
    <Text accessibilityRole="header" testID={testID} style={{ flex: 1, textAlign: 'center', fontFamily: font.display700, fontSize: size.PERIOD, color: c.ink }}>
      {children}
    </Text>
  );
}

/** Strzałka poprzedni/następny okres obok PeriodTitle. */
export function PeriodArrow({ dir, label, onPress, testID }: { dir: -1 | 1; label: string; onPress: () => void; testID?: string }) {
  const { c, size } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={{ minWidth: size.TOUCH_TARGET, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <Glyph name={dir < 0 ? 'prev' : 'next'} color={c.ink} place="period" />
    </Pressable>
  );
}

/**
 * Komunikat o błędzie pod polem albo przyciskiem: czerwony i ogłaszany przez VoiceOver, gdy się pojawi albo zmieni
 * (audyt 2, M-39: rola „alert” na iOS niczego nie ogłasza — zostaje dla innych platform i testów). Jeden wygląd wszędzie:
 * rozmiar i krój z motywu (M-152).
 */
export function ErrorText({ children, testID, silent, attempt }: { children: string; testID?: string; silent?: boolean; attempt?: number }) {
  const { c, font, size } = useTheme();
  // `silent` — ten sam błąd ogłasza już inny napis (np. „Popraw lekcję…” przy „Zapisz”), bez dwóch ogłoszeń naraz.
  // `attempt` — licznik prób z useFormError: ten sam błąd przy kolejnym „Zapisz” jest znów ogłaszany (audyt 3, N-194).
  useEffect(() => (silent ? undefined : announce(children)), [children, silent, attempt]);
  return (
    <Text accessibilityRole="alert" testID={testID} style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>
      {children}
    </Text>
  );
}

/**
 * Błąd formularza z licznikiem prób (audyt 3, N-194): każde ustawienie błędu (także tego samego przy drugim „Zapisz”)
 * zwiększa licznik, który ErrorText dostaje w `attempt` — bez tego React pomija ten sam stan i VoiceOver milczy, a osoba
 * myśli, że przycisk nie działa. Wyczyszczenie (null) licznika nie zmienia.
 */
export function useFormError<T>(): [T | null, (e: T | null) => void, number] {
  const [state, setState] = useState<{ e: T | null; n: number }>({ e: null, n: 0 });
  const set = useCallback((e: T | null) => setState((s) => (e !== null ? { e, n: s.n + 1 } : s.e === null ? s : { e: null, n: s.n })), []);
  return [state.e, set, state.n];
}

/** Potwierdzenie albo stan po czynności („Dodano do kalendarza”, „Wysłano”): zwykły tekst ogłaszany jak błąd (M-39). */
export function StatusText({ children }: { children: string }) {
  useEffect(() => announce(children), [children]);
  return <Body muted>{children}</Body>;
}

/** Tekst wskaźnika synchronizacji (architektura: 5 stanów + wygasła sesja). */
export function indicatorLabel(i: Indicator, nowMs: number): string {
  switch (i.state) {
    case 'offline':
      return strings['sync.offline'](i.pending);
    case 'auth_expired':
      return strings['sync.authExpired'];
    case 'upgrade_required':
      return strings['sync.upgrade'];
    case 'syncing':
      return strings['sync.syncing'];
    case 'error':
      return strings['sync.error'];
    case 'pending':
      return strings['sync.pending'](i.pending);
    case 'synced':
      return strings['sync.synced'](i.since === null ? null : Math.floor((nowMs - i.since) / 60_000));
  }
}

const PROBLEM: ReadonlySet<Indicator['state']> = new Set(['offline', 'error', 'auth_expired', 'upgrade_required']);

/**
 * Co ogłosić VoiceOverem po zmianie wskaźnika (audyt 2, M-37): wejście w problem (offline, błąd, wygasła sesja,
 * „zaktualizuj”) albo zmianę problemu i powrót do normy (zsynchronizowano / czeka) — nie każde „synchronizuję”.
 * `last` — stan z ostatniego ogłoszenia albo ostatni zwykły stan.
 */
export function syncAnnouncement(last: Indicator['state'], next: Indicator, nowMs: number): { text: string | null; last: Indicator['state']; calm: boolean } {
  if (next.state === 'syncing') return { text: null, last, calm: false };
  const problem = PROBLEM.has(next.state);
  const say = problem ? next.state !== last : PROBLEM.has(last);
  return { text: say ? spoken(indicatorLabel(next, nowMs)) : null, last: next.state, calm: say && !problem };
}

/**
 * Ogłaszanie stanu synchronizacji (audyt 3, N-198): wejście w problem — od razu; powrót do normy — dopiero po
 * config.a11y.SYNC_CALM_MS bez nowego problemu. Problem, który wrócił w tym czasie, nie jest ogłaszany drugi raz
 * (powrotu też nie było). `read` — bieżący wskaźnik, `now` — zegar, `say` — ogłoszenie (announce).
 */
export function syncAnnouncer(read: () => Indicator, now: () => number, say: (text: string | null) => void): { update: () => void; stop: () => void } {
  let last = read().state;
  let calm: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (calm) clearTimeout(calm);
    calm = null;
  };
  const update = () => {
    const i = read();
    const r = syncAnnouncement(last, i, now());
    if (PROBLEM.has(i.state)) stop();
    if (!r.calm) {
      last = r.last;
      return say(r.text);
    }
    if (calm) return;
    calm = setTimeout(() => {
      calm = null;
      const later = syncAnnouncement(last, read(), now());
      if (later.calm) {
        last = later.last;
        say(later.text);
      }
    }, config.a11y.SYNC_CALM_MS);
  };
  return { update, stop };
}

/**
 * Wskaźnik synchronizacji. „Zaktualizuj aplikację” (upgrade_required) dostaje przycisk do publicznego linku TestFlight
 * (decyzja koordynatora 8.10.2026), gdy link jest ustawiony (config.invites.TESTFLIGHT_LINK); bez niego — sam tekst.
 */
export function SyncChip({ indicator, nowMs }: { indicator: Indicator; nowMs: number }) {
  const link = config.invites.TESTFLIGHT_LINK;
  const chip = <SyncChipBody indicator={indicator} nowMs={nowMs} />;
  if (indicator.state !== 'upgrade_required' || !link) return chip;
  return (
    <View style={{ gap: 8 }}>
      {chip}
      <Button kind="secondary" label={strings['sync.upgradeOpen']} testID="sync-upgrade" onPress={() => void Linking.openURL(link).catch(() => {})} />
    </View>
  );
}

function SyncChipBody({ indicator, nowMs }: { indicator: Indicator; nowMs: number }) {
  const { c, font, size } = useTheme();
  const warn = indicator.state === 'offline' || indicator.state === 'error' || indicator.state === 'auth_expired' || indicator.state === 'upgrade_required';
  const label = indicatorLabel(indicator, nowMs);
  return (
    // Jeden element VoiceOvera z etykietą (audyt 2, M-264): etykieta zwykłego widoku na iOS nie jest czytana.
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={strings['sync.a11y'](spoken(label))}
      accessibilityLiveRegion="polite"
      testID="sync-chip"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: warn ? c.warnBorder : c.border, backgroundColor: warn ? c.warnBg : c.surface }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: warn ? c.warnBorder : indicator.state === 'synced' ? c.ok : c.inkMuted }} />
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: warn ? c.warnInk : c.ink }}>{label}</Text>
    </View>
  );
}

export function LineChip({ name, line }: { name: string; line: number }) {
  const { c, font, size, line: lineOf } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 6, paddingRight: 10, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: lineOf(line).line }} />
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.ink }}>{name}</Text>
    </View>
  );
}

export function Checkbox({ checked, onPress, label, round = true }: { checked: boolean; onPress: () => void; label: string; round?: boolean }) {
  const { c, size, radius } = useTheme();
  return (
    <Pressable
      {...buttonA11y({ selected: checked })}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, borderRadius: round ? size.TOUCH_TARGET / 2 : radius.FIELD, borderWidth: 2, borderColor: checked ? c.ok : c.control, backgroundColor: checked ? c.ok : c.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      {/* M-43: pole ma stały kształt 44 pt, więc ✓ nie rośnie z Dynamic Type ponad to pole (wielkość = rola GLYPH_CHECK). */}
      {checked ? <Glyph name="check" color={c.surface} place="check" /> : null}
    </Pressable>
  );
}

/** Jedyny separator pól w opisie wiersza (audyt 2, M-128): StationRow, EventRow, src/app/row-meta.ts. */
export const META_SEP = '  ·  ';

/**
 * Wiersz-stacja: odcinek linii grupy z kropką, tytuł, opis (czas · grupa · osoba…) i pole do odhaczenia.
 * `depth` wcina podzadania; zrobione — przekreślone. `when` — czas (godzina albo termin) na początku opisu, jak w EventRow
 * (M-128). `readOnly` — bez pola odhaczania (blady przyszły termin zadania powtarzanego, zrobione zakupy w Kalendarzu).
 */
export function StationRow(props: {
  title: string;
  line: number;
  group?: string;
  when?: string;
  readOnly?: boolean;
  meta?: string[];
  depth?: number;
  checked: boolean;
  /** Brak — wiersz bez pola odhaczenia (np. zakupy u dziecka z kontem: serwer ich nie przyjmie, PW-14 B). */
  onToggle?: () => void;
  onOpen?: () => void;
  /** Podpowiedź VoiceOvera, co robi dotknięcie wiersza (domyślnie „Otwiera zadanie”). */
  openHint?: string;
  /** Wiersz rozwija panel pod sobą (np. pozycja zakupów) — stan dla VoiceOvera. */
  expanded?: boolean;
  pending?: boolean;
  shopping?: boolean;
  /** Ostrzeżenie na czerwono, np. „zaległe od 2 dni” (D61). */
  alert?: string;
  testID?: string;
}) {
  const { c, font, size, line } = useTheme();
  const l = line(props.line);
  const done = props.checked;
  const toggleLabel = props.shopping
    ? (done ? strings['shop.takeOut'] : strings['shop.put'])(props.title)
    : `${done ? strings['task.undone'] : strings['task.done']}: ${props.title}`;
  // D104: podzadanie — wcięcie pod rodzicem, cieńsza wstążka i mniejsza kropka.
  const sub = (props.depth ?? 0) > 0;
  const actions = useSwipeAction();
  // Audyt 2 (M-263): VoiceOver zaczyna od tytułu, czyta widoczne dopiski (także „czeka na wysłanie”) słowami, a czynność
  // jest w podpowiedzi, nie w etykiecie. Wiersz bez otwierania (M-142) to zwykły element z etykietą — nie „wyszarzony”
  // przycisk.
  // Audyt 3 (N-65): ostrzeżenie też słowami (dopisek z aplikacji).
  const label = [props.title, props.alert ? spoken(props.alert) : null, props.when ? spoken(props.when) : null, props.group, ...(props.meta ?? []).map(spoken), props.pending ? strings['lists.pendingItem'] : null].filter(Boolean).join(', ');
  const body = (
    <>
      <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: done || props.readOnly ? c.inkMuted : c.ink, textDecorationLine: done ? 'line-through' : 'none' }}>{props.title}</Text>
      {props.alert ? <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.danger }}>{props.alert}</Text> : null}
      {props.when || props.group || props.meta?.length || props.pending ? (
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
          {[
            ...(props.when ? [<Text key="when" style={{ fontFamily: font.text700, color: c.ink }}>{props.when}</Text>] : []),
            ...(props.group ? [<Text key="group" style={{ fontFamily: font.text700, color: l.ink }}>{props.group}</Text>] : []),
            ...(props.meta ?? []),
            ...(props.pending ? [<Text key="pending" style={{ fontFamily: font.text700, color: c.pendingInk }}>{strings['lists.pendingItem']}</Text>] : []),
          ].flatMap((part, i) => (i === 0 ? [part] : [META_SEP, part]))}
        </Text>
      ) : null}
    </>
  );
  const bodyStyle = { flex: 1, minHeight: size.TOUCH_TARGET, paddingVertical: 10, paddingLeft: 6, gap: 3, justifyContent: 'center' } as const;
  return (
    <View testID={props.testID} style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: sub ? 52 : 60, marginLeft: Math.min(props.depth ?? 0, 3) * 22 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {/* Wstążka grupy (D72): szeroka, zaokrąglona, z kropką w jaśniejszej obwódce. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, width: sub ? 4 : 10, borderRadius: 5, backgroundColor: l.line, opacity: done || props.readOnly ? 0.12 : 0.28 }} />
        {sub ? null : <View style={{ position: 'absolute', top: 11, width: 30, height: 30, borderRadius: 15, backgroundColor: done ? c.control : l.line, opacity: 0.22 }} />}
        <View style={{ marginTop: sub ? 18 : 16, width: sub ? 12 : 20, height: sub ? 12 : 20, borderRadius: 10, backgroundColor: done ? c.control : l.line }} />
      </View>
      {props.onOpen ? (
        <Pressable
          {...buttonA11y({ expanded: props.expanded })}
          accessibilityLabel={label}
          accessibilityHint={props.openHint ?? strings['task.openHint']}
          {...actions}
          onPress={props.onOpen}
          style={bodyStyle}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} {...actions} style={bodyStyle}>
          {body}
        </View>
      )}
      {props.onToggle && !props.readOnly ? (
        <View style={{ justifyContent: 'center' }}>
          <Checkbox checked={done} onPress={props.onToggle} label={toggleLabel} round={!props.shopping} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Zwijana sekcja („Bez terminu (N)” w tygodniu i miesiącu, „Zrobione dziś (N)”, „Zrobione (N)” na ekranie wydarzenia —
 * PWD-7 A, PWD-13 A): nagłówek jest przyciskiem ze stanem rozwinięcia dla VoiceOvera.
 */
export function Collapsible({ title, open, onToggle, children, testID }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; testID?: string }) {
  const { c, font, size } = useTheme();
  return (
    <View testID={testID}>
      <Pressable
        {...buttonA11y({ expanded: open })}
        accessibilityLabel={(open ? strings['section.hideA11y'] : strings['section.showA11y'])(title)}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: size.TOUCH_TARGET }}
      >
        <Text style={{ fontFamily: font.display700, fontSize: size.SECTION, letterSpacing: 1.2, textTransform: 'uppercase', color: c.inkMuted }}>{title}</Text>
        <Glyph name={open ? 'less' : 'more'} color={c.inkMuted} place="inline" />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** Szerokość odsłanianego przycisku „Usuń” (pt). */
const SWIPE_ACTION = 96;

/**
 * Wiersz z usuwaniem przesunięciem w lewo (D60, standard iOS): przesunięcie odsłania „Usuń”, usuwa dopiero dotknięcie
 * przycisku. Zwykłe dotknięcie wiersza niczego nie usuwa. VoiceOver dociera do przycisku jak do każdego innego.
 * `action="cancel"` — „Odwołaj” (termin wydarzenia cyklicznego). Otwarty jest najwyżej jeden wiersz na ekranie, a po
 * dotknięciu przycisku wiersz się zamyka (audyt 2, M-249).
 */
export function SwipeRow({ children, title, onDelete, enabled = true, testID, action = 'delete' }: { children: ReactNode; title: string; onDelete: () => void; enabled?: boolean; testID?: string; action?: 'delete' | 'cancel' }) {
  const { c, font, size, radius } = useTheme();
  const ref = useRef<ScrollView>(null);
  const group = useContext(SwipeContext);
  // Szerokość wiersza = szerokość ekranu bez marginesów Screen (20 pt z każdej strony), potem z pomiaru.
  const [width, setWidth] = useState(Dimensions.get('window').width - 40);
  const close = useCallback(() => ref.current?.scrollTo({ x: 0, animated: true }), []);
  useEffect(() => () => group?.closed(close), [group, close]);
  // Wiersz przejął usuwanie jako czynność VoiceOvera (M-150) — przycisk tylko dla dotyku i przesunięcia.
  const [claimed, setClaimed] = useState(false);
  const press = () => {
    ref.current?.scrollTo({ x: 0, animated: false });
    group?.closed(close);
    onDelete();
  };
  const latest = useRef(press);
  useEffect(() => void (latest.current = press));
  const label = strings[action === 'delete' ? 'common.delete' : 'event.cancel'];
  const act = useMemo(() => ({ label, run: () => latest.current(), claim: () => setClaimed(true) }), [label]);
  if (!enabled) return <>{children}</>;
  const settle = (x: number) => (x > 0 ? group?.opened(close) : group?.closed(close));
  return (
    <ScrollView
      ref={ref}
      testID={testID}
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator={false}
      snapToOffsets={[0, SWIPE_ACTION]}
      decelerationRate="fast"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.x)}
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}
    >
      <View style={{ width }}>
        <SwipeActionContext.Provider value={act}>{children}</SwipeActionContext.Provider>
      </View>
      <View style={{ width: SWIPE_ACTION, paddingLeft: 8, justifyContent: 'center' }}>
        {/* Przejęty przez wiersz: nie jest elementem VoiceOvera (napis też nie), dotyk działa jak dotąd. */}
        <Pressable
          accessible={!claimed}
          accessibilityRole="button"
          accessibilityLabel={strings[action === 'delete' ? 'swipe.deleteA11y' : 'swipe.cancelA11y'](title)}
          onPress={press}
          style={{ minHeight: size.TOUCH_TARGET + 8, borderRadius: radius.FIELD, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.danger }}
        >
          <Text accessibilityElementsHidden={claimed} style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>
            {label}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** `danger` (czerwony) — przycisk, który usuwa albo unieważnia, w obu krokach: otwarcie i potwierdzenie (audyt 2, M-241). */
/**
 * `busy` — trwa czynność sieciowa (audyt 2, M-267): mały wskaźnik postępu i stan „zajęty” dla VoiceOvera (RN ogłasza go
 * na iOS: RCTViewComponentView, `accessibilityState.busy`); przycisk jest wtedy nieaktywny. `a11yFocus` — fokus
 * VoiceOvera na przycisku po jego pojawieniu (potwierdzenie w miejscu bez pytania, M-44).
 */
export function Button({ label, onPress, kind = 'primary', disabled, testID, a11yHint, a11yLabel, busy, a11yFocus }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; testID?: string; a11yHint?: string; a11yLabel?: string; busy?: boolean; a11yFocus?: boolean }) {
  const { c, font, size, radius } = useTheme();
  const ref = useA11yFocus<View>(null, !!a11yFocus);
  const off = !!disabled || !!busy;
  const bg = kind === 'primary' ? c.inverseBg : c.surface;
  const fg = kind === 'primary' ? c.inverseInk : kind === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      {...buttonA11y({ disabled: off, busy })}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={a11yHint}
      disabled={off}
      onPress={onPress}
      style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: radius.PILL, paddingHorizontal: 18, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'primary' ? 0 : 1, borderColor: kind === 'danger' ? c.danger : c.border, opacity: off ? 0.5 : 1 }}
    >
      {busy ? <ActivityIndicator testID={testID ? `${testID}-busy` : undefined} color={fg} /> : null}
      <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: fg }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Limit długości (audyt 2, M-228): `maxLength` z src/config (zgodny z SQL) — pole nie przyjmie więcej znaków
 * (https://reactnative.dev/docs/0.86/textinput#maxlength), a przy limicie mówi o tym zamiast odrzucenia po synchronizacji.
 */
function LengthNote({ value, max }: { value: string | undefined; max: number | undefined }) {
  const { c, font, size } = useTheme();
  if (max === undefined || (value ?? '').length < max) return null;
  return <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings['common.maxLength'](max)}</Text>;
}

/**
 * Widoczny podpis pola (Field, DateField, TimeField). Pole ma tę samą etykietę, więc podpis jest ukryty przed VoiceOverem —
 * inaczej każdy podpis to osobny przystanek przed polem („Tytuł”, potem „Tytuł, Odebrać paczkę, pole tekstowe”; audyt 3,
 * N-195). RN 0.86: „setting accessibilityElementsHidden to true on view B causes VoiceOver to ignore the B view”
 * (https://reactnative.dev/docs/0.86/accessibility#accessibilityelementshidden-ios).
 */
export function FieldCaption({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>
      {children}
    </Text>
  );
}

/** `ref` — pole tekstowe (React 19: ref jak zwykły props), np. żeby przejść do pola z karty „Następne kroki”. */
/**
 * `a11yFocus` — fokus VoiceOvera na polu po jego pojawieniu (panel w miejscu zaczyna się od pola, M-44); wtedy bez `ref`.
 * Klawiatura numeryczna iOS nie ma klawisza zatwierdzenia — pole z nią dostaje pasek „Gotowe” nad klawiaturą
 * (audyt 2, M-268; RN 0.86 InputAccessoryView, iOS: https://reactnative.dev/docs/0.86/inputaccessoryview).
 */
export function Field({ label, ref, a11yFocus, ...input }: TextInputProps & { label: string; ref?: Ref<TextInput>; a11yFocus?: boolean }) {
  const { c, font, size, radius } = useTheme();
  const own = useA11yFocus<TextInput>(null, !!a11yFocus);
  const accessory = useId();
  const numeric = input.keyboardType === 'number-pad' || input.keyboardType === 'decimal-pad';
  return (
    <View style={{ gap: 6 }}>
      <FieldCaption>{label}</FieldCaption>
      <TextInput
        ref={a11yFocus ? own : ref}
        accessibilityLabel={label}
        placeholderTextColor={c.inkMuted}
        inputAccessoryViewID={numeric ? accessory : undefined}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: radius.FIELD, borderWidth: 1, borderColor: c.control, backgroundColor: c.surface, paddingHorizontal: 14, color: c.ink, fontFamily: font.text400, fontSize: size.BODY }}
        {...input}
      />
      {numeric ? (
        <InputAccessoryView nativeID={accessory} backgroundColor={c.surface}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, borderTopWidth: 1, borderColor: c.border }}>
            <Pressable accessibilityRole="button" accessibilityLabel={strings['common.finish']} onPress={() => Keyboard.dismiss()} style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>{strings['common.finish']}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      <LengthNote value={input.value} max={input.maxLength} />
    </View>
  );
}

/**
 * Pole szybkiego dodawania (D18): biała pigułka z okrągłym przyciskiem „Dodaj” w kolorze akcentu (D72). Tytuł zadania
 * i pozycji zakupów ma limit z SQL (config.lengths.TASK_TITLE; audyt 2, M-228).
 */
/** `inputRef` — pole tekstowe, np. żeby fokus VoiceOvera wrócił do niego po „Anuluj” w pytaniu pod polem (audyt 3, N-62). */
export function QuickAddField({ value, onChangeText, onSubmit, placeholder, children, inputRef }: { value: string; onChangeText: (s: string) => void; onSubmit: () => void; placeholder: string; children?: ReactNode; inputRef?: Ref<TextInput> }) {
  const { c, font, size } = useTheme();
  // D102: po dodaniu klawiatura znika (także po „+”, nie tylko po klawiszu zatwierdzenia).
  const submit = () => {
    Keyboard.dismiss();
    onSubmit();
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingLeft: 18, paddingRight: 5, borderRadius: 27, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
        <TextInput
          ref={inputRef}
          testID="quick-add"
          accessibilityLabel={strings['quick.label']}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={submit}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={c.inkMuted}
          maxLength={config.lengths.TASK_TITLE}
          style={{ flex: 1, color: c.ink, fontFamily: font.text400, fontSize: size.BODY, minHeight: size.TOUCH_TARGET }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['common.add']}
          onPress={submit}
          style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, borderRadius: size.TOUCH_TARGET / 2, backgroundColor: c.inverseBg, alignItems: 'center', justifyContent: 'center' }}
        >
          <Glyph name="add" color={c.inverseInk} place="check" />
        </Pressable>
      </View>
      <LengthNote value={value} max={config.lengths.TASK_TITLE} />
      {children}
    </View>
  );
}

/** Rozpoznany fragment (D18: chip do odklikania). */
export function TokenChip({ text, onPress }: { text: string; onPress: () => void }) {
  const { c, font, size } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings['quick.chipA11y'](text)}
      accessibilityHint={strings['quick.chipHint']}
      onPress={onPress}
      style={{ minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.control }}
    >
      <Text maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontFamily: font.text600, fontSize: size.CONTROL, color: c.ink }}>{text}</Text>
      <Glyph name="close" color={c.ink} place="inline" />
    </Pressable>
  );
}

/**
 * Wiersz nawigacyjny (lista, grupa, ustawienie) z kropką linii. `chevron={false}` — wiersz wyboru, który nie przechodzi
 * na inny ekran (strzałka „›” obiecuje przejście, audyt 2: G-14, U-14).
 */
export function NavRow({ title, subtitle, line, onPress, testID, chevron = true }: { title: string; subtitle?: string; line?: number; onPress: () => void; testID?: string; chevron?: boolean }) {
  const { c, font, size, radius } = useTheme();
  const actions = useSwipeAction();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      // Audyt 3 (N-65): podpis budowany przez aplikację („3 osoby · administrator”, „Co tydzień: śr. · 17:00”) słowami.
      accessibilityLabel={subtitle ? `${title}, ${spoken(subtitle)}` : title}
      {...actions}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, borderRadius: radius.ROW, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}
    >
      {line === undefined ? null : <GroupMark line={line} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{title}</Text>
        {subtitle ? <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{subtitle}</Text> : null}
      </View>
      {chevron ? <Glyph name="next" color={c.inkMuted} /> : null}
    </Pressable>
  );
}

/**
 * `a11yLabel` — etykieta VoiceOver grupy z kontekstem, gdy kilka grup na ekranie ma ten sam napis (audyt 2, M-145);
 * `hint` opcji — podpowiedź VoiceOvera, gdy wybór robi coś więcej niż zaznaczenie (np. otwiera inny formularz).
 * `contextual` — kilka pól na ekranie ma te same opcje („Włączone / Wyłączone” dla każdego kalendarza, „Będę / Może”
 * dla każdej osoby): opcja mówi, do którego pola należy („Włączone, Praca”), bo etykieta grupy na iOS nie jest czytana
 * przy przechodzeniu po opcjach (audyt 2, M-264).
 */
export function Segmented<T extends string>({ value, options, onChange, label, a11yLabel, contextual }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string; a11yLabel?: string; contextual?: boolean }) {
  const { c, font, size } = useTheme();
  return (
    // Bez roli „radiogroup” (na iOS bez cechy, N-9); etykieta grupy dla testów, opcje mówią ją same przy `contextual`.
    <View accessibilityLabel={a11yLabel ?? label} style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              {...buttonA11y({ selected: on })}
              accessibilityLabel={contextual ? `${o.label}, ${a11yLabel ?? label}` : o.label}
              accessibilityHint={o.hint}
              onPress={() => onChange(o.value)}
              style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: on ? c.ink : c.control, backgroundColor: on ? c.ink : c.surface }}
            >
              <Text style={{ fontFamily: on ? font.text700 : font.text600, fontSize: size.CONTROL, color: on ? c.surface : c.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Wiersz wydarzenia (`faded` — minione, wyszarzone): godzina w kolumnie po lewej, kwadratowy znacznik linii grupy (zadania mają kółko-stację),
 * tytuł i grupa; po godzinach długość (D120). Całość otwiera wydarzenie. `expanded` — wiersz rozwija listę pod sobą
 * (lekcje dziecka): zamiast „›” (obiecuje przejście) znak rozwinięcia ˅/˄, stan dla VoiceOvera i `hint` z czynnością
 * (audyt 2, M-141). Etykieta VoiceOvera (M-263): tylko to, co widać (bez „powtarza się”, D129), dopiski słowami,
 * „minione” przy wyszarzonym.
 */
/** `part` (D199) — który to dzień wielodniowego („dzień 2 z 5”, ui/when.ts). */
export function EventRow({ title, time, length, part, line, group, onPress, testID, faded, extra, alert, expanded, hint }: { title: string; time: string | null; length?: string | null; part?: string | null; line: number; group: string; onPress: () => void; testID?: string; faded?: boolean; extra?: string; alert?: string; expanded?: boolean; hint?: string }) {
  const { c, font, size, line: lineOf } = useTheme();
  const l = lineOf(line);
  const actions = useSwipeAction();
  const when = time ?? strings['common.allDay'];
  // Audyt 3 (N-65): „Wyjdź o 16:20 · 35 min autem” słowami.
  const label = [title, when, length ? spoken(length) : null, part, group, extra ? spoken(extra) : null, alert ? spoken(alert) : null, faded ? strings['event.pastA11y'] : null].filter(Boolean).join(', ');
  return (
    <Pressable
      testID={testID}
      {...buttonA11y({ expanded })}
      accessibilityLabel={label}
      accessibilityHint={hint}
      {...actions}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 8 }}
    >
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: faded ? c.control : l.line }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: faded ? c.inkMuted : c.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
          <Text style={{ fontFamily: font.text700, color: c.ink }}>{when}</Text>
          {length ? `${META_SEP}${length}` : ''}
          {part ? `${META_SEP}${part}` : ''}
          {META_SEP}
          <Text style={{ fontFamily: font.text700, color: l.ink }}>{group}</Text>
          {extra ? `${META_SEP}${extra}` : ''}
        </Text>
        {/* D129: „Wyjdź o …” — jedyna pilna informacja — w osobnej, wyróżnionej linii; „powtarza się” tylko w szczegółach. */}
        {alert ? <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.accentInk }}>{alert}</Text> : null}
      </View>
      <Glyph name={expanded === undefined ? 'next' : expanded ? 'less' : 'more'} color={c.inkMuted} />
    </Pressable>
  );
}

/** Przerwa w widoku dnia (D122): cienka linia z „wolne 2 h 30 min” pośrodku, wcięta jak treść wierszy. */
export function GapRow({ length, testID }: { length: string; testID?: string }) {
  const { c, font, size } = useTheme();
  return (
    <View testID={testID} accessible accessibilityLabel={strings['day.gapA11y'](spoken(length))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30, paddingLeft: 38 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.control }} />
      <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings['day.gap'](length)}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.control }} />
    </View>
  );
}

/**
 * Wybór wielu opcji (dni tygodnia, uczestnicy): każda opcja to pole wyboru z tekstem. Zaznaczenie wygląda jak w
 * Segmented (decyzja PW-52 A, D198: ciemne wypełnienie, terakota tylko dla przycisku głównego) i ma ✓, bo można wybrać
 * kilka.
 */
export function Toggles<T extends string | number>({ values, options, onChange, label }: { values: T[]; options: { value: T; label: string; a11y?: string }[]; onChange: (v: T[]) => void; label: string }) {
  const { c, font, size } = useTheme();
  return (
    <View accessibilityLabel={label} style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <Pressable
              key={String(o.value)}
              {...buttonA11y({ selected: on })}
              accessibilityLabel={o.a11y ?? o.label}
              onPress={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
              style={{ minHeight: size.TOUCH_TARGET, minWidth: size.TOUCH_TARGET, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: on ? c.ink : c.control, backgroundColor: on ? c.ink : c.surface }}
            >
              {on ? <Glyph name="check" color={c.surface} place="inline" /> : null}
              <Text style={{ fontFamily: on ? font.text700 : font.text600, fontSize: size.CONTROL, color: on ? c.surface : c.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Znacznik grupy (audyt 2, M-252): jeden kształt — pierścień w kolorze linii — w wierszach, liniach grupy i na ekranie grupy. */
export function GroupMark({ line, size: px = 18 }: { line: number; size?: number }) {
  const { c, line: lineOf } = useTheme();
  return <View style={{ width: px, height: px, borderRadius: px / 2, borderWidth: Math.round(px * 0.28), borderColor: lineOf(line).line, backgroundColor: c.surface }} />;
}

/**
 * Linia grupy nad tytułem na ekranach szczegółów (audyt 2, M-252): jeden znacznik grupy (pierścień w kolorze linii, jak
 * w wierszach nawigacji i na ekranie grupy), nazwa grupy w jej kolorze i jedna linia opisu. `header` — etykieta nagłówka
 * VoiceOvera, gdy linia zastępuje nagłówek ekranu (zadanie, M-146).
 */
export function GroupLine({ name, line, detail, header, flex }: { name: string; line: number; detail?: string; header?: string; flex?: boolean }) {
  const { c, font, size, line: lineOf } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: flex ? 1 : undefined }}>
      <GroupMark line={line} />
      {header ? (
        <HeaderLine header={header} name={name} detail={detail} ink={lineOf(line).ink} />
      ) : (
        <Text style={{ flex: 1, fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
          <Text style={{ fontFamily: font.text700, color: lineOf(line).ink }}>{name}</Text>
          {detail ? `${META_SEP}${detail}` : ''}
        </Text>
      )}
    </View>
  );
}

/** Linia grupy jako nagłówek ekranu: fokus VoiceOvera po wejściu na ekran, jak tytuł (audyt 3, N-63). */
function HeaderLine({ header, name, detail, ink }: { header: string; name: string; detail?: string; ink: string }) {
  const { c, font, size } = useTheme();
  const ref = useRef<Text>(null);
  useScreenTitleFocus(ref);
  return (
    <Text ref={ref} accessibilityRole="header" accessibilityLabel={header} style={{ flex: 1, fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
      <Text style={{ fontFamily: font.text700, color: ink }}>{name}</Text>
      {detail ? `${META_SEP}${detail}` : ''}
    </Text>
  );
}

/**
 * Ekran rzeczy, której nie ma (usunięta, stary link, powiadomienie; audyt 2, M-131): „Wróć” i powód zamiast „Coś poszło nie
 * tak. Spróbuj jeszcze raz.” — nie ma czego ponawiać.
 */
export function MissingScreen({ text, onBack, testID }: { text: string; onBack: () => void; testID: string }) {
  return (
    <Screen testID={testID}>
      <BackButton onPress={onBack} />
      <MissingText>{text}</MissingText>
    </Screen>
  );
}

/** Powód na ekranie „brak obiektu” to jego nagłówek: VoiceOver zaczyna od niego, nie od „Wróć” (audyt 3, N-63). */
function MissingText({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  const ref = useRef<Text>(null);
  useScreenTitleFocus(ref);
  return (
    <Text ref={ref} accessibilityRole="header" style={{ fontFamily: font.text400, fontSize: size.BODY, color: c.inkMuted, lineHeight: size.BODY * 1.3 }}>
      {children}
    </Text>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { c, font, size } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={strings['common.back']} onPress={onPress} style={{ minHeight: size.TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
      <Glyph name="prev" color={c.ink} />
      <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>{strings['common.back']}</Text>
    </Pressable>
  );
}

/**
 * Włącz/wyłącz w Ustawieniach (audyt 2, M-308; decyzja PWD-39 A z 8.10.2026): systemowy przełącznik iOS w wierszu zamiast
 * pigułek z trzema różnymi napisami. Apple HIG Toggles (https://developer.apple.com/design/human-interface-guidelines/toggles):
 * „Use a switch in a list row”. VoiceOver czyta nazwę wiersza, rolę „przełącznik” i stan.
 */
export function SwitchRow({ label, value, onChange, testID, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string; hint?: string }) {
  const { c, font, size, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: size.TOUCH_TARGET + 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.ROW, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ flex: 1, fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{label}</Text>
      <Switch testID={testID} accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: value }} value={value} onValueChange={onChange} />
    </View>
  );
}

export const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
