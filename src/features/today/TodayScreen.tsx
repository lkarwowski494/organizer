/**
 * „Moje sprawy” — rdzeń produktu (D0.4): moje sprawy ze wszystkich grup na jednej mapie linii. Dzień / tydzień /
 * miesiąc ze strzałkami (wczoraj, jutro…), zaległe przechodzą na dziś z czerwonym znacznikiem (D61).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
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
import { PushPrompt } from './PushPrompt';
import { WhatsNew } from './WhatsNew';
import { WELCOME_SEEN } from '../welcome/WelcomeScreen';
import { extractMention, type MentionTarget, mentionTargets } from '../../domain/views/mention';
import { useUndo } from '../../ui/undo';
import { type MyEntry, myDays, type RangeMode, rangeOf, shiftAnchor } from '../../domain/views/my-days';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, EventRow, LineChip, QuickAddField, Screen, SectionTitle, Segmented, StationRow, SwipeRow, SyncChip, Title, TokenChip } from '../../ui/components';
import { useTheme } from '../../ui/theme';

const MODES: RangeMode[] = ['day', 'week', 'month'];

export function TodayScreen() {
  const { userId, store, now, nowMs, newId, prefs } = useServices();
  const actions = useTaskActions();
  const { tables, today, indicator } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size } = useTheme();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<{ start: number; end: number }[]>([]);
  // D91: „@imię” pasujące do kilku osób — wybór osoby i grupy przed dodaniem.
  const [choices, setChoices] = useState<MentionTarget[] | null>(null);
  const undo = useUndo();
  // Zakres i dzień odniesienia (decyzja właściciela z 7.10.2026: przełącznik + strzałki, ADR 0009).
  const [mode, setMode] = useState<RangeMode>('day');
  const [anchor, setAnchor] = useState<CivilDate | null>(null);
  const at = anchor ?? today;

  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  // Pierwsze kroki (D79): przy pierwszym uruchomieniu na tym telefonie — wprowadzenie.
  useEffect(() => {
    let live = true;
    prefs
      ?.get(WELCOME_SEEN)
      .then((v) => live && v !== '1' && nav.navigate('Welcome'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefs, nav]);
  const view = useMemo(() => myDays(tables, userId, today, mode, at, (iso) => formatIsoDate(localNow(Date.parse(iso)))), [tables, userId, today, mode, at]);
  const incoming = useMemo(() => incomingHandoffs(tables, userId), [tables, userId]);
  const declined = useMemo(() => declinedHandoffs(tables, userId), [tables, userId]);
  const tokens = text ? parseQuickAdd(text, now(), { ignore }).tokens : [];
  const { from, to } = rangeOf(mode, at);
  const isoToday = formatIsoDate(today);
  const showsToday = formatIsoDate(from) <= isoToday && isoToday <= formatIsoDate(to);
  const label = mode === 'day' ? formatLongDate(at, today) : mode === 'week' ? formatRange(from, to, today) : formatMonth(at.y, at.m);

  // Szybkie dodanie (D90, D91): „@imię” wybiera grupę i osobę; po dodaniu pasek „Dodano … · Zmień” otwiera pełny formularz.
  const addWith = (target?: MentionTarget) => {
    const { mention } = extractMention(text);
    // „@imię” zastępujemy spacjami tej samej długości, żeby odklikane fragmenty (ignore) zachowały pozycje.
    const body = mention && target ? `${text.slice(0, mention.start)}${' '.repeat(mention.end - mention.start)}${text.slice(mention.end)}` : text;
    const ops = quickAddOps({ tables, userId, text: body, now: now(), ignore, newId, groupId: target?.groupId, assigneeId: target?.memberId });
    store.dispatch(ops);
    const created = ops.find((o) => o.kind === 'create' && o.entity === 'tasks');
    if (created && created.kind === 'create') {
      undo.show(strings['form.added'](String(created.set.title), target ? target.groupName : strings['groups.personal']), () => nav.navigate('AddTask', { taskId: created.id }), strings['form.change']);
    }
    setText('');
    setIgnore([]);
    setChoices(null);
  };
  const submit = () => {
    const { mention } = extractMention(text);
    const targets = mention ? mentionTargets(tables, userId, mention.name) : [];
    if (targets.length > 1) return setChoices(targets);
    addWith(targets[0]);
  };
  const canDelete = (groupId: string) => groups.find((g) => g.id === groupId)?.me.role !== 'child';
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.kind === 'personal' ? strings['groups.personal'] : name);
  const pinned = mode === 'day' && showsToday ? view.pinned : [];
  const empty = pinned.length === 0 && view.days.every((d) => d.entries.length === 0);

  const tripRow = (task: TodayItem & { trip: { open: number } }, key: string, alert?: string) => (
    // Zakupy z listy zakupów (D73): odhaczenie z potwierdzeniem i pytaniem o niekupione, dotknięcie otwiera listę.
    <StationRow
      key={key}
      testID={`today-trip-${task.id}`}
      title={strings['trip.title'](task.title)}
      line={task.line}
      group={groupLabel(task.group_id, task.groupName)}
      meta={[task.due ? formatDue(task.due, today) : strings['today.noDue'], strings['trip.open'](task.trip.open), ...(task.assignee ? [strings['task.assignedTo'](task.assignee)] : [])]}
      alert={alert}
      checked={false}
      onToggle={() => actions.finishTrip(task.id, task.title)}
      onOpen={() => nav.navigate('List', { listId: task.id })}
    />
  );
  const taskRow = (task: TodayItem, key: string, alert?: string) => task.trip ? tripRow({ ...task, trip: task.trip }, key, alert) : (
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
      <QuickAddField value={text} onChangeText={(s) => (setText(s), setIgnore([]), setChoices(null))} onSubmit={submit} placeholder={strings['quick.placeholder']}>
        {tokens.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tokens.map((t) => (
              <TokenChip key={`${t.start}-${t.end}`} text={t.text} onPress={() => setIgnore([...ignore, { start: t.start, end: t.end }])} />
            ))}
          </View>
        ) : null}
      </QuickAddField>
      <Button
        kind="secondary"
        label={strings['form.more']}
        a11yHint={strings['form.moreHint']}
        testID="add-more"
        onPress={() => {
          nav.navigate('AddTask', { text });
          setText('');
          setIgnore([]);
          setChoices(null);
        }}
      />
      {choices ? (
        <View testID="mention-choices" style={{ gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, fontSize: 17, color: c.ink }}>
            {strings['mention.ask'](extractMention(text).mention?.name ?? '')}
          </Text>
          {choices.map((t) => (
            <Button key={`${t.groupId}-${t.memberId}`} kind="secondary" label={strings['mention.pick'](t.displayName, t.groupName)} onPress={() => addWith(t)} />
          ))}
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setChoices(null)} />
        </View>
      ) : null}
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
      <WhatsNew />
      <PushPrompt />
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
