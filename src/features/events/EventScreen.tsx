/**
 * Wydarzenie (jedno wystąpienie): kiedy, gdzie w serii, kogo dotyczy. Zmiana i odwołanie w zakresie
 * „tylko to / to i następne / wszystkie” (D57); jednorazowe — po prostu zmiana albo usunięcie.
 * Zadania na to spotkanie (D13); przy odwołaniu pytanie, co z podpiętymi zadaniami (D14). „Dodaj do kalendarza” (D7).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { draftOf, withMark } from '../../app/device-calendar';
import type { RootStackParams } from '../../app/routes';
import { useTaskActions } from '../../app/task-actions';
import { addDays, formatIsoDate } from '../../domain/civil-date';
import type { NewOp } from '../../domain/sync-engine/client';
import { formatDue, formatLongDate, parseIsoDate } from '../../domain/format';
import { createList, inverseOps } from '../../domain/views/commands';
import { useUndo } from '../../ui/undo';
import { listsView } from '../../domain/views';
import { affectedByCancel, attachedTasks, createEventTask, nextOccurrence, type Relink, relinkOps, seriesCopiesCancelOps, upcomingInGroup } from '../../domain/views/event-tasks';
import { occurrenceOwner } from '../../domain/views/event-rows';
import { cancelEvent, describeRule, eventDetail, fieldsOf, lengthLabel, occurrenceState, restoreOccurrence, type Scope, timeLabel } from '../../domain/views/events';
import { createSeries, type SeriesDef, seriesOf, stopOps } from '../../domain/views/series-tasks';
import { cancelHandoff, createHandoff, handoffKey, handoffTargets, outgoingPending } from '../../domain/views/handoffs';
import { HandoffPicker } from '../handoffs/HandoffPicker';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, SectionTitle, Segmented, StationRow, SwipeRow, Title } from '../../ui/components';
import { TravelBox } from './TravelBox';
import { useTheme } from '../../ui/theme';
import { OccurrencePicker } from './OccurrencePicker';
import { RsvpBox } from './RsvpBox';
import { rsvpView } from '../../domain/views/rsvp';

type Props = NativeStackScreenProps<RootStackParams, 'Event'>;

const SCOPES: Scope[] = ['this', 'following', 'all'];

export function EventScreen({ route, navigation }: Props) {
  const { userId, store, newId, calendar } = useServices();
  const { tables, today } = useAppData();
  const { c, font, line } = useTheme();
  const actions = useTaskActions();
  const undo = useUndo();
  const { eventId: linked, date: linkedDate } = route.params;
  // Audyt 2: termin po „to i następne” należy do nowej serii — stary link (przypomnienie, inny ekran) prowadzi do niej.
  const eventId = useMemo(() => (linkedDate === undefined ? linked : occurrenceOwner(tables, linked, linkedDate)), [tables, linked, linkedDate]);
  const d = useMemo(() => eventDetail(tables, userId, eventId), [tables, userId, eventId]);
  const [ask, setAsk] = useState<'edit' | 'cancel' | null>(null);
  // M-239: z przesunięcia wiersza z podpiętymi zadaniami — od razu pytanie D14.
  const [relink, setRelink] = useState<{ scope: Scope; picking: boolean } | null>(route.params.cancel ? { scope: route.params.cancel, picking: false } : null);
  const [taskTitle, setTaskTitle] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [every, setEvery] = useState<'one' | 'all'>('one');
  const [handing, setHanding] = useState(false);
  const [handScope, setHandScope] = useState<'one' | 'series'>('one');
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const deviceCalendar = useDeviceCalendar();

  if (!d || d.event.deleted_at !== null) {
    return (
      <Screen testID="screen-event-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  // PWD-16: link do całej serii (powiadomienie o przypisaniu serii) — najbliższy termin od dziś, a gdy go nie ma — pierwszy.
  const date = linkedDate ?? nextOccurrence(tables, userId, eventId, formatIsoDate(addDays(today, -1))) ?? d.event.start_date;
  const occ = fieldsOf(d, date, 'this');
  const recurring = d.rule !== null;
  // Audyt 2 (E-18): odwołany albo nieistniejący termin — bez zadań, obecności, przekazania i dodawania do kalendarza.
  const state = occurrenceState(d, date);
  const active = state === 'active';
  // D120: godziny i długość („17:00–18:30 · 1 h 30 min”).
  const time = [timeLabel(occ.startTime, occ.endTime) ?? strings['event.allDayLabel'], lengthLabel(occ.startTime, occ.endTime)].filter(Boolean).join(' · ');
  // D70: przekazać mogę termin (albo całą serię, jeśli w niej to ja odpowiadam), za który odpowiadam.
  const myMember = d.members.find((m) => m.user_id === userId)?.member_id;
  const iAmResponsible = myMember !== undefined && occ.responsibleId === myMember;
  const seriesMine = d.event.responsible_member_id === myMember;
  const pending = outgoingPending(tables, userId);
  const waiting = pending.get(handoffKey('events', eventId, date)) ?? pending.get(handoffKey('events', eventId, null));
  const responsible = occ.responsibleId === null ? null : (d.members.find((m) => m.member_id === occ.responsibleId)?.display_name ?? null);
  const names = d.members.filter((m) => occ.participantIds.includes(m.member_id)).map((m) => m.display_name);
  const tasks = attachedTasks(tables, eventId, date);
  const rsvp = rsvpView(tables, userId, eventId, date);
  const defs = seriesOf(tables, eventId);
  const taskLists = listsView(tables, userId, d.event.group_id).filter((l) => l.kind === 'tasks');
  const chosenList = taskLists.find((l) => l.id === listId) ?? taskLists[0];

  const edit = (scope: Scope) => navigation.navigate('EventEdit', { eventId, date, scope });
  const finish = (scope: Scope, to: Relink | null) => {
    const affected = to ? affectedByCancel(tables, d, date, scope) : [];
    const ops = [...cancelEvent(d, date, scope), ...(to ? relinkOps(affected, to) : []), ...seriesCopiesCancelOps(tables, d, date, scope)];
    const back = inverseOps(tables, ops);
    store.dispatch(ops);
    // Pasek „Cofnij” jak przy zadaniach i listach (audyt 8.10.2026).
    // Audyt 2 (U-17): jednorazowe się usuwa, termin serii — odwołuje.
    if (back) undo.show(strings[d.rule === null ? 'undo.deleted' : 'undo.eventCancelled'](occ.title), () => store.dispatch(back), { changed: ops });
    navigation.goBack();
  };
  const stopSeries = (s: SeriesDef) => {
    const ops = stopOps(tables, s, today);
    // Same usunięcia (definicja i kopie), więc odwrotność zawsze istnieje.
    const back = inverseOps(tables, ops)!;
    store.dispatch(ops);
    undo.show(strings['undo.seriesStopped'](s.title), () => store.dispatch(back), { changed: ops });
  };
  // D14: przy podpiętych zadaniach najpierw pytanie, potem odwołanie i przepięcie w jednym zapisie.
  const cancel = (scope: Scope) => (affectedByCancel(tables, d, date, scope).length ? (setAsk(null), setRelink({ scope, picking: false })) : finish(scope, null));
  const addTask = () => {
    const title = taskTitle.trim();
    if (!title) return;
    const ops: NewOp[] = [];
    let list = chosenList?.id;
    if (!list) {
      // Grupa bez listy zadań: zakładamy listę „Zadania”, żeby zadanie miało gdzie trafić.
      list = newId();
      ops.push(createList({ id: list, groupId: d.event.group_id, kind: 'tasks', name: strings['event.defaultList'] }));
    }
    // D65: „na każde spotkanie” = definicja; kopie na najbliższe tygodnie dokłada SeriesFiller.
    ops.push(every === 'all' && recurring ? createSeries({ id: newId(), groupId: d.event.group_id, eventId, listId: list, title }) : createEventTask({ id: newId(), groupId: d.event.group_id, listId: list, eventId, occurrenceDate: date, title }));
    store.dispatch(ops);
    setTaskTitle('');
  };
  const inMirror = deviceCalendar.mirrorCalendar(eventId, date, occ.date);
  const addToCalendar = async () => {
    setCalendarMsg(null);
    // D173: znacznik w notatce — ta kopia nie pokaże się w aplikacji jako „moje wydarzenie” obok oryginału.
    const r = await calendar.add(draftOf(occ, withMark(d.groupName)));
    setCalendarMsg(r === 'saved' ? strings['event.calendarSaved'] : r === 'denied' ? strings['event.calendarDenied'] : null);
  };

  const next = relink?.scope === 'this' ? nextOccurrence(tables, userId, eventId, date) : null;
  const others = relink
    ? upcomingInGroup(tables, userId, d.event.group_id, formatIsoDate(today)).filter(
        (o) => !(o.eventId === eventId && (!recurring || relink.scope === 'all' || (relink.scope === 'this' ? o.occurrenceDate === date : o.occurrenceDate >= date))),
      )
    : [];

  return (
    <Screen testID="screen-event">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: line(d.line).line }} />
        <Text style={{ fontFamily: font.text700, fontSize: 15, color: line(d.line).ink }}>{d.groupName}</Text>
      </View>
      <Title>{occ.title}</Title>
      <Body>{`${formatLongDate(parseIsoDate(occ.date), today)} · ${time}`}</Body>
      {occ.date !== date ? <Body muted>{strings['event.moved'](formatLongDate(parseIsoDate(date), today))}</Body> : null}
      <Body muted>{d.rule ? describeRule(d.rule, parseIsoDate(d.event.start_date)) : strings['event.oneOff']}</Body>
      {state === 'cancelled' ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['event.cancelledInfo']}</Body>
          {d.canEdit ? <Button kind="secondary" label={strings['event.restore']} testID="event-restore" onPress={() => store.dispatch(restoreOccurrence(d, date))} /> : null}
        </View>
      ) : state === 'missing' ? (
        <Body>{strings['event.missingInfo']}</Body>
      ) : null}
      {d.event.location ? <TravelBox location={d.event.location} eventId={eventId} date={date} upcoming={active && occ.date >= formatIsoDate(today) && occ.startTime !== null} /> : null}
      <SectionTitle>{strings['event.who']}</SectionTitle>
      <Body>{d.event.audience === 'group' ? strings['event.whoAll'] : names.join(', ')}</Body>
      {responsible ? <Body>{strings['event.responsibleIs'](responsible)}</Body> : null}
      {iAmResponsible && d.canEdit && active ? (
        waiting ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['handoff.waiting'](waiting.otherName)}</Body>
            <Button kind="secondary" label={strings['handoff.cancel']} testID="handoff-cancel" onPress={() => store.dispatch(cancelHandoff(waiting.id))} />
          </View>
        ) : handing ? (
          <HandoffPicker
            targets={handoffTargets(tables, userId, d.event.group_id)}
            onPick={(m) => {
              store.dispatch(createHandoff({ id: newId(), groupId: d.event.group_id, entity: 'events', entityId: eventId, occurrenceDate: handScope === 'one' && recurring ? date : null, toMember: m.member_id }));
              setHanding(false);
            }}
            onCancel={() => setHanding(false)}
          >
            {recurring && seriesMine ? (
              <Segmented
                label={strings['handoff.scope']}
                value={handScope}
                onChange={setHandScope}
                options={[
                  { value: 'one', label: strings['handoff.scope.one'] },
                  { value: 'series', label: strings['handoff.scope.series'] },
                ]}
              />
            ) : null}
          </HandoffPicker>
        ) : (
          <Button kind="secondary" label={strings['handoff.give']} testID="handoff-start" onPress={() => setHanding(true)} />
        )
      ) : null}

      {/* D124: obecność na dzisiejszym i przyszłym terminie. */}
      {rsvp && active && occ.date >= formatIsoDate(today) ? <RsvpBox view={rsvp} eventId={eventId} date={date} /> : null}

      {/* PWD-2 (M-174): przy włączonym lustrze wydarzenie już jest w iPhonie — „Dodaj” zrobiłby nieaktualizowany dubel. */}
      {active ? inMirror ? <Body muted>{strings['event.inMirror'](inMirror)}</Body> : <Button kind="secondary" label={strings['event.addToCalendar']} testID="event-calendar" onPress={addToCalendar} /> : null}
      {calendarMsg ? <Body muted>{calendarMsg}</Body> : null}

      <SectionTitle>{strings['event.tasks']}</SectionTitle>
      {/* Audyt 2 (M-124): zadanie terminu przesuwa się do usunięcia jak na liście (dorośli, D34). */}
      {tasks.map((t) => (
        <SwipeRow key={t.id} title={t.title} enabled={d.canEdit} onDelete={() => actions.remove(t)} testID={`swipe-${t.id}`}>
          <StationRow
            testID={`event-task-${t.id}`}
            title={t.title}
            line={d.line}
            meta={[formatDue({ date: occ.date, time: occ.startTime }, today)]}
            checked={false}
            onToggle={() => actions.toggle(t)}
            onOpen={() => navigation.navigate('Task', { taskId: t.id })}
          />
        </SwipeRow>
      ))}
      {defs.length ? (
        <View style={{ gap: 8 }}>
          <Body muted>{strings['event.seriesTasks']}</Body>
          {defs.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: font.text600, fontSize: 16, color: c.ink }}>{s.title}</Text>
              {/* Audyt 2 (M-225, G-19): kończy stałe zadanie — czerwony i z „Cofnij” (D60), jak inne usuwanie. */}
              {d.canEdit ? <Button kind="danger" label={strings['event.seriesStop'](s.title)} testID={`series-stop-${s.id}`} onPress={() => stopSeries(s)} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      {d.canEdit && active ? (
        <View style={{ gap: 8 }}>
          {taskLists.length > 1 ? <Segmented label={strings['event.taskList']} value={chosenList!.id} onChange={setListId} options={taskLists.map((l) => ({ value: l.id, label: l.name }))} /> : null}
          {recurring ? (
            <Segmented
              label={strings['event.taskEvery']}
              value={every}
              onChange={setEvery}
              options={[
                { value: 'one', label: strings['event.taskEvery.one'] },
                { value: 'all', label: strings['event.taskEvery.all'] },
              ]}
            />
          ) : null}
          <Field label={strings['event.taskAdd']} value={taskTitle} onChangeText={setTaskTitle} onSubmitEditing={addTask} testID="event-task-title" />
          <Button kind="secondary" label={strings['event.taskAdd']} testID="event-task-add" onPress={addTask} />
        </View>
      ) : null}

      {!d.canEdit ? (
        <Body muted>{strings['event.readOnly']}</Body>
      ) : state === 'missing' ? null : relink ? (
        relink.picking ? (
          <OccurrencePicker items={others} today={today} onPick={(o) => finish(relink.scope, { kind: 'occurrence', eventId: o.eventId, occurrenceDate: o.occurrenceDate })} onCancel={() => setRelink({ ...relink, picking: false })} />
        ) : (
          <View style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
              {strings['event.relinkQuestion'](affectedByCancel(tables, d, date, relink.scope).length)}
            </Text>
            {next ? <Button kind="secondary" label={strings['event.relinkNext'](formatDue({ date: next, time: null }, today))} testID="relink-next" onPress={() => finish(relink.scope, { kind: 'occurrence', eventId, occurrenceDate: next })} /> : null}
            <Button kind="secondary" label={strings['event.relinkOther']} testID="relink-other" onPress={() => setRelink({ ...relink, picking: true })} />
            <Button kind="secondary" label={strings['event.relinkUnlink']} testID="relink-unlink" onPress={() => finish(relink.scope, { kind: 'unlink' })} />
            <Button kind="danger" label={strings['event.relinkDelete']} testID="relink-delete" onPress={() => finish(relink.scope, { kind: 'delete' })} />
            <Button kind="secondary" label={strings['common.cancel']} onPress={() => setRelink(null)} />
          </View>
        )
      ) : ask === 'edit' || ask === 'cancel' ? (
        <View style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {ask === 'edit' ? strings['event.scopeQuestionEdit'] : strings['event.scopeQuestionCancel']}
          </Text>
          {SCOPES.map((s) => (
            <Button key={s} kind={ask === 'cancel' ? 'danger' : 'secondary'} label={strings[`event.scope.${s}`]} testID={`scope-${s}`} onPress={() => (ask === 'edit' ? edit(s) : cancel(s))} />
          ))}
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(null)} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button label={strings['event.change']} testID="event-edit" onPress={() => (recurring ? setAsk('edit') : edit('all'))} />
          {/* D187 (audyt 2: PW-16 A, M-121): jednorazowe usuwa się bez pytania — pasek „Cofnij” i kosz; seria pyta o zakres (D57). */}
          <Button kind="danger" label={recurring ? strings['event.cancel'] : strings['event.delete']} testID="event-cancel" onPress={() => (recurring ? setAsk('cancel') : cancel('all'))} />
        </View>
      )}
    </Screen>
  );
}
