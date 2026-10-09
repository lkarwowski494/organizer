/**
 * Kosz (decyzja właściciela z 8.10.2026, audyt 2: PW-4 A, M-34; D151, D165): usunięte listy, zadania, pozycje zakupów
 * (bez kupionych — audyt 3, N-49),
 * wydarzenia i osoby z ostatnich config.sync.TOMBSTONE_DAYS dni — tyle serwer trzyma usunięte wiersze, potem czyści kosz.
 * Grupy w koszu ma osobno `trashedGroups` (przywraca je RPC, D54).
 *
 * Pokazujemy tylko to, co mogę przywrócić (serwer i tak odrzuci resztę — RLS): dziecko niczego nie usuwa ani nie
 * przywraca (D34), osoby — jak przy usuwaniu (`removedMembers`). Zadanie z usuniętej listy albo pod usuniętym rodzicem
 * wraca razem z nimi (wyzwalacze lists_cascade i tasks_cascade w 20261006120100_lists_tasks.sql), a samo zostałoby
 * odrzucone („deleted:list”, „deleted:parent”) — więc w koszu stoi tylko lista albo rodzic.
 */
import { config } from '../../config';
import { groupsView, removedMembers } from './index';
import { asList, asTask, type Tables } from './model';

export type TrashKind = 'list' | 'task' | 'item' | 'event' | 'member';

export type TrashEntry = {
  kind: TrashKind;
  entity: 'lists' | 'tasks' | 'events' | 'group_members';
  id: string;
  title: string;
  groupName: string;
  line: number;
  /** Lista zadania albo pozycji; przy liście — liczba zadań, które wrócą razem z nią. */
  listName: string | null;
  tasks: number;
  /** Lista zakupów (liczba to pozycje, nie zadania). */
  shopping: boolean;
  deletedMs: number;
  daysLeft: number;
};

const DAY = 86_400_000;

/** Kolejność sekcji kosza na ekranie. */
export const TRASH_KINDS: readonly TrashKind[] = ['list', 'task', 'item', 'event', 'member'];

/**
 * Wszystko w koszu, najnowsze pierwsze. Usunięcie jeszcze niewysłane (deleted_at = „pending”, applyOp) liczy się od teraz.
 */
export function trashView(t: Tables, userId: string, nowMs: number): TrashEntry[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const out: TrashEntry[] = [];
  const when = (deletedAt: unknown) => (typeof deletedAt === 'string' && Number.isFinite(Date.parse(deletedAt)) ? Date.parse(deletedAt) : nowMs);
  const add = (e: Omit<TrashEntry, 'daysLeft' | 'groupName' | 'line'> & { groupId: string }) => {
    const g = groups.get(e.groupId)!;
    const { groupId: _g, ...rest } = e;
    out.push({ ...rest, groupName: g.name, line: g.line, daysLeft: Math.ceil((e.deletedMs + config.sync.TOMBSTONE_DAYS * DAY - nowMs) / DAY) });
  };
  const adult = (groupId: string) => {
    const g = groups.get(groupId);
    return g !== undefined && g.me.role !== 'child';
  };
  const lists = t.lists ?? {};
  const tasks = Object.values(t.tasks ?? {}).map(asTask);
  for (const raw of Object.values(lists)) {
    const l = asList(raw);
    if (l.deleted_at === null || !adult(l.group_id)) continue;
    // Zadania, które wrócą z listą: usunięte razem z nią (ten sam znacznik) i jeszcze nieusunięte lokalnie (usunięcie listy
    // niewysłane — kaskadę robi dopiero serwer).
    const n = tasks.filter((x) => x.list_id === l.id && (x.deleted_at === null || x.deleted_at === l.deleted_at)).length;
    add({ kind: 'list', entity: 'lists', id: l.id, title: l.name, groupId: l.group_id, listName: null, tasks: n, shopping: l.kind === 'shopping', deletedMs: when(l.deleted_at) });
  }
  const byId = new Map(tasks.map((x) => [x.id, x]));
  for (const x of tasks) {
    if (x.deleted_at === null || !adult(x.group_id)) continue;
    const list = lists[x.list_id];
    if (!list || list.deleted_at != null) continue;
    if (x.parent_id !== null && byId.get(x.parent_id)?.deleted_at !== null) continue;
    const l = asList(list);
    // Decyzja właściciela (audyt 3: Q9 B, N-49): kupione (usunięte z koszyka, np. „Zakupy zrobione”) nie są w Koszu —
    // wracają z sekcji „Kupione w ostatnich zakupach” na liście (shopping-trip.ts, boughtItems).
    if (l.kind === 'shopping' && x.completed_at !== null) continue;
    add({ kind: l.kind === 'shopping' ? 'item' : 'task', entity: 'tasks', id: x.id, title: x.title, groupId: x.group_id, listName: l.name, tasks: 0, shopping: false, deletedMs: when(x.deleted_at) });
  }
  for (const e of Object.values(t.events ?? {})) {
    if (e.deleted_at == null || !adult(String(e.group_id))) continue;
    add({ kind: 'event', entity: 'events', id: String(e.id), title: String(e.title ?? ''), groupId: String(e.group_id), listName: null, tasks: 0, shopping: false, deletedMs: when(e.deleted_at) });
  }
  for (const g of groups.values()) {
    for (const m of removedMembers(t, userId, g.id, nowMs)) {
      add({ kind: 'member', entity: 'group_members', id: m.member_id, title: m.display_name, groupId: g.id, listName: null, tasks: 0, shopping: false, deletedMs: when(m.user_id === null ? m.deleted_at : t.group_members?.[m.member_id]?.removed_at) });
    }
  }
  return out.filter((e) => e.daysLeft > 0).sort((a, b) => b.deletedMs - a.deletedMs || a.title.localeCompare(b.title, 'pl'));
}
