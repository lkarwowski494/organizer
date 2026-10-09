/**
 * Kalendarz miesiąca: tydzień od poniedziałku, polskie dni wolne, kropki linii grup przy dniach
 * z wydarzeniami i zadaniami; pod siatką wydarzenia (wszystkie z moich grup, także serie RRULE) i zadania
 * wybranego dnia oraz dodawanie wydarzenia na ten dzień.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { formatIsoDate } from '../../domain/civil-date';
import { formatLongDate, formatMinutes, formatMonth, parseIsoDate } from '../../domain/format';
import { useTaskActions } from '../../app/task-actions';
import { useEventActions } from '../../app/event-actions';
import { type CalendarItem, calendarMonth, groupsView, myMemberships } from '../../domain/views';
import { agenda } from '../../domain/views/agenda';
import { type Nested, nestEntries } from '../../domain/views/nesting';
import { splitDuplicates } from '../../domain/views/calendar-sync';
import { eventsByDate } from '../../domain/views/events';
import { daySpan, isContinuation } from '../../domain/span';
import { occurrenceRow } from '../../ui/when';
import { dayPlan, type Span } from '../../domain/views/day-plan';
import type { PlainEntry } from '../../domain/views/agenda';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, EventRow, GapRow, PeriodArrow, PeriodTitle, Screen, StationRow, SwipeRow, Title } from '../../ui/components';
import { DayNumber } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { localNow } from '../../domain/local-time';
import { GroupFilterBar, useGroupFilter } from '../../app/group-filter';
import { useRowMeta } from '../../app/row-meta';
import { TabHeader, usePullRefresh } from '../../app/TabHeader';
import { DeviceCalendarCard } from './DeviceCalendarCard';
import { DeviceEventRow } from './DeviceEventRow';
import { HiddenDuplicates } from './HiddenDuplicates';

export function CalendarScreen() {
  const { userId, now } = useServices();
  const meta = useRowMeta();
  const refresh = usePullRefresh();
  const actions = useTaskActions();
  const eventActions = useEventActions();
  const { tables, today } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size, line } = useTheme();
  const [ym, setYm] = useState({ y: today.y, m: today.m });
  const [selected, setSelected] = useState(formatIsoDate(today));
  // PW-38 A: te same chipy grup co w Moich sprawach (wspólny filtr).
  const groups = useMemo(() => groupsView(tables, userId).map((g) => ({ id: g.id, name: g.kind === 'personal' ? strings['groups.personal'] : g.name, line: g.line, personal: g.kind === 'personal' })), [tables, userId]);
  const filter = useGroupFilter(groups);
  const shown = useCallback((groupId: string) => filter.active.size === 0 || filter.active.has(groupId), [filter.active]);
  const days = useMemo(
    () => calendarMonth(tables, userId, ym.y, ym.m, { today, localDate: (iso) => formatIsoDate(localNow(Date.parse(iso))) }).map((d) => ({ ...d, items: d.items.filter((x) => shown(x.group_id)) })),
    [tables, userId, ym, today, shown],
  );
  const events = useMemo(() => {
    const all = eventsByDate(tables, userId, parseIsoDate(days[0]!.date), parseIsoDate(days.at(-1)!.date));
    return new Map([...all].map(([d, list]) => [d, list.filter((e) => shown(e.groupId))]));
  }, [tables, userId, days, shown]);
  const shift = (k: number) => {
    const idx = ym.y * 12 + (ym.m - 1) + k;
    setYm({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };
  const day = days.find((d) => d.date === selected);
  const dayEvents = day ? (events.get(day.date) ?? []) : [];
  const roles = myMemberships(tables, userId);
  const isoToday = formatIsoDate(today);
  // Grupa osobista pod nazwą „Osobiste” — jak w Moich sprawach.
  const groupLabel = (id: string, name: string) => (groups.find((g) => g.id === id)?.personal ? strings['groups.personal'] : name);
  // M-128, M-129: opis wiersza wspólny z Moimi sprawami (src/app/row-meta.ts); minione wydarzenia wyszarzone.
  const calRow = ({ entry: x, ...n }: Nested<PlainEntry>, date: string) => {
    if (x.kind === 'event') {
      const m = meta.event(x.event, n);
      return (
        // Audyt 2 (M-239): termin przesuwa się jak w Moich sprawach — jednorazowe „Usuń”, termin serii „Odwołaj”.
        <SwipeRow key={x.key} title={x.event.title} enabled={roles.get(x.event.groupId)?.role !== 'child'} action={x.event.recurring ? 'cancel' : 'delete'} onDelete={() => eventActions.cancel(x.event.eventId, x.event.occurrenceDate)} testID={`swipe-cal-event-${x.event.eventId}-${x.event.occurrenceDate}`}>
          <EventRow testID={`cal-event-${x.event.eventId}-${x.event.occurrenceDate}`} title={x.event.title} {...occurrenceRow(x.event)} line={x.event.line} group={groupLabel(x.event.groupId, x.event.groupName)} extra={m.extra} alert={m.alert} faded={date < isoToday} onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })} />
        </SwipeRow>
      );
    }
    const task = x.task as CalendarItem;
    const m = meta.task(task, date, n);
    // PWD-15 A: blady przyszły termin — bez odhaczania, otwiera zadanie, z którego wynika.
    if (task.projected)
      return <StationRow key={`${x.key}-${date}`} testID={`cal-next-${task.id}-${date}`} title={task.title} line={task.line} group={groupLabel(task.group_id, task.groupName)} when={m.when} meta={m.meta} readOnly checked={false} onToggle={() => {}} openHint={strings['calendar.repeatNextHint']} onOpen={() => nav.navigate('Task', { taskId: task.id })} />;
    if (task.trip)
      return (
        <StationRow
          key={x.key}
          testID={task.completed_at ? `cal-trip-done-${task.id}` : `cal-trip-${task.id}`}
          title={strings['trip.title'](task.title)}
          line={task.line}
          group={groupLabel(task.group_id, task.groupName)}
          when={m.when}
          meta={m.meta}
          alert={m.alert}
          // PWD-11 A: zrobione zakupy — przekreślone, bez odhaczania (cofnięcie jest na pasku „Cofnij”).
          readOnly={task.completed_at !== null}
          checked={task.completed_at !== null}
          // PW-14 B (audyt 2, R-11): dziecko z kontem — zakupy bez pola odhaczenia.
          onToggle={roles.get(task.group_id)?.role !== 'child' ? () => actions.finishTrip(task.id, task.title) : undefined}
          onOpen={() => nav.navigate('List', { listId: task.trip!.listId })}
        />
      );
    return (
      <SwipeRow key={x.key} title={task.title} enabled={roles.get(task.group_id)?.role !== 'child'} onDelete={() => actions.remove(task)} testID={`swipe-cal-${task.id}`}>
        <StationRow testID={`cal-${task.id}`} title={task.title} line={task.line} group={groupLabel(task.group_id, task.groupName)} depth={n.depth} when={m.when} meta={m.meta} alert={m.alert} checked={task.completed_at !== null} onToggle={() => actions.toggle(task)} onOpen={() => nav.navigate('Task', { taskId: task.id })} />
      </SwipeRow>
    );
  };
  const spanOf = ({ entry: x }: { entry: PlainEntry }): Span => (x.kind === 'event' ? daySpan(x.event.startTime, x.event.endTime, x.event.part) : { start: x.task.due?.time ?? null, end: null });
  // D95: moje wydarzenia z iPhone'a (tylko na tym telefonie).
  // D173: bez dubli wpisów aplikacji z tego samego dnia; ukryte — w wierszu „Ukryto N” pod dniem.
  const deviceAll = useDeviceCalendar().days;
  // Przy filtrze grup (PW-38) wydarzenia z iPhone'a schowane — nie należą do żadnej grupy (jak w Moich sprawach).
  const allDevice = filter.active.size ? new Map<string, never[]>() : deviceAll;
  const deviceSplit = (date: string, items: { title: string; due: { time: string | null } | null }[]) =>
    splitDuplicates(allDevice.get(date) ?? [], [...items.map((i) => ({ title: i.title, time: i.due?.time ?? null })), ...(events.get(date) ?? []).map((e) => ({ title: e.title, time: e.startTime, continued: isContinuation(e.part) }))]);
  const deviceOf = (date: string, items: { title: string; due: { time: string | null } | null }[]) => deviceSplit(date, items).shown;
  const daySplit = day ? deviceSplit(day.date, day.items) : { shown: [], hidden: [] };
  const dayDevice = daySplit.shown;
  const atToday = ym.y === today.y && ym.m === today.m && selected === isoToday;

  return (
    <Screen testID="screen-calendar" refresh={refresh}>
      <TabHeader />
      <Title>{strings['tabs.calendar']}</Title>
      <GroupFilterBar groups={groups} testID="calendar-filter" />
      <DeviceCalendarCard />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <PeriodArrow dir={-1} label={strings['today.prev.month']} onPress={() => shift(-1)} />
        <PeriodTitle testID="calendar-month">{formatMonth(ym.y, ym.m)}</PeriodTitle>
        <PeriodArrow dir={1} label={strings['today.next.month']} onPress={() => shift(1)} />
        {/* PWD-8 A: „Dziś” jak w Moich sprawach — stałe miejsce, na bieżącym miesiącu z wybranym dziś wyszarzony. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings['common.today']}
          accessibilityState={{ disabled: atToday }}
          disabled={atToday}
          testID="calendar-go-today"
          onPress={() => {
            setYm({ y: today.y, m: today.m });
            setSelected(isoToday);
          }}
          style={{ minHeight: size.TOUCH_TARGET, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: c.control, opacity: atToday ? 0.35 : 1 }}
        >
          <Text style={{ fontFamily: font.text700, fontSize: size.CONTROL, color: c.ink }}>{strings['common.today']}</Text>
        </Pressable>
      </View>
      {/* Skróty dni tygodnia tylko dla oka — każdy dzień podaje pełną nazwę (audyt 2, M-263, A-46). */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row' }}>
        {WEEKDAYS_ABBREVIATED.map((w) => (
          <Text key={w} style={{ flex: 1, textAlign: 'center', fontFamily: font.text700, fontSize: size.META, color: c.inkMuted }}>{w}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {days.map((d) => {
          const on = d.date === selected;
          const n = parseIsoDate(d.date).d;
          const evs = events.get(d.date) ?? [];
          const isToday = d.date === isoToday;
          // Audyt 2 (M-263, A-44): kropka „z kalendarza iPhone'a” ma odpowiednik w etykiecie.
          const device = deviceOf(d.date, d.items).length;
          const dayLabel = strings['calendar.dayA11y'](formatLongDate(parseIsoDate(d.date), today), d.items.length, d.holiday, evs.length, device);
          // M-140 (PW-50 A, D196): dziś — kółko z obwódką i „Dziś, …” dla VoiceOvera; zaznaczenie ciemnym wypełnieniem (D198).
          const label = isToday ? strings['calendar.todayA11y'](dayLabel) : dayLabel;
          return (
            <Pressable
              key={d.date}
              testID={`day-${d.date}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() => setSelected(d.date)}
              style={{ width: `${100 / 7}%`, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}
            >
              <DayNumber n={n} selected={on} today={isToday} holiday={!!d.holiday} muted={!d.inMonth} testID={`day-num-${d.date}`} />
              <View style={{ flexDirection: 'row', gap: 2, height: 8, marginTop: 2 }}>
                {[...new Set([...evs.map((e) => e.line), ...d.items.map((i) => i.line)])].slice(0, 4).map((l) => (
                  <View key={l} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: line(l).line }} />
                ))}
                {device ? <View testID={`device-dot-${d.date}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.inkMuted }} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {day ? (
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.display700, fontSize: size.CARD_TITLE, color: c.ink }}>
            {formatLongDate(parseIsoDate(day.date), today)}
            {day.holiday ? ` · ${day.holiday}` : ''}
          </Text>
          {day.items.length === 0 && dayEvents.length === 0 && dayDevice.length === 0 ? <Body muted>{strings['calendar.empty']}</Body> : null}
          {/* D122: wydarzenia z iPhone'a według godziny i przerwy „wolne …” (dziś od teraz, bez minionych dni). */}
          {dayPlan(nestEntries(agenda(day.items, dayEvents), tables), dayDevice, spanOf, { nowMin: day.date === isoToday ? now().hh * 60 + now().mm : null, gaps: day.date >= isoToday }).map((r) =>
            r.kind === 'device' ? (
              <DeviceEventRow key={r.item.key} e={r.item} />
            ) : r.kind === 'gap' ? (
              <GapRow key={r.key} testID={`cal-${r.key}`} length={formatMinutes(r.minutes)} />
            ) : (
              calRow(r.item, day.date)
            ),
          )}
          <HiddenDuplicates entries={daySplit.hidden} testID={`cal-hidden-${day.date}`} />
        </View>
      ) : null}
      <Button kind="secondary" label={strings['calendar.addEvent']} testID="calendar-add-event" onPress={() => nav.navigate('EventEdit', { date: selected })} />
      <Button kind="secondary" label={strings['routine.add']} testID="calendar-add-routine" onPress={() => nav.navigate('Routine')} />
    </Screen>
  );
}
