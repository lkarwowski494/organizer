/**
 * Zadanie: tytuł, notatka, termin (własny / bez terminu / jak nadrzędne — D15, D16), osoba,
 * podzadania (do MAX_TASK_DEPTH, D4), usunięcie z możliwością cofnięcia (kosz, R1 „nic nie ginie”).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { isValidDate , formatIsoDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { createTask, patchTask, remove, restore, setDue } from '../../domain/views/commands';
import { useTaskActions } from '../../app/task-actions';
import { asTask, listDetail, myMemberships, type TaskNode } from '../../domain/views';
import { asEvent, occurrenceResolver } from '../../domain/views/event-rows';
import { lacksAddressee } from '../../domain/views/addressee';
import { attachOps, relinkOps, upcomingInGroup } from '../../domain/views/event-tasks';
import { OccurrencePicker } from '../events/OccurrencePicker';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Checkbox, Field, Screen, SectionTitle, Segmented, StationRow, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Task'>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Walidacja pól terminu; zwraca błąd do pokazania albo termin. */
export function parseDueFields(date: string, time: string): { error: string } | { due: { date: string; time: string | null } } {
  const m = DATE.exec(date.trim());
  if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) return { error: strings['task.invalidDate'] };
  const t = time.trim();
  if (t !== '' && !TIME.test(t)) return { error: strings['task.invalidTime'] };
  return { due: { date: date.trim(), time: t === '' ? null : t } };
}

function find(nodes: TaskNode[], id: string): TaskNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = find(n.children, id);
    if (inner) return inner;
  }
  return undefined;
}

export function TaskScreen({ route, navigation }: Props) {
  const { userId, store, now, newId } = useServices();
  const actions = useTaskActions();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const raw = tables.tasks?.[route.params.taskId];
  const task = raw ? asTask(raw) : null;
  const detail = useMemo(() => (task ? listDetail(tables, userId, task.list_id, today) : null), [tables, userId, task?.list_id, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const node = detail && task ? (find([...detail.open, ...detail.done], task.id) ?? null) : null;
  const [title, setTitle] = useState(task?.title ?? '');
  const [note, setNote] = useState(task?.note ?? '');
  const [date, setDate] = useState(task?.due_date ?? '');
  const [time, setTime] = useState(task?.due_time?.slice(0, 5) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState('');
  const [picking, setPicking] = useState(false);

  if (!task || !detail) {
    return (
      <Screen testID="screen-task-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  if (task.deleted_at !== null) {
    return (
      <Screen testID="screen-task-deleted">
        <BackButton onPress={() => navigation.goBack()} />
        <Title>{strings['task.deleted']}</Title>
        <Button label={strings['task.restore']} onPress={() => store.dispatch(restore('tasks', task.id))} />
      </Screen>
    );
  }

  const depth = node?.depth ?? 0;
  // D13: podpięcie do wystąpienia spotkania; termin wystąpienia liczy resolver (null = odwołane / zmienione).
  const linked = task.event_id !== null && task.occurrence_date !== null;
  const linkedDue = linked ? occurrenceResolver(tables)(task.event_id!, task.occurrence_date!) : null;
  const linkedEvent = linked ? asEvent(tables.events?.[task.event_id!] ?? { id: task.event_id, group_id: task.group_id, start_date: task.occurrence_date }) : null;
  const canEdit = myMemberships(tables, userId).get(task.group_id)?.role !== 'child';
  const save = () => {
    if (title.trim() && title.trim() !== task.title) store.dispatch(patchTask(task.id, { title: title.trim() }));
    if ((note.trim() || null) !== task.note) store.dispatch(patchTask(task.id, { note: note.trim() || null }));
    if (date.trim() !== '') {
      const r = parseDueFields(date, time);
      if ('error' in r) return setError(r.error);
      if (r.due.date !== task.due_date || r.due.time !== (task.due_time?.slice(0, 5) ?? null) || task.deadline_mode !== 'own') store.dispatch(setDue(task.id, r.due));
    }
    setError(null);
    navigation.goBack();
  };
  const addSub = () => {
    const parsed = parseQuickAdd(sub, now());
    if (parsed.title.trim() === '') return;
    store.dispatch(createTask({ id: newId(), groupId: task.group_id, listId: task.list_id, parentId: task.id, parsed }));
    setSub('');
  };

  return (
    <Screen testID="screen-task">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Checkbox checked={task.completed_at !== null} onPress={() => actions.toggle(task)} label={task.completed_at ? strings['task.undone'] : strings['task.done']} />
        <Text style={{ flex: 1, fontFamily: font.text700, fontSize: 14, color: c.inkMuted }}>{`${detail.list.groupName} · ${detail.list.name}${node?.due ? ` · ${formatDue(node.due, today)}` : ''}`}</Text>
      </View>
      {lacksAddressee(tables, userId, task) ? <Text testID="task-no-addressee" style={{ fontFamily: font.text700, color: c.danger }}>{strings['task.noAddressee']}</Text> : null}
      <Field label={strings['task.title']} value={title} onChangeText={setTitle} testID="task-title" />
      <Field label={strings['task.note']} value={note} onChangeText={setNote} multiline testID="task-note" />
      <SectionTitle>{strings['task.due']}</SectionTitle>
      <Body muted>
        {task.deadline_mode === 'none'
          ? strings['task.dueNone']
          : task.deadline_mode === 'inherit'
            ? strings['task.dueInherit']
            : task.deadline_mode === 'event'
              ? `${strings['task.dueEvent']}${node?.due ? `: ${formatDue(node.due, today)}` : ''}`
              : formatDue({ date: task.due_date!, time: task.due_time }, today)}
      </Body>
      <Field label={strings['task.dueDate']} value={date} onChangeText={setDate} placeholder="2026-10-09" testID="task-date" />
      <Field label={strings['task.dueTime']} value={time} onChangeText={setTime} placeholder="17:30" testID="task-time" />
      {task.deadline_mode !== 'none' ? (
        <Button
          kind="secondary"
          label={strings['task.clearDue']}
          onPress={() => {
            if (lacksAddressee(tables, userId, { ...task, deadline_mode: 'none' })) return setError(strings['addressee.blocked']);
            store.dispatch(setDue(task.id, null));
            setDate('');
            setTime('');
          }}
        />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      {task.deadline_mode !== 'none' && !linked ? (
        <Segmented
          label={strings['task.rollover']}
          value={task.rollover ? 'roll' : 'day'}
          onChange={(v) => store.dispatch(patchTask(task.id, { rollover: v === 'roll' }))}
          options={[
            { value: 'roll', label: strings['task.rollover.roll'] },
            { value: 'day', label: strings['task.rollover.day'] },
          ]}
        />
      ) : null}
      {canEdit ? (
        <View style={{ gap: 8 }}>
          {linked ? (
            <>
              {linkedDue ? <Body>{strings['task.event'](linkedEvent?.title ?? '', formatDue(linkedDue, today))}</Body> : <Body>{strings['task.eventGone']}</Body>}
              {linkedDue ? <Button kind="secondary" label={strings['task.openEvent']} testID="task-open-event" onPress={() => navigation.navigate('Event', { eventId: task.event_id!, date: task.occurrence_date! })} /> : null}
              {task.deadline_mode !== 'event' && linkedDue ? <Button kind="secondary" label={strings['task.useEventDue']} testID="task-event-due" onPress={() => store.dispatch(attachOps(task, task.event_id!, task.occurrence_date!))} /> : null}
              <Button kind="secondary" label={strings['event.relinkOther']} testID="task-relink" onPress={() => setPicking(true)} />
              <Button kind="secondary" label={strings['task.detach']} testID="task-detach" onPress={() => store.dispatch(relinkOps([task], { kind: 'unlink' }))} />
            </>
          ) : (
            <Button kind="secondary" label={strings['task.attach']} testID="task-attach" onPress={() => setPicking(true)} />
          )}
          {picking ? (
            <OccurrencePicker
              items={upcomingInGroup(tables, userId, task.group_id, formatIsoDate(today))}
              today={today}
              onPick={(o) => {
                store.dispatch(linked ? relinkOps([task], { kind: 'occurrence', eventId: o.eventId, occurrenceDate: o.occurrenceDate }) : attachOps(task, o.eventId, o.occurrenceDate));
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : null}
        </View>
      ) : null}
      <Segmented
        label={strings['task.assignee']}
        value={task.assignee_member_id ?? ''}
        onChange={(v) => {
          if (v === '' && lacksAddressee(tables, userId, { ...task, assignee_member_id: null })) return setError(strings['addressee.blocked']);
          setError(null);
          store.dispatch(patchTask(task.id, { assignee_member_id: v === '' ? null : v }));
        }}
        options={[{ value: '', label: strings['task.assigneeNone'] }, ...detail.members.map((m) => ({ value: m.member_id, label: m.display_name }))]}
      />
      {depth < config.MAX_TASK_DEPTH ? (
        <View style={{ gap: 8 }}>
          <SectionTitle>{strings['task.subtasks']}</SectionTitle>
          {(node?.children ?? []).map((ch) => (
            <StationRow key={ch.id} testID={`sub-${ch.id}`} title={ch.title} line={detail.list.line} checked={ch.completed_at !== null} onToggle={() => actions.toggle(ch)} onOpen={() => navigation.push('Task', { taskId: ch.id })} />
          ))}
          <Field label={strings['task.addSubtask']} value={sub} onChangeText={setSub} onSubmitEditing={addSub} testID="task-sub" />
          <Button kind="secondary" label={strings['task.addSubtask']} onPress={addSub} />
        </View>
      ) : null}
      <Button label={strings['task.save']} onPress={save} testID="task-save" />
      <Button kind="danger" label={strings['task.delete']} onPress={() => store.dispatch(remove('tasks', task.id))} />
    </Screen>
  );
}

