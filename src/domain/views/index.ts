/**
 * Widoki ekranów: czyste funkcje z danych lokalnych (materialize) na to, co pokazuje ekran.
 * Reguły widoczności egzekwuje serwer (RLS); telefon dostaje tylko to, co wolno mu widzieć, więc tutaj
 * zostaje wybór i kolejność.
 */
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { monthGrid } from '../month-grid';
import { addDays, type CivilDate, formatIsoDate } from '../civil-date';
import { compareByDue, type Due, effectiveDue, isVisible } from '../deadlines';
import { occurrenceResolver } from './event-rows';
import { tripEntries } from './shopping-trip';
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
    .map((g, i) => ({ ...g, line: lineOf(g, i), me: mine.get(g.id)!, memberCount: members.filter((m) => m.group_id === g.id).length }));
}

/** Kolor wybrany przez właściciela (D56, wspólny dla wszystkich) albo przydział po kolejności. */
function lineOf(g: Group, i: number): number {
  const chosen = groupLines.findIndex((l) => l.key === g.color);
  return chosen >= 0 ? chosen : i % groupLines.length;
}

export type TrashedGroup = Group & { daysLeft: number };

/** Grupy w koszu, które mogę przywrócić (jestem właścicielem), z liczbą dni do trwałego usunięcia (D54). */
export function trashedGroups(t: Tables, userId: string, nowMs: number): TrashedGroup[] {
  const mine = myMemberships(t, userId);
  const day = 86_400_000;
  return rows(t, 'groups', asGroup)
    .filter((g) => g.deleted_at !== null && mine.get(g.id)?.role === 'owner')
    .map((g) => ({ ...g, daysLeft: Math.max(0, Math.ceil((Date.parse(g.deleted_at!) + config.sync.TOMBSTONE_DAYS * day - nowMs) / day)) }))
    .filter((g) => g.daysLeft > 0)
    .sort(byName);
}

const ROLE_ORDER = { owner: 0, admin: 1, member: 2, child: 3 } as const;

export type GroupDetail = {
  group: GroupItem;
  members: Member[];
  canInvite: boolean;
  /** Admina zaprasza tylko owner (private.create_invite). */
  canInviteAdmin: boolean;
  canManageMembers: boolean;
  canLeave: boolean;
  canRename: boolean;
  /** Kolor, kosz i przekazanie własności — tylko właściciel grupy wspólnej (D54–D56). */
  canSetColor: boolean;
  canDelete: boolean;
};

export type MemberActions = { rename: boolean; setRole: boolean; remove: boolean; makeOwner: boolean };

/**
 * Co mogę zrobić z członkiem — jak strażnik członkostw (migracje invites, groups_edit): imię zmienia owner/admin
 * albo sam członek; role i przekazanie tylko owner; usuwa owner (każdego poza sobą) albo admin (tylko member/child).
 * Nowy właściciel to dorosły z kontem (D49, D55).
 */
export function memberActions(d: GroupDetail, m: Member): MemberActions {
  const me = d.group.me;
  const self = m.member_id === me.member_id;
  const shared = d.group.kind === 'shared';
  const owner = me.role === 'owner';
  const admin = me.role === 'admin';
  return {
    rename: self || owner || admin,
    setRole: shared && owner && !self && m.role !== 'child' && m.user_id !== null,
    remove: shared && !self && (owner || (admin && (m.role === 'member' || m.role === 'child'))),
    makeOwner: shared && owner && !self && m.user_id !== null && (m.role === 'admin' || m.role === 'member'),
  };
}

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
  return { group, members, canInvite: shared && manager, canInviteAdmin: shared && group.me.role === 'owner', canManageMembers: shared && manager, canLeave: shared && group.me.role !== 'owner', canRename: shared && manager, canSetColor: group.me.role === 'owner', canDelete: shared && group.me.role === 'owner' };
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

/** `expired` — minęło bez odhaczenia (D61); na liście w sekcji zrobionych z dopiskiem. */
export type TaskNode = Task & { due: Due; depth: number; children: TaskNode[]; assignee: string | null; expired: boolean };

export type ListDetail = { list: ListItem; open: TaskNode[]; done: TaskNode[]; members: Member[] };

/**
 * Lista z drzewem zadań. Otwarte: przypięte (bez terminu) na górze, potem po terminie, potem sort_key
 * (compareByDue, D16). Zrobione osobno, razem z tymi, które minęły bez odhaczenia (D61) („W koszyku” na liście zakupów). Zadania z przyszłym start_date
 * są ukryte (D „przypnij za X dni”). Podzadania pod rodzicem, w tej samej kolejności.
 */
export function listDetail(t: Tables, userId: string, listId: string, today: CivilDate): ListDetail | null {
  const list = listsView(t, userId).find((l) => l.id === listId);
  if (!list) return null;
  const members = rows(t, 'group_members', asMember).filter((m) => alive(m) && m.group_id === list.group_id);
  const names = new Map(members.map((m) => [m.member_id, m.display_name]));
  const all = rows(t, 'tasks', asTask).filter((x) => alive(x) && x.list_id === listId);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const isoToday = formatIsoDate(today);
  const order = (a: TaskNode, b: TaskNode) => compareByDue(a.due, b.due) || a.sort_key.localeCompare(b.sort_key) || a.title.localeCompare(b.title, 'pl');
  const build = (parent: string | null, depth: number, done: boolean): TaskNode[] =>
    all
      .filter((x) => x.parent_id === parent && (depth > 0 || (x.completed_at !== null || isExpired(x, effectiveDue(x, byId, occ), isoToday)) === done) && isVisible(x, today))
      .map((x) => ({
        ...x,
        due: effectiveDue(x, byId, occ),
        expired: isExpired(x, effectiveDue(x, byId, occ), isoToday),
        depth,
        assignee: x.assignee_member_id === null ? null : (names.get(x.assignee_member_id) ?? null),
        children: depth < config.MAX_TASK_DEPTH ? build(x.id, depth + 1, done) : [],
      }))
      .sort(order);
  return { list, open: build(null, 0, false), done: build(null, 0, true), members };
}

/** `trip` — wpis zakupów z listy zakupów (D73, src/domain/views/shopping-trip.ts), nie zadanie. */
export type TodayItem = Task & { due: Due; line: number; groupName: string; listName: string; assignee: string | null; trip?: { listId: string; open: number } };
export type TodayView = { overdue: TodayItem[]; pinned: TodayItem[]; today: TodayItem[]; tomorrow: TodayItem[] };

/**
 * „Moje sprawy” (D0.4: wszystko z moich grup, co dotyczy mnie dziś). Zadanie dotyczy mnie, gdy
 * jest otwarte, widoczne dziś (start_date) i: przypisane do mnie, albo nieprzypisane w mojej grupie
 * osobistej, albo nieprzypisane z terminem (każdy w grupie może je zrobić). Sekcje: zaległe, przypięte
 * (bez terminu — tylko moje i osobiste, żeby wspólne bez terminu nie zalewały widoku), dziś, jutro.
 */
/** Zadanie dotyczy mnie (reguła „Moje sprawy” powyżej, bez warunku „otwarte”). */
export function concernsMeTask(x: Task, g: GroupItem, due: Due): boolean {
  const unassigned = x.assignee_member_id === null;
  return x.assignee_member_id === g.me.member_id || (unassigned && (g.kind === 'personal' || due !== null));
}

/**
 * Niezrobione zadanie po terminie mija zamiast przechodzić dalej (D61): „Tylko tego dnia” albo zadanie na spotkaniu
 * (D13 — po spotkaniu przepada, jak decyzja właściciela z 7.10.2026). Pozostałe zaległe przechodzą na dziś.
 */
export function isExpired(x: Pick<Task, 'rollover' | 'event_id' | 'completed_at'>, due: Due, isoToday: string): boolean {
  return x.completed_at === null && due !== null && due.date < isoToday && (!x.rollover || x.event_id !== null);
}

export function todayView(t: Tables, userId: string, today: CivilDate): TodayView {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const isoToday = formatIsoDate(today);
  const isoTomorrow = formatIsoDate(addDays(today, 1));
  const out: TodayView = { overdue: [], pinned: [], today: [], tomorrow: [] };
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    if (!g || !l || x.completed_at !== null || !isVisible(x, today)) continue;
    const mine = x.assignee_member_id === g.me.member_id;
    const due = effectiveDue(x, byId, occ);
    if (!concernsMeTask(x, g, due) || isExpired(x, due, isoToday)) continue;
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
 * Wydarzenia dokłada ekran (eventsByDate); zaplanowane zakupy (D73) są tu jako wpisy z `trip`.
 */
export function calendarMonth(t: Tables, userId: string, year: number, month: number): CalendarDay[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const byDate = new Map<string, TodayItem[]>();
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    const due = effectiveDue(x, byId, occ);
    if (!g || !l || due === null || x.completed_at !== null) continue;
    const list = byDate.get(due.date) ?? [];
    list.push({ ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: null });
    byDate.set(due.date, list);
  }
  // Zaplanowane zakupy z dniem (D73) — także cudze, jak zadania grupy.
  for (const trip of tripEntries(t, groups, true)) {
    if (trip.due === null) continue;
    byDate.set(trip.due.date, [...(byDate.get(trip.due.date) ?? []), trip]);
  }
  return monthGrid(year, month).map((g) => ({
    date: g.date,
    inMonth: g.inMonth,
    holiday: g.holiday,
    items: (byDate.get(g.date) ?? []).sort((a, b) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl')),
  }));
}
