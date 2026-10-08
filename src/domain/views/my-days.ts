/**
 * „Moje sprawy” w zakresie dnia, tygodnia albo miesiąca (decyzja właściciela z 7.10.2026, ADR 0009):
 *  - dzień miniony: zadania odhaczone tego dnia (data odhaczenia w czasie Europe/Warsaw) i wyszarzone wydarzenia,
 *  - dziś: zaległe (termin bez zmian, czerwony znacznik — D61) na górze, potem plan dnia (agenda.ts),
 *  - dzień przyszły: zadania z terminem tego dnia i wydarzenia.
 * Wygasłe (D61: „Tylko tego dnia”, zadanie na spotkaniu) nie przechodzą na dziś. Tydzień od poniedziałku
 * (PN-EN ISO 8601, jak kalendarz).
 */
import { addDays, type CivilDate, daysInMonth, formatIsoDate, isoWeekday, toDayNumber } from '../civil-date';
import { effectiveDue, isVisible } from '../deadlines';
import { parseIsoDate } from '../format';
import { agenda, type LessonBlock, type AgendaEntry } from './agenda';
import { occurrenceResolver } from './event-rows';
import { expandEvents, type Occurrence } from './events';
import { concernsMeTask, groupsView, isExpired, liveMemberIds, type TodayItem } from './index';
import { asList, asTask, rows, type Tables } from './model';
import { tripEntries } from './shopping-trip';

export type RangeMode = 'day' | 'week' | 'month';

export function rangeOf(mode: RangeMode, anchor: CivilDate): { from: CivilDate; to: CivilDate } {
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const from = addDays(anchor, -isoWeekday(anchor));
    return { from, to: addDays(from, 6) };
  }
  return { from: { y: anchor.y, m: anchor.m, d: 1 }, to: { y: anchor.y, m: anchor.m, d: daysInMonth(anchor.y, anchor.m) } };
}

/** Następny / poprzedni dzień, tydzień, miesiąc (w miesiącu dzień przycięty do długości miesiąca, np. 31 → 30). */
export function shiftAnchor(mode: RangeMode, anchor: CivilDate, k: number): CivilDate {
  if (mode === 'day') return addDays(anchor, k);
  if (mode === 'week') return addDays(anchor, 7 * k);
  const idx = anchor.y * 12 + (anchor.m - 1) + k;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

export type MyTask = TodayItem & { overdueDays: number };
export type MyEntry = AgendaEntry | { kind: 'overdue'; key: string; task: MyTask };
export type MyDay = { date: string; past: boolean; isToday: boolean; entries: MyEntry[] };
export type MyDaysView = { pinned: TodayItem[]; days: MyDay[] };

/**
 * Dni zakresu z ich zawartością. W tygodniu i miesiącu tylko dni, w których coś jest (i zawsze dziś);
 * w trybie dnia — zawsze ten jeden dzień. `localDate` zamienia chwilę odhaczenia (ISO, UTC) na dzień w Warszawie.
 */
export function myDays(t: Tables, userId: string, today: CivilDate, mode: RangeMode, anchor: CivilDate, localDate: (iso: string) => string): MyDaysView {
  const { from, to } = rangeOf(mode, anchor);
  const isoToday = formatIsoDate(today);
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter((l) => l.deleted_at === null).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
  const byId = new Map(all.map((x) => [x.id, x]));
  const live = liveMemberIds(t);
  const occ = occurrenceResolver(t);
  const pinned: TodayItem[] = [];
  const overdue: MyTask[] = [];
  const tasksByDay = new Map<string, TodayItem[]>();
  const push = (d: string, item: TodayItem) => tasksByDay.set(d, [...(tasksByDay.get(d) ?? []), item]);
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    // Pozycje list zakupów nie są sprawami — lista pokazuje się raz, jako „Zakupy: …” (D73; audyt 8.10.2026).
    if (!g || !l || l.kind === 'shopping') continue;
    const due = effectiveDue(x, byId, occ);
    if (!concernsMeTask(x, g, due, live)) continue;
    const mine = x.assignee_member_id === g.me.member_id;
    const item: TodayItem = { ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: mine ? g.me.display_name : null };
    if (x.completed_at !== null) {
      const d = localDate(x.completed_at);
      if (d < isoToday) push(d, item); // odhaczone dziś znikają z widoku (jak dotąd); historia dla minionych dni
      continue;
    }
    if (!isVisible(x, today) || isExpired(x, due, isoToday, byId)) continue;
    if (due === null) pinned.push(item);
    else if (due.date < isoToday) overdue.push({ ...item, overdueDays: toDayNumber(today) - toDayNumber(parseIsoDate(due.date)) });
    else push(due.date, item);
  }
  // Zakupy z terminem albo osobą (D73) — jak zadanie: bez terminu przypięte, po terminie zaległe, inaczej w swoim dniu.
  for (const trip of tripEntries(t, groups)) {
    if (trip.due === null) pinned.push(trip);
    else if (trip.due.date < isoToday) overdue.push({ ...trip, overdueDays: toDayNumber(today) - toDayNumber(parseIsoDate(trip.due.date)) });
    else push(trip.due.date, trip);
  }
  const events = new Map<string, Occurrence[]>();
  // D127: lekcje dziecka (sam w nich nie jestem) — jeden wiersz na dziecko i dzień; wspólna lekcja rodzeństwa w wierszu
  // każdego z dzieci (audyt 2, E-15: plan każdego dziecka kompletny).
  const lessons = new Map<string, Map<string, LessonBlock>>();
  for (const e of expandEvents(t, userId, from, to)) {
    if (!e.concernsMe) continue;
    if (!e.lessonFor) {
      events.set(e.date, [...(events.get(e.date) ?? []), e]);
      continue;
    }
    const day = lessons.get(e.date) ?? new Map<string, LessonBlock>();
    lessons.set(e.date, day);
    for (const child of e.lessonFor) {
      const b = day.get(child.memberId);
      if (b) b.lessons.push(e);
      else day.set(child.memberId, { memberId: child.memberId, name: child.name, groupId: e.groupId, groupName: e.groupName, line: e.line, start: null, end: null, lessons: [e] });
    }
  }
  for (const day of lessons.values())
    for (const b of day.values()) {
      // Godziny bloku: od najwcześniejszego początku do najpóźniejszego końca (lekcja bez końca liczy się początkiem).
      const starts = b.lessons.flatMap((x) => (x.startTime ? [x.startTime.slice(0, 5)] : [])).sort();
      const ends = b.lessons.flatMap((x) => (x.startTime ? [(x.endTime ?? x.startTime).slice(0, 5)] : [])).sort();
      b.start = starts[0] ?? null;
      b.end = ends.at(-1) ?? null;
    }

  const days: MyDay[] = [];
  for (let d = from; toDayNumber(d) <= toDayNumber(to); d = addDays(d, 1)) {
    const iso = formatIsoDate(d);
    const isToday = iso === isoToday;
    const past = iso < isoToday;
    const entries: MyEntry[] = [
      ...(isToday ? overdue.sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id)).map((x) => ({ kind: 'overdue' as const, key: `o-${x.id}`, task: x })) : []),
      ...agenda(tasksByDay.get(iso) ?? [], events.get(iso) ?? [], [...(lessons.get(iso)?.values() ?? [])]),
    ];
    if (mode === 'day' || isToday || entries.length) days.push({ date: iso, past, isToday, entries });
  }
  pinned.sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
  return { pinned, days };
}
