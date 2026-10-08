/**
 * Termin w jednym kształcie wszędzie (audyt 2, M-245): przełącznik „Kiedy” — Dziś · Jutro · Inny dzień · Bez terminu
 * (w tej kolejności w zadaniu, formularzu i zakupach), pole „Inny dzień” z mini kalendarzem (D103) i godzina (D125).
 * Wybrany dzień spoza dziś i jutro zaznacza „Inny dzień” i pokazuje go słownie (U-24: nie „2026-10-09”). Godzina bez dnia
 * jest nieaktywna z napisem „Najpierw wybierz dzień.” (M-89). `extra` — dodatkowa opcja na początku, np. „Jak zadanie
 * nadrzędne” w podzadaniu (M-204).
 */
import { useState } from 'react';
import { View } from 'react-native';

import { addDays, type CivilDate, formatIsoDate } from '../domain/civil-date';
import { formatDue } from '../domain/format';
import { strings } from '../i18n/strings.pl';
import { Segmented } from './components';
import { DateField } from './DateField';
import { TimeField } from './TimeField';

export type DueExtra = { label: string; selected: boolean; onPress: () => void };

export function DueFields({ date, time, onDate, onTime, today, testID, timeLabel, extra }: { date: string; time: string; onDate: (iso: string) => void; onTime: (t: string) => void; today: CivilDate; testID: string; timeLabel?: string; extra?: DueExtra }) {
  // „Inny dzień” bez wybranego dnia: zaznaczony do chwili wyboru (kalendarz rozwija się sam).
  const [other, setOther] = useState(0);
  const day = (k: number) => formatIsoDate(addDays(today, k));
  const choice = extra?.selected ? 'extra' : date === '' ? (other ? 'other' : 'none') : date === day(0) ? 'today' : date === day(1) ? 'tomorrow' : 'other';
  const otherLabel = choice === 'other' && date !== '' ? formatDue({ date, time: null }, today) : strings['due.other'];
  return (
    <View style={{ gap: 10 }}>
      <Segmented
        label={strings['due.when']}
        value={choice}
        onChange={(v) => {
          if (v === 'extra') return extra?.onPress();
          if (v === 'other') return setOther((n) => n + 1);
          setOther(0);
          onDate(v === 'none' ? '' : day(v === 'today' ? 0 : 1));
        }}
        options={[
          ...(extra ? [{ value: 'extra', label: extra.label }] : []),
          { value: 'today', label: strings['form.today'] },
          { value: 'tomorrow', label: strings['form.tomorrow'] },
          { value: 'other', label: otherLabel },
          { value: 'none', label: strings['form.noDate'] },
        ]}
      />
      <DateField label={strings['due.other']} value={date} onChange={(d) => (setOther(0), onDate(d))} today={today} testID={`${testID}-date`} openSignal={other} />
      <TimeField label={timeLabel ?? strings['task.dueTime']} value={time} onChange={onTime} testID={`${testID}-time`} optional disabledNote={date === '' ? strings['due.timeNeedsDay'] : undefined} />
    </View>
  );
}
