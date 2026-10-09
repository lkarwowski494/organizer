/**
 * Pole godziny bez pisania (decyzja właściciela 8.10.2026, D125): dotknięcie rozwija kafelki godzin (0–23) i minut
 * (co config.time.MINUTE_STEP), jak mini kalendarz w DateField (D103). Wcześniej było pole tekstowe z podpowiedzią
 * „07:00”, którą łatwo wziąć za wpisaną godzinę. Inną minutę można wpisać ręcznie w panelu; pole opcjonalne ma
 * „Bez godziny”. Wartość jak dotąd: tekst „GG:MM” (sprawdza go formularz).
 * Audyt 2: ręcznie wpisana godzina trafia do formularza dopiero w pełnym kształcie „G:MM”/„GG:MM” albo po wyjściu z pola
 * — w trakcie pisania („1”, „19:”) nie ma komunikatu o błędzie (M-206). `disabledNote` — pole nieaktywne z wyjaśnieniem,
 * np. „Najpierw wybierz dzień.” w zadaniu bez dnia (M-89: godzina bez dnia znikała bez słowa).
 * M-45 (decyzja PW-11 A z 8.10.2026, D195): „Początek” i „Koniec” obok siebie (TimeFieldPair) mają jeden panel kafelków
 * na pełnej szerokości pod parą pól — kafelek ma co najmniej 44 pt (Apple HIG; WCAG 2.5.8 wymaga 24 pt), a zaznaczenie
 * wypełnia tylko swój kafelek, więc nie zasłania sąsiednich liczb. Zaznaczenie jak w innych wyborach (PW-52 A, D198).
 */
import { type ReactNode, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';
import { buttonA11y, useA11yFocus, useClosedPanel } from './a11y';
import { Card, Field, FieldCaption } from './components';
import { useTheme } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = Array.from({ length: 60 / config.time.MINUTE_STEP }, (_, i) => pad(i * config.time.MINUTE_STEP));
const parts = (v: string) => /^(\d{1,2}):(\d{2})$/.exec(v.trim());

/** `a11yLabel` — etykieta VoiceOver z kontekstem, gdy kilka pól na ekranie ma ten sam napis (audyt 2, M-145). */
export type TimeFieldProps = { label: string; value: string; onChange: (v: string) => void; testID: string; optional?: boolean; a11yLabel?: string; disabledNote?: string };

/**
 * Pole (przycisk z godziną) i jego panel kafelków — osobno, żeby para pól miała jeden panel pod spodem.
 * Audyt 3 (N-62): po zwinięciu panelu (minuta, „Bez godziny”, drugie dotknięcie pola) fokus VoiceOvera wraca na pole;
 * `elsewhere` — panel zwinął się, bo otwarto drugie pole pary (ono ma już fokus).
 */
function useTimeField({ label, value, onChange, testID, optional, a11yLabel, disabledNote }: TimeFieldProps, open: boolean, setOpen: (o: boolean) => void, elsewhere = false): { field: ReactNode; panel: ReactNode } {
  const { c, font, size, radius, fontScale } = useTheme();
  const closed = useClosedPanel(open) !== null;
  const ref = useA11yFocus<View>(open, closed && !open && !elsewhere);
  // Ręczne wpisywanie: tekst w polu, dopóki nie ma pełnej godziny albo nie wyjdę z pola (M-206).
  const [typed, setTyped] = useState<string | null>(null);
  const type = (v: string) => {
    setTyped(v);
    if (parts(v) || v.trim() === '') onChange(v);
  };
  const leave = () => {
    if (typed !== null && typed !== value) onChange(typed);
    setTyped(null);
  };
  const disabled = disabledNote !== undefined;
  const m = parts(value);
  const hour = m ? pad(Number(m[1])) : null;
  const minute = m ? m[2]! : null;
  const shown = value.trim() === '' ? strings['time.pick'] : value.trim();
  const chip = (id: string, text: string, selected: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ width: `${100 / 6}%`, minHeight: size.TOUCH_TARGET, padding: 2 }}
    >
      <View testID={`${id}-tile`} style={{ flex: 1, minHeight: size.TOUCH_TARGET - 4, borderRadius: radius.FIELD, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.ink : 'transparent' }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={size.MIN_TEXT / size.TILE} maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontFamily: selected ? font.text700 : font.text400, fontSize: size.TILE, color: selected ? c.surface : c.ink }}>{text}</Text>
      </View>
    </Pressable>
  );
  const caption = (text: string) => <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted, paddingHorizontal: 6 }}>{text}</Text>;

  const field = (
    <View style={{ gap: 6 }}>
      <FieldCaption>{label}</FieldCaption>
      <Pressable
        ref={ref}
        // Audyt 2 (M-144, M-141): etykieta to sam podpis, wartość raz; podpowiedź — co zrobi dotknięcie.
        {...buttonA11y({ expanded: open && !disabled, disabled }, shown)}
        accessibilityLabel={a11yLabel ?? label}
        // Audyt 3 (N-199): przy nieaktywnym polu powód czyta widoczna notka pod polem — bez podpowiedzi, żeby nie dwa razy.
        accessibilityHint={disabled ? undefined : strings[open ? 'time.closeHint' : 'time.openHint']}
        testID={testID}
        disabled={disabled}
        onPress={() => (Keyboard.dismiss(), setOpen(!open))}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: radius.FIELD, borderWidth: 1, borderColor: open && !disabled ? c.ink : c.control, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ fontFamily: font.text400, fontSize: size.BODY, color: value.trim() ? c.ink : c.inkMuted }}>{shown}</Text>
      </Pressable>
      {disabled ? <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{disabledNote}</Text> : null}
    </View>
  );
  const panel =
    open && !disabled ? (
      <Card kind="panel" testID={`${testID}-panel`}>
        {caption(strings['time.hour'])}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {HOURS.map((h) => chip(`${testID}-h-${h}`, h, h === hour, () => (setTyped(null), onChange(`${h}:${minute ?? '00'}`)), strings['time.hourA11y'](h)))}
        </View>
        {caption(strings['time.minute'])}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {MINUTES.map((mm) => chip(`${testID}-m-${mm}`, `:${mm}`, mm === minute, () => (setTyped(null), onChange(`${hour ?? '12'}:${mm}`), setOpen(false)), strings['time.minuteA11y'](mm)))}
        </View>
        <Field label={strings['time.manual']} value={typed ?? value} onChangeText={type} onBlur={leave} onSubmitEditing={leave} placeholder={strings['time.manualHint']} keyboardType="numbers-and-punctuation" testID={`${testID}-manual`} />
        {optional && value.trim() ? (
          <Pressable accessibilityRole="button" accessibilityLabel={strings['time.clear']} testID={`${testID}-clear`} onPress={() => (setTyped(null), onChange(''), setOpen(false))} style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ fontFamily: font.text700, fontSize: size.CONTROL, color: c.ink }}>{strings['time.clear']}</Text>
          </Pressable>
        ) : null}
      </Card>
    ) : null;
  return { field, panel };
}

export function TimeField(props: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const { field, panel } = useTimeField(props, open, setOpen);
  return (
    <View style={{ gap: 6 }}>
      {field}
      {panel}
    </View>
  );
}

/** „Początek” i „Koniec” obok siebie z jednym panelem kafelków na pełnej szerokości pod parą (M-45, D195). */
export function TimeFieldPair({ start, end }: { start: TimeFieldProps; end: TimeFieldProps }) {
  const [open, setOpen] = useState<'start' | 'end' | null>(null);
  const a = useTimeField(start, open === 'start', (o) => setOpen(o ? 'start' : null), open === 'end');
  const b = useTimeField(end, open === 'end', (o) => setOpen(o ? 'end' : null), open === 'start');
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>{a.field}</View>
        <View style={{ flex: 1 }}>{b.field}</View>
      </View>
      {a.panel}
      {b.panel}
    </View>
  );
}
