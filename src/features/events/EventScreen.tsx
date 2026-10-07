/**
 * Wydarzenie (jedno wystąpienie): kiedy, gdzie w serii, kogo dotyczy. Zmiana i odwołanie w zakresie
 * „tylko to / to i następne / wszystkie” (D57); jednorazowe — po prostu zmiana albo usunięcie.
 * Zadania na to spotkanie (D13); przy odwołaniu pytanie, co z podpiętymi zadaniami (D14). „Dodaj do kalendarza” (D7).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { draftOf } from '../../app/device-calendar';
import type { RootStackParams } from '../../app/routes';
import { useTaskActions } from '../../app/task-actions';
import { formatIsoDate } from '../../domain/civil-date';
import type { NewOp } from '../../domain/sync-engine/client';
import { formatDue, formatLongDate, parseIsoDate } from '../../domain/format';
import { createList } from '../../domain/views/commands';
import { listsView } from '../../domain/views';
import { affectedByCancel, attachedTasks, createEventTask, nextOccurrence, type Relink, relinkOps, upcomingInGroup } from '../../domain/views/event-tasks';
import { cancelEvent, describeRule, eventDetail, fieldsOf, type Scope, timeLabel } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, SectionTitle, Segmented, StationRow, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { OccurrencePicker } from './OccurrencePicker';

type Props = NativeStackScreenProps<RootStackParams, 'Event'>;

const SCOPES: Scope[] = ['this', 'following', 'all'];

export function EventScreen({ route, navigation }: Props) {
  const { userId, store, newId, calendar } = useServices();
  const { tables, today } = useAppData();
  const { c, font, line } = useTheme();
  const actions = useTaskActions();
  const { eventId, date } = route.params;
  const d = useMemo(() => eventDetail(tables, userId, eventId), [tables, userId, eventId]);
  const [ask, setAsk] = useState<'edit' | 'cancel' | 'delete' | null>(null);
  const [relink, setRelink] = useState<{ scope: Scope; picking: boolean } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [listId, setListId] = useState<string | null>(null);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);

  if (!d || d.event.deleted_at !== null) {
    return (
      <Screen testID="screen-event-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const occ = fieldsOf(d, date, 'this');
  const recurring = d.rule !== null;
  const time = timeLabel(occ.startTime, occ.endTime) ?? strings['event.allDayLabel'];
  const names = d.members.filter((m) => occ.participantIds.includes(m.member_id)).map((m) => m.display_name);
  const tasks = attachedTasks(tables, eventId, date);
  const taskLists = listsView(tables, userId, d.event.group_id).filter((l) => l.kind === 'tasks');
  const chosenList = taskLists.find((l) => l.id === listId) ?? taskLists[0];

  const edit = (scope: Scope) => navigation.navigate('EventEdit', { eventId, date, scope });
  const finish = (scope: Scope, to: Relink | null) => {
    const affected = to ? affectedByCancel(tables, d, date, scope) : [];
    store.dispatch([...cancelEvent(d, date, scope, newId), ...(to ? relinkOps(affected, to) : [])]);
    navigation.goBack();
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
    ops.push(createEventTask({ id: newId(), groupId: d.event.group_id, listId: list, eventId, occurrenceDate: date, title }));
    store.dispatch(ops);
    setTaskTitle('');
  };
  const addToCalendar = async () => {
    setCalendarMsg(null);
    const r = await calendar.add(draftOf(occ, d.groupName));
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
      <SectionTitle>{strings['event.who']}</SectionTitle>
      <Body>{d.event.audience === 'group' ? strings['event.whoAll'] : names.join(', ')}</Body>

      <Button kind="secondary" label={strings['event.addToCalendar']} testID="event-calendar" onPress={addToCalendar} />
      {calendarMsg ? <Body muted>{calendarMsg}</Body> : null}

      <SectionTitle>{strings['event.tasks']}</SectionTitle>
      {tasks.map((t) => (
        <StationRow
          key={t.id}
          testID={`event-task-${t.id}`}
          title={t.title}
          line={d.line}
          meta={[formatDue({ date: occ.date, time: occ.startTime }, today)]}
          checked={false}
          onToggle={() => actions.toggle(t)}
          onOpen={() => navigation.navigate('Task', { taskId: t.id })}
        />
      ))}
      {d.canEdit ? (
        <View style={{ gap: 8 }}>
          {taskLists.length > 1 ? <Segmented label={strings['event.taskList']} value={chosenList!.id} onChange={setListId} options={taskLists.map((l) => ({ value: l.id, label: l.name }))} /> : null}
          <Field label={strings['event.taskAdd']} value={taskTitle} onChangeText={setTaskTitle} onSubmitEditing={addTask} testID="event-task-title" />
          <Button kind="secondary" label={strings['event.taskAdd']} testID="event-task-add" onPress={addTask} />
        </View>
      ) : null}

      {!d.canEdit ? (
        <Body muted>{strings['event.readOnly']}</Body>
      ) : relink ? (
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
      ) : ask === 'delete' ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['event.deleteConfirm']}</Body>
          <Button kind="danger" label={strings['event.delete']} testID="event-delete-confirm" onPress={() => cancel('all')} />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(null)} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button label={strings['event.change']} testID="event-edit" onPress={() => (recurring ? setAsk('edit') : edit('all'))} />
          <Button kind="danger" label={recurring ? strings['event.cancel'] : strings['event.delete']} testID="event-cancel" onPress={() => setAsk(recurring ? 'cancel' : 'delete')} />
        </View>
      )}
    </Screen>
  );
}
