/**
 * Pole godziny bez pisania (decyzja właściciela 8.10.2026, D125): dotknięcie rozwija kafelki godzin (0–23) i minut
 * (co config.time.MINUTE_STEP), jak mini kalendarz w DateField (D103). Wcześniej było pole tekstowe z podpowiedzią
 * „07:00”, którą łatwo wziąć za wpisaną godzinę. Inną minutę można wpisać ręcznie w panelu; pole opcjonalne ma
 * „Bez godziny”. Wartość jak dotąd: tekst „GG:MM” (sprawdza go formularz).
 * Audyt 2: ręcznie wpisana godzina trafia do formularza dopiero w pełnym kształcie „G:MM”/„GG:MM” albo po wyjściu z pola
 * — w trakcie pisania („1”, „19:”) nie ma komunikatu o błędzie (M-206). `disabledNote` — pole nieaktywne z wyjaśnieniem,
 * np. „Najpierw wybierz dzień.” w zadaniu bez dnia (M-89: godzina bez dnia znikała bez słowa).
 */
import { useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';
import { Field } from './components';
import { useTheme } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTES = Array.from({ length: 60 / config.time.MINUTE_STEP }, (_, i) => pad(i * config.time.MINUTE_STEP));
const parts = (v: string) => /^(\d{1,2}):(\d{2})$/.exec(v.trim());

export function TimeField({ label, value, onChange, testID, optional, disabledNote }: { label: string; value: string; onChange: (v: string) => void; testID: string; optional?: boolean; disabledNote?: string }) {
  const { c, font, size } = useTheme();
  const [open, setOpen] = useState(false);
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
      style={{ width: `${100 / 6}%`, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ minWidth: 44, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.inverseBg : 'transparent' }}>
        <Text style={{ fontFamily: selected ? font.text700 : font.text400, fontSize: 16, color: selected ? c.inverseInk : c.ink }}>{text}</Text>
      </View>
    </Pressable>
  );
  const caption = (text: string) => <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted, paddingHorizontal: 6 }}>{text}</Text>;

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ expanded: open && !disabled, disabled }}
        accessibilityValue={{ text: value.trim() }}
        accessibilityHint={disabledNote}
        testID={testID}
        disabled={disabled}
        onPress={() => (Keyboard.dismiss(), setOpen(!open))}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: 12, borderWidth: 1, borderColor: open && !disabled ? c.ink : c.control, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ fontFamily: font.text400, fontSize: size.BODY, color: value.trim() ? c.ink : c.inkMuted }}>{shown}</Text>
      </Pressable>
      {disabled ? <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{disabledNote}</Text> : null}
      {open && !disabled ? (
        <View testID={`${testID}-panel`} style={{ padding: 8, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
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
              <Text style={{ fontFamily: font.text700, fontSize: 15, color: c.ink }}>{strings['time.clear']}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
