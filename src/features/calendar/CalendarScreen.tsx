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
import { formatDue, formatLongDate, formatMonth, parseIsoDate } from '../../domain/format';
import { useTaskActions } from '../../app/task-actions';
import { calendarMonth, myMemberships } from '../../domain/views';
import { agenda } from '../../domain/views/agenda';
import { eventsByDate, timeLabel } from '../../domain/views/events';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, EventRow, Screen, StationRow, SwipeRow, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function CalendarScreen() {
  const { userId } = useServices();
  const actions = useTaskActions();
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
  const memberName = (id: string) => String(tables.group_members?.[id]?.display_name ?? '');
  const isoToday = formatIsoDate(today);

  return (
    <Screen testID="screen-calendar">
      <Title>{strings['calendar.title']}</Title>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings['calendar.prev']} onPress={() => shift(-1)} style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26, color: c.ink }}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={{ fontFamily: font.display700, fontSize: 20, color: c.ink }}>{formatMonth(ym.y, ym.m)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={strings['calendar.next']} onPress={() => shift(1)} style={{ width: size.TOUCH_TARGET, height: size.TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26, color: c.ink }}>›</Text>
        </Pressable>
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
          const label = strings['calendar.dayA11y'](formatLongDate(parseIsoDate(d.date), today), d.items.length, d.holiday, evs.length);
          return (
            <Pressable
              key={d.date}
              testID={`day-${d.date}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() => setSelected(d.date)}
              style={{ width: `${100 / 7}%`, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: on ? 2 : 0, borderColor: c.ink, backgroundColor: d.date === isoToday ? c.surface : 'transparent' }}
            >
              <Text style={{ fontFamily: d.holiday ? font.text700 : font.text400, fontSize: 16, color: d.holiday ? c.danger : d.inMonth ? c.ink : c.inkMuted }}>{n}</Text>
              <View style={{ flexDirection: 'row', gap: 2, height: 8, marginTop: 2 }}>
                {[...new Set([...evs.map((e) => e.line), ...d.items.map((i) => i.line)])].slice(0, 4).map((l) => (
                  <View key={l} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: line(l).line }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      {day ? (
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.display700, fontSize: 18, color: c.ink }}>
            {formatLongDate(parseIsoDate(day.date), today)}
            {day.holiday ? ` · ${day.holiday}` : ''}
          </Text>
          {day.items.length === 0 && dayEvents.length === 0 ? <Body muted>{strings['calendar.empty']}</Body> : null}
          {agenda(day.items, dayEvents).map((x) =>
            x.kind === 'event' ? (
              <EventRow key={x.key} testID={`cal-event-${x.event.eventId}-${x.event.occurrenceDate}`} title={x.event.title} time={timeLabel(x.event.startTime, x.event.endTime)} line={x.event.line} group={x.event.groupName} recurring={x.event.recurring} onPress={() => nav.navigate('Event', { eventId: x.event.eventId, date: x.event.occurrenceDate })} />
            ) : x.task.trip ? (
              <StationRow
                key={x.key}
                testID={`cal-trip-${x.task.id}`}
                title={strings['trip.title'](x.task.title)}
                line={x.task.line}
                group={x.task.groupName}
                meta={[formatDue(x.task.due!, today), strings['trip.open'](x.task.trip.open), ...(x.task.assignee_member_id ? [strings['task.assignedTo'](memberName(x.task.assignee_member_id))] : [])]}
                checked={false}
                onToggle={() => actions.finishTrip(x.task.id, x.task.title)}
                onOpen={() => nav.navigate('List', { listId: x.task.id })}
              />
            ) : (
              <SwipeRow key={x.key} title={x.task.title} enabled={roles.get(x.task.group_id)?.role !== 'child'} onDelete={() => actions.remove(x.task)}>
                <StationRow testID={`cal-${x.task.id}`} title={x.task.title} line={x.task.line} group={x.task.groupName} meta={[formatDue(x.task.due!, today)]} checked={false} onToggle={() => actions.toggle(x.task)} onOpen={() => nav.navigate('Task', { taskId: x.task.id })} />
              </SwipeRow>
            ),
          )}
        </View>
      ) : null}
      <Button kind="secondary" label={strings['calendar.addEvent']} testID="calendar-add-event" onPress={() => nav.navigate('EventEdit', { date: selected })} />
    </Screen>
  );
}
