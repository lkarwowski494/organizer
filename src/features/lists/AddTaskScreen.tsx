/**
 * Pełny formularz zadania (D90, ADR 0019): „Więcej” przy polu dodawania (wypełniony tym, co wpisałeś) i „Zmień” po
 * szybkim dodaniu (to samo zadanie). Rodzaj (zadanie albo wydarzenie, D98), grupa, dzień i godzina, osoba, powtarzanie;
 * bez wyboru listy (D97). Logika: domain/views/task-form.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text } from 'react-native';

import { useAdded } from '../../app/added';
import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { addDays, formatIsoDate, isValidDate } from '../../domain/civil-date';
import {
  type FormError,
  formFromTask,
  formFromText,
  formGroups,
  formMembers,
  formOps,
  formUnseen,
  formWeekday,
  movedSubtasks,
  pickCandidate,
  type TaskForm,
  validateForm,
} from '../../domain/views/task-form';
import { formatDue } from '../../domain/format';
import { strings } from '../../i18n/strings.pl';
import { AskPanel } from '../../ui/AskPanel';
import { BackButton, Body, Button, Field, Screen, Segmented, Title } from '../../ui/components';
import { TimeField } from '../../ui/TimeField';
import { DateField } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';
import { RepeatEditor } from './RepeatEditor';

type Props = NativeStackScreenProps<RootStackParams, 'AddTask'>;

const validDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

const ERRORS: Record<FormError, string> = {
  title: strings['form.error.title'],
  group: strings['form.error.group'],
  date: strings['task.invalidDate'],
  time: strings['task.invalidTime'],
  repeatNeedsDate: strings['form.error.repeatNeedsDate'],
};

export function AddTaskScreen({ route, navigation }: Props) {
  const { userId, store, now, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const editing = route.params.taskId;
  const added = useAdded();
  // Grupa z chipa przy polu (M-24), gdy tekst („#…”, „@…”) nie wskazuje innej.
  const [initial] = useState(() => formFromText(tables, userId, route.params.text ?? '', now(), { chipGroupId: route.params.defaultGroupId ?? null, personalLabel: strings['groups.personal'] }));
  const [form, setForm] = useState<TaskForm>(() => {
    const base = (editing ? formFromTask(tables, editing) : null) ?? initial.form;
    // Powrót z formularza wydarzenia (przełącznik rodzaju): to, co już wpisane.
    const p = route.params;
    return { ...base, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.date ? { date: p.date } : {}), ...(p.time ? { time: p.time } : {}), ...(p.groupId ? { groupId: p.groupId } : {}) };
  });
  const [error, setError] = useState<FormError | null>(null);
  // „@imię” pasujące do kilku osób (D91): pytanie jak w Moich sprawach, zamiast cicho zgubić wzmiankę (audyt 2, M-170).
  const [choices, setChoices] = useState(editing ? [] : initial.candidates);
  const set = (patch: Partial<TaskForm>) => (setForm((f) => ({ ...f, ...patch })), setError(null));
  const groups = formGroups(tables, userId);
  const members = formMembers(tables, form.groupId);
  const originalGroup = editing ? tables.tasks?.[editing]?.group_id : undefined;
  const subtasks = editing ? movedSubtasks(tables, editing) : 0;
  const day = (k: number) => formatIsoDate(addDays(today, k));
  const dateChoice = form.date === '' ? 'none' : form.date === day(0) ? 'today' : form.date === day(1) ? 'tomorrow' : 'other';

  const save = () => {
    const e = validateForm(tables, userId, form);
    if (e) return setError(e);
    const { ops } = formOps(tables, userId, form, newId, editing);
    // D189: nowe zadanie z formularza — „Dodano … · Cofnij”; zmiana istniejącego — bez paska (jak każda edycja).
    if (editing) store.dispatch(ops);
    else {
      const g = groups.find((x) => x.id === form.groupId);
      added(strings['form.added'](form.title.trim(), g?.kind === 'personal' ? strings['groups.personal'] : (g?.name ?? '')), ops);
    }
    navigation.goBack();
  };

  return (
    <Screen testID="screen-add-task">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{editing ? strings['form.editTitle'] : strings['form.newTitle']}</Title>
      {editing ? null : (
        // D98: zadanie albo wydarzenie — wydarzenie ma czas od–do, osobę odpowiedzialną i uczestników (osobny formularz).
        <Segmented
          label={strings['form.kind']}
          value="task"
          onChange={(k) => {
            // Audyt 2 (PWD-26): rutyna też stąd — nazwa i grupa przechodzą do jej formularza.
            if (k === 'routine') return navigation.replace('Routine', { groupId: form.groupId, title: form.title });
            if (k !== 'event') return;
            // Osoba zadania staje się odpowiedzialną za wydarzenie (formularz wydarzenia przyjmie tylko dorosłego, D66).
            const date = validDate(form.date) ? form.date : formatIsoDate(today);
            navigation.replace('EventEdit', { groupId: form.groupId, date, title: form.title, start: form.time || undefined, responsibleId: form.assigneeId ?? undefined });
          }}
          options={[
            { value: 'task', label: strings['form.kind.task'] },
            { value: 'event', label: strings['form.kind.event'] },
            { value: 'routine', label: strings['form.kind.routine'] },
          ]}
        />
      )}
      <Field label={strings['task.title']} value={form.title} onChangeText={(v) => set({ title: v })} testID="form-title" />
      {choices.length && initial.mention ? (
        <AskPanel
          testID="mention-choices"
          title={strings['mention.ask'](initial.mention)}
          options={choices.map((t) => ({ key: `${t.groupId}-${t.memberId}`, label: strings['mention.pick'](t.displayName, t.groupName), onPress: () => (setForm((f) => pickCandidate(f, initial.mention!, t)), setChoices([]), setError(null)) }))}
          onCancel={() => setChoices([])}
        />
      ) : null}
      <Segmented
        label={strings['form.group']}
        value={form.groupId}
        onChange={(g) => set({ groupId: g, assigneeId: null })}
        options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))}
      />
      {originalGroup && originalGroup !== form.groupId ? <Body muted>{subtasks ? strings['form.movedWithSubtasks'](subtasks) : strings['form.moved']}</Body> : null}
      <Segmented
        label={strings['task.due']}
        value={dateChoice}
        onChange={(v) => set(v === 'none' ? { date: '', time: '', repeat: null } : v === 'today' ? { date: day(0) } : v === 'tomorrow' ? { date: day(1) } : {})}
        options={[
          { value: 'none', label: strings['form.noDate'] },
          { value: 'today', label: strings['form.today'] },
          { value: 'tomorrow', label: strings['form.tomorrow'] },
          // Audyt 2 (U-24): dzień słownie, nie „2026-10-09”.
          ...(dateChoice === 'other' ? [{ value: 'other', label: formatDue({ date: form.date, time: null }, today) }] : []),
        ]}
      />
      <DateField label={strings['task.dueDate']} value={form.date} onChange={(v) => set({ date: v })} today={today} testID="form-date" />
      <TimeField label={strings['task.dueTime']} value={form.time} onChange={(v) => set({ time: v })} testID="form-time" optional />
      <Segmented
        label={strings['task.assignee']}
        value={form.assigneeId ?? ''}
        onChange={(v) => set({ assigneeId: v === '' ? null : v })}
        options={[{ value: '', label: strings['task.assigneeNone'] }, ...members.map((m) => ({ value: m.member_id, label: m.display_name }))]}
      />
      {form.date ? <RepeatEditor value={form.repeat} weekday={formWeekday(form, today)} onChange={(r) => set({ repeat: r })} /> : <Body muted>{strings['repeat.needsDue']}</Body>}
      {/* D68 po decyzji właściciela z 8.10.2026 (PW-18 b): bez osoby i terminu zapis przechodzi, z dopiskiem jak na ekranie zadania. */}
      {formUnseen(tables, userId, form) ? <Text testID="form-no-addressee" style={{ fontFamily: font.text700, color: c.danger }}>{strings['task.noAddressee']}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>
          {ERRORS[error]}
        </Text>
      ) : null}
      <Button label={strings['form.save']} onPress={save} testID="form-save" />
      <Button kind="secondary" label={strings['common.cancel']} onPress={() => navigation.goBack()} />
    </Screen>
  );
}
