/**
 * Widoki ekranów: czyste funkcje z danych lokalnych (materialize) na to, co pokazuje ekran.
 * Reguły widoczności egzekwuje serwer (RLS); telefon dostaje tylko to, co wolno mu widzieć, więc tutaj
 * zostaje wybór i kolejność.
 */
import { config } from '../../config';
import { HOLIDAYS_FROM_YEAR } from '../../config/holidays.pl';
import { groupLines } from '../../config/theme';
import { addDays, type CivilDate, formatIsoDate, isoWeekday } from '../civil-date';
import { compareByDue, type Due, effectiveDue, isVisible } from '../deadlines';
import { polishHolidays } from '../holidays';
import { asGroup, asList, asMember, asTask, type Group, type List, type Member, rows, type Tables, type Task } from './model';

export * from './model';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pl');
const alive = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at === null;

/** Moje aktywne członkostwa: grupa → mój wiersz członka. */
export function myMemberships(t: Tables, userId: string): Map<string, Member> {
  return new Map(
    rows(t, 'group_members', asMember)
      .filter((m) => alive(m) && m.user_id === userId)
      .map((m) => [m.group_id, m]),
  );
}

const personalFirst = (g: Group) => (g.kind === 'personal' ? 0 : 1);

export type GroupItem = Group & { line: number; me: Member; memberCount: number };

/**
 * Grupy, do których należę: osobista pierwsza, potem w kolejności dołączenia do projektu (created_at).
 * `line` — numer koloru linii (src/config/theme.ts, groupLines); przydział po kolejności jest stały, dopóki
 * nie zmienia się zbiór grup, i dwie grupy nie dostają tego samego koloru, póki jest ich ≤ liczba kolorów.
 */
export function groupsView(t: Tables, userId: string): GroupItem[] {
  const mine = myMemberships(t, userId);
  const members = rows(t, 'group_members', asMember).filter(alive);
  return rows(t, 'groups', asGroup)
    .filter((g) => alive(g) && mine.has(g.id))
    .sort(
      (a, b) =>
        personalFirst(a) - personalFirst(b) ||
        (a.created_at ?? '￿').localeCompare(b.created_at ?? '￿') ||
        a.id.localeCompare(b.id),
    )
    .map((g, i) => ({ ...g, line: i % groupLines.length, me: mine.get(g.id)!, memberCount: members.filter((m) => m.group_id === g.id).length }));
}

const ROLE_ORDER = { owner: 0, admin: 1, member: 2, child: 3 } as const;

export type GroupDetail = {
  group: GroupItem;
  members: Member[];
  canInvite: boolean;
  canManageMembers: boolean;
  canLeave: boolean;
  canRename: boolean;
};

export function groupDetail(t: Tables, userId: string, groupId: string): GroupDetail | null {
  const group = groupsView(t, userId).find((g) => g.id === groupId);
  if (!group) return null;
  const members = rows(t, 'group_members', asMember)
    .filter((m) => alive(m) && m.group_id === groupId)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.display_name.localeCompare(b.display_name, 'pl'));
  const manager = group.me.role === 'owner' || group.me.role === 'admin';
  const shared = group.kind === 'shared';
  // Zgodnie ze strażnikiem członkostw (migracja invites): owner nie wychodzi (najpierw przekazuje grupę),
  // zaproszenia tylko w grupach wspólnych, nazwę grupy zmienia owner/admin.
  return { group, members, canInvite: shared && manager, canManageMembers: shared && manager, canLeave: shared && group.me.role !== 'owner', canRename: shared && manager };
}

export type ListItem = List & { line: number; groupName: string; open: number };

export function listsView(t: Tables, userId: string, groupId?: string): ListItem[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const tasks = rows(t, 'tasks', asTask).filter((x) => alive(x) && x.completed_at === null);
  return rows(t, 'lists', asList)
    .filter((l) => alive(l) && groups.has(l.group_id) && (groupId === undefined || l.group_id === groupId))
    .map((l) => {
      const g = groups.get(l.group_id)!;
      return { ...l, line: g.line, groupName: g.name, open: tasks.filter((x) => x.list_id === l.id).length };
    })
    .sort((a, b) => groupOrder(groups, a.group_id) - groupOrder(groups, b.group_id) || a.sort_key.localeCompare(b.sort_key) || byName(a, b));
}

function groupOrder(groups: Map<string, GroupItem>, id: string): number {
  return [...groups.keys()].indexOf(id);
}

export type TaskNode = Task & { due: Due; depth: number; children: TaskNode[]; assignee: string | null };

export type ListDetail = { list: ListItem; open: TaskNode[]; done: TaskNode[]; members: Member[] };

/**
 * Lista z drzewem zadań. Otwarte: przypięte (bez terminu) na górze, potem po terminie, potem sort_key
 * (compareByDue, D16). Zrobione osobno („W koszyku” na liście zakupów). Zadania z przyszłym start_date
 * są ukryte (D „przypnij za X dni”). Podzadania pod rodzicem, w tej samej kolejności.
 */
export function listDetail(t: Tables, userId: string, listId: string, today: CivilDate): ListDetail | null {
  const list = listsView(t, userId).find((l) => l.id === listId);
  if (!list) return null;
  const members = rows(t, 'group_members', asMember).filter((m) => alive(m) && m.group_id === list.group_id);
  const names = new Map(members.map((m) => [m.member_id, m.display_name]));
  const all = rows(t, 'tasks', asTask).filter((x) => alive(x) && x.list_id === listId);
  const byId = new Map(all.map((x) => [x.id, x]));
  const order = (a: TaskNode, b: TaskNode) => compareByDue(a.due, b.due) || a.sort_key.localeCompare(b.sort_key) || a.title.localeCompare(b.title, 'pl');
  const build = (parent: string | null, depth: number, done: boolean): TaskNode[] =>
    all
      .filter((x) => x.parent_id === parent && (depth > 0 || (x.completed_at !== null) === done) && isVisible(x, today))
      .map((x) => ({
        ...x,
        due: effectiveDue(x, byId),
        depth,
        assignee: x.assignee_member_id === null ? null : (names.get(x.assignee_member_id) ?? null),
        children: depth < config.MAX_TASK_DEPTH ? build(x.id, depth + 1, done) : [],
      }))
      .sort(order);
  return { list, open: build(null, 0, false), done: build(null, 0, true), members };
}

export type TodayItem = Task & { due: Due; line: number; groupName: string; listName: string; assignee: string | null };
export type TodayView = { overdue: TodayItem[]; pinned: TodayItem[]; today: TodayItem[]; tomorrow: TodayItem[] };

/**
 * „Dotyczy mnie” (D0.4: wszystko z moich grup, co dotyczy mnie dziś). Zadanie dotyczy mnie, gdy
 * jest otwarte, widoczne dziś (start_date) i: przypisane do mnie, albo nieprzypisane w mojej grupie
 * osobistej, albo nieprzypisane z terminem (każdy w grupie może je zrobić). Sekcje: zaległe, przypięte
 * (bez terminu — tylko moje i osobiste, żeby wspólne bez terminu nie zalewały widoku), dziś, jutro.
 */
export function todayView(t: Tables, userId: string, today: CivilDate): TodayView {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const isoToday = formatIsoDate(today);
  const isoTomorrow = formatIsoDate(addDays(today, 1));
  const out: TodayView = { overdue: [], pinned: [], today: [], tomorrow: [] };
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    if (!g || !l || x.completed_at !== null || !isVisible(x, today)) continue;
    const mine = x.assignee_member_id === g.me.member_id;
    const due = effectiveDue(x, byId);
    const unassigned = x.assignee_member_id === null;
    if (!(mine || (unassigned && (g.kind === 'personal' || due !== null)))) continue;
    const item: TodayItem = {
      ...x,
      due,
      line: g.line,
      groupName: g.name,
      listName: l.name,
      // W widoku są tylko zadania moje albo nieprzypisane, więc przypisana osoba to zawsze ja.
      assignee: mine ? g.me.display_name : null,
    };
    if (due === null) out.pinned.push(item);
    else if (due.date < isoToday) out.overdue.push(item);
    else if (due.date === isoToday) out.today.push(item);
    else if (due.date === isoTomorrow) out.tomorrow.push(item);
  }
  const order = (a: TodayItem, b: TodayItem) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id);
  for (const k of ['overdue', 'pinned', 'today', 'tomorrow'] as const) out[k].sort(order);
  return out;
}

export type CalendarDay = { date: string; inMonth: boolean; holiday: string | null; items: TodayItem[] };

/**
 * Miesiąc w siatce tygodni od poniedziałku (norma PN-EN ISO 8601: tydzień zaczyna się w poniedziałek).
 * Dni z zadaniami z terminem z moich grup i polskimi dniami wolnymi (src/domain/holidays.ts).
 * Wydarzenia (serie RRULE) dochodzą w Etapie 4.
 */
export function calendarMonth(t: Tables, userId: string, year: number, month: number): CalendarDay[] {
  const first: CivilDate = { y: year, m: month, d: 1 };
  const start = addDays(first, -isoWeekday(first)); // isoWeekday: 0 = poniedziałek
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const holidays = new Map([year - 1, year, year + 1].filter((y) => y >= HOLIDAYS_FROM_YEAR).flatMap((y) => polishHolidays(y)).map((h) => [h.date, h.name]));
  const byDate = new Map<string, TodayItem[]>();
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    const due = effectiveDue(x, byId);
    if (!g || !l || due === null || x.completed_at !== null) continue;
    const list = byDate.get(due.date) ?? [];
    list.push({ ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: null });
    byDate.set(due.date, list);
  }
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    if (i % 7 === 0 && i > 0 && (day.m !== month || day.y !== year)) break;
    const iso = formatIsoDate(day);
    const items = (byDate.get(iso) ?? []).sort((a, b) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl'));
    days.push({ date: iso, inMonth: day.m === month && day.y === year, holiday: holidays.get(iso) ?? null, items });
  }
  return days;
}
