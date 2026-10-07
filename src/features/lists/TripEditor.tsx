/** Zakupy na liście zakupów (D73): dzień (Dziś / Jutro / wpisany / bez terminu), godzina i kto robi zakupy. */
import { View } from 'react-native';

import { addDays, type CivilDate, formatIsoDate } from '../../domain/civil-date';
import type { Member } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Field, Segmented } from '../../ui/components';
import { parseDueFields } from './TaskScreen';

export type TripDraft = { date: string; time: string; responsibleId: string | null };

/** Szkic → pola listy albo błąd (zły dzień, zła godzina). */
export function readTrip(d: TripDraft): { error: string } | { trip: { date: string | null; time: string | null; responsibleId: string | null } } {
  if (d.date.trim() === '') return { trip: { date: null, time: null, responsibleId: d.responsibleId } };
  const r = parseDueFields(d.date, d.time);
  return 'error' in r ? r : { trip: { date: r.due.date, time: r.due.time, responsibleId: d.responsibleId } };
}

export function TripEditor({ value, onChange, adults, today, required }: { value: TripDraft; onChange: (d: TripDraft) => void; adults: Member[]; today: CivilDate; required: boolean }) {
  const day = (k: number) => formatIsoDate(addDays(today, k));
  const quick = value.date === '' ? 'none' : value.date === day(0) ? 'today' : value.date === day(1) ? 'tomorrow' : 'other';
  return (
    <View testID="trip-editor" style={{ gap: 10 }}>
      <Body muted>{strings['trip.info']}</Body>
      <Segmented
        label={strings['trip.date']}
        value={quick}
        onChange={(q) => q !== 'other' && onChange({ ...value, date: q === 'none' ? '' : day(q === 'today' ? 0 : 1) })}
        options={[
          { value: 'today', label: strings['trip.today'] },
          { value: 'tomorrow', label: strings['trip.tomorrow'] },
          { value: 'none', label: strings['trip.noDate'] },
        ]}
      />
      <Field label={strings['trip.date']} value={value.date} onChangeText={(date) => onChange({ ...value, date })} placeholder="2026-10-09" testID="trip-date" />
      {value.date === '' ? null : <Field label={strings['trip.time']} value={value.time} onChangeText={(time) => onChange({ ...value, time })} placeholder="17:30" testID="trip-time" />}
      <Segmented
        label={strings['trip.who']}
        value={value.responsibleId ?? ''}
        onChange={(id) => onChange({ ...value, responsibleId: id === '' ? null : id })}
        options={[{ value: '', label: strings['trip.anyone'] }, ...adults.map((m) => ({ value: m.member_id, label: m.display_name }))]}
      />
      {required && value.date.trim() === '' && value.responsibleId === null ? <Body muted>{strings['trip.required']}</Body> : null}
    </View>
  );
}
