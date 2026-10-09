/**
 * Klocki motywu „Wstążki” (D72, następca „Linii” z D50; makieta C: https://claude.ai/artifact/KS4HyYxYRQf3HfiS9Jvucx).
 * Każdy element dotykowy ma co najmniej sizes.TOUCH_TARGET (44 pt, Apple HIG), etykietę dostępności
 * i rolę; kolor grupy zawsze idzie w parze z jej nazwą.
 */
import { createContext, type ReactNode, type Ref, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import type { Indicator } from '../domain/sync-engine/scheduler';
import { strings } from '../i18n/strings.pl';
import { useTheme } from './theme';

/**
 * Wiersze z przesuwaniem na jednym ekranie (audyt 2, M-249; standard iOS): otwarty jest najwyżej jeden — otwarcie
 * następnego zamyka poprzedni, a przewinięcie ekranu zamyka otwarty.
 */
type SwipeGroup = { opened: (close: () => void) => void; closed: (close: () => void) => void; closeAll: () => void };
const SwipeContext = createContext<SwipeGroup | null>(null);

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

export function Screen({ children, scroll = true, testID }: { children: ReactNode; scroll?: boolean; testID?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const swipe = useSwipeGroup();
  const style = { flex: 1, backgroundColor: c.ground };
  const content = { paddingTop: insets.top + 12, paddingBottom: 24, paddingHorizontal: 20, gap: 14 };
  return (
    <SwipeContext.Provider value={swipe}>
      {scroll ? (
        // D102: klawiatura chowa się przy przewijaniu i po dotknięciu pustego miejsca (keyboardShouldPersistTaps „handled”).
        // D109: pas w kolorze tła pod zegarem i baterią — przewijana treść chowa się pod nim.
        <View style={style}>
          <ScrollView testID={testID} style={style} contentContainerStyle={content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={swipe.closeAll}>
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

export function Title({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontFamily: font.display800, fontSize: size.TITLE, lineHeight: size.TITLE * 1.05, letterSpacing: -1, color: c.ink }}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const { c, font, size } = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontFamily: font.display700, fontSize: size.SECTION, letterSpacing: 1.2, textTransform: 'uppercase', color: c.inkMuted, marginBottom: 4 }}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { c, font, size } = useTheme();
  return <Text style={[{ fontFamily: font.text400, fontSize: size.BODY, color: muted ? c.inkMuted : c.ink, lineHeight: size.BODY * 1.3 }, style]}>{children}</Text>;
}

/** Komunikat o błędzie pod polem albo przyciskiem: czerwony, ogłaszany przez VoiceOver (rola alert). */
export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  const { c, font } = useTheme();
  return (
    <Text accessibilityRole="alert" testID={testID} style={{ fontFamily: font.text700, color: c.danger }}>
      {children}
    </Text>
  );
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
  const { c, font } = useTheme();
  const warn = indicator.state === 'offline' || indicator.state === 'error' || indicator.state === 'auth_expired' || indicator.state === 'upgrade_required';
  const label = indicatorLabel(indicator, nowMs);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={strings['sync.a11y'](label)}
      accessibilityLiveRegion="polite"
      testID="sync-chip"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: warn ? c.warnBorder : c.border, backgroundColor: warn ? c.warnBg : c.surface }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: warn ? c.warnBorder : indicator.state === 'synced' ? c.ok : c.inkMuted }} />
      <Text style={{ fontFamily: font.text600, fontSize: 13, color: warn ? c.warnInk : c.ink }}>{label}</Text>
    </View>
  );
}

export function LineChip({ name, line }: { name: string; line: number }) {
  const { c, font, line: lineOf } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 6, paddingRight: 10, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: lineOf(line).line }} />
      <Text style={{ fontFamily: font.text600, fontSize: 13, color: c.ink }}>{name}</Text>
    </View>
  );
}

export function Checkbox({ checked, onPress, label, round = true }: { checked: boolean; onPress: () => void; label: string; round?: boolean }) {
  const { c, size } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, borderRadius: round ? size.TOUCH_TARGET / 2 : 12, borderWidth: 2, borderColor: checked ? c.ok : c.control, backgroundColor: checked ? c.ok : c.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      {checked ? <Text style={{ color: c.surface, fontSize: 20, fontWeight: '700' }}>✓</Text> : null}
    </Pressable>
  );
}

/**
 * Wiersz-stacja: odcinek linii grupy z kropką, tytuł, opis (grupa · termin · osoba) i pole do odhaczenia.
 * `depth` wcina podzadania; `faded` dla zrobionych.
 */
export function StationRow(props: {
  title: string;
  line: number;
  group?: string;
  meta?: string[];
  depth?: number;
  checked: boolean;
  /** Brak — wiersz bez pola odhaczenia (np. zakupy u dziecka z kontem: serwer ich nie przyjmie, PW-14 B). */
  onToggle?: () => void;
  onOpen?: () => void;
  /** Etykieta VoiceOver dla dotknięcia wiersza (domyślnie „Otwórz: …”). */
  openLabel?: string;
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
  return (
    <View testID={props.testID} style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: sub ? 52 : 60, marginLeft: Math.min(props.depth ?? 0, 3) * 22 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {/* Wstążka grupy (D72): szeroka, zaokrąglona, z kropką w jaśniejszej obwódce. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, width: sub ? 4 : 10, borderRadius: 5, backgroundColor: l.line, opacity: done ? 0.12 : 0.28 }} />
        {sub ? null : <View style={{ position: 'absolute', top: 11, width: 30, height: 30, borderRadius: 15, backgroundColor: done ? c.control : l.line, opacity: 0.22 }} />}
        <View style={{ marginTop: sub ? 18 : 16, width: sub ? 12 : 20, height: sub ? 12 : 20, borderRadius: 10, backgroundColor: done ? c.control : l.line }} />
      </View>
      <Pressable
        accessibilityRole={props.onOpen ? 'button' : undefined}
        // VoiceOver czyta cały wiersz: tytuł, ostrzeżenie (np. zaległe), grupę i opis (audyt 8.10.2026).
        accessibilityLabel={props.onOpen ? [props.openLabel ?? strings['task.open'](props.title), props.alert, props.group, ...(props.meta ?? [])].filter(Boolean).join(', ') : undefined}
        disabled={!props.onOpen}
        onPress={props.onOpen}
        style={{ flex: 1, minHeight: size.TOUCH_TARGET, paddingVertical: 10, paddingLeft: 6, gap: 3, justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: done ? c.inkMuted : c.ink, textDecorationLine: done ? 'line-through' : 'none' }}>{props.title}</Text>
        {props.alert ? <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.danger }}>{props.alert}</Text> : null}
        {props.group || props.meta?.length || props.pending ? (
          <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
            {props.group ? <Text style={{ fontFamily: font.text700, color: l.ink }}>{props.group}</Text> : null}
            {props.meta?.length ? `${props.group ? '  ' : ''}${props.meta.join('  ·  ')}` : ''}
            {props.pending ? <Text style={{ fontFamily: font.text700, color: c.pendingInk }}>{`  ·  ${strings['lists.pendingItem']}`}</Text> : null}
          </Text>
        ) : null}
      </Pressable>
      {props.onToggle ? (
        <View style={{ justifyContent: 'center' }}>
          <Checkbox checked={done} onPress={props.onToggle} label={toggleLabel} round={!props.shopping} />
        </View>
      ) : null}
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
  const { c, font, size } = useTheme();
  const ref = useRef<ScrollView>(null);
  const group = useContext(SwipeContext);
  // Szerokość wiersza = szerokość ekranu bez marginesów Screen (20 pt z każdej strony), potem z pomiaru.
  const [width, setWidth] = useState(Dimensions.get('window').width - 40);
  const close = useCallback(() => ref.current?.scrollTo({ x: 0, animated: true }), []);
  useEffect(() => () => group?.closed(close), [group, close]);
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
      <View style={{ width }}>{children}</View>
      <View style={{ width: SWIPE_ACTION, paddingLeft: 8, justifyContent: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings[action === 'delete' ? 'swipe.deleteA11y' : 'swipe.cancelA11y'](title)}
          onPress={() => {
            ref.current?.scrollTo({ x: 0, animated: false });
            group?.closed(close);
            onDelete();
          }}
          style={{ minHeight: size.TOUCH_TARGET + 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.danger }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>{strings[action === 'delete' ? 'common.delete' : 'event.cancel']}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** `danger` (czerwony) — przycisk, który usuwa albo unieważnia, w obu krokach: otwarcie i potwierdzenie (audyt 2, M-241). */
export function Button({ label, onPress, kind = 'primary', disabled, testID, a11yHint, a11yLabel }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; testID?: string; a11yHint?: string; a11yLabel?: string }) {
  const { c, font, size } = useTheme();
  const bg = kind === 'primary' ? c.inverseBg : c.surface;
  const fg = kind === 'primary' ? c.inverseInk : kind === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={a11yHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: 24, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'primary' ? 0 : 1, borderColor: kind === 'danger' ? c.danger : c.border, opacity: disabled ? 0.5 : 1 }}
    >
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

/** `ref` — pole tekstowe (React 19: ref jak zwykły props), np. żeby przejść do pola z karty „Następne kroki”. */
export function Field({ label, ref, ...input }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  const { c, font, size } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={c.inkMuted}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: 12, borderWidth: 1, borderColor: c.control, backgroundColor: c.surface, paddingHorizontal: 14, color: c.ink, fontFamily: font.text400, fontSize: size.BODY }}
        {...input}
      />
      <LengthNote value={input.value} max={input.maxLength} />
    </View>
  );
}

/**
 * Pole szybkiego dodawania (D18): biała pigułka z okrągłym przyciskiem „Dodaj” w kolorze akcentu (D72). Tytuł zadania
 * i pozycji zakupów ma limit z SQL (config.lengths.TASK_TITLE; audyt 2, M-228).
 */
export function QuickAddField({ value, onChangeText, onSubmit, placeholder, children }: { value: string; onChangeText: (s: string) => void; onSubmit: () => void; placeholder: string; children?: ReactNode }) {
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
          <Text style={{ color: c.inverseInk, fontSize: 24, lineHeight: 26, fontFamily: font.text700 }}>+</Text>
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
      onPress={onPress}
      style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.control }}
    >
      <Text style={{ fontFamily: font.text600, fontSize: 15, color: c.ink }}>{`${text}  ✕`}</Text>
    </Pressable>
  );
}

/**
 * Wiersz nawigacyjny (lista, grupa, ustawienie) z kropką linii. `chevron={false}` — wiersz wyboru, który nie przechodzi
 * na inny ekran (strzałka „›” obiecuje przejście, audyt 2: G-14, U-14).
 */
export function NavRow({ title, subtitle, line, onPress, testID, chevron = true }: { title: string; subtitle?: string; line?: number; onPress: () => void; testID?: string; chevron?: boolean }) {
  const { c, font, size, line: lineOf } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}
    >
      {line === undefined ? null : <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 5, borderColor: lineOf(line).line, backgroundColor: c.surface }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{title}</Text>
        {subtitle ? <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{subtitle}</Text> : null}
      </View>
      {chevron ? <Text style={{ fontSize: 22, color: c.inkMuted }}>›</Text> : null}
    </Pressable>
  );
}

/**
 * `a11yLabel` — etykieta VoiceOver grupy z kontekstem, gdy kilka grup na ekranie ma ten sam napis (audyt 2, M-145);
 * `hint` opcji — podpowiedź VoiceOvera, gdy wybór robi coś więcej niż zaznaczenie (np. otwiera inny formularz).
 */
export function Segmented<T extends string>({ value, options, onChange, label, a11yLabel }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string; a11yLabel?: string }) {
  const { c, font, size } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={a11yLabel ?? label} style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              accessibilityHint={o.hint}
              onPress={() => onChange(o.value)}
              style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: on ? c.ink : c.control, backgroundColor: on ? c.ink : c.surface }}
            >
              <Text style={{ fontFamily: on ? font.text700 : font.text600, fontSize: 15, color: on ? c.surface : c.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Wiersz wydarzenia (`faded` — minione, wyszarzone): godzina w kolumnie po lewej, kwadratowy znacznik linii grupy (zadania mają kółko-stację),
 * tytuł i grupa; po godzinach długość (D120). Całość otwiera wydarzenie.
 */
/** `part` (D199) — który to dzień wielodniowego („dzień 2 z 5”, ui/when.ts). */
export function EventRow({ title, time, length, part, line, group, recurring, onPress, testID, faded, extra, alert }: { title: string; time: string | null; length?: string | null; part?: string | null; line: number; group: string; recurring: boolean; onPress: () => void; testID?: string; faded?: boolean; extra?: string; alert?: string }) {
  const { c, font, size, line: lineOf } = useTheme();
  const l = lineOf(line);
  const when = time ?? strings['common.allDay'];
  const whenA11y = [when, length, part].filter(Boolean).join(', ');
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${strings['event.rowA11y'](title, whenA11y, group, recurring)}${extra ? `, ${extra.split('  ·  ').join(', ')}` : ''}${alert ? `, ${alert}` : ''}`} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 8 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: faded ? c.control : l.line }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: faded ? c.inkMuted : c.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
          <Text style={{ fontFamily: font.text700, color: c.ink }}>{when}</Text>
          {length ? `  ·  ${length}` : ''}
          {part ? `  ·  ${part}` : ''}
          {'  ·  '}
          <Text style={{ fontFamily: font.text700, color: l.ink }}>{group}</Text>
          {extra ? `  ·  ${extra}` : ''}
        </Text>
        {/* D129: „Wyjdź o …” — jedyna pilna informacja — w osobnej, wyróżnionej linii; „powtarza się” tylko w szczegółach. */}
        {alert ? <Text style={{ fontFamily: font.text700, fontSize: size.META, color: c.accentInk }}>{alert}</Text> : null}
      </View>
      <Text style={{ fontSize: 22, color: c.inkMuted }}>›</Text>
    </Pressable>
  );
}

/** Przerwa w widoku dnia (D122): cienka linia z „wolne 2 h 30 min” pośrodku, wcięta jak treść wierszy. */
export function GapRow({ length, testID }: { length: string; testID?: string }) {
  const { c, font, size } = useTheme();
  return (
    <View testID={testID} accessible accessibilityLabel={strings['day.gapA11y'](length)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30, paddingLeft: 38 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.control }} />
      <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings['day.gap'](length)}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.control }} />
    </View>
  );
}

/** Wybór wielu opcji (dni tygodnia, uczestnicy): każda opcja to pole wyboru z tekstem. */
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
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.a11y ?? o.label}
              onPress={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
              style={{ minHeight: size.TOUCH_TARGET, minWidth: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, borderWidth: on ? 2 : 1, borderColor: on ? c.ink : c.control, backgroundColor: on ? c.inverseBg : c.ground }}
            >
              <Text style={{ fontFamily: on ? font.text700 : font.text400, fontSize: 15, color: on ? c.inverseInk : c.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  const { c, font, size } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={strings['common.back']} onPress={onPress} style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.ink }}>‹ {strings['common.back']}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' } });
