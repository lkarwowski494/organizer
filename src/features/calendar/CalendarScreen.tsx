/**
 * Kalendarz miesiąca: tydzień od poniedziałku, polskie dni wolne, kropki linii grup przy dniach
 * z wydarzeniami i zadaniami; pod siatką wydarzenia (wszystkie z moich grup, także serie RRULE) i zadania
 * wybranego dnia oraz dodawanie wydarzenia na ten dzień.
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { formatIsoDate } from '../../domain/civil-date';
import { formatDue, formatLongDate, formatMinutes, formatMonth, parseIsoDate } from '../../domain/format';
import { useTaskActions } from '../../app/task-actions';
import { useEventActions } from '../../app/event-actions';
import { calendarMonth, myMemberships } from '../../domain/views';
import { agenda } from '../../domain/views/agenda';
import { type Nested, nestEntries } from '../../domain/views/nesting';
import { splitDuplicates } from '../../domain/views/calendar-sync';
import { eventsByDate } from '../../domain/views/events';
import { daySpan, isContinuation } from '../../domain/span';
import { occurrenceRow } from '../../ui/when';
import { personOf } from '../../domain/views/who';
import { rsvpView } from '../../domain/views/rsvp';
import { dayPlan, type Span } from '../../domain/views/day-plan';
import type { PlainEntry } from '../../domain/views/agenda';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, EventRow, GapRow, PeriodArrow, PeriodTitle, Screen, StationRow, SwipeRow, Title } from '../../ui/components';
import { DayNumber } from '../../ui/DateField';
import { useTheme } from '../../ui/theme';
import { useDeviceCalendar } from '../../app/calendar-sync';
import { DeviceCalendarCard } from './DeviceCalendarCard';
import { DeviceEventRow } from './DeviceEventRow';
import { HiddenDuplicates } from './HiddenDuplicates';

export function CalendarScreen() {
  const { userId, now } = useServices();
  const actions = useTaskActions();
  const eventActions = useEventActions();
  const { tables, today } = useAppData();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { c, font, size, line } = useTheme();
  const [ym, setYm] = useState({ y: today.y, m: today.m });
  const [selected, setSelected] = useState(formatIsoDate(today));
  const days = useMemo(() => calendarMonth(tables, userId, ym.y, ym.m), [tables, userId, ym]);
  const events = useMemo(() => eventsByDate(tables, userId, parseIsoDate(days[0]!.date), parseIsoDate(days.at(-1)!.date)), [tables, userId, days]);
  const shift = (k: number) => {
    const idx = ym.y * 12 + (ym.m - 1) + k;
    setYm({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };
  const day = days.find((d) => d.date === selected);
  const dayEvents = day ? (events.get(day.date) ?? []) : [];
  const roles = myMemberships(tables, userId);
  // D119: kto w każdym wierszu („Ty”, gdy to ja).
  const who = (memberId: string | null, kind: 'who.task' | 'who.event') => {
    const p = personOf(tables, userId, memberId);
    return p ? [strings[kind](p)] : [];
  };
  const isoToday = formatIsoDate(today);
  // D124: ile osób potwierdziło obecność.
  const rsvpOf = (eventId: string, date: string) => {
    const v = rsvpView(tables, userId, eventId, date);
    // D129: w wierszu tylko, gdy ktoś nie będzie (reszta w szczegółach).
    return v && v.counts.no ? [strings['rsvp.short'](v.counts)] : [];
  };
  const calRow = ({ entry: x, ...n }: Nested<PlainEntry>) =>
            x.kind === 'event' ? (
              // Audyt 2 (M-239): termin przesuwa się jak w Moich sprawach — jednorazowe „Usuń”, termin serii „Odwołaj”.
              <SwipeRow key={x.key} title={x.event.title} enabled={roles.get(x.event.groupId)?.role !== 'child'} action={x.event.recurring ? 'cancel' : 'delete'} onDelete={() => eventActions.cancel(x.event.eventId, x.event.occurrenceDate)} testID={`swipe-cal-event-${x.event.eventId}-${x.event.occurrenceDate}`}>
              <EventRow testID={`cal-event-${x.event.eventId}-${x.event.occurrenceDate}`} title={x.event.title} {...occurrenceRow(x.event)} line={x.event.line} group={x.event.groupName} recurring={x.event.recurring} extra={[...who(x.event.responsibleId, 'who.event'), ...rsvpOf(x.event.eventId, x.event.occurrenceDate), ...(n.progress ? [strings['nest.progress'](n.progress.done, n.progress.total)] : [])].join('  ·  ') || undefined} onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })} />
              </SwipeRow>
            ) : x.task.trip ? (
              <StationRow
                key={x.key}
                testID={`cal-trip-${x.task.id}`}
                title={strings['trip.title'](x.task.title)}
                line={x.task.line}
                group={x.task.groupName}
                meta={[formatDue(x.task.due!, today), strings['trip.open'](x.task.trip.open), ...who(x.task.assignee_member_id, 'who.task')]}
                checked={false}
                // PW-14 B (audyt 2, R-11): dziecko z kontem — zakupy bez pola odhaczenia.
                onToggle={roles.get(x.task.group_id)?.role !== 'child' ? () => actions.finishTrip(x.task.id, x.task.title) : undefined}
                onOpen={() => nav.navigate('List', { listId: x.task.id })}
              />
            ) : (
              <SwipeRow key={x.key} title={x.task.title} enabled={roles.get(x.task.group_id)?.role !== 'child'} onDelete={() => actions.remove(x.task)} testID={`swipe-cal-${x.task.id}`}>
                <StationRow
                  testID={`cal-${x.task.id}`}
                  title={x.task.title}
                  line={x.task.line}
                  group={x.task.groupName}
                  depth={n.depth}
                  meta={[...(n.parent ? [strings['nest.parent'](n.parent.title, n.parent.kind === 'event')] : []), ...(n.progress ? [strings['nest.progress'](n.progress.done, n.progress.total)] : []), formatDue(x.task.due!, today), ...who(x.task.assignee_member_id, 'who.task')]} checked={x.task.completed_at !== null} onToggle={() => actions.toggle(x.task)} onOpen={() => nav.navigate('Task', { taskId: x.task.id })} />
              </SwipeRow>
            );
  const spanOf = ({ entry: x }: { entry: PlainEntry }): Span => (x.kind === 'event' ? daySpan(x.event.startTime, x.event.endTime, x.event.part) : { start: x.task.due?.time ?? null, end: null });
  // D95: moje wydarzenia z iPhone'a (tylko na tym telefonie).
  // D173: bez dubli wpisów aplikacji z tego samego dnia; ukryte — w wierszu „Ukryto N” pod dniem.
  const allDevice = useDeviceCalendar().days;
  const deviceSplit = (date: string, items: { title: string; due: { time: string | null } | null }[]) =>
    splitDuplicates(allDevice.get(date) ?? [], [...items.map((i) => ({ title: i.title, time: i.due?.time ?? null })), ...(events.get(date) ?? []).map((e) => ({ title: e.title, time: e.startTime, continued: isContinuation(e.part) }))]);
  const deviceOf = (date: string, items: { title: string; due: { time: string | null } | null }[]) => deviceSplit(date, items).shown;
  const daySplit = day ? deviceSplit(day.date, day.items) : { shown: [], hidden: [] };
  const dayDevice = daySplit.shown;

  return (
    <Screen testID="screen-calendar">
      <Title>{strings['calendar.title']}</Title>
      <DeviceCalendarCard />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <PeriodArrow dir={-1} label={strings['calendar.prev']} onPress={() => shift(-1)} />
        <PeriodTitle>{formatMonth(ym.y, ym.m)}</PeriodTitle>
        <PeriodArrow dir={1} label={strings['calendar.next']} onPress={() => shift(1)} />
      </View>
      <View style={{ flexDirection: 'row' }}>
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
          const dayLabel = strings['calendar.dayA11y'](formatLongDate(parseIsoDate(d.date), today), d.items.length, d.holiday, evs.length);
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
                {deviceOf(d.date, d.items).length ? <View testID={`device-dot-${d.date}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.inkMuted }} /> : null}
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
              calRow(r.item)
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
