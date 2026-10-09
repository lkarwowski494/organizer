/**
 * Zadanie — jedyny ekran zmiany zadania (decyzja właściciela 8.10.2026, D178 / PW-19 A; „Zmień” po szybkim dodaniu też
 * tu prowadzi): tytuł, notatka, termin (Dziś / Jutro / Inny dzień / Bez terminu, a w podzadaniu też „Jak zadanie
 * nadrzędne” — D15, D16; audyt 2: M-204, M-245), osoba, przeniesienie do innej grupy (task-move.ts), podzadania
 * (do MAX_TASK_DEPTH, D4), usunięcie z paskiem „Cofnij” (kosz, R1 „nic nie ginie”).
 * D130: każda zmiana zapisuje się od razu — bez „Zapisz” i „Anuluj” (PWD-6): tytuł i notatka po wyjściu z pola
 * (ui/live-text), termin po wyborze dnia albo poprawnej godziny.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { formatIsoDate, isValidDate } from '../../domain/civil-date';
import { formatDue, parseIsoDate } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { createTask, inheritDue, patchTask, restore, setDue } from '../../domain/views/commands';
import { useTaskActions } from '../../app/task-actions';
import { asTask, checkOff, listDetail, myMemberships, type TaskNode } from '../../domain/views';
import { asEvent, occurrenceResolver } from '../../domain/views/event-rows';
import { lacksAddressee } from '../../domain/views/addressee';
import { cancelHandoff, createHandoff, handoffKey, handoffTargets, outgoingPending } from '../../domain/views/handoffs';
import { HandoffPicker } from '../handoffs/HandoffPicker';
import { cycleChange, keepCycle, type Repeat, repeatOf, setRepeat } from '../../domain/views/task-repeat';
import { moveTargets, moveTaskOps } from '../../domain/views/task-move';
import { taskHistory } from '../../domain/views/history';
import { personOf } from '../../domain/views/who';
import { RepeatEditor } from './RepeatEditor';
import { TaskHistory } from './TaskHistory';
import { attachOps, relinkOps, upcomingInGroup } from '../../domain/views/event-tasks';
import { OccurrencePicker } from '../events/OccurrencePicker';
import { strings } from '../../i18n/strings.pl';
import { useClosedPanel } from '../../ui/a11y';
import { AskPanel } from '../../ui/AskPanel';
import { BackButton, Body, Button, Checkbox, ErrorText, Field, GroupLine, META_SEP, MissingScreen, QuickAddField, Screen, SectionTitle, Segmented, StationRow, SwipeRow, Title } from '../../ui/components';
import { DueFields } from '../../ui/DueFields';
import { useLiveText } from '../../ui/live-text';
import { QuickAddExtras } from '../../ui/QuickAddExtras';
import { PersonPicker } from '../../ui/PersonPicker';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';

type Props = NativeStackScreenProps<RootStackParams, 'Task'>;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Walidacja pól terminu; zwraca błąd do pokazania albo termin. */
export function parseDueFields(date: string, time: string): { error: string } | { due: { date: string; time: string | null } } {
  const m = DATE.exec(date.trim());
  if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) return { error: strings['event.error.date'] };
  const t = time.trim();
  if (t !== '' && !TIME.test(t)) return { error: strings['event.error.time'] };
  return { due: { date: date.trim(), time: t === '' ? null : t } };
}

/** Pola terminu, które edytuję (brak klucza = pole pokazuje dane). */
type Edits = { date?: string; time?: string };

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
  const undo = useUndo();
  const { tables, today, state } = useAppData();
  const { c, font, size } = useTheme();
  const raw = tables.tasks?.[route.params.taskId];
  const task = raw ? asTask(raw) : null;
  const detail = useMemo(() => (task ? listDetail(tables, userId, task.list_id, today) : null), [tables, userId, task?.list_id, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingIds = useMemo(() => new Set(state.pending.filter((op) => op.seq > state.ackedSeq).flatMap((op) => ('id' in op ? [op.id] : []))), [state]);
  const node = detail && task ? (find([...detail.open, ...detail.done], task.id) ?? null) : null;
  const editable = task !== null && task.deleted_at === null && myMemberships(tables, userId).get(task.group_id)?.role !== 'child';
  // D130 + audyt 2 (T-22, M-202): tytuł i notatka podążają za danymi, dopóki ich nie edytuję; zapis tylko zmienionych.
  // Pusty tytuł się nie zapisuje — pole wraca do zapisanego z komunikatem; pusta notatka = bez notatki.
  const title = useLiveText(task?.title ?? '', (v) => editable && store.dispatch(patchTask(task!.id, { title: v })), { empty: strings['form.error.title'] });
  const note = useLiveText(task?.note ?? '', (v) => editable && store.dispatch(patchTask(task!.id, { note: v || null })), { allowEmpty: true });
  // Termin: pole podąża za danymi, dopóki go nie zmieniam (T-22) — zmieniona część z pola, druga z danych.
  const [edit, setEdit] = useState<Edits>({});
  const [error, setError] = useState<string | null>(null);
  // D181: nowy dzień zadania powtarzanego zmieniający cykl — pytanie „Tylko ten raz / Też kolejne”.
  const [cycleAsk, setCycleAsk] = useState<{ due: { date: string; time: string | null }; next: Repeat } | null>(null);
  const [sub, setSub] = useState('');
  const [subIgnore, setSubIgnore] = useState<{ start: number; end: number }[]>([]);
  const [subError, setSubError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [handing, setHanding] = useState(false);
  const [moving, setMoving] = useState(false);
  // Audyt 3 (N-62): po zamknięciu panelu fokus VoiceOvera wraca na przycisk, który go otworzył; po pytaniu o cykl — na dzień.
  const handBack = useClosedPanel(handing) !== null;
  const moveBack = useClosedPanel(moving) !== null;
  const [dueFocus, setDueFocus] = useState(0);
  const closeCycle = () => (setCycleAsk(null), setDueFocus((k) => k + 1));

  if (!task || !detail) {
    return (
      <MissingScreen testID="screen-task-missing" text={strings['missing.task']} onBack={() => navigation.goBack()} />
    );
  }
  // Usunięte gdzie indziej albo otwarte z linku do usuniętego (z tego ekranu usunięcie wraca z paskiem „Cofnij”, M-254).
  if (task.deleted_at !== null) {
    return (
      <Screen testID="screen-task-deleted">
        <BackButton onPress={() => navigation.goBack()} />
        <Title>{strings['task.deleted']}</Title>
        <Button label={strings['task.restore']} onPress={() => store.dispatch(restore('tasks', task.id))} />
      </Screen>
    );
  }

  const cur = { date: task.deadline_mode === 'own' ? (task.due_date ?? '') : '', time: task.deadline_mode === 'own' ? (task.due_time?.slice(0, 5) ?? '') : '' };
  const shown = (k: keyof Edits) => edit[k] ?? cur[k];
  const depth = node?.depth ?? 0;
  // D13: podpięcie do wystąpienia spotkania; termin wystąpienia liczy resolver (null = odwołane / zmienione).
  const linked = task.event_id !== null && task.occurrence_date !== null;
  const linkedDue = linked ? occurrenceResolver(tables)(task.event_id!, task.occurrence_date!) : null;
  const linkedEvent = linked ? asEvent(tables.events?.[task.event_id!] ?? { id: task.event_id, group_id: task.group_id, start_date: task.occurrence_date }) : null;
  const membership = myMemberships(tables, userId).get(task.group_id);
  const canEdit = membership?.role !== 'child';
  const canCheck = checkOff(tables, userId);
  // D70: zadanie „na mnie” mogę przekazać; do przyjęcia widać, na kogo czeka.
  const mine = task.assignee_member_id !== null && task.assignee_member_id === membership?.member_id;
  const waiting = outgoingPending(tables, userId).get(handoffKey('tasks', task.id, null));
  const repeat = task.parent_id === null ? repeatOf(tables, task.id) : null;
  // D178: przeniesienie zadania głównego do innej grupy (z podzadaniami); w trakcie przekazania — po jego zakończeniu.
  const targets = canEdit && task.parent_id === null && !waiting ? moveTargets(tables, userId, task) : [];

  const writeDue = (due: { date: string; time: string | null }, r: Repeat | null) => {
    store.dispatch([setDue(task.id, due), ...(r ? [setRepeat(task.id, r, due.date)] : [])]);
  };
  const changeDue = (patch: Edits) => {
    const next = { ...edit, ...patch };
    const d = next.date ?? cur.date;
    const t = next.time ?? cur.time;
    setEdit(next);
    // Bez dnia godziny nie ma (pole godziny jest wtedy nieaktywne, M-89).
    if (d.trim() === '') return;
    const r = parseDueFields(d, t);
    if ('error' in r) return setError(r.error);
    setError(null);
    setEdit({});
    const same = task.deadline_mode === 'own' && r.due.date === task.due_date && r.due.time === (task.due_time?.slice(0, 5) ?? null);
    if (same) return;
    const old = task.deadline_mode === 'own' ? task.due_date : null;
    const changed = old ? cycleChange(repeat, old, r.due.date) : null;
    if (changed) return setCycleAsk({ due: r.due, next: changed });
    writeDue(r.due, old ? keepCycle(repeat, old) : null);
  };
  const noDue = () => {
    // D68 po decyzji właściciela z 8.10.2026 (PW-18 b): bez terminu i osoby też wolno — wtedy dopisek task.noAddressee.
    setEdit({});
    setError(null);
    if (task.deadline_mode !== 'none') store.dispatch(setDue(task.id, null));
  };
  const inherit = () => {
    setEdit({});
    setError(null);
    if (task.deadline_mode !== 'inherit') store.dispatch(inheritDue(task.id));
  };
  // Podzadanie dodaje się jak w polu dodawania (M-244): rozpoznane fragmenty to chipy do odklikania.
  const subParsed = parseQuickAdd(sub, now(), { ignore: subIgnore });
  const addSub = () => {
    if (sub.trim() === '') return;
    if (subParsed.title.trim() === '') return setSubError(strings['form.error.title']);
    store.dispatch(createTask({ id: newId(), groupId: task.group_id, listId: task.list_id, parentId: task.id, parsed: subParsed }));
    setSub('');
    setSubIgnore([]);
    setSubError(null);
  };
  const whoOf = (memberId: string | null) => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings['who.task'](p)] : [];
  };
  const groupLine = [detail.list.name, ...(node?.due ? [formatDue(node.due, today)] : [])].join(META_SEP);
  const groupName = (g: { kind: string; name: string }) => (g.kind === 'personal' ? strings['groups.personal'] : g.name);

  return (
    <Screen testID="screen-task">
      <BackButton onPress={() => navigation.goBack()} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* PW-14 B: dziecko z kontem odhacza tylko swoje sprawy (serwer: forbidden:not_own). */}
        {canCheck(task) ? <Checkbox checked={task.completed_at !== null} onPress={() => actions.toggle(task)} label={`${task.completed_at ? strings['task.undone'] : strings['task.done']}: ${task.title}`} /> : null}
        {/* M-146: nagłówek ekranu dla VoiceOvera to nazwa zadania (z grupą i listą); wygląd bez zmian. */}
        <GroupLine flex name={detail.list.groupName} line={detail.list.line} detail={groupLine} header={`${task.title}, ${detail.list.groupName}, ${groupLine.split(META_SEP).join(', ')}`} />
      </View>
      {lacksAddressee(tables, userId, task) ? <Text testID="task-no-addressee" style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>{strings['task.noAddressee']}</Text> : null}
      {/* Dziecko (D34) tylko odhacza: bez pól, które serwer i tak odrzuci. */}
      {canEdit ? (
        <>
          <Field label={strings['task.title']} {...title.field} maxLength={config.lengths.TASK_TITLE} testID="task-title" />
          {title.error ? <ErrorText>{title.error}</ErrorText> : null}
          <Field label={strings['task.note']} {...note.field} onSubmitEditing={undefined} multiline testID="task-note" />
        </>
      ) : (
        <>
          <Text style={{ fontFamily: font.text700, fontSize: size.DETAIL, color: c.ink }}>{task.title}</Text>
          {task.note ? <Body>{task.note}</Body> : null}
        </>
      )}
      <SectionTitle>{strings['task.due']}</SectionTitle>
      <Body muted>
        {task.deadline_mode === 'none'
          ? strings['task.dueNone']
          : task.deadline_mode === 'inherit'
            ? `${strings['task.dueInherit']}${node?.due ? `: ${formatDue(node.due, today)}` : ''}`
            : task.deadline_mode === 'event'
              ? `${strings['task.dueEvent']}${node?.due ? `: ${formatDue(node.due, today)}` : ''}`
              : formatDue({ date: task.due_date!, time: task.due_time }, today)}
      </Body>
      {canEdit ? (
        <DueFields
          date={shown('date')}
          time={shown('time')}
          onDate={(d) => (d === '' ? noDue() : changeDue({ date: d }))}
          onTime={(t) => changeDue({ time: t })}
          today={today}
          testID="task"
          focusDate={dueFocus}
          extra={task.parent_id !== null ? { label: strings['task.dueInherit'], selected: task.deadline_mode === 'inherit' && edit.date === undefined, onPress: inherit } : undefined}
        />
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {cycleAsk ? (
        <AskPanel
          testID="cycle-ask"
          title={strings['repeat.cycleAsk']}
          options={[
            { key: 'once', label: strings['repeat.cycleOnce'], onPress: () => (writeDue(cycleAsk.due, keepCycle(repeat, task.due_date!)), closeCycle()) },
            { key: 'all', label: strings['repeat.cycleAll'], onPress: () => (writeDue(cycleAsk.due, cycleAsk.next), closeCycle()) },
          ]}
          onCancel={closeCycle}
        />
      ) : null}
      {canEdit && task.deadline_mode !== 'none' && !linked ? (
        // M-81: podzadanie z terminem nadrzędnego przechodzi albo mija razem z nim — przełącznik nic by nie zmienił.
        task.deadline_mode === 'inherit' ? (
          <Body muted>{strings['task.rolloverInherit']}</Body>
        ) : (
          <Segmented
            label={strings['task.rollover']}
            value={task.rollover ? 'roll' : 'day'}
            onChange={(v) => store.dispatch(patchTask(task.id, { rollover: v === 'roll' }))}
            options={[
              { value: 'roll', label: strings['task.rollover.roll'] },
              { value: 'day', label: strings['task.rollover.day'] },
            ]}
          />
        )
      ) : null}
      {canEdit && !linked && task.parent_id === null ? (
        task.deadline_mode === 'own' && task.due_date ? (
          <>
            <RepeatEditor value={repeat} date={parseIsoDate(task.due_date)} onChange={(r) => store.dispatch(setRepeat(task.id, r, task.due_date))} />
            {repeat ? <Body muted>{strings['repeat.info']}</Body> : null}
          </>
        ) : (
          <Body muted>{strings['form.error.repeatNeedsDate']}</Body>
        )
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
      {canEdit ? (
        <View style={{ gap: 6 }}>
          <PersonPicker
            label={strings['task.assignee']}
            value={task.assignee_member_id ?? ''}
            onChange={(v) => {
              setError(null);
              store.dispatch(patchTask(task.id, { assignee_member_id: v === '' ? null : v }));
            }}
            options={[{ value: '', label: strings['common.nobody'] }, ...detail.members.map((m) => ({ value: m.member_id, label: m.display_name }))]}
          />
          {/* D180 (PW-21 B): obie drogi zostają — opis różnicy przy polu. */}
          <Body muted>{strings['task.assigneeHint']}</Body>
        </View>
      ) : null}
      {mine && canEdit ? (
        waiting ? (
          <View style={{ gap: 8 }}>
            <Body>{strings['handoff.waiting'](waiting.otherName)}</Body>
            <Button kind="secondary" label={strings['handoff.cancel']} testID="handoff-cancel" onPress={() => store.dispatch(cancelHandoff(waiting.id))} a11yFocus={handBack} />
          </View>
        ) : handing ? (
          <HandoffPicker
            targets={handoffTargets(tables, userId, task.group_id, task.list_id)}
            onPick={(m) => {
              store.dispatch(createHandoff({ id: newId(), groupId: task.group_id, entity: 'tasks', entityId: task.id, toMember: m.member_id }));
              setHanding(false);
            }}
            onCancel={() => setHanding(false)}
          />
        ) : task.completed_at === null ? (
          // Zrobionego nie ma czego przekazywać (serwer: „nieaktualne”); powtarzane przekazuje się od następnego terminu.
          <Button kind="secondary" label={strings['handoff.giveTask']} testID="handoff-start" onPress={() => setHanding(true)} a11yFocus={handBack} />
        ) : null
      ) : null}
      {targets.length ? (
        moving ? (
          <AskPanel
            testID="move-groups"
            title={strings['task.moveAsk']}
            body={strings['task.moveInfo']}
            options={targets.map((g) => ({
              key: g.id,
              label: groupName(g),
              onPress: () => {
                const r = moveTaskOps(tables, userId, task.id, g.id, newId)!;
                title.drop();
                note.drop();
                store.dispatch(r.ops);
                // Jak po usunięciu: powrót z paskiem „Cofnij” (wpisy wracają z paskiem — M-246).
                navigation.goBack();
                undo.show(strings['task.moved'](task.title, groupName(g)), { ops: r.undo }, { changed: r.ops });
              },
            }))}
            onCancel={() => setMoving(false)}
          />
        ) : (
          <Button kind="secondary" label={strings['task.move']} testID="task-move" onPress={() => setMoving(true)} a11yFocus={moveBack} />
        )
      ) : null}
      {depth < config.MAX_TASK_DEPTH ? (
        <View style={{ gap: 8 }}>
          <SectionTitle>{strings['task.subtasks']}</SectionTitle>
          {/* M-251: ta sama linia opisu co na liście — termin, osoba, „czeka na wysłanie”. */}
          {(node?.children ?? []).map((ch) => (
            // Audyt 2 (M-124): podzadanie przesuwa się do usunięcia jak na liście (dorośli, D34).
            <SwipeRow key={ch.id} title={ch.title} enabled={canEdit} onDelete={() => actions.remove(ch)} testID={`swipe-${ch.id}`}>
              <StationRow
                testID={`sub-${ch.id}`}
                title={ch.title}
                line={detail.list.line}
                meta={[...(ch.due ? [formatDue(ch.due, today)] : []), ...(ch.expired ? [strings['lists.expired']] : []), ...whoOf(ch.assignee_member_id)]}
                pending={pendingIds.has(ch.id)}
                checked={ch.completed_at !== null}
                onToggle={canCheck(ch) ? () => actions.toggle(ch) : undefined}
                onOpen={() => navigation.push('Task', { taskId: ch.id })}
              />
            </SwipeRow>
          ))}
          {canEdit ? (
            <QuickAddField value={sub} onChangeText={(v) => (setSub(v), setSubIgnore([]), setSubError(null))} onSubmit={addSub} placeholder={strings['task.addSubtask']}>
              <QuickAddExtras preview={{ tokens: subParsed.tokens, event: false, unrecognizedDay: subParsed.unrecognizedDay }} error={subError} onUnclick={(t) => setSubIgnore([...subIgnore, { start: t.start, end: t.end }])} />
            </QuickAddField>
          ) : null}
        </View>
      ) : null}
      {canEdit ? (
        <Button
          kind="danger"
          label={strings['task.delete']}
          testID="task-delete"
          onPress={() => {
            // M-254: jak przesunięcie na liście — kosz, powrót i pasek „Cofnij”.
            title.drop();
            note.drop();
            actions.remove(task);
            navigation.goBack();
          }}
        />
      ) : null}
      <TaskHistory entries={taskHistory(tables, task.id, config.HISTORY_LIMIT)} today={today} />
    </Screen>
  );
}
