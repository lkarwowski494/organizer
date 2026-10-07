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
import { toggleDone } from '../../domain/views/commands';
import { groupsView, type TodayItem, todayView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, LineChip, QuickAddField, Screen, SectionTitle, StationRow, SyncChip, Title, TokenChip } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function TodayScreen() {
  const { userId, store, now, nowIso, nowMs, newId } = useServices();
  const { tables, today, indicator } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);

  const view = useMemo(() => todayView(tables, userId, today), [tables, userId, today]);
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const tokens = text ? parseQuickAdd(text, now(), { ignore }).tokens : [];

  const submit = () => {
    for (const op of quickAddOps({ tables, userId, text, now: now(), ignore, newId })) store.dispatch(op);
    setText('');
    setIgnore([]);
  };

  const sections: [string, TodayItem[]][] = [
    [strings['today.overdue'], view.overdue],
    [strings['today.pinned'], view.pinned],
    [strings['today.today'], view.today],
    [strings['today.tomorrow'], view.tomorrow],
  ];
  const empty = sections.every(([, items]) => items.length === 0);

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
      {sections.map(([title, items]) =>
        items.length === 0 ? null : (
          <View key={title}>
            <SectionTitle>{title}</SectionTitle>
            {items.map((it) => (
              <StationRow
                key={it.id}
                testID={`today-${it.id}`}
                title={it.title}
                line={it.line}
                group={groups.find((g) => g.id === it.group_id)?.kind === 'personal' ? strings['groups.personal'] : it.groupName}
                meta={[it.due ? formatDue(it.due, today) : strings['today.noDue'], ...(it.assignee ? [strings['task.assignedTo'](it.assignee)] : [])]}
                checked={false}
                onToggle={() => store.dispatch(toggleDone(it, nowIso()))}
                onOpen={() => nav.navigate('Task', { taskId: it.id })}
              />
            ))}
          </View>
        ),
      )}
    </Screen>
  );
}
