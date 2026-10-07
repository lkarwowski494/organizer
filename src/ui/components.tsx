/**
 * Klocki motywu „Wstążki” (D72, następca „Linii” z D50; makieta C: https://claude.ai/artifact/KS4HyYxYRQf3HfiS9Jvucx).
 * Każdy element dotykowy ma co najmniej sizes.TOUCH_TARGET (44 pt, Apple HIG), etykietę dostępności
 * i rolę; kolor grupy zawsze idzie w parze z jej nazwą.
 */
import { type ReactNode, useRef, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Indicator } from '../domain/sync-engine/scheduler';
import { strings } from '../i18n/strings.pl';
import { useTheme } from './theme';

export function Screen({ children, scroll = true, testID }: { children: ReactNode; scroll?: boolean; testID?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const style = { flex: 1, backgroundColor: c.ground };
  const content = { paddingTop: insets.top + 12, paddingBottom: 24, paddingHorizontal: 20, gap: 14 };
  return scroll ? (
    <ScrollView testID={testID} style={style} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View testID={testID} style={[style, content]}>
      {children}
    </View>
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

/** Tekst wskaźnika synchronizacji (architektura: 5 stanów + wygasła sesja). */
export function indicatorLabel(i: Indicator, nowMs: number): string {
  switch (i.state) {
    case 'offline':
      return strings['sync.offline'](i.pending);
    case 'auth_expired':
      return strings['sync.authExpired'];
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

export function SyncChip({ indicator, nowMs }: { indicator: Indicator; nowMs: number }) {
  const { c, font } = useTheme();
  const warn = indicator.state === 'offline' || indicator.state === 'error' || indicator.state === 'auth_expired';
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
  onToggle: () => void;
  onOpen?: () => void;
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
  return (
    <View testID={props.testID} style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 60, marginLeft: (props.depth ?? 0) * 18 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {/* Wstążka grupy (D72): szeroka, zaokrąglona, z kropką w jaśniejszej obwódce. */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, width: 10, borderRadius: 5, backgroundColor: l.line, opacity: done ? 0.12 : 0.28 }} />
        <View style={{ position: 'absolute', top: 11, width: 30, height: 30, borderRadius: 15, backgroundColor: done ? c.control : l.line, opacity: 0.22 }} />
        <View style={{ marginTop: 16, width: 20, height: 20, borderRadius: 10, backgroundColor: done ? c.control : l.line }} />
      </View>
      <Pressable
        accessibilityRole={props.onOpen ? 'button' : undefined}
        accessibilityLabel={props.onOpen ? strings['task.open'](props.title) : undefined}
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
      <View style={{ justifyContent: 'center' }}>
        <Checkbox checked={done} onPress={props.onToggle} label={toggleLabel} round={!props.shopping} />
      </View>
    </View>
  );
}

/** Szerokość odsłanianego przycisku „Usuń” (pt). */
const SWIPE_ACTION = 96;

/**
 * Wiersz z usuwaniem przesunięciem w lewo (D60, standard iOS): przesunięcie odsłania „Usuń”, usuwa dopiero dotknięcie
 * przycisku. Zwykłe dotknięcie wiersza niczego nie usuwa. VoiceOver dociera do przycisku jak do każdego innego.
 */
export function SwipeRow({ children, title, onDelete, enabled = true, testID }: { children: ReactNode; title: string; onDelete: () => void; enabled?: boolean; testID?: string }) {
  const { c, font, size } = useTheme();
  const ref = useRef<ScrollView>(null);
  // Szerokość wiersza = szerokość ekranu bez marginesów Screen (20 pt z każdej strony), potem z pomiaru.
  const [width, setWidth] = useState(Dimensions.get('window').width - 40);
  if (!enabled) return <>{children}</>;
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
    >
      <View style={{ width }}>{children}</View>
      <View style={{ width: SWIPE_ACTION, paddingLeft: 8, justifyContent: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['swipe.deleteA11y'](title)}
          onPress={() => {
            ref.current?.scrollTo({ x: 0, animated: false });
            onDelete();
          }}
          style={{ minHeight: size.TOUCH_TARGET + 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.danger }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>{strings['swipe.delete']}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, testID, a11yHint }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; testID?: string; a11yHint?: string }) {
  const { c, font, size } = useTheme();
  const bg = kind === 'primary' ? c.inverseBg : c.surface;
  const fg = kind === 'primary' ? c.inverseInk : kind === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
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

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const { c, font, size } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.inkMuted}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: 12, borderWidth: 1, borderColor: c.control, backgroundColor: c.surface, paddingHorizontal: 14, color: c.ink, fontFamily: font.text400, fontSize: size.BODY }}
        {...input}
      />
    </View>
  );
}

/** Pole szybkiego dodawania (D18): biała pigułka z okrągłym przyciskiem „Dodaj” w kolorze akcentu (D72). */
export function QuickAddField({ value, onChangeText, onSubmit, placeholder, children }: { value: string; onChangeText: (s: string) => void; onSubmit: () => void; placeholder: string; children?: ReactNode }) {
  const { c, font, size } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingLeft: 18, paddingRight: 5, borderRadius: 27, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
        <TextInput
          testID="quick-add"
          accessibilityLabel={strings['quick.label']}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={c.inkMuted}
          style={{ flex: 1, color: c.ink, fontFamily: font.text400, fontSize: size.BODY, minHeight: size.TOUCH_TARGET }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['quick.add']}
          onPress={onSubmit}
          style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, borderRadius: size.TOUCH_TARGET / 2, backgroundColor: c.inverseBg, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: c.inverseInk, fontSize: 24, lineHeight: 26, fontFamily: font.text700 }}>+</Text>
        </Pressable>
      </View>
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

/** Wiersz nawigacyjny (lista, grupa, ustawienie) z kropką linii. */
export function NavRow({ title, subtitle, line, onPress, testID }: { title: string; subtitle?: string; line?: number; onPress: () => void; testID?: string }) {
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
      <Text style={{ fontSize: 22, color: c.inkMuted }}>›</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { c, font, size } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 6 }}>
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
 * tytuł i grupa. Całość otwiera wydarzenie.
 */
export function EventRow({ title, time, line, group, recurring, onPress, testID, faded }: { title: string; time: string | null; line: number; group: string; recurring: boolean; onPress: () => void; testID?: string; faded?: boolean }) {
  const { c, font, size, line: lineOf } = useTheme();
  const l = lineOf(line);
  const when = time ?? strings['event.allDayLabel'];
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={strings['event.rowA11y'](title, when, group, recurring)} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 8 }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: faded ? c.control : l.line }} />
      </View>
      <View style={{ flex: 1, paddingVertical: 10, gap: 3 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, lineHeight: size.BODY * 1.25, color: faded ? c.inkMuted : c.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>
          <Text style={{ fontFamily: font.text700, color: c.ink }}>{when}</Text>
          {'  ·  '}
          <Text style={{ fontFamily: font.text700, color: l.ink }}>{group}</Text>
          {recurring ? `  ·  ${strings['event.repeats']}` : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 22, color: c.inkMuted }}>›</Text>
    </Pressable>
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
