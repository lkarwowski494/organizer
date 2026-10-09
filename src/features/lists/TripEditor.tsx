/** Zakupy na liście zakupów (D73): dzień (Dziś / Jutro / Inny dzień / Bez terminu), godzina i kto robi zakupy. */
import { View } from 'react-native';

import type { CivilDate } from '../../domain/civil-date';
import type { Member } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Segmented } from '../../ui/components';
import { DueFields } from '../../ui/DueFields';
import { parseDueFields } from './TaskScreen';

export type TripDraft = { date: string; time: string; responsibleId: string | null };

/** Szkic → pola listy albo błąd (zły dzień, zła godzina). */
export function readTrip(d: TripDraft): { error: string } | { trip: { date: string | null; time: string | null; responsibleId: string | null } } {
  if (d.date.trim() === '') return { trip: { date: null, time: null, responsibleId: d.responsibleId } };
  const r = parseDueFields(d.date, d.time);
  return 'error' in r ? r : { trip: { date: r.due.date, time: r.due.time, responsibleId: d.responsibleId } };
}

export function TripEditor({ value, onChange, adults, today, required }: { value: TripDraft; onChange: (d: TripDraft) => void; adults: Member[]; today: CivilDate; required: boolean }) {
  return (
    <View testID="trip-editor" style={{ gap: 10 }}>
      <Body muted>{strings['trip.info']}</Body>
      {/* Audyt 2 (M-245): ten sam termin co w zadaniu — „Kiedy” z „Inny dzień”; bez dnia nie ma godziny. */}
      <DueFields
        date={value.date}
        time={value.time}
        onDate={(date) => onChange({ ...value, date, ...(date === '' ? { time: '' } : {}) })}
        onTime={(time) => onChange({ ...value, time })}
        today={today}
        testID="trip"
        timeLabel={strings['common.timeOptional']}
      />
      <Segmented
        label={strings['trip.who']}
        value={value.responsibleId ?? ''}
        onChange={(id) => onChange({ ...value, responsibleId: id === '' ? null : id })}
        options={[{ value: '', label: strings['common.nobody'] }, ...adults.map((m) => ({ value: m.member_id, label: m.display_name }))]}
      />
      {required && value.date.trim() === '' && value.responsibleId === null ? <Body>{strings['trip.required']}</Body> : null}
    </View>
  );
}
