/**
 * Widżet iOS „Moje sprawy” (D17, BRD B4).
 * Generuje lekki zrzut danych JSON do kontenera App Group:
 * data, łączna liczba pozostałych spraw na dziś oraz lista najbliższych pozycji
 * wraz z kolorami wstążek grup i linkami głębokimi (deep links).
 */
import { groupLines } from '../../config/theme';
import type { CivilDate } from '../civil-date';
import { formatIsoDate } from '../civil-date';
import { formatLongDate, formatTime } from '../format';
import type { TodayItem } from './index';
import type { MyScope } from './my-scope';
import { myDays } from './my-days';

export type WidgetItemKind = 'event' | 'task' | 'trip' | 'lessons';

export type WidgetItem = {
  id: string;
  title: string;
  time: string | null;
  kind: WidgetItemKind;
  groupName: string;
  groupLine: number;
  groupColor: string;
  isOverdue: boolean;
  deepLink: string;
};

export type WidgetPayload = {
  version: 1;
  updatedAt: string;
  today: string;
  dayLabel: string;
  totalRemainingCount: number;
  items: WidgetItem[];
};

export type BuildWidgetOptions = {
  tables: { [entity: string]: { [id: string]: any } };
  userId: string;
  today: CivilDate;
  nowIso: string;
  localIso: (utcIso: string) => string;
  scopeOf?: (groupId: string) => MyScope;
  maxItems?: number;
};

const formatSpan = (start: string | null | undefined, end: string | null | undefined): string | null => {
  if (!start) return null;
  const s = formatTime(start);
  return end ? `${s}–${formatTime(end)}` : s;
};

function groupInfo(tables: { [entity: string]: { [id: string]: any } }, groupId: string) {
  const grp = tables.groups![groupId];
  const line = grp.line >= 0 ? grp.line : 0;
  return {
    name: grp.name,
    line,
    color: groupLines[line % groupLines.length]!.light.line,
  };
}

export function buildWidgetPayload({
  tables,
  userId,
  today,
  nowIso,
  localIso,
  scopeOf = () => 'all',
  maxItems = 5,
}: BuildWidgetOptions): WidgetPayload {
  const isoToday = formatIsoDate(today);
  const view = myDays(tables, userId, today, 'day', today, localIso, scopeOf);
  const entries = view.days[0]!.entries;

  const mapTask = (t: TodayItem, isOverdue: boolean): WidgetItem => {
    const grp = groupInfo(tables, t.group_id);
    return {
      id: t.id,
      title: t.title,
      time: t.due?.time ? formatTime(t.due.time) : null,
      kind: t.trip ? 'trip' : 'task',
      groupName: grp.name,
      groupLine: grp.line,
      groupColor: grp.color,
      isOverdue,
      deepLink: t.trip ? `organizer://list/${t.trip.listId}` : `organizer://task/${t.id}`,
    };
  };

  const items: WidgetItem[] = entries.map((entry) => {
    switch (entry.kind) {
      case 'overdue':
        return mapTask(entry.task, true);
      case 'task':
        return mapTask(entry.task, false);
      case 'event': {
        const ev = entry.event;
        const grp = groupInfo(tables, ev.groupId);
        return {
          id: ev.eventId,
          title: ev.title,
          time: formatSpan(ev.startTime, ev.endTime),
          kind: 'event',
          groupName: grp.name,
          groupLine: grp.line,
          groupColor: grp.color,
          isOverdue: false,
          deepLink: `organizer://event/${ev.eventId}?date=${ev.occurrenceDate}`,
        };
      }
      case 'lessons': {
        const b = entry.block;
        const grp = groupInfo(tables, b.groupId);
        return {
          id: b.memberId,
          title: b.name,
          time: formatSpan(b.start, b.end),
          kind: 'lessons',
          groupName: b.groupName,
          groupLine: grp.line,
          groupColor: grp.color,
          isOverdue: false,
          deepLink: 'organizer://today',
        };
      }
    }
  });

  return {
    version: 1,
    updatedAt: nowIso,
    today: isoToday,
    dayLabel: formatLongDate(today, today),
    totalRemainingCount: entries.length,
    items: items.slice(0, maxItems),
  };
}
