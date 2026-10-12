/**
 * Formularz nowego zadania (D90, ADR 0019): „Więcej” przy polu dodawania, wypełniony tym, co wpisałeś. Rodzaj (zadanie
 * albo wydarzenie, D98), grupa, termin (jak wszędzie: Dziś / Jutro / Inny dzień / Bez terminu, M-245), osoba,
 * powtarzanie; bez wyboru listy (D97). Logika: domain/views/task-form.
 * Zmiana istniejącego zadania to ekran zadania (D178). Bez „Anuluj” (PWD-6) — gest i „Wróć” wystarczą, a wpisane pola
 * zostają w szkicu na telefonie (D179, app/form-draft).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, type TextInput } from 'react-native';

import { useAdded } from '../../app/added';
import { useAppData, useServices } from '../../app/context';
import { DraftNote, useAnnounce, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { config } from '../../config';
import { formatIsoDate, isValidDate } from '../../domain/civil-date';
import { namesOf, sanitizeTaskDraft } from '../../domain/views/form-choices';
import { type FormError, formDate, formDateChange, formFromText, formGroups, formMembers, formOps, formUnseen, pickCandidate, type TaskForm, validateForm } from '../../domain/views/task-form';
import { strings } from '../../i18n/strings.pl';
import { useA11yFocus, useClosedPanel } from '../../ui/a11y';
import { AskPanel } from '../../ui/AskPanel';
import { BackButton, Body, Button, ErrorText, Field, Screen, Segmented, Title, useFormError } from '../../ui/components';
import { DueFields } from '../../ui/DueFields';
import { PersonPicker } from '../../ui/PersonPicker';
import { useTheme } from '../../ui/theme';
import { RepeatEditor } from './RepeatEditor';

type Props = NativeStackScreenProps<RootStackParams, 'AddTask'>;

const validDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

const ERRORS: Record<Exclude<FormError, 'assignee'>, string> = {
  title: strings['form.error.title'],
  titleLong: strings['common.maxLength'](config.lengths.TASK_TITLE),
  group: strings['form.error.group'],
  date: strings['event.error.date'],
  time: strings['event.error.time'],
  repeatNeedsDate: strings['form.error.repeatNeedsDate'],
};

export function AddTaskScreen({ route, navigation }: Props) {
  const { userId, now, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font, size } = useTheme();
  const p = route.params;
  const added = useAdded();
  // Grupa z chipa przy polu (M-24), gdy tekst („#…”, „@…”) nie wskazuje innej.
  const [initial] = useState(() => formFromText(tables, userId, p.text ?? '', now(), { chipGroupId: p.defaultGroupId ?? null, personalLabel: strings['groups.personal'] }));
  // Powrót z formularza wydarzenia (przełącznik rodzaju): to, co już wpisane.
  const [form, setForm] = useState<TaskForm>(() => ({ ...initial.form, ...(p.title !== undefined ? { title: p.title } : {}), ...(p.date ? { date: p.date } : {}), ...(p.time ? { time: p.time } : {}), ...(p.groupId ? { groupId: p.groupId } : {}) }));
  const [error, setError, attempt] = useFormError<FormError>();
  // „@imię” pasujące do kilku osób (D91): pytanie jak w Moich sprawach, zamiast cicho zgubić wzmiankę (audyt 2, M-170).
  const [choices, setChoices] = useState(initial.candidates);
  // Audyt 3 (N-62): po odpowiedzi albo „Anuluj” w pytaniu „Kogo masz na myśli?” fokus VoiceOvera wraca do tytułu.
  const asked = useClosedPanel(choices.length > 0) !== null;
  const titleRef = useA11yFocus<TextInput>(choices.length, asked && choices.length === 0);
  const set = (patch: Partial<TaskForm>) => (setForm((f) => ({ ...f, ...patch })), setError(null));
  // D179: szkic na telefonie. Formularz z wpisanym tekstem startuje z tego tekstu (szkicu nie przywraca).
  const prefilled = (p.text ?? '').trim() !== '' || p.title !== undefined || p.kindSwitch === true;
  // Audyt 3: przywrócony szkic bez grupy, osoby i dnia, których już nie ma (N-32, N-144); pola przeniesione przełącznikiem
  // „Rodzaj” to zmiany względem pustego formularza — „Wróć” ich nie gubi (N-138).
  const draft = useFormDraft('task:new', form, Object.fromEntries(Object.keys(form).map((k) => [k, (v: unknown) => set({ [k]: v })])) as { [K in keyof TaskForm]: (v: TaskForm[K]) => void }, {
    restore: !prefilled,
    initial: p.kindSwitch ? initial.form : undefined,
    sanitize: (d, init) => sanitizeTaskDraft(tables, userId, today, d, init),
  });
  // M-255: po przełączeniu rodzaju VoiceOver słyszy, w jakim formularzu jest.
  useAnnounce(p.kindSwitch ? strings['form.newTitle'] : null);
  const groups = formGroups(tables, userId);
  const members = formMembers(tables, form.groupId);
  const [initialEmpty] = useState(() => form.title === '');

  const save = () => {
    const e = validateForm(tables, userId, form);
    if (e) return setError(e);
    draft.saved();
    // D189: nowe zadanie z formularza — „Dodano … · Cofnij”.
    const g = groups.find((x) => x.id === form.groupId);
    added(strings['form.added'](form.title.trim(), g?.kind === 'personal' ? strings['groups.personal'] : (g?.name ?? '')), formOps(tables, userId, form, newId).ops);
    navigation.goBack();
  };

  return (
    <Screen testID="screen-add-task">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['form.newTitle']}</Title>
      <DraftNote draft={draft} />
      {/* D98: zadanie, wydarzenie albo rutyna (PWD-26) — wpisane nazwa, dzień, godzina, grupa i osoba przechodzą. */}
      <Segmented
        label={strings['form.kind']}
        value="task"
        onChange={(k) => {
          if (k === 'task') return;
          // Wpisane pola przechodzą do innego formularza — szkic zadania nie jest już potrzebny.
          draft.saved();
          if (k === 'routine') return navigation.replace('Routine', { groupId: form.groupId, title: form.title, kindSwitch: true });
          // Dorosły z „Dla kogo” staje się odpowiedzialnym (D66), dziecko — uczestnikiem, jak w szybkim dodaniu (M-255).
          const date = validDate(form.date) ? form.date : formatIsoDate(today);
          const child = form.assigneeId !== null && tables.group_members?.[form.assigneeId]?.role === 'child';
          navigation.replace('EventEdit', {
            groupId: form.groupId,
            date,
            title: form.title,
            start: form.time || undefined,
            ...(child ? { participantIds: [form.assigneeId!] } : { responsibleId: form.assigneeId ?? undefined }),
            kindSwitch: true,
          });
        }}
        options={[
          { value: 'task', label: strings['form.kind.task'] },
          { value: 'event', label: strings['form.kind.event'], hint: strings['form.kind.eventHint'] },
          { value: 'routine', label: strings['form.kind.routine'], hint: strings['form.kind.routineHint'] },
        ]}
      />
      {/* M-247: kursor w pierwszym polu, gdy formularz jest pusty (z „Więcej” tekst już jest). */}
      {/* Audyt 3 (N-134): limit z SQL. */}
      <Field ref={titleRef} label={strings['task.title']} value={form.title} onChangeText={(v) => set({ title: v })} autoFocus={initialEmpty} maxLength={config.lengths.TASK_TITLE} returnKeyType="done" testID="form-title" />
      {choices.length && initial.mention ? (
        <AskPanel
          testID="mention-choices"
          title={strings['mention.ask'](initial.mention)}
          options={choices.map((t) => ({ key: `${t.groupId}-${t.memberId}`, label: strings['mention.pick'](t.displayName, t.groupName), onPress: () => (setForm((f) => pickCandidate(f, initial.mention!, t)), setChoices([]), setError(null)) }))}
          onCancel={() => setChoices([])}
        />
      ) : null}
      <Segmented
        label={strings['common.group']}
        value={form.groupId}
        onChange={(g) => set({ groupId: g, assigneeId: null })}
        options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))}
      />
      <DueFields date={form.date} time={form.time} onDate={(v) => set(formDateChange(form, v, today))} onTime={(v) => set({ time: v })} today={today} testID="form" />
      <PersonPicker
        label={strings['task.assignee']}
        value={form.assigneeId ?? ''}
        onChange={(v) => set({ assigneeId: v === '' ? null : v })}
        options={[{ value: '', label: strings['common.nobody'] }, ...members.map((m) => ({ value: m.member_id, label: m.display_name }))]}
      />
      {form.date ? <RepeatEditor value={form.repeat} date={formDate(form, today)} onChange={(r) => set({ repeat: r })} /> : <Body muted>{strings['form.error.repeatNeedsDate']}</Body>}
      {/* D68 po decyzji właściciela z 8.10.2026 (PW-18 b): bez osoby i terminu zapis przechodzi, z dopiskiem jak na ekranie zadania. */}
      {formUnseen(tables, userId, form) ? <Text testID="form-no-addressee" style={{ fontFamily: font.text700, fontSize: size.BODY, color: c.danger }}>{strings['task.noAddressee']}</Text> : null}
      {error ? <ErrorText attempt={attempt}>{error === 'assignee' ? strings['form.error.peopleGone'](namesOf(tables, [form.assigneeId!])) : ERRORS[error]}</ErrorText> : null}
      <Button label={strings['form.save']} onPress={save} testID="form-save" />
    </Screen>
  );
}
