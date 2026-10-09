/**
 * Nowe wydarzenie albo zmiana istniejącego w wybranym zakresie (D57). Nowe co tydzień może mieć kilka terminów
 * (np. pon. 18:00 i sob. 12:00) — każdy staje się osobną serią (src/domain/views/event-form.ts).
 * „Tylko to” zmienia nazwę, dzień i godzinę jednego wystąpienia; powtarzanie i uczestnicy należą do serii.
 */
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useRef, useState } from 'react';
import { type TextInput, View } from 'react-native';

import { useAdded } from '../../app/added';
import { useAppData, useServices } from '../../app/context';
import { DraftNote, useAnnounce, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED, WEEKDAYS_NOMINATIVE } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import { addDays, formatIsoDate } from '../../domain/civil-date';
import { materialize } from '../../domain/sync-engine/client';
import { startGroup } from '../../domain/views/default-group';
import { useDefaultGroup } from '../../app/default-group';
import { formatDateInline, parseIsoDate } from '../../domain/format';
import { emptyForm, type EventForm, formOf, moveStart, type Repeat, type Slot, validateForm, weekdayPosition } from '../../domain/views/event-form';
import { coveredDays, endsNextDay } from '../../domain/span';
import { type SeriesEffects, seriesEditEffects, seriesEditOps } from '../../domain/views/event-tasks';
import { createEvent, editEvent, eventDetail, expandEvents, fieldsOf, moveTooFar } from '../../domain/views/events';
import { occurrenceOwner } from '../../domain/views/event-rows';
import { config } from '../../config';
import type { NewOp } from '../../domain/sync-engine/client';
import { groupDetail, groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, CardTitle, ErrorText, Field, MissingScreen, Screen, Segmented, Title, Toggles } from '../../ui/components';
import { TimeFieldPair } from '../../ui/TimeField';
import { DateField } from '../../ui/DateField';
import { PeopleToggles, PersonPicker } from '../../ui/PersonPicker';
import { useTheme } from '../../ui/theme';
import { SeriesPreview } from './SeriesPreview';

type Props = NativeStackScreenProps<RootStackParams, 'EventEdit'>;

const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FEMININE = new Set([2, 5, 6]); // środa, sobota, niedziela

export function EventEditScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, space, radius } = useTheme();
  const { eventId, scope = 'all' } = route.params;
  const detail = useMemo(() => (eventId ? eventDetail(tables, userId, eventId) : null), [tables, userId, eventId]);
  const groups = useMemo(() => groupsView(tables, userId).filter((g) => g.me.role !== 'child'), [tables, userId]);
  const added = useAdded();
  const occurrence = route.params.date ?? formatIsoDate(today);
  // PW-37 A (M-118, D191): nowe wydarzenie bez wskazanej grupy (także „Dodaj do grupy” z kalendarza iPhone'a) startuje
  // z „Grupy domyślnej”, jak szybkie dodawanie; zapis zapamiętuje grupę jako ostatnio użytą.
  const defaultGroup = useDefaultGroup();
  const [groupId, setGroupId] = useState(detail?.event.group_id ?? (groups.some((g) => g.id === route.params.groupId) ? route.params.groupId! : (startGroup(groups, defaultGroup.setting, defaultGroup.last) ?? '')));
  const [form, setForm] = useState<EventForm>(() => {
    if (detail) return formOf(fieldsOf(detail, occurrence, scope));
    // D98: przejście z formularza zadania (przełącznik „Rodzaj”) — to, co już wpisane.
    // PWD-33 (D200): kopia wydarzenia z iPhone'a — nazwa, dzień, godziny i miejsce do poprawienia przed zapisem.
    // Audyt 2 (M-255): dziecko z „@Tymek” przechodzi jako uczestnik, jak w szybkim dodaniu (quickEvent).
    const { title, start, end, responsibleId, location, allDay, participantIds, endDate } = route.params;
    const f = emptyForm(occurrence, participantIds ?? []);
    const adult = responsibleId && groups.find((g) => g.id === groupId)?.kind !== 'personal' && (groupDetail(tables, userId, groupId)?.members ?? []).some((m) => m.member_id === responsibleId && m.role !== 'child');
    // D199: dzień końca taki jak z godzin (ten sam albo następny przy końcu przed początkiem) = puste pole (z napisem).
    const auto = !allDay && start && end && endsNextDay(start, end) ? formatIsoDate(addDays(parseIsoDate(occurrence), 1)) : occurrence;
    return { ...f, title: title ?? '', allDay: allDay ?? false, endDate: endDate && endDate !== auto ? endDate : '', location: location ?? '', slots: [{ ...f.slots[0]!, start: start ?? '', end: end ?? '' }], responsibleId: adult ? responsibleId : null };
  });
  // Formularz z chwili otwarcia — zapis zmiany wysyła tylko pola, które zmieniłem (editEvent, synchronizacja per pole).
  const [loadedForm] = useState<EventForm | null>(() => (detail ? formOf(fieldsOf(detail, occurrence, scope)) : null));
  const [error, setError] = useState<string | null>(null);
  // Podgląd skutków zmiany serii (Faza 0: „podgląd skutków edycji serii połączony z dialogiem przepinania”, D14).
  const [preview, setPreview] = useState<{ ops: NewOp[]; effects: SeriesEffects } | null>(null);
  const [lostChoice, setLostChoice] = useState<'nearest' | 'unlink'>('nearest');
  // Audyt 2 (M-242): w podglądzie zmian serii gest cofania (i „Wróć” systemowe) wraca do edycji, jak przycisk
  // „Wróć do edycji” — nie zamyka formularza. Native stack blokuje wtedy na iOS zamknięcie gestem (preventNativeDismiss,
  // @react-navigation/native-stack, NativeStackView.native.tsx) i wywołuje callback.
  // Zapis z podglądu wychodzi z ekranu naprawdę (`leaving`) — wtedy przepuszczamy zatrzymaną akcję nawigacji.
  const leaving = useRef(false);
  const locationField = useRef<TextInput>(null);
  usePreventRemove(preview !== null, ({ data }) => (leaving.current ? navigation.dispatch(data.action) : setPreview(null)));
  const members = useMemo(() => groupDetail(tables, userId, groupId)?.members ?? [], [tables, userId, groupId]);
  const personal = groups.find((g) => g.id === groupId)?.kind === 'personal';
  // D66: osobą odpowiedzialną jest tylko dorosły (serwer odrzuci dziecko); w grupie osobistej nie ma kogo wybierać.
  const adults = members.filter((m) => m.role !== 'child' && !personal);
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Zapisz” zostawia wpisane pola (app/form-draft).
  const set = (patch: Partial<EventForm>) => setForm((f) => ({ ...f, ...patch }));
  const prefilled = route.params.title !== undefined || route.params.start !== undefined;
  // M-255: po przełączeniu rodzaju VoiceOver słyszy, w jakim formularzu jest (fokus zostaje na „Wróć”).
  useAnnounce(route.params.kindSwitch ? strings['event.new'] : null);
  const draft = useFormDraft(
    detail ? `event:${eventId}:${occurrence}:${scope}` : 'event:new',
    { ...form, groupId },
    { ...(Object.fromEntries(Object.keys(form).map((k) => [k, (v: unknown) => set({ [k]: v })])) as { [K in keyof EventForm]: (v: EventForm[K]) => void }), groupId: setGroupId },
    { restore: !prefilled },
  );

  if (eventId && (!detail || !detail.canEdit)) {
    return (
      <MissingScreen testID="screen-event-edit-missing" text={strings['missing.event']} onBack={() => navigation.goBack()} />
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

  const setSlot = (i: number, patch: Partial<Slot>) => setForm((f) => ({ ...f, slots: f.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const only = detail !== null && scope === 'this';
  const series = !only && form.repeat !== 'none';
  const multi = !detail && form.repeat === 'weekly';
  const slots = multi ? form.slots : form.slots.slice(0, 1);
  const pos = DATE.test(form.date) ? weekdayPosition(form.date) : null;
  // D199: dzień końca wynikający z godzin pierwszego terminu (koniec nie później niż początek — następny dzień).
  const clock = (slot: Slot) => /^\d{2}:\d{2}$/.test(slot.start.trim()) && /^\d{2}:\d{2}$/.test(slot.end.trim());
  const autoEnd = !form.allDay && DATE.test(form.date) && clock(form.slots[0]!) && endsNextDay(form.slots[0]!.start.trim(), form.slots[0]!.end.trim()) ? formatIsoDate(addDays(parseIsoDate(form.date), 1)) : form.date;

  const save = () => {
    // W grupie osobistej „kogo dotyczy” nie ma (P-53) — zawsze cała grupa, czyli ja.
    // D199: koniec nie później niż początek = następnego dnia (plan lekcji i rutyny tego nie mają).
    const normalized = (x: EventForm) => validateForm({ ...x, ...(only ? { repeat: 'none' as const } : {}), ...(personal ? { audience: 'group' as const, participantIds: [] } : {}) }, { overnight: true });
    const r = normalized(form);
    if ('error' in r) return setError(strings[`event.error.${r.error}`]);
    if (only && moveTooFar(occurrence, r.fields[0]!.date)) return setError(strings['event.moveTooFar'](config.events.MOVE_WINDOW_DAYS));
    setError(null);
    if (!detail) {
      draft.saved();
      // D189: „Dodano wydarzenie: … · Cofnij”.
      const g = groups.find((x) => x.id === groupId);
      added(strings['form.addedEvent'](r.fields[0]!.title, g?.kind === 'personal' ? strings['groups.personal'] : (g?.name ?? '')), r.fields.flatMap((f) => createEvent(groupId, f, newId).ops));
      defaultGroup.remember(groupId);
      navigation.goBack();
    } else {
      const was = loadedForm ? normalized(loadedForm) : null;
      const ops = editEvent(detail, occurrence, scope, r.fields[0]!, was && !('error' in was) ? was.fields[0] : undefined);
      if (scope !== 'this' && detail.rule) return setPreview({ ops, effects: seriesEditEffects(tables, detail, occurrence, scope, ops) });
      commit(ops);
    }
  };
  const commit = (ops: NewOp[]) => {
    // Szkic znika dopiero przy zapisie — „Wróć” z podglądu zmian serii go nie gubi (D179).
    draft.saved();
    store.dispatch(ops);
    leaving.current = true;
    // Audyt 2 (M-246): po zmianie wracamy do szczegółów wystąpienia, gdy ono nadal istnieje (także przeniesione do nowej
    // serii po „to i następne” — ekran wydarzenia sam trafia do właściciela terminu); gdy zniknęło (np. seria skończyła
    // się wcześniej) — o ekran dalej, zamiast pokazywać „Tego wydarzenia już nie ma”.
    const state = navigation.getState();
    const below = state.routes[state.index - 1];
    const after = materialize(store.getSnapshot().state);
    const owner = occurrenceOwner(after, eventId!, occurrence);
    const d = parseIsoDate(occurrence);
    const exists = expandEvents(after, userId, addDays(d, -config.events.MOVE_WINDOW_DAYS), addDays(d, config.events.MOVE_WINDOW_DAYS)).some((o) => o.eventId === owner && o.occurrenceDate === occurrence);
    if (below?.name === 'Event' && !exists) navigation.pop(2);
    else navigation.goBack();
  };

  if (preview && detail) {
    return (
      <SeriesPreview
        testID="screen-event-preview"
        saveTestID="event-preview-save"
        effects={preview.effects}
        today={today}
        choice={lostChoice}
        onChoice={setLostChoice}
        onSave={() => commit(seriesEditOps(detail, preview.ops, preview.effects, lostChoice))}
        onBack={() => setPreview(null)}
      />
    );
  }

  return (
    <Screen testID="screen-event-edit">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{detail ? strings['event.edit'] : strings['event.new']}</Title>
      <DraftNote draft={draft} />
      {detail ? null : (
        // D98, PWD-26: zadanie, wydarzenie albo rutyna — wpisane pola przechodzą do wybranego formularza.
        <Segmented
          label={strings['form.kind']}
          value="event"
          onChange={(k) => {
            if (k === 'event') return;
            // Wpisane pola przechodzą do innego formularza — szkic wydarzenia nie jest już potrzebny.
            draft.saved();
            // Audyt 2 (PWD-26): rutyna też stąd — nazwa i grupa przechodzą do jej formularza.
            if (k === 'routine') return navigation.replace('Routine', { groupId, title: form.title, kindSwitch: true });
            navigation.replace('AddTask', { title: form.title, date: DATE.test(form.date) ? form.date : undefined, time: form.allDay ? undefined : form.slots[0]!.start || undefined, groupId, kindSwitch: true });
          }}
          options={[
            { value: 'task', label: strings['form.kind.task'], hint: strings['form.kind.taskHint'] },
            { value: 'event', label: strings['form.kind.event'] },
            { value: 'routine', label: strings['form.kind.routine'], hint: strings['form.kind.routineHint'] },
          ]}
        />
      )}
      {route.params.fromDevice && !detail ? <Body muted>{strings['event.copyInfo']}</Body> : null}
      {detail && detail.rule ? (
        <Body muted>
          {scope === 'this' ? strings['event.scopeThisInfo'] : scope === 'following' ? strings['event.scopeFollowingInfo'](formatDateInline(parseIsoDate(occurrence), today)) : strings['event.scopeAllInfo']}
        </Body>
      ) : null}
      {!detail && groups.length > 1 ? (
        <Segmented label={strings['common.group']} value={groupId} onChange={(g) => (setGroupId(g), set({ participantIds: [], responsibleId: null }))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      ) : null}
      {/* M-247: kursor w pierwszym polu pustego formularza tworzenia; M-243: Return przechodzi do miejsca. */}
      <Field label={strings['common.name']} value={form.title} onChangeText={(title) => set({ title })} placeholder={strings['event.titlePlaceholder']} autoFocus={!detail && !prefilled} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => locationField.current?.focus()} testID="event-title" />
      {only ? null : (
        // D115: miejsce całej serii („Tylko to” go nie zmienia).
        <Field ref={locationField} label={strings['event.location']} value={form.location} onChangeText={(location) => set({ location })} placeholder={strings['event.locationPlaceholder']} testID="event-location" />
      )}
      {/* Audyt 2: w serii „to i następne” zaczyna się od tego wystąpienia (E-6, napis wyżej), a „wszystkie” — od początku
          serii; dzień wybiera się tylko, gdy seria staje się jednorazowa (E-7). */}
      {detail?.rule && (scope === 'following' || (scope === 'all' && form.repeat !== 'none')) ? null : (
        // D199: przesunięcie startu przesuwa ostatni dzień (długość zostaje).
        <DateField label={series ? strings['event.firstDate'] : strings['due.day']} value={form.date} onChange={(date) => set(moveStart(form, date))} today={today} testID="event-date" />
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
        <View key={i} style={{ gap: 10, ...(multi ? { padding: space.PANEL_PAD, borderRadius: radius.PANEL, borderWidth: 1, borderColor: c.border } : {}) }}>
          {multi && form.slots.length > 1 ? <CardTitle>{strings['event.slot'](i + 1)}</CardTitle> : null}
          {form.repeat === 'weekly' && !only ? (
            <Toggles
              label={strings['event.days']}
              values={slot.days}
              onChange={(days) => setSlot(i, { days })}
              options={WEEKDAYS_ABBREVIATED.map((w, wd) => ({ value: wd, label: w, a11y: strings['event.dayA11y'](WEEKDAYS_ACCUSATIVE[wd]!) + (multi && form.slots.length > 1 ? ` (${strings['event.slot'](i + 1)})` : '') }))}
            />
          ) : null}
          {form.allDay ? null : (
            <TimeFieldPair
              start={{ label: strings['event.start'], value: slot.start, onChange: (start) => setSlot(i, { start }), testID: `event-start-${i}` }}
              end={{ label: strings['event.end'], value: slot.end, onChange: (end) => setSlot(i, { end }), testID: `event-end-${i}`, optional: true }}
            />
          )}
          {/* D199: koniec wcześniejszy niż początek (nocny dyżur) — widoczna informacja zamiast błędu. */}
          {!form.allDay && form.endDate === '' && clock(slot) && coveredDays(slot.start.trim(), slot.end.trim(), 1) === 2 ? (
            <Body muted>{strings['event.endsNextDay']}</Body>
          ) : null}
          {multi && form.slots.length > 1 ? <Button kind="danger" label={strings['event.removeSlot'](i + 1)} onPress={() => set({ slots: form.slots.filter((_, j) => j !== i) })} /> : null}
        </View>
      ))}
      {/* D199: „Kończy się” — całodniowe przez kilka dni (obóz) i z godziną do innego dnia (wyjazd pt. 18:00 – nd. 16:00).
          Domyślnie ten sam dzień, a z godziną końca nie później niż początek — następny (wtedy pole pokazuje ten dzień). */}
      <View style={{ gap: 6 }}>
        <DateField label={strings['event.endDate']} value={form.endDate || autoEnd} onChange={(v) => set({ endDate: v === autoEnd ? '' : v })} today={today} testID="event-end-date" />
        {series && form.endDate !== '' && form.endDate !== autoEnd ? <Body muted>{strings['event.sameLength']}</Body> : null}
      </View>
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
                // PWD-37: ostatni dzień miesiąca (BYMONTHDAY=-1), gdy dzień startu nim jest.
                ...(pos.lastDay || form.monthly === 'lastDay' ? [{ value: 'lastDay' as const, label: strings['event.monthly.lastDay'] }] : []),
              ]}
            />
          ) : null}
          {form.repeat === 'monthly' && pos && form.monthly === 'day' && parseIsoDate(form.date).d >= 29 ? <Body muted>{strings['repeat.monthSkip'](parseIsoDate(form.date).d)}</Body> : null}
          <Segmented label={strings['event.ends']} value={form.ends} onChange={(ends) => set({ ends })} options={[{ value: 'never', label: strings['event.ends.never'] }, { value: 'until', label: strings['event.ends.until'] }]} />
          {form.ends === 'until' ? <DateField label={strings['event.until']} value={form.until} onChange={(until) => set({ until })} today={today} testID="event-until" /> : null}
        </>
      ) : null}

      {/* Audyt 2 (P-53): w grupie osobistej nie ma kogo wybierać. */}
      {only || personal ? null : (
        <>
          <Segmented label={strings['event.audience']} value={form.audience} onChange={(audience) => set({ audience })} options={[{ value: 'group', label: strings['event.audience.group'] }, { value: 'members', label: strings['event.audience.members'] }]} />
          {/* Audyt 3 (N-46, Q13 C): „Wybrane osoby” to nie prywatność — mówimy to przy wyborze. */}
          {form.audience === 'members' ? <Body muted testID="event-audience-info">{strings['event.audienceInfo']}</Body> : null}
          {form.audience === 'members' ? (
            <PeopleToggles
              label={strings['event.who']}
              values={form.participantIds}
              onChange={(participantIds) => set({ participantIds })}
              options={members.map((m) => ({ value: m.member_id, label: m.display_name, a11y: strings['event.participantA11y'](m.display_name) }))}
            />
          ) : null}
        </>
      )}

      {adults.length ? (
        <PersonPicker
          label={strings['event.responsible']}
          value={form.responsibleId ?? ''}
          onChange={(v) => set({ responsibleId: v === '' ? null : v })}
          options={[{ value: '', label: strings['common.nobody'] }, ...adults.map((m) => ({ value: m.member_id, label: m.display_name }))]}
        />
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label={strings['event.save']} onPress={save} testID="event-save" />
    </Screen>
  );
}
