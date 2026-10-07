/** „Dotyczy mnie” — rdzeń produktu (D0.4): moje sprawy ze wszystkich grup na jednej mapie linii. */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { quickAddOps } from '../../app/quickadd';
import type { RootStackParams } from '../../app/routes';
import { useAppData, useServices } from '../../app/context';
import { formatDue, formatLongDate } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { useTaskActions } from '../../app/task-actions';
import { groupsView, todayView } from '../../domain/views';
import { agenda, type AgendaEntry } from '../../domain/views/agenda';
import { timeLabel, todayEvents } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { Body, EventRow, LineChip, QuickAddField, Screen, SectionTitle, StationRow, SwipeRow, SyncChip, Title, TokenChip } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function TodayScreen() {
  const { userId, store, now, nowMs, newId } = useServices();
  const actions = useTaskActions();
  const { tables, today, indicator } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);

  const view = useMemo(() => todayView(tables, userId, today), [tables, userId, today]);
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const events = useMemo(() => todayEvents(tables, userId, today), [tables, userId, today]);
  const tokens = text ? parseQuickAdd(text, now(), { ignore }).tokens : [];

  const submit = () => {
    for (const op of quickAddOps({ tables, userId, text, now: now(), ignore, newId })) store.dispatch(op);
    setText('');
    setIgnore([]);
  };

  // Zaległe i przypięte: kolejność terminów. Dziś i jutro: plan dnia — całodniowe na górze, potem godziny po kolei,
  // wydarzenia (D58: dotyczące mnie) przemieszane z zadaniami.
  const asTasks = (items: typeof view.today): AgendaEntry[] => items.map((t) => ({ kind: 'task', key: `t-${t.id}`, task: t }));
  const sections: [string, AgendaEntry[]][] = [
    [strings['today.overdue'], asTasks(view.overdue)],
    [strings['today.pinned'], asTasks(view.pinned)],
    [strings['today.today'], agenda(view.today, events.today)],
    [strings['today.tomorrow'], agenda(view.tomorrow, events.tomorrow)],
  ];
  const empty = sections.every(([, entries]) => entries.length === 0);
  const canDelete = (groupId: string) => groups.find((g) => g.id === groupId)?.me.role !== 'child';
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.kind === 'personal' ? strings['groups.personal'] : name);

  return (
    <Screen testID="screen-today">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: font.text600, fontSize: 15, color: c.inkMuted }}>{formatLongDate(today, today)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={strings['settings.open']} onPress={() => nav.navigate('Settings')} style={{ minHeight: 44, justifyContent: 'center' }}>
          <SyncChip indicator={indicator} nowMs={nowMs()} />
        </Pressable>
      </View>
      <Title>{strings['today.title']}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {groups.map((g) => (
          <LineChip key={g.id} name={g.kind === 'personal' ? strings['groups.personal'] : g.name} line={g.line} />
        ))}
      </View>
      <QuickAddField value={text} onChangeText={(s) => (setText(s), setIgnore([]))} onSubmit={submit} placeholder={strings['quick.placeholder']}>
        {tokens.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tokens.map((t) => (
              <TokenChip key={`${t.start}-${t.end}`} text={t.text} onPress={() => setIgnore([...ignore, { start: t.start, end: t.end }])} />
            ))}
          </View>
        ) : null}
      </QuickAddField>
      {empty ? <Body muted>{strings['today.empty']}</Body> : null}
      {sections.map(([title, entries]) =>
        entries.length === 0 ? null : (
          <View key={title}>
            <SectionTitle>{title}</SectionTitle>
            {entries.map((x) =>
              x.kind === 'event' ? (
                <EventRow
                  key={x.key}
                  testID={`today-event-${x.event.eventId}-${x.event.occurrenceDate}`}
                  title={x.event.title}
                  time={timeLabel(x.event.startTime, x.event.endTime)}
                  line={x.event.line}
                  group={groupLabel(x.event.groupId, x.event.groupName)}
                  recurring={x.event.recurring}
                  onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })}
                />
              ) : (
                <SwipeRow key={x.key} title={x.task.title} enabled={canDelete(x.task.group_id)} onDelete={() => actions.remove(x.task)}>
                  <StationRow
                    testID={`today-${x.task.id}`}
                    title={x.task.title}
                    line={x.task.line}
                    group={groupLabel(x.task.group_id, x.task.groupName)}
                    meta={[x.task.due ? formatDue(x.task.due, today) : strings['today.noDue'], ...(x.task.assignee ? [strings['task.assignedTo'](x.task.assignee)] : [])]}
                    checked={false}
                    onToggle={() => actions.toggle(x.task)}
                    onOpen={() => nav.navigate('Task', { taskId: x.task.id })}
                  />
                </SwipeRow>
              ),
            )}
          </View>
        ),
      )}
    </Screen>
  );
}
