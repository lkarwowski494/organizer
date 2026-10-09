/**
 * Nowa rutyna (D113, ADR 0028): wydarzenie cykliczne (dni, godzina, osoby) z krokami jako stałymi zadaniami serii.
 * Kroki pojawiają się codziennie pod rutyną w „Moich sprawach”; potem zmienia się ją jak zwykłe wydarzenie
 * (stałe zadania — na ekranie wydarzenia). Logika: domain/views/routines.ts.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { type TextInput, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { useDefaultGroup } from '../../app/default-group';
import { startGroup } from '../../domain/views/default-group';
import { DraftNote, useAnnounce, useFormDraft } from '../../app/form-draft';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ON } from '../../config/quickadd.pl';
import { groupDetail, groupsView } from '../../domain/views';
import { routineOps } from '../../domain/views/routines';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, ErrorText, Field, Screen, SectionTitle, Segmented, Title, Toggles, useFormError } from '../../ui/components';
import { PeopleToggles } from '../../ui/PersonPicker';
import { TimeFieldPair } from '../../ui/TimeField';
import { useUndo } from '../../ui/undo';

type Props = NativeStackScreenProps<RootStackParams, 'Routine'>;

export function RoutineScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const undo = useUndo();
  const groups = groupsView(tables, userId).filter((g) => g.me.role !== 'child');
  // PW-37 A (M-118, D191): bez wskazanej grupy — „Grupa domyślna”, jak szybkie dodawanie; zapis ją zapamiętuje.
  const defaultGroup = useDefaultGroup();
  const [groupId, setGroupId] = useState(groups.some((g) => g.id === route.params?.groupId) ? route.params!.groupId! : (startGroup(groups, defaultGroup.setting, defaultGroup.last) ?? ''));
  const [title, setTitle] = useState(route.params?.title ?? '');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>(['']);
  const [error, setError, attempt] = useFormError<string>();
  const stepRefs = useRef<(TextInput | null)[]>([]);
  const members = groupDetail(tables, userId, groupId)?.members ?? [];
  // D179 (audyt 2, M-123): szkic na telefonie — wyjście bez „Zapisz” zostawia wpisane pola (app/form-draft).
  const draft = useFormDraft('routine:new', { groupId, title, days, start, end, who, steps }, { groupId: setGroupId, title: setTitle, days: setDays, start: setStart, end: setEnd, who: setWho, steps: setSteps }, { restore: route.params?.title === undefined });
  // M-255: po przełączeniu rodzaju VoiceOver słyszy, w jakim formularzu jest.
  useAnnounce(route.params?.kindSwitch ? strings['routine.title'] : null);

  const save = () => {
    const r = routineOps({ tables, userId, groupId, title, days, start, end, participantIds: who, steps, today, newId });
    if ('error' in r) return setError(r.error === 'steps' ? strings['routine.error.steps'] : r.error === 'title' ? strings['routine.error.title'] : strings[`event.error.${r.error}`]);
    draft.saved();
    store.dispatch(r.ops);
    defaultGroup.remember(groupId);
    // Audyt 2 (E-3): cofnięcie liczone w chwili cofnięcia — z kopiami kroków dołożonymi w międzyczasie (przepis „routine”
    // w AppProvider, także po ponownym uruchomieniu — D194 b).
    undo.show(strings['routine.saved'](title.trim()), { ops: r.ops, recipe: 'routine' });
    navigation.goBack();
  };

  return (
    <Screen testID="screen-routine">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['routine.title']}</Title>
      <DraftNote draft={draft} />
      {/* Audyt 2 (PWD-26): ten sam wybór rodzaju co w formularzu zadania i wydarzenia (D98) — nazwa i grupa przechodzą. */}
      <Segmented
        label={strings['form.kind']}
        value="routine"
        onChange={(k) => {
          if (k === 'routine') return;
          // Wpisane pola przechodzą do innego formularza — szkic rutyny nie jest już potrzebny.
          draft.saved();
          if (k === 'task') navigation.replace('AddTask', { title, groupId: groupId || undefined, kindSwitch: true });
          else navigation.replace('EventEdit', { groupId: groupId || undefined, title, kindSwitch: true });
        }}
        options={[
          { value: 'task', label: strings['form.kind.task'], hint: strings['form.kind.taskHint'] },
          { value: 'event', label: strings['form.kind.event'], hint: strings['form.kind.eventHint'] },
          { value: 'routine', label: strings['form.kind.routine'] },
        ]}
      />
      <Body muted>{strings['routine.info']}</Body>
      {groups.length > 1 ? (
        <Segmented label={strings['common.group']} value={groupId} onChange={(g) => (setGroupId(g), setWho([]))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      ) : null}
      {/* M-247: kursor w pierwszym polu pustego formularza; M-243: Return przechodzi do pierwszego kroku. */}
      <Field label={strings['common.name']} value={title} onChangeText={(v) => (setTitle(v), setError(null))} placeholder={strings['routine.namePlaceholder']} autoFocus={title === ''} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => stepRefs.current[0]?.focus()} testID="routine-title" />
      <Toggles label={strings['event.days']} values={days} onChange={(v) => (setDays(v), setError(null))} options={WEEKDAYS_ABBREVIATED.map((w, wd) => ({ value: wd, label: w, a11y: strings['event.dayA11y'](w, WEEKDAYS_ON[wd]!) }))} />
      <TimeFieldPair
        start={{ label: strings['event.start'], value: start, onChange: (v) => (setStart(v), setError(null)), testID: 'routine-start' }}
        end={{ label: strings['event.end'], value: end, onChange: (v) => (setEnd(v), setError(null)), testID: 'routine-end', optional: true }}
      />
      {members.length > 1 ? (
        <PeopleToggles label={strings['routine.who']} values={who} onChange={setWho} options={members.map((m) => ({ value: m.member_id, label: m.display_name, a11y: strings['event.participantA11y'](m.display_name) }))} />
      ) : null}
      <SectionTitle>{strings['routine.steps']}</SectionTitle>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field ref={(r) => void (stepRefs.current[i] = r)} label={strings['routine.step'](i + 1)} value={s} onChangeText={(v) => (setSteps(steps.map((x, j) => (j === i ? v : x))), setError(null))} returnKeyType={i < steps.length - 1 ? 'next' : 'done'} submitBehavior={i < steps.length - 1 ? 'submit' : undefined} onSubmitEditing={() => stepRefs.current[i + 1]?.focus()} testID={`routine-step-${i}`} />
          </View>
          {steps.length > 1 ? <Button kind="danger" label={strings['common.delete']} a11yLabel={strings['routine.removeStepA11y'](i + 1)} onPress={() => setSteps(steps.filter((_, j) => j !== i))} /> : null}
        </View>
      ))}
      <Button kind="secondary" label={strings['routine.addStep']} testID="routine-add-step" onPress={() => setSteps([...steps, ''])} />
      {error ? (
        <ErrorText attempt={attempt}>{error}</ErrorText>
      ) : null}
      <Button label={strings['routine.save']} testID="routine-save" onPress={save} />
    </Screen>
  );
}
