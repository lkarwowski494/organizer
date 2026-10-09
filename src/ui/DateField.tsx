/**
 * Pole daty z mini kalendarzem (D103): dotknięcie rozwija miesiąc pod polem (poniedziałek pierwszy, święta na
 * czerwono), dotknięcie dnia wybiera go i zwija kalendarz. Bez klawiatury. Siatka: domain/month-grid.ts.
 * Audyt 2: dziś — liczba w kółku z obwódką i „Dziś, …” dla VoiceOvera (M-140, PW-50 A); święto — pogrubienie, kolor
 * i kreska pod liczbą, nie sam kolor (M-291, PWD-22 A); zaznaczenie ciemnym wypełnieniem jak w innych wyborach
 * (M-151, PW-52 A).
 */
import { useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';

import { WEEKDAYS_ABBREVIATED } from '../config/calendar.pl';
import type { CivilDate } from '../domain/civil-date';
import { formatIsoDate, isValidDate } from '../domain/civil-date';
import { formatLongDate, formatMonth, parseIsoDate } from '../domain/format';
import { monthGrid, monthOf, shiftMonth } from '../domain/month-grid';
import { strings } from '../i18n/strings.pl';
import { Card, PeriodArrow, PeriodTitle } from './components';
import { useTheme } from './theme';

const valid = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

/**
 * `openSignal` — każda nowa wartość (> 0) rozwija kalendarz, np. po wyborze „Inny dzień” w DueFields.
 * `optional` — pole można wyczyścić: „Bez dnia” w rozwiniętym kalendarzu, jak „Bez godziny” w TimeField (audyt 2,
 * M-125: jeden sposób czyszczenia dnia w każdym formularzu, także „Do dnia” w planie lekcji).
 * VoiceOver (M-144, M-141): etykieta to sam podpis, wartość — dzień słownie (bez ISO), podpowiedź mówi, co zrobi
 * dotknięcie (stan „zwinięte” RN na iOS sam nie ogłasza).
 */
export function DateField({ label, value, onChange, today, testID, openSignal = 0, optional }: { label: string; value: string; onChange: (iso: string) => void; today: CivilDate; testID: string; openSignal?: number; optional?: boolean }) {
  const { c, font, size, radius } = useTheme();
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
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        accessibilityValue={{ text: shown }}
        accessibilityHint={strings[open ? 'date.closeHint' : 'date.openHint']}
        testID={testID}
        onPress={toggle}
        style={{ minHeight: size.TOUCH_TARGET + 4, borderRadius: radius.FIELD, borderWidth: 1, borderColor: open ? c.ink : c.control, backgroundColor: c.surface, paddingHorizontal: 14, justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: font.text400, fontSize: size.BODY, color: valid(value) ? c.ink : c.inkMuted }}>{shown}</Text>
      </Pressable>
      {open ? (
        <Card kind="panel" testID={`${testID}-calendar`}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PeriodArrow dir={-1} label={strings['today.prev.month']} testID={`${testID}-prev`} onPress={() => setYm(shiftMonth(ym, -1))} />
            <PeriodTitle>{formatMonth(ym.y, ym.m)}</PeriodTitle>
            <PeriodArrow dir={1} label={strings['today.next.month']} testID={`${testID}-next`} onPress={() => setYm(shiftMonth(ym, 1))} />
          </View>
          {/* Skróty dni tygodnia tylko dla oka — każdy dzień siatki podaje pełną nazwę (audyt 2, M-263, A-46). */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row' }}>
            {WEEKDAYS_ABBREVIATED.map((w) => (
              <Text key={w} style={{ width: `${100 / 7}%`, textAlign: 'center', fontFamily: font.text600, fontSize: size.META, color: c.inkMuted }}>
                {w}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {monthGrid(ym.y, ym.m).map((d) => {
              const selected = d.date === value.trim();
              const isToday = d.date === isoToday;
              const long = formatLongDate(parseIsoDate(d.date), today);
              const label = d.holiday ? `${long}, ${d.holiday}` : long;
              return (
                <Pressable
                  key={d.date}
                  testID={`${testID}-day-${d.date}`}
                  accessibilityRole="button"
                  accessibilityLabel={isToday ? strings['calendar.todayA11y'](label) : label}
                  accessibilityState={{ selected }}
                  onPress={() => (onChange(d.date), setOpen(false))}
                  style={{ width: `${100 / 7}%`, minHeight: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}
                >
                  <DayNumber n={d.d} selected={selected} today={isToday} holiday={!!d.holiday} muted={!d.inMonth} testID={`${testID}-num-${d.date}`} />
                </Pressable>
              );
            })}
          </View>
          {optional && valid(value) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={strings['date.clear']} testID={`${testID}-clear`} onPress={() => (onChange(''), setOpen(false))} style={{ minHeight: size.TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={{ fontFamily: font.text700, fontSize: size.CONTROL, color: c.ink }}>{strings['date.clear']}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

/**
 * Liczba dnia w siatce miesiąca — ta sama w Kalendarzu i mini kalendarzu: zaznaczony dzień ciemnym wypełnieniem (D198),
 * dziś — obwódką kółka (D196), święto — pogrubieniem, kolorem i kreską pod liczbą (PWD-22 A). Kółko rośnie z Dynamic Type
 * (minWidth/minHeight, najwyżej 200% — M-43).
 */
export function DayNumber({ n, selected, today, holiday, muted, testID }: { n: number; selected: boolean; today: boolean; holiday: boolean; muted: boolean; testID?: string }) {
  const { c, font, size, fontScale } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <View testID={testID} style={{ minWidth: 36, minHeight: 36, paddingHorizontal: 2, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.ink : 'transparent', borderWidth: today && !selected ? 2 : 0, borderColor: c.ink }}>
        <Text maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontFamily: holiday || selected || today ? font.text700 : font.text400, fontSize: size.TILE, color: selected ? c.surface : holiday ? c.danger : muted ? c.inkMuted : c.ink }}>{String(n)}</Text>
      </View>
      {holiday ? <View testID={testID ? `${testID}-holiday` : undefined} style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: c.danger }} /> : null}
    </View>
  );
}
