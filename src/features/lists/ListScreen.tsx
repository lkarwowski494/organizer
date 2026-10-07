/**
 * Lista zadań albo zakupów: drzewo zadań (podzadania pod rodzicem), szybkie dodawanie na tę listę,
 * zrobione na dole („W koszyku” dla zakupów). Pozycja jeszcze niewysłana ma dopisek „czeka na wysłanie”.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { quickAddOps } from '../../app/quickadd';
import type { RootStackParams } from '../../app/routes';
import { addDays, formatIsoDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { addresseeRequired, lacksAddressee } from '../../domain/views/addressee';
import { useTaskActions } from '../../app/task-actions';
import { remove, restore } from '../../domain/views/commands';
import { listDetail, myMemberships, type TaskNode } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, QuickAddField, Screen, SectionTitle, StationRow, SwipeRow, SyncChip, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';

type Props = NativeStackScreenProps<RootStackParams, 'List'>;

export function ListScreen({ route, navigation }: Props) {
  const { userId, store, now, nowMs, newId } = useServices();
  const actions = useTaskActions();
  const undo = useUndo();
  const { tables, today, indicator, state } = useAppData();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [ask, setAsk] = useState(false);
  const detail = useMemo(() => listDetail(tables, userId, route.params.listId, today), [tables, userId, route.params.listId, today]);
  const pendingIds = useMemo(() => new Set(state.pending.filter((op) => op.seq > state.ackedSeq).flatMap((op) => ('id' in op ? [op.id] : []))), [state]);

  if (!detail) {
    return (
      <Screen testID="screen-list-missing">
        <BackButton onPress={() => navigation.goBack()} />
        <Body muted>{strings['common.error']}</Body>
      </Screen>
    );
  }
  const { list } = detail;
  const shopping = list.kind === 'shopping';
  // D34: dziecko tylko odhacza (serwer odrzuca usunięcie), więc nie dostaje przesuwania.
  const canDelete = myMemberships(tables, userId).get(list.group_id)?.role !== 'child';
  const add = (extra: { assigneeId?: string; dueDate?: string } = {}) => {
    store.dispatch(quickAddOps({ tables, userId, text, now: now(), ignore: [], newId, listId: list.id, ...extra }));
    setText('');
    setAsk(false);
  };
  // D68: we wspólnej grupie zadanie bez osoby i terminu nie zapisze się — najpierw wybór adresata.
  const submit = () => {
    const parsed = parseQuickAdd(text, now());
    if (parsed.title.trim() === '') return;
    if (!shopping && !parsed.due && addresseeRequired(tables, userId, list.id, null)) return setAsk(true);
    add();
  };
  const n = now();
  const day = (k: number) => formatIsoDate(addDays({ y: n.y, m: n.m, d: n.d }, k));
  const rows = (nodes: TaskNode[], done: boolean): React.ReactNode[] =>
    nodes.flatMap((t) => [
      <SwipeRow key={t.id} title={t.title} enabled={canDelete} onDelete={() => actions.remove(t)} testID={`swipe-${t.id}`}>
        <StationRow
          testID={`task-${t.id}`}
          title={t.title}
          line={list.line}
          depth={t.depth}
          meta={[...(t.due ? [formatDue(t.due, today)] : []), ...(t.expired ? [strings['lists.expired']] : []), ...(t.assignee ? [strings['task.assignedTo'](t.assignee)] : [])]}
          checked={done || t.completed_at !== null}
          pending={pendingIds.has(t.id)}
          alert={!done && t.completed_at === null && lacksAddressee(tables, userId, t) ? strings['lists.noAddressee'] : undefined}
          shopping={shopping}
          onToggle={() => actions.toggle(t, shopping)}
          onOpen={shopping ? undefined : () => navigation.navigate('Task', { taskId: t.id })}
        />
      </SwipeRow>,
      ...rows(t.children, done),
    ]);

  return (
    <Screen testID="screen-list">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <BackButton onPress={() => navigation.goBack()} />
        <SyncChip indicator={indicator} nowMs={nowMs()} />
      </View>
      <Title>{list.name}</Title>
      <Text style={{ fontFamily: font.text400, fontSize: 14, color: c.inkMuted }}>
        <Text style={{ fontFamily: font.text700 }}>{list.groupName}</Text>
        {`  ·  ${strings['lists.open'](detail.open.length)}`}
      </Text>
      <QuickAddField value={text} onChangeText={(v) => (setText(v), setAsk(false))} onSubmit={submit} placeholder={shopping ? strings['lists.addItem'] : strings['lists.addTask']} />
      {ask ? (
        <View testID="addressee-ask" style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {strings['addressee.ask']}
          </Text>
          <Body muted>{strings['addressee.why']}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {detail.members.map((m) => (
              <Button key={m.member_id} kind="secondary" label={strings['addressee.for'](m.display_name)} onPress={() => add({ assigneeId: m.member_id })} />
            ))}
            <Button kind="secondary" label={strings['addressee.today']} onPress={() => add({ dueDate: day(0) })} />
            <Button kind="secondary" label={strings['addressee.tomorrow']} onPress={() => add({ dueDate: day(1) })} />
          </View>
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setAsk(false)} />
        </View>
      ) : null}
      {detail.open.length === 0 && detail.done.length === 0 ? <Body muted>{strings['lists.emptyItems']}</Body> : null}
      <View>{rows(detail.open, false)}</View>
      {detail.done.length ? (
        <View>
          <SectionTitle>{shopping ? strings['lists.inCart'] : strings['lists.done']}</SectionTitle>
          {rows(detail.done, true)}
        </View>
      ) : null}
      <Button
        kind="danger"
        label={strings['lists.delete']}
        onPress={() => {
          store.dispatch(remove('lists', list.id));
          undo.show(strings['undo.listDeleted'](list.name), () => store.dispatch(restore('lists', list.id)));
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
