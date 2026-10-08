/**
 * Powtarzanie zadania (D76): nie / codziennie / co tydzień w wybrane dni / co miesiąc / co N dni albo tygodni od wykonania.
 * Co miesiąc (PWD-37, jak w wydarzeniu): „N. dnia” albo — gdy termin to ostatni dzień miesiąca — „ostatniego dnia
 * miesiąca” (BYMONTHDAY=-1). Przy dniu ≥ 29 napis, że miesiące bez tego dnia są pomijane (RFC 5545 §3.3.10, M-87).
 */
import { View } from 'react-native';

import { type CivilDate, daysInMonth, isoWeekday } from '../../domain/civil-date';

import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import type { Repeat } from '../../domain/views/task-repeat';
import { strings } from '../../i18n/strings.pl';
import { Body, Segmented, Toggles } from '../../ui/components';

type Kind = 'none' | Repeat['kind'];
const INTERVALS = [1, 2, 3, 4, 5, 6, 7, 10, 14] as const;

/** `date` — termin zadania (dzień tygodnia dla „co tydzień”, dzień miesiąca dla „co miesiąc”). */
export function RepeatEditor({ value, onChange, date }: { value: Repeat | null; onChange: (r: Repeat | null) => void; date: CivilDate }) {
  const kind: Kind = value?.kind ?? 'none';
  const weekday = isoWeekday(date);
  const lastDay = date.d === daysInMonth(date.y, date.m);
  // Dzień cyklu: zapisany (D137) albo z terminu.
  const monthDay = value?.kind === 'monthly' && value.day !== undefined && value.day > 0 ? value.day : date.d;
  const pick = (k: Kind) =>
    onChange(
      k === 'none' ? null : k === 'weekly' ? { kind: 'weekly', days: [weekday] } : k === 'after' ? { kind: 'after', unit: 'DAILY', interval: 7 } : { kind: k },
    );
  return (
    <View testID="repeat-editor" style={{ gap: 10 }}>
      <Segmented
        label={strings['repeat.label']}
        value={kind}
        onChange={pick}
        options={(['none', 'daily', 'weekly', 'monthly', 'after'] as const).map((k) => ({ value: k, label: strings[`repeat.${k}`] }))}
      />
      {value?.kind === 'weekly' ? (
        <Toggles
          label={strings['repeat.days']}
          values={value.days}
          onChange={(days) => days.length && onChange({ kind: 'weekly', days })}
          options={WEEKDAYS_ABBREVIATED.map((w, i) => ({ value: i, label: w, a11y: strings['event.dayA11y'](WEEKDAYS_ACCUSATIVE[i]!) }))}
        />
      ) : null}
      {value?.kind === 'monthly' && (lastDay || value.day === -1) ? (
        <Segmented
          label={strings['event.monthly']}
          value={value.day === -1 ? 'last' : 'day'}
          onChange={(v) => onChange(v === 'last' ? { kind: 'monthly', day: -1 } : { kind: 'monthly', day: monthDay })}
          options={[
            { value: 'day', label: strings['event.monthly.day'](monthDay) },
            { value: 'last', label: strings['event.monthly.lastDay'] },
          ]}
        />
      ) : null}
      {value?.kind === 'monthly' && value.day !== -1 && monthDay >= 29 ? <Body muted>{strings['repeat.monthSkip'](monthDay)}</Body> : null}
      {value?.kind === 'after' ? (
        <>
          <Segmented
            label={strings['repeat.unit']}
            value={value.unit}
            onChange={(unit) => onChange({ ...value, unit })}
            options={[
              { value: 'DAILY', label: strings['repeat.unit.days'] },
              { value: 'WEEKLY', label: strings['repeat.unit.weeks'] },
            ]}
          />
          <Segmented
            label={strings['repeat.every']}
            value={String(value.interval)}
            onChange={(v) => onChange({ ...value, interval: Number(v) })}
            options={INTERVALS.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </>
      ) : null}
    </View>
  );
}
