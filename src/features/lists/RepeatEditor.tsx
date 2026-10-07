/** Powtarzanie zadania (D76): nie / codziennie / co tydzień w wybrane dni / co miesiąc / co N dni albo tygodni od wykonania. */
import { View } from 'react-native';

import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import type { Repeat } from '../../domain/views/task-repeat';
import { strings } from '../../i18n/strings.pl';
import { Segmented, Toggles } from '../../ui/components';

type Kind = 'none' | Repeat['kind'];
const INTERVALS = [1, 2, 3, 4, 5, 6, 7, 10, 14] as const;

export function RepeatEditor({ value, onChange, weekday }: { value: Repeat | null; onChange: (r: Repeat | null) => void; weekday: number }) {
  const kind: Kind = value?.kind ?? 'none';
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
