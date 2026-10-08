/**
 * Pole daty z mini kalendarzem (D103): dotknięcie rozwija miesiąc pod polem (poniedziałek pierwszy, święta na
 * czerwono), dotknięcie dnia wybiera go i zwija kalendarz. Bez klawiatury. Siatka: domain/month-grid.ts.
 */
import { useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';

import { WEEKDAYS_ABBREVIATED } from '../config/calendar.pl';
import type { CivilDate } from '../domain/civil-date';
import { formatIsoDate, isValidDate } from '../domain/civil-date';
import { formatLongDate, formatMonth, parseIsoDate } from '../domain/format';
import { monthGrid, monthOf, shiftMonth } from '../domain/month-grid';
import { strings } from '../i18n/strings.pl';
import { useTheme } from './theme';

const valid = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

/** `openSignal` — każda nowa wartość (> 0) rozwija kalendarz, np. po wyborze „Inny dzień” w DueFields. */
export function DateField({ label, value, onChange, today, testID, openSignal = 0 }: { label: string; value: string; onChange: (iso: string) => void; today: CivilDate; testID: string; openSignal?: number }) {
  const { c, font, size } = useTheme();
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState(() => monthOf(value, today));
  // Nowy sygnał rozwija kalendarz (zmiana stanu w trakcie rysowania, bez efektu).
  const [signal, setSignal] = useState(openSignal);
  if (signal !== openSignal) {
    setSignal(openSignal);
    if (openSignal > 0) setOpen(true);
  }
  const shown = valid(value) ? formatLongDate(parseIsoDate(value.trim()), today) : strings['date.pick'];
  const isoToday = formatIsoDate(today);
  const toggle = () => {
    Keyboard.dismiss();
    if (!open) setYm(monthOf(value, today));
    setOpen(!open);
  };
  const arrow = (k: number, a11y: string, glyph: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} testID={`${testID}-${k < 0 ? 'prev' : 'next'}`} onPress={() => setYm(shiftMonth(ym, k))} style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.text700, fontSize: 24, color: c.ink }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ expanded: open }}
        accessibilityValue={{ text: value.trim() }}
        testID={testID}
        onPress={toggle}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: 12, borderWidth: 1, borderColor: open ? c.ink : c.control, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: font.text400, fontSize: size.BODY, color: valid(value) ? c.ink : c.inkMuted }}>{shown}</Text>
      </Pressable>
      {open ? (
        <View testID={`${testID}-calendar`} style={{ padding: 8, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {arrow(-1, strings['calendar.prev'], '‹')}
            <Text accessibilityRole="header" style={{ flex: 1, textAlign: 'center', fontFamily: font.display700, fontSize: 17, color: c.ink }}>
              {formatMonth(ym.y, ym.m)}
            </Text>
            {arrow(1, strings['calendar.next'], '›')}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS_ABBREVIATED.map((w) => (
              <Text key={w} style={{ width: `${100 / 7}%`, textAlign: 'center', fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>
                {w}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {monthGrid(ym.y, ym.m).map((d) => {
              const selected = d.date === value.trim();
              const long = formatLongDate(parseIsoDate(d.date), today);
              return (
                <Pressable
                  key={d.date}
                  accessibilityRole="button"
                  accessibilityLabel={d.holiday ? `${long}, ${d.holiday}` : long}
                  accessibilityState={{ selected }}
                  onPress={() => (onChange(d.date), setOpen(false))}
                  style={{ width: `${100 / 7}%`, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.inverseBg : 'transparent', borderWidth: d.date === isoToday && !selected ? 1 : 0, borderColor: c.ink }}>
                    <Text style={{ fontFamily: d.holiday || selected ? font.text700 : font.text400, fontSize: 16, color: selected ? c.inverseInk : d.holiday ? c.danger : d.inMonth ? c.ink : c.inkMuted }}>{String(d.d)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
