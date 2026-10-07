/**
 * „Dotyczy mnie” — rdzeń produktu (D0.4): moje sprawy ze wszystkich grup na jednej mapie linii. Dzień / tydzień /
 * miesiąc ze strzałkami (wczoraj, jutro…), zaległe przechodzą na dziś z czerwonym znacznikiem (D61).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { quickAddOps } from '../../app/quickadd';
import type { RootStackParams } from '../../app/routes';
import { useAppData, useServices } from '../../app/context';
import { formatDue, formatLongDate, formatMonth, formatRange, parseIsoDate } from '../../domain/format';
import { parseQuickAdd } from '../../domain/quickadd';
import { useTaskActions } from '../../app/task-actions';
import { localNow } from '../../app/clock';
import { type CivilDate, formatIsoDate } from '../../domain/civil-date';
import { groupsView, type TodayItem } from '../../domain/views';
import { timeLabel } from '../../domain/views/events';
import { closeHandoff, decideHandoff, declinedHandoffs, incomingHandoffs } from '../../domain/views/handoffs';
import { HandoffInbox } from '../handoffs/HandoffInbox';
import { type MyEntry, myDays, type RangeMode, rangeOf, shiftAnchor } from '../../domain/views/my-days';
import { strings } from '../../i18n/strings.pl';
import { Body, EventRow, LineChip, QuickAddField, Screen, SectionTitle, Segmented, StationRow, SwipeRow, SyncChip, Title, TokenChip } from '../../ui/components';
import { useTheme } from '../../ui/theme';

const MODES: RangeMode[] = ['day', 'week', 'month'];

export function TodayScreen() {
  const { userId, store, now, nowMs, newId } = useServices();
  const actions = useTaskActions();
  const { tables, today, indicator } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);
  // Zakres i dzień odniesienia (decyzja właściciela z 7.10.2026: przełącznik + strzałki, ADR 0009).
  const [mode, setMode] = useState<RangeMode>('day');
  const [anchor, setAnchor] = useState<CivilDate | null>(null);
  const at = anchor ?? today;

  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  const view = useMemo(() => myDays(tables, userId, today, mode, at, (iso) => formatIsoDate(localNow(Date.parse(iso)))), [tables, userId, today, mode, at]);
  const incoming = useMemo(() => incomingHandoffs(tables, userId), [tables, userId]);
  const declined = useMemo(() => declinedHandoffs(tables, userId), [tables, userId]);
  const tokens = text ? parseQuickAdd(text, now(), { ignore }).tokens : [];
  const { from, to } = rangeOf(mode, at);
  const isoToday = formatIsoDate(today);
  const showsToday = formatIsoDate(from) <= isoToday && isoToday <= formatIsoDate(to);
  const label = mode === 'day' ? formatLongDate(at, today) : mode === 'week' ? formatRange(from, to, today) : formatMonth(at.y, at.m);

  const submit = () => {
    for (const op of quickAddOps({ tables, userId, text, now: now(), ignore, newId })) store.dispatch(op);
    setText('');
    setIgnore([]);
  };
  const canDelete = (groupId: string) => groups.find((g) => g.id === groupId)?.me.role !== 'child';
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.kind === 'personal' ? strings['groups.personal'] : name);
  const pinned = mode === 'day' && showsToday ? view.pinned : [];
  const empty = pinned.length === 0 && view.days.every((d) => d.entries.length === 0);

  const taskRow = (task: TodayItem, key: string, alert?: string) => (
    <SwipeRow key={key} title={task.title} enabled={canDelete(task.group_id) && task.completed_at === null} onDelete={() => actions.remove(task)}>
      <StationRow
        testID={`today-${task.id}`}
        title={task.title}
        line={task.line}
        group={groupLabel(task.group_id, task.groupName)}
        meta={[task.due ? formatDue(task.due, today) : strings['today.noDue'], ...(task.assignee ? [strings['task.assignedTo'](task.assignee)] : [])]}
        alert={alert}
        checked={task.completed_at !== null}
        onToggle={() => actions.toggle(task)}
        onOpen={() => nav.navigate('Task', { taskId: task.id })}
      />
    </SwipeRow>
  );
  const entryRow = (x: MyEntry, past: boolean) =>
    x.kind === 'event' ? (
      <EventRow
        key={x.key}
        testID={`today-event-${x.event.eventId}-${x.event.occurrenceDate}`}
        title={x.event.title}
        time={timeLabel(x.event.startTime, x.event.endTime)}
        line={x.event.line}
        group={groupLabel(x.event.groupId, x.event.groupName)}
        recurring={x.event.recurring}
        faded={past}
        onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })}
      />
    ) : x.kind === 'overdue' ? (
      taskRow(x.task, x.key, strings['today.overdueDays'](x.task.overdueDays))
    ) : (
      taskRow(x.task, x.key)
    );
  const arrow = (k: number, a11y: string, glyph: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={() => setAnchor(shiftAnchor(mode, at, k))} style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, color: c.ink }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <Screen testID="screen-today">
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
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
      <Segmented label={strings['today.range']} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: strings[`today.range.${m}`] }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {arrow(-1, strings[`today.prev.${mode}`], '‹')}
        <Text accessibilityRole="header" testID="today-range-label" style={{ flex: 1, textAlign: 'center', fontFamily: font.display700, fontSize: 18, color: c.ink }}>
          {label}
        </Text>
        {arrow(1, strings[`today.next.${mode}`], '›')}
        {showsToday ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel={strings['today.goToday']} onPress={() => setAnchor(null)} style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: c.control }}>
            <Text style={{ fontFamily: font.text700, fontSize: 15, color: c.ink }}>{strings['today.goToday']}</Text>
          </Pressable>
        )}
      </View>
      <HandoffInbox incoming={incoming} declined={declined} today={today} onDecide={(h, accept) => store.dispatch(decideHandoff(h.id, accept))} onClose={(h) => store.dispatch(closeHandoff(h.id))} />
      {empty ? <Body muted>{showsToday && mode === 'day' ? strings['today.empty'] : strings['today.emptyRange']}</Body> : null}
      {pinned.length ? (
        <View>
          <SectionTitle>{strings['today.pinned']}</SectionTitle>
          {pinned.map((p) => taskRow(p, `p-${p.id}`))}
        </View>
      ) : null}
      {view.days.map((d) =>
        d.entries.length === 0 ? null : (
          <View key={d.date} testID={`today-day-${d.date}`}>
            {mode === 'day' ? null : <SectionTitle>{d.isToday ? `${strings['today.today']} · ${formatLongDate(parseIsoDate(d.date), today)}` : formatLongDate(parseIsoDate(d.date), today)}</SectionTitle>}
            {d.past ? <Body muted>{strings['today.pastInfo']}</Body> : null}
            {d.entries.map((x) => entryRow(x, d.past))}
          </View>
        ),
      )}
    </Screen>
  );
}
