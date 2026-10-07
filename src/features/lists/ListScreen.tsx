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
import { formatDue } from '../../domain/format';
import { remove, toggleDone } from '../../domain/views/commands';
import { listDetail, type TaskNode } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, QuickAddField, Screen, SectionTitle, StationRow, SyncChip, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'List'>;

export function ListScreen({ route, navigation }: Props) {
  const { userId, store, now, nowIso, nowMs, newId } = useServices();
  const { tables, today, indicator, state } = useAppData();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
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
  const submit = () => {
    for (const op of quickAddOps({ tables, userId, text, now: now(), ignore: [], newId, listId: list.id })) store.dispatch(op);
    setText('');
  };
  const rows = (nodes: TaskNode[], done: boolean): React.ReactNode[] =>
    nodes.flatMap((t) => [
      <StationRow
        key={t.id}
        testID={`task-${t.id}`}
        title={t.title}
        line={list.line}
        depth={t.depth}
        meta={[...(t.due ? [formatDue(t.due, today)] : []), ...(t.assignee ? [strings['task.assignedTo'](t.assignee)] : [])]}
        checked={done || t.completed_at !== null}
        pending={pendingIds.has(t.id)}
        shopping={shopping}
        onToggle={() => store.dispatch(toggleDone(t, nowIso()))}
        onOpen={shopping ? undefined : () => navigation.navigate('Task', { taskId: t.id })}
      />,
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
      <QuickAddField value={text} onChangeText={setText} onSubmit={submit} placeholder={shopping ? strings['lists.addItem'] : strings['lists.addTask']} />
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
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
