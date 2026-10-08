/**
 * Nowe wydarzenie albo zmiana istniejącego w wybranym zakresie (D57). Nowe co tydzień może mieć kilka terminów
 * (np. pon. 18:00 i sob. 12:00) — każdy staje się osobną serią (src/domain/views/event-form.ts).
 * „Tylko to” zmienia nazwę, dzień i godzinę jednego wystąpienia; powtarzanie i uczestnicy należą do serii.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED, WEEKDAYS_NOMINATIVE } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import { formatIsoDate } from '../../domain/civil-date';
import { formatLongDate, parseIsoDate , formatDue } from '../../domain/format';
import { emptyForm, type EventForm, formOf, type Repeat, type Slot, validateForm, weekdayPosition } from '../../domain/views/event-form';
import { type SeriesEffects, seriesEditEffects, seriesEditOps } from '../../domain/views/event-tasks';
import { createEvent, editEvent, eventDetail, fieldsOf, moveTooFar } from '../../domain/views/events';
import { config } from '../../config';
import type { NewOp } from '../../domain/sync-engine/client';
import { groupDetail, groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, Segmented, Title, Toggles } from '../../ui/components';
import { TimeField } from '../../ui/TimeField';
import { DateField } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'EventEdit'>;

const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FEMININE = new Set([2, 5, 6]); // środa, sobota, niedziela

export function EventEditScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const { eventId, scope = 'all' } = route.params;
  const detail = useMemo(() => (eventId ? eventDetail(tables, userId, eventId) : null), [tables, userId, eventId]);
  const groups = useMemo(() => groupsView(tables, userId).filter((g) => g.me.role !== 'child'), [tables, userId]);
  const occurrence = route.params.date ?? formatIsoDate(today);
  const [groupId, setGroupId] = useState(detail?.event.group_id ?? (groups.some((g) => g.id === route.params.groupId) ? route.params.groupId! : (groups[0]?.id ?? '')));
  const [form, setForm] = useState<EventForm>(() => {
    if (detail) return formOf(fieldsOf(detail, occurrence, scope));
    // D98: przejście z formularza zadania (przełącznik „Rodzaj”) — to, co już wpisane.
    // PWD-33 (D200): kopia wydarzenia z iPhone'a — nazwa, dzień, godziny i miejsce do poprawienia przed zapisem.
    const { title, start, end, responsibleId, location, allDay } = route.params;
    const f = emptyForm(occurrence);
    const adult = responsibleId && groups.find((g) => g.id === groupId)?.kind !== 'personal' && (groupDetail(tables, userId, groupId)?.members ?? []).some((m) => m.member_id === responsibleId && m.role !== 'child');
    return { ...f, title: title ?? '', allDay: allDay ?? false, location: location ?? '', slots: [{ ...f.slots[0]!, start: start ?? '', end: end ?? '' }], responsibleId: adult ? responsibleId : null };
  });
  const [error, setError] = useState<string | null>(null);
  // Podgląd skutków zmiany serii (Faza 0: „podgląd skutków edycji serii połączony z dialogiem przepinania”, D14).
  const [preview, setPreview] = useState<{ ops: NewOp[]; effects: SeriesEffects } | null>(null);
  const [lostChoice, setLostChoice] = useState<'nearest' | 'unlink'>('nearest');
  const members = useMemo(() => groupDetail(tables, userId, groupId)?.members ?? [], [tables, userId, groupId]);
  const personal = groups.find((g) => g.id === groupId)?.kind === 'personal';
  // D66: osobą odpowiedzialną jest tylko dorosły (serwer odrzuci dziecko); w grupie osobistej nie ma kogo wybierać.
  const adults = members.filter((m) => m.role !== 'child' && !personal);

  if (eventId && (!detail || !detail.canEdit)) {
    return (
      <Screen testID="screen-event-edit-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  if (!eventId && groups.length === 0) {
    return (
      <Screen testID="screen-event-edit-nogroups">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['event.noGroups']}</Body>
      </Screen>
    );
  }

  const set = (patch: Partial<EventForm>) => setForm((f) => ({ ...f, ...patch }));
  const setSlot = (i: number, patch: Partial<Slot>) => setForm((f) => ({ ...f, slots: f.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const only = detail !== null && scope === 'this';
  const series = !only && form.repeat !== 'none';
  const multi = !detail && form.repeat === 'weekly';
  const slots = multi ? form.slots : form.slots.slice(0, 1);
  const pos = DATE.test(form.date) ? weekdayPosition(form.date) : null;

  const save = () => {
    // W grupie osobistej „kogo dotyczy” nie ma (P-53) — zawsze cała grupa, czyli ja.
    const r = validateForm({ ...form, ...(only ? { repeat: 'none' as const } : {}), ...(personal ? { audience: 'group' as const, participantIds: [] } : {}) });
    if ('error' in r) return setError(strings[`event.error.${r.error}`]);
    if (only && moveTooFar(occurrence, r.fields[0]!.date)) return setError(strings['event.moveTooFar'](config.events.MOVE_WINDOW_DAYS));
    setError(null);
    if (!detail) {
      store.dispatch(r.fields.flatMap((f) => createEvent(groupId, f, newId).ops));
      navigation.goBack();
    } else {
      const ops = editEvent(detail, occurrence, scope, r.fields[0]!);
      if (scope !== 'this' && detail.rule) return setPreview({ ops, effects: seriesEditEffects(tables, detail, occurrence, scope, ops) });
      commit(ops);
    }
  };
  const commit = (ops: NewOp[]) => {
    store.dispatch(ops);
    // Ekran wystąpienia za nami może już nie istnieć (np. seria skończyła się dzień wcześniej) — wracamy dalej.
    navigation.pop(2);
  };

  if (preview && detail) {
    const { effects } = preview;
    return (
      <Screen testID="screen-event-preview">
        <Title>{strings['event.previewTitle']}</Title>
        <Body>{effects.preview.length ? strings['event.previewDates'](effects.preview.map((x) => formatDue({ date: x, time: null }, today)).join(', ')) : strings['event.previewNone']}</Body>
        {effects.kept.length ? <Body muted>{strings['event.previewKept'](effects.kept.length)}</Body> : null}
        {effects.overridesLost ? <Body>{strings['event.previewOverridesLost'](effects.overridesLost)}</Body> : null}
        {effects.lost.length ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['event.previewLost'](effects.lost.length)}</Body>
            <Body muted>{effects.lost.map((x) => x.task.title).join(', ')}</Body>
            <Segmented label={strings['event.previewLostChoice']} value={lostChoice} onChange={setLostChoice} options={[{ value: 'nearest', label: strings['event.previewNearest'] }, { value: 'unlink', label: strings['event.previewUnlink'] }]} />
          </View>
        ) : null}
        <Button label={strings['event.previewSave']} testID="event-preview-save" onPress={() => commit(seriesEditOps(detail, preview.ops, effects, lostChoice))} />
        <Button kind="secondary" label={strings['event.previewBack']} onPress={() => setPreview(null)} />
      </Screen>
    );
  }

  return (
    <Screen testID="screen-event-edit">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{detail ? strings['event.edit'] : strings['event.new']}</Title>
      {detail ? null : (
        // D98: zadanie albo wydarzenie — wpisane nazwa, dzień, godzina i grupa przechodzą do formularza zadania.
        <Segmented
          label={strings['form.kind']}
          value="event"
          onChange={(k) => {
            if (k !== 'task') return;
            navigation.replace('AddTask', { title: form.title, date: DATE.test(form.date) ? form.date : undefined, time: form.allDay ? undefined : form.slots[0]!.start || undefined, groupId });
          }}
          options={[
            { value: 'task', label: strings['form.kind.task'] },
            { value: 'event', label: strings['form.kind.event'] },
          ]}
        />
      )}
      {route.params.fromDevice && !detail ? <Body muted>{strings['event.copyInfo']}</Body> : null}
      {detail && detail.rule ? (
        <Body muted>
          {scope === 'this' ? strings['event.scopeThisInfo'] : scope === 'following' ? strings['event.scopeFollowingInfo'](formatLongDate(parseIsoDate(occurrence), today)) : strings['event.scopeAllInfo']}
        </Body>
      ) : null}
      {!detail && groups.length > 1 ? (
        <Segmented label={strings['event.group']} value={groupId} onChange={(g) => (setGroupId(g), set({ participantIds: [], responsibleId: null }))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      ) : null}
      <Field label={strings['event.title']} value={form.title} onChangeText={(title) => set({ title })} placeholder={strings['event.titlePlaceholder']} testID="event-title" />
      {only ? null : (
        // D115: miejsce całej serii („Tylko to” go nie zmienia).
        <Field label={strings['event.location']} value={form.location} onChangeText={(location) => set({ location })} placeholder={strings['event.locationPlaceholder']} testID="event-location" />
      )}
      {/* Audyt 2: w serii „to i następne” zaczyna się od tego wystąpienia (E-6, napis wyżej), a „wszystkie” — od początku
          serii; dzień wybiera się tylko, gdy seria staje się jednorazowa (E-7). */}
      {detail?.rule && (scope === 'following' || (scope === 'all' && form.repeat !== 'none')) ? null : (
        <DateField label={series ? strings['event.firstDate'] : strings['event.date']} value={form.date} onChange={(date) => set({ date })} today={today} testID="event-date" />
      )}
      {/* D136: także „tylko to” może być na cały dzień. */}
      <Segmented label={strings['event.when']} value={form.allDay ? 'allDay' : 'time'} onChange={(v) => set({ allDay: v === 'allDay' })} options={[{ value: 'time', label: strings['event.atTime'] }, { value: 'allDay', label: strings['event.allDay'] }]} />
      {only ? null : (
        <Segmented
          label={strings['event.repeat']}
          value={form.repeat}
          // Audyt 2 (E-7): seria „wszystkie” → jednorazowe: dzień otwartego terminu, nie pierwszy dzień serii (często miniony).
          onChange={(repeat) => set(repeat === 'none' && detail?.rule && scope === 'all' ? { repeat, date: fieldsOf(detail, occurrence, 'this').date } : { repeat })}
          options={REPEATS.map((r) => ({ value: r, label: strings[`event.repeat.${r}`] }))}
        />
      )}

      {slots.map((slot, i) => (
        <View key={i} style={{ gap: 10, ...(multi ? { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border } : {}) }}>
          {multi && form.slots.length > 1 ? <Text style={{ fontFamily: font.text700, fontSize: 15, color: c.ink }}>{strings['event.slot'](i + 1)}</Text> : null}
          {form.repeat === 'weekly' && !only ? (
            <Toggles
              label={strings['event.days']}
              values={slot.days}
              onChange={(days) => setSlot(i, { days })}
              options={WEEKDAYS_ABBREVIATED.map((w, wd) => ({ value: wd, label: w, a11y: strings['event.dayA11y'](WEEKDAYS_ACCUSATIVE[wd]!) + (multi && form.slots.length > 1 ? ` (${strings['event.slot'](i + 1)})` : '') }))}
            />
          ) : null}
          {form.allDay ? null : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <TimeField label={strings['event.start']} value={slot.start} onChange={(start) => setSlot(i, { start })} testID={`event-start-${i}`} />
              </View>
              <View style={{ flex: 1 }}>
                <TimeField label={strings['event.end']} value={slot.end} onChange={(end) => setSlot(i, { end })} testID={`event-end-${i}`} optional />
              </View>
            </View>
          )}
          {multi && form.slots.length > 1 ? <Button kind="secondary" label={strings['event.removeSlot'](i + 1)} onPress={() => set({ slots: form.slots.filter((_, j) => j !== i) })} /> : null}
        </View>
      ))}
      {multi ? (
        <View style={{ gap: 6 }}>
          <Button kind="secondary" label={strings['event.addSlot']} testID="event-add-slot" onPress={() => set({ slots: [...form.slots, { days: [], start: '', end: '' }] })} />
          <Body muted>{strings['event.addSlotHint']}</Body>
        </View>
      ) : null}

      {series ? (
        <>
          <Field label={strings['event.interval'](form.repeat as Exclude<Repeat, 'none'>)} value={form.interval} onChangeText={(interval) => set({ interval })} keyboardType="number-pad" testID="event-interval" />
          {form.repeat === 'monthly' && pos ? (
            <Segmented
              label={strings['event.monthly']}
              value={form.monthly}
              onChange={(monthly) => set({ monthly })}
              options={[
                { value: 'day' as const, label: strings['event.monthly.day'](parseIsoDate(form.date).d) },
                ...(pos.n <= 4 ? [{ value: 'nth' as const, label: strings['event.monthly.nth'](pos.n, WEEKDAYS_NOMINATIVE[pos.wd]!) }] : []),
                ...(pos.last ? [{ value: 'last' as const, label: strings['event.monthly.last'](WEEKDAYS_NOMINATIVE[pos.wd]!, FEMININE.has(pos.wd)) }] : []),
              ]}
            />
          ) : null}
          <Segmented label={strings['event.ends']} value={form.ends} onChange={(ends) => set({ ends })} options={[{ value: 'never', label: strings['event.ends.never'] }, { value: 'until', label: strings['event.ends.until'] }]} />
          {form.ends === 'until' ? <DateField label={strings['event.until']} value={form.until} onChange={(until) => set({ until })} today={today} testID="event-until" /> : null}
        </>
      ) : null}

      {/* Audyt 2 (P-53): w grupie osobistej nie ma kogo wybierać. */}
      {only || personal ? null : (
        <>
          <Segmented label={strings['event.audience']} value={form.audience} onChange={(audience) => set({ audience })} options={[{ value: 'group', label: strings['event.audience.group'] }, { value: 'members', label: strings['event.audience.members'] }]} />
          {form.audience === 'members' ? (
            <Toggles
              label={strings['event.who']}
              values={form.participantIds}
              onChange={(participantIds) => set({ participantIds })}
              options={members.map((m) => ({ value: m.member_id, label: m.display_name, a11y: strings['event.participantA11y'](m.display_name) }))}
            />
          ) : null}
        </>
      )}

      {adults.length ? (
        <Segmented
          label={strings['event.responsible']}
          value={form.responsibleId ?? ''}
          onChange={(v) => set({ responsibleId: v === '' ? null : v })}
          options={[{ value: '', label: strings['event.responsibleNone'] }, ...adults.map((m) => ({ value: m.member_id, label: m.display_name }))]}
        />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      <Button label={strings['event.save']} onPress={save} testID="event-save" />
    </Screen>
  );
}
