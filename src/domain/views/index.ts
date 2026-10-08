/**
 * Widoki ekranów: czyste funkcje z danych lokalnych (materialize) na to, co pokazuje ekran.
 * Reguły widoczności egzekwuje serwer (RLS); telefon dostaje tylko to, co wolno mu widzieć, więc tutaj
 * zostaje wybór i kolejność.
 */
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { monthGrid } from '../month-grid';
import { addDays, type CivilDate, formatIsoDate, toDayNumber } from '../civil-date';
import { compareByDue, type Due, effectiveDue, isVisible } from '../deadlines';
import { parseIsoDate } from '../format';
import { concernsMe, liveMembers, ownPrivateList } from './concerns';
import { occurrenceResolver } from './event-rows';
import { repeatHeads, shoppingSplit, type Split, splitList } from './list-tree';
import { doneTrips, tripEntries } from './shopping-trip';
import { formatRepeat, repeatOf } from './task-repeat';
import { occurrences, parseRule } from '../rrule';
import { memberCanSeeList } from './visibility';
import type { MyScope } from './my-scope';
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
 * nie zmienia się zbiór grup ani wybrane kolory, i dwie grupy nie dostają tego samego koloru, póki jest ich ≤ liczba
 * kolorów (chyba że właściciele dwóch grup wybrali ten sam).
 */
export function groupsView(t: Tables, userId: string): GroupItem[] {
  const mine = myMemberships(t, userId);
  const members = rows(t, 'group_members', asMember).filter(alive);
  const groups = rows(t, 'groups', asGroup)
    .filter((g) => alive(g) && mine.has(g.id))
    .sort(
      (a, b) =>
        personalFirst(a) - personalFirst(b) ||
        (a.created_at ?? '￿').localeCompare(b.created_at ?? '￿') ||
        a.id.localeCompare(b.id),
    );
  const lines = linesOf(groups);
  return groups.map((g, i) => ({ ...g, line: lines[i]!, me: mine.get(g.id)!, memberCount: members.filter((m) => m.group_id === g.id).length }));
}

/**
 * Kolor wybrany przez właściciela (D56, wspólny dla wszystkich) albo przydział po kolejności spośród kolorów, których
 * nie wybrał właściciel żadnej z moich grup (audyt 2, R-23: wybrany kolor nie dubluje się z automatycznym). Gdy wolnych
 * zabraknie, automatyczne powtarzają wolne po kolei, a gdy wybrane są wszystkie — całą paletę.
 */
function linesOf(groups: readonly Group[]): number[] {
  const chosen = groups.map((g) => groupLines.findIndex((l) => l.key === g.color));
  const all = groupLines.map((_, i) => i);
  const free = all.filter((i) => !chosen.includes(i));
  const pool = free.length > 0 ? free : all;
  let next = 0;
  return chosen.map((c) => (c >= 0 ? c : pool[next++ % pool.length]!));
}

/** `restoreUntilMs` — do kiedy właściciel może przywrócić grupę; `canRestore` — to ja (właściciel). */
export type TrashedGroup = Group & { daysLeft: number; restoreUntilMs: number; canRestore: boolean };

/**
 * Moje grupy w koszu z liczbą dni do trwałego usunięcia (D54). Przywraca tylko właściciel; pozostali członkowie widzą
 * wpis z datą, zamiast żeby grupa po prostu znikała (decyzja właściciela z 8.10.2026, PWD-21 A).
 */
export function trashedGroups(t: Tables, userId: string, nowMs: number): TrashedGroup[] {
  const mine = myMemberships(t, userId);
  const day = 86_400_000;
  return rows(t, 'groups', asGroup)
    .filter((g) => g.deleted_at !== null && mine.has(g.id))
    .map((g) => {
      const restoreUntilMs = Date.parse(g.deleted_at!) + config.sync.TOMBSTONE_DAYS * day;
      return { ...g, restoreUntilMs, daysLeft: Math.max(0, Math.ceil((restoreUntilMs - nowMs) / day)), canRestore: mine.get(g.id)!.role === 'owner' };
    })
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
 * Co mogę zrobić z członkiem — jak strażnik członkostw (migracje invites, groups_edit, 20261008360000): imię osoby z kontem
 * zmienia ona sama albo owner, a profilu bez konta — owner albo admin (decyzja właściciela z 8.10.2026, PW-54 A); role
 * i przekazanie tylko owner; usuwa owner (każdego poza sobą) albo admin (tylko member/child).
 * Nowy właściciel to dorosły z kontem (D49, D55).
 */
export function memberActions(d: GroupDetail, m: Member): MemberActions {
  const me = d.group.me;
  const self = m.member_id === me.member_id;
  const shared = d.group.kind === 'shared';
  const owner = me.role === 'owner';
  const admin = me.role === 'admin';
  return {
    rename: self || owner || (admin && m.user_id === null),
    setRole: shared && owner && !self && m.role !== 'child' && m.user_id !== null,
    remove: shared && !self && (owner || (admin && (m.role === 'member' || m.role === 'child'))),
    makeOwner: shared && owner && !self && m.user_id !== null && (m.role === 'admin' || m.role === 'member'),
  };
}

export type RemovedMember = Member & { daysLeft: number };

/**
 * Osoby usunięte z grupy, które mogę przywrócić (D165, decyzja z 8.10.2026): przez config.sync.TOMBSTONE_DAYS dni od
 * usunięcia, z prawami jak przy usuwaniu (owner — każdego, admin — członka i dziecko). Konto, które samo wyszło (bez
 * `removed_at`, który wpisuje serwer), wraca tylko przez zaproszenie. Pod kosz osób (D151); dziś przywraca pasek „Cofnij”.
 */
export function removedMembers(t: Tables, userId: string, groupId: string, nowMs: number): RemovedMember[] {
  const me = myMemberships(t, userId).get(groupId);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) return [];
  const day = 86_400_000;
  return rows(t, 'group_members', (r) => ({ m: asMember(r), removedAt: r.user_id == null ? r.deleted_at : r.removed_at }))
    .filter(({ m, removedAt }) => m.group_id === groupId && m.deleted_at !== null && typeof removedAt === 'string' && (me.role === 'owner' || m.role === 'member' || m.role === 'child'))
    .map(({ m, removedAt }) => ({ ...m, daysLeft: Math.ceil((Date.parse(removedAt as string) + config.sync.TOMBSTONE_DAYS * day - nowMs) / day) }))
    .filter((m) => m.daysLeft > 0)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'));
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

/** Licznik listy liczy `listOpenCount` (zależy od dnia: ukryte do daty i minione — D61). */
export type ListItem = List & { line: number; groupName: string };

export function listsView(t: Tables, userId: string, groupId?: string): ListItem[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  return rows(t, 'lists', asList)
    .filter((l) => alive(l) && groups.has(l.group_id) && (groupId === undefined || l.group_id === groupId))
    .map((l) => {
      const g = groups.get(l.group_id)!;
      return { ...l, line: g.line, groupName: g.name };
    })
    .sort((a, b) => groupOrder(groups, a.group_id) - groupOrder(groups, b.group_id) || a.sort_key.localeCompare(b.sort_key) || byName(a, b));
}

function groupOrder(groups: Map<string, GroupItem>, id: string): number {
  return [...groups.keys()].indexOf(id);
}

/**
 * `expired` — minęło bez odhaczenia (D61); `closed` — zrobione albo minione (stoi w zamkniętych); `parentTitle` — rodzic
 * podzadania, które stoi w otwartych, choć rodzic jest zamknięty (M-82). `depth` — prawdziwa głębokość w drzewie (D4).
 */
export type TaskNode = Task & { due: Due; depth: number; children: TaskNode[]; assignee: string | null; expired: boolean; closed: boolean; parentTitle: string | null };

/**
 * Wiersz zamkniętych na ekranie listy: zadanie albo zwinięte minione kopie zadania powtarzanego (decyzja właściciela
 * z 8.10.2026, audyt 2: PWD-14 A, M-283) — „12 razy minęło”, rozwijane. Zwijamy od dwóch minionych kopii jednego łańcucha
 * (repeatHeads); `title` — z najnowszej kopii.
 */
export type DoneRow = { kind: 'task'; node: TaskNode } | { kind: 'run'; key: string; title: string; nodes: TaskNode[] };

export type ListDetail = { list: ListItem; open: TaskNode[]; done: TaskNode[]; doneRows: DoneRow[]; members: Member[] };

type ListState = { split: Split<Task>; due: (x: Task) => Due; expired: (x: Task) => boolean };

/**
 * Zadania listy na jej ekranie (list-tree.ts). Lista zadań: bez ukrytych do daty (start_date), zamknięte = zrobione albo
 * minione (D61). Lista zakupów: pozycje bez terminów i ukrywania (D73), zamknięte = w koszyku (shoppingSplit).
 */
function listState(t: Tables, list: Pick<List, 'id' | 'kind'>, today: CivilDate): ListState {
  const all = rows(t, 'tasks', asTask).filter((x) => alive(x) && x.list_id === list.id);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const due = (x: Task) => effectiveDue(x, byId, occ);
  if (list.kind === 'shopping') return { split: shoppingSplit(t, list.id), due, expired: () => false };
  const isoToday = formatIsoDate(today);
  const expired = (x: Task) => isExpired(x, due(x), isoToday, byId);
  const visible = all.filter((x) => isVisible(x, today));
  return { split: splitList(visible, (x) => x.completed_at !== null || expired(x)), due, expired };
}

/**
 * Licznik listy: „N otwarte”, a na liście zakupów „N do kupienia” (audyt 2, M-83, T-8, R-15) — tyle, ile wierszy stoi
 * w otwartych na ekranie listy (listDetail), na ekranie List, w grupie i (zakupy) w Moich sprawach.
 */
export function listOpenCount(t: Tables, list: Pick<List, 'id' | 'kind'>, today: CivilDate): number {
  return listState(t, list, today).split.open.length;
}

/**
 * Lista z drzewem zadań. Otwarte: przypięte (bez terminu) na górze, potem po terminie, potem sort_key
 * (compareByDue, D16). Zamknięte osobno: zrobione i te, które minęły bez odhaczenia (D61) („W koszyku” na liście
 * zakupów). Zadania z przyszłym start_date („widoczne od”, funkcja bez UI — zob. visibleOnItsDay) są ukryte do tego dnia.
 * Podzadania pod rodzicem, w tej samej kolejności, wszystkie (ekran zadania pokazuje je w całości); otwarte podzadanie
 * zamkniętego rodzica stoi też w otwartych z dopiskiem rodzica (M-82) — ekran listy nie powtarza go w zamkniętych.
 */
export function listDetail(t: Tables, userId: string, listId: string, today: CivilDate): ListDetail | null {
  const list = listsView(t, userId).find((l) => l.id === listId);
  if (!list) return null;
  const members = rows(t, 'group_members', asMember).filter((m) => alive(m) && m.group_id === list.group_id);
  const names = new Map(members.map((m) => [m.member_id, m.display_name]));
  const s = listState(t, list, today);
  const order = (a: TaskNode, b: TaskNode) => compareByDue(a.due, b.due) || a.sort_key.localeCompare(b.sort_key) || a.title.localeCompare(b.title, 'pl');
  const node = (x: Task, depth: number, parent: Task | null): TaskNode => {
    const expired = s.expired(x);
    return {
      ...x,
      due: s.due(x),
      expired,
      closed: x.completed_at !== null || expired,
      parentTitle: parent?.title ?? null,
      depth,
      assignee: x.assignee_member_id === null ? null : (names.get(x.assignee_member_id) ?? null),
      children: depth < config.MAX_TASK_DEPTH ? (s.split.children.get(x.id) ?? []).map((c) => node(c, depth + 1, null)).sort(order) : [],
    };
  };
  const done = s.split.done.map((x) => node(x, 0, null)).sort(order);
  const head = repeatHeads(t, list.id);
  const runs = new Map<string, TaskNode[]>();
  for (const n of done) if (n.expired) runs.set(head(n.id), [...(runs.get(head(n.id)) ?? []), n]);
  const doneRows: DoneRow[] = [];
  const shown = new Set<string>();
  for (const n of done) {
    const key = head(n.id);
    const run = n.expired ? runs.get(key)! : [];
    if (run.length < 2) doneRows.push({ kind: 'task', node: n });
    else if (!shown.has(key)) {
      shown.add(key);
      doneRows.push({ kind: 'run', key, title: run.at(-1)!.title, nodes: run });
    }
  }
  // Audyt 2 (T-10, R-5): do wyboru osoby tylko ci, którzy widzą listę (serwer odrzuca innych); imiona — wszystkich.
  return {
    list,
    open: s.split.open.map((r) => node(r.x, r.depth, r.parent)).sort(order),
    done,
    doneRows,
    members: members.filter((m) => memberCanSeeList(t, m.member_id, list.id)),
  };
}

/**
 * `trip` — wpis zakupów z listy zakupów (D73, src/domain/views/shopping-trip.ts), nie zadanie. `assignee` — imię osoby
 * zadania w Moich sprawach (ja albo dziecko bez konta); `null` — nikt konkretny.
 */
export type TodayItem = Task & { due: Due; line: number; groupName: string; listName: string; assignee: string | null; trip?: { listId: string; open: number } };
export type TodayView = { overdue: TodayItem[]; pinned: TodayItem[]; today: TodayItem[]; tomorrow: TodayItem[] };

/**
 * Reguła „Moje sprawy” (D89; wcześniej „Dotyczy mnie”, ADR 0006, 0011): zadanie dotyczy mnie, gdy jest przypisane do mnie,
 * albo nieprzypisane w mojej grupie osobistej, albo nieprzypisane z terminem (każdy w grupie może je zrobić). Bez terminu
 * (przypięte) — tylko moje i osobiste, żeby wspólne bez terminu nie zalewały widoku. Osoba usunięta z grupy (albo która
 * wyszła) to „nikt konkretny” (D132) — jej zadanie nie znika wszystkim. Zadanie dziecka bez konta (profil, D10) dotyczy
 * każdego dorosłego tej grupy, który widzi listę — jak wydarzenie z dzieckiem-uczestnikiem (D58; decyzja właściciela
 * z 8.10.2026, audyt 2: T-25, P-1). Warunki „otwarte”, „widoczne” i „nie minęło” sprawdza widok. Ekran „Moje sprawy”
 * układa dni z my-days.ts (D62); `todayView` niżej to dawny układ sekcji zaległe / przypięte / dziś / jutro.
 */
export { liveMembers };

/**
 * Na mojej liście „Tylko ja” zadanie bez osoby jest moje, jak w grupie osobistej (PW-18 A; concerns.ts). `scope` — zakres
 * Moich spraw w grupie (PW-2): zadanie dziecka bez konta jest wtedy tylko w „Wszystko” (nie jest przypisane do mnie).
 */
export function concernsMeTask(t: Tables, x: Task, g: GroupItem, due: Due, live: ReadonlyMap<string, Member>, list: Pick<List, 'visibility' | 'owner_member_id'>, scope: MyScope = 'all'): boolean {
  const a = x.assignee_member_id === null ? undefined : live.get(x.assignee_member_id);
  if (a && a.member_id !== g.me.member_id && a.role === 'child' && a.user_id === null) return scope === 'all' && g.me.role !== 'child' && memberCanSeeList(t, g.me.member_id, x.list_id);
  return concernsMe(x.assignee_member_id, g, due, live, ownPrivateList(list, g), scope);
}

/** Imię osoby zadania (żywej; usunięta z grupy — nikt, D132). */
export const assigneeName = (x: Pick<Task, 'assignee_member_id'>, live: ReadonlyMap<string, Member>) => (x.assignee_member_id === null ? null : (live.get(x.assignee_member_id)?.display_name ?? null));

/**
 * start_date („widoczne od”, D „przypnij za X dni”) — bez UI: żaden ekran go nie ustawia, logika czeka na tę funkcję.
 * Przypięte i zaległe liczą się względem dziś, zadanie z terminem — względem dnia, w którym stoi (audyt 2, T-23).
 */
export function visibleOnItsDay(x: Pick<Task, 'start_date'>, due: Due, today: CivilDate): boolean {
  return isVisible(x, due === null || due.date < formatIsoDate(today) ? today : parseIsoDate(due.date));
}

type ExpiryTerms = Pick<Task, 'rollover' | 'deadline_mode' | 'parent_id' | 'completed_at'>;

/**
 * Niezrobione zadanie po terminie mija zamiast przechodzić dalej (D61): „Tylko tego dnia” albo termin spotkania
 * (D13 — po spotkaniu przepada, jak decyzja właściciela z 7.10.2026). Pozostałe zaległe przechodzą na dziś.
 * O tym decyduje zadanie, od którego pochodzi termin: podzadanie z dziedziczonym terminem mija razem z rodzicem
 * (audyt 8.10.2026 — wcześniej zostawało samo jako zaległe). Zadanie podpięte do spotkania, ale z własnym terminem,
 * przechodzi dalej jak każde inne. Podzadanie zrobionego zadania (odhaczonego z „Zostaw podzadania”) też mija po swoim
 * terminie — następny termin zadania powtarzanego ma własne kopie podzadań (decyzja właściciela z 8.10.2026; audyt 2,
 * T-13: wcześniej wisiało jako zaległe bez końca).
 */
export function isExpired(x: ExpiryTerms, due: Due, isoToday: string, byId: ReadonlyMap<string, ExpiryTerms> = new Map()): boolean {
  if (x.completed_at !== null || due === null || due.date >= isoToday) return false;
  // Ograniczenie kroków jak w effectiveDue (uszkodzone dane lokalne, np. cykl).
  for (let p = byId.get(x.parent_id ?? ''), step = 0; p && step < 8; p = byId.get(p.parent_id ?? ''), step++) if (p.completed_at !== null) return true;
  let source: ExpiryTerms = x;
  // Termin jest (due ≠ null), więc łańcuch „inherit” kończy się zadaniem z własnym terminem albo spotkaniem — effectiveDue
  // przeszedł go tą samą mapą. Ograniczenie kroków jak tam (uszkodzone dane lokalne).
  for (let step = 0; step < 8; step++) {
    if (source.deadline_mode !== 'inherit') break;
    source = byId.get(source.parent_id!)!;
  }
  return !source.rollover || source.deadline_mode === 'event';
}

export function todayView(t: Tables, userId: string, today: CivilDate): TodayView {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const live = liveMembers(t);
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const isoToday = formatIsoDate(today);
  const isoTomorrow = formatIsoDate(addDays(today, 1));
  const out: TodayView = { overdue: [], pinned: [], today: [], tomorrow: [] };
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    if (!g || !l || l.kind === 'shopping' || x.completed_at !== null) continue;
    const due = effectiveDue(x, byId, occ);
    if (!concernsMeTask(t, x, g, due, live, l) || !visibleOnItsDay(x, due, today) || isExpired(x, due, isoToday, byId)) continue;
    const item: TodayItem = { ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: assigneeName(x, live) };
    if (due === null) out.pinned.push(item);
    else if (due.date < isoToday) out.overdue.push(item);
    else if (due.date === isoToday) out.today.push(item);
    else if (due.date === isoTomorrow) out.tomorrow.push(item);
  }
  const order = (a: TodayItem, b: TodayItem) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id);
  for (const k of ['overdue', 'pinned', 'today', 'tomorrow'] as const) out[k].sort(order);
  return out;
}

/**
 * Wpis dnia w Kalendarzu. `doneOn` — dzień odhaczenia (Europe/Warsaw), gdy inny niż dzień, w którym wpis stoi (PWD-1 C,
 * audyt 2 M-173: „zrobione śr.”); `projected` — policzony przyszły termin zadania powtarzanego (PWD-15 A, M-284: blady,
 * bez odhaczania); `expired` — minęło bez odhaczenia (D61, „minęło”); `overdueDays` — niezrobione po terminie, które
 * przechodzi na kolejne dni (D61, „zaległe od …”), inaczej 0. Ten sam opis wiersza co w Moich sprawach (M-129).
 */
export type CalendarItem = TodayItem & { doneOn: string | null; projected: boolean; expired: boolean; overdueDays: number };
export type CalendarDay = { date: string; inMonth: boolean; holiday: string | null; items: CalendarItem[] };

/**
 * Miesiąc w siatce tygodni od poniedziałku (norma PN-EN ISO 8601: tydzień zaczyna się w poniedziałek).
 * Dni z zadaniami z terminem z moich grup i polskimi dniami wolnymi (src/domain/holidays.ts).
 * Wydarzenia dokłada ekran (eventsByDate); zaplanowane zakupy (D73) są tu jako wpisy z `trip`, a ostatnie zrobione
 * zakupy listy — przekreślone w dniu planu (PWD-11 A, M-280; doneTrips).
 * `today` i `localDate` (chwila → dzień w Warszawie) — do „zrobione śr.”, „minęło” i „zaległe”; bez nich (testy siatki)
 * dzisiaj = 1.01.1970, a dzień odhaczenia = data UTC.
 */
export function calendarMonth(t: Tables, userId: string, year: number, month: number, opts: { today?: CivilDate; localDate?: (iso: string) => string } = {}): CalendarDay[] {
  const isoToday = formatIsoDate(opts.today ?? { y: 1970, m: 1, d: 1 });
  const localDate = opts.localDate ?? ((iso: string) => iso.slice(0, 10));
  const grid = monthGrid(year, month);
  const last = grid.at(-1)!.date;
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const byDate = new Map<string, CalendarItem[]>();
  const add = (date: string, item: CalendarItem) => byDate.set(date, [...(byDate.get(date) ?? []), item]);
  const doneOn = (date: string, completedAt: string | null) => {
    const d = completedAt === null ? null : localDate(completedAt);
    return d === date ? null : d;
  };
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    const due = effectiveDue(x, byId, occ);
    // D135: Kalendarz = co było zaplanowane — także zrobione (przekreślone) i minione, w dniu swojego terminu.
    // Niezrobione „widoczne od” późniejszego dnia (start_date) w dniu terminu jeszcze nie stoi — jak w Moich sprawach.
    if (!g || !l || l.kind === 'shopping' || due === null || (x.completed_at === null && !isVisible(x, parseIsoDate(due.date)))) continue;
    const expired = isExpired(x, due, isoToday, byId);
    const overdue = x.completed_at === null && !expired && due.date < isoToday;
    const item: TodayItem = { ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: null };
    add(due.date, { ...item, doneOn: doneOn(due.date, x.completed_at), projected: false, expired, overdueDays: overdue ? dayDiff(isoToday, due.date) : 0 });
    // PWD-15 A: kolejne terminy otwartego zadania powtarzanego według kalendarza (od wykonania — nie da się ich
    // przewidzieć), tylko w oknie siatki; zadanie powstanie dopiero po odhaczeniu poprzedniego (task-repeat.ts).
    for (const date of x.completed_at === null && x.parent_id === null ? futureRepeats(t, x, due, last) : []) add(date, { ...item, due: { date, time: due.time }, doneOn: null, projected: true, expired: false, overdueDays: 0 });
  }
  // Zaplanowane zakupy z dniem (D73) — także cudze, jak zadania grupy; ostatnie zrobione — przekreślone (PWD-11 A).
  for (const trip of tripEntries(t, groups, true)) {
    if (trip.due === null) continue;
    const overdue = trip.due.date < isoToday;
    add(trip.due.date, { ...trip, doneOn: null, projected: false, expired: false, overdueDays: overdue ? dayDiff(isoToday, trip.due.date) : 0 });
  }
  for (const trip of doneTrips(t, groups, localDate)) add(trip.due!.date, { ...trip, doneOn: doneOn(trip.due!.date, trip.completed_at), projected: false, expired: false, overdueDays: 0 });
  return grid.map((g) => ({
    date: g.date,
    inMonth: g.inMonth,
    holiday: g.holiday,
    items: (byDate.get(g.date) ?? []).sort((a, b) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl')),
  }));
}

const dayDiff = (a: string, b: string) => toDayNumber(parseIsoDate(a)) - toDayNumber(parseIsoDate(b));

/** Daty kolejnych terminów zadania powtarzanego według kalendarza po `due`, do `last` włącznie (PWD-15 A). */
function futureRepeats(t: Tables, x: Task, due: NonNullable<Due>, last: string): string[] {
  const r = x.deadline_mode === 'own' ? repeatOf(t, x.id) : null;
  if (!r || r.kind === 'after' || due.date >= last) return [];
  const start = parseIsoDate(due.date);
  return occurrences(start, parseRule(formatRepeat(r)), addDays(start, 1), parseIsoDate(last)).map(formatIsoDate);
}
