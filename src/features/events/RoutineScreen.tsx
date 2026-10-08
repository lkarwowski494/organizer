/**
 * Nowa rutyna (D113, ADR 0028): wydarzenie cykliczne (dni, godzina, osoby) z krokami jako stałymi zadaniami serii.
 * Kroki pojawiają się codziennie pod rutyną w „Moich sprawach”; potem zmienia się ją jak zwykłe wydarzenie
 * (stałe zadania — na ekranie wydarzenia). Logika: domain/views/routines.ts.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import { groupDetail, groupsView } from '../../domain/views';
import { routineOps } from '../../domain/views/routines';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Field, Screen, SectionTitle, Segmented, Title, Toggles } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';

type Props = NativeStackScreenProps<RootStackParams, 'Routine'>;

export function RoutineScreen({ route, navigation }: Props) {
  const { userId, store, newId } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const undo = useUndo();
  const groups = groupsView(tables, userId).filter((g) => g.me.role !== 'child');
  const [groupId, setGroupId] = useState(groups.some((g) => g.id === route.params?.groupId) ? route.params!.groupId! : (groups[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [who, setWho] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>(['']);
  const [error, setError] = useState<string | null>(null);
  const members = groupDetail(tables, userId, groupId)?.members ?? [];

  const save = () => {
    const r = routineOps({ tables, userId, groupId, title, days, start, end, participantIds: who, steps, today, newId });
    if ('error' in r) return setError(r.error === 'steps' ? strings['routine.error.steps'] : r.error === 'title' ? strings['routine.error.title'] : strings[`event.error.${r.error}`]);
    store.dispatch(r.ops);
    const created = r.ops.flatMap((o) => (o.kind === 'create' && (o.entity === 'events' || o.entity === 'event_task_series') ? [{ kind: 'delete' as const, entity: o.entity, id: o.id }] : []));
    undo.show(strings['routine.saved'](title.trim()), () => store.dispatch(created));
    navigation.goBack();
  };

  return (
    <Screen testID="screen-routine">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['routine.title']}</Title>
      <Body muted>{strings['routine.info']}</Body>
      {groups.length > 1 ? (
        <Segmented label={strings['event.group']} value={groupId} onChange={(g) => (setGroupId(g), setWho([]))} options={groups.map((g) => ({ value: g.id, label: g.kind === 'personal' ? strings['groups.personal'] : g.name }))} />
      ) : null}
      <Field label={strings['routine.name']} value={title} onChangeText={(v) => (setTitle(v), setError(null))} placeholder={strings['routine.namePlaceholder']} testID="routine-title" />
      <Toggles label={strings['event.days']} values={days} onChange={(v) => (setDays(v), setError(null))} options={WEEKDAYS_ABBREVIATED.map((w, wd) => ({ value: wd, label: w, a11y: strings['event.dayA11y'](WEEKDAYS_ACCUSATIVE[wd]!) }))} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field label={strings['event.start']} value={start} onChangeText={(v) => (setStart(v), setError(null))} placeholder="07:00" testID="routine-start" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={strings['event.end']} value={end} onChangeText={(v) => (setEnd(v), setError(null))} placeholder="07:30" testID="routine-end" />
        </View>
      </View>
      {members.length > 1 ? (
        <Toggles label={strings['routine.who']} values={who} onChange={setWho} options={members.map((m) => ({ value: m.member_id, label: m.display_name, a11y: strings['event.participantA11y'](m.display_name) }))} />
      ) : null}
      <SectionTitle>{strings['routine.steps']}</SectionTitle>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label={strings['routine.step'](i + 1)} value={s} onChangeText={(v) => (setSteps(steps.map((x, j) => (j === i ? v : x))), setError(null))} testID={`routine-step-${i}`} />
          </View>
          {steps.length > 1 ? <Button kind="secondary" label={strings['routine.removeStep']} a11yLabel={strings['routine.removeStepA11y'](i + 1)} onPress={() => setSteps(steps.filter((_, j) => j !== i))} /> : null}
        </View>
      ))}
      <Button kind="secondary" label={strings['routine.addStep']} testID="routine-add-step" onPress={() => setSteps([...steps, ''])} />
      {error ? (
        <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>
          {error}
        </Text>
      ) : null}
      <Button label={strings['routine.save']} testID="routine-save" onPress={save} />
    </Screen>
  );
}
