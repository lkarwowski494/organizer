/**
 * Typowane wiersze z `materialize()` silnika synchronizacji (src/domain/sync-engine/client.ts).
 * Kolumny jak w migracjach SQL (supabase/migrations/*). Ekrany czytają wyłącznie przez funkcje z src/domain/views.
 */
import type { Row } from '../sync-engine/client';

export type Tables = { readonly [e: string]: { readonly [id: string]: Row } };

export type Group = { id: string; name: string; kind: 'personal' | 'shared'; color: string | null; created_at: string | null; deleted_at: string | null };
export type Member = {
  member_id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: 'owner' | 'admin' | 'member' | 'child';
  created_at: string | null;
  deleted_at: string | null;
};
export type List = {
  id: string;
  group_id: string;
  kind: 'tasks' | 'shopping';
  name: string;
  visibility: 'group' | 'restricted' | 'private';
  owner_member_id: string | null;
  sort_key: string;
  deleted_at: string | null;
};
export type Task = {
  id: string;
  group_id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  note: string | null;
  sort_key: string;
  assignee_member_id: string | null;
  deadline_mode: 'none' | 'own' | 'inherit' | 'event';
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  /** Podpięcie do wystąpienia wydarzenia (D13): seria i data wystąpienia według reguły. */
  event_id: string | null;
  occurrence_date: string | null;
  /** D61: niezrobione przechodzi na kolejne dni (domyślnie); `false` = „Tylko tego dnia”, mija jak wydarzenie. */
  rollover: boolean;
  /** Kopia stałego zadania serii (D65) — definicja w event_task_series. */
  series_id: string | null;
  /**
   * Audyt 3 (N-25): pierwotny dzień terminu zadania powtarzanego przeniesionego „Tylko ten raz” (D137, D181) — następny
   * liczy się od niego, gdy przeniesiony termin jest wcześniej. Kopia (następne) zaczyna bez niego.
   */
  cycle_date: string | null;
  completed_at: string | null;
  deleted_at: string | null;
};

const str = (v: unknown, d: string | null = null) => (v == null ? d : String(v));

// Wiersz lokalny (jeszcze niepotwierdzony) nie ma pól ustawianych przez serwer — stąd wartości domyślne
// takie same jak DEFAULT w migracjach SQL.
export function asGroup(r: Row): Group {
  return { id: String(r.id), name: String(r.name ?? ''), kind: r.kind === 'personal' ? 'personal' : 'shared', color: str(r.color), created_at: str(r.created_at), deleted_at: str(r.deleted_at) };
}
export function asMember(r: Row): Member {
  return {
    member_id: String(r.member_id),
    group_id: String(r.group_id),
    user_id: str(r.user_id),
    display_name: String(r.display_name ?? ''),
    role: (['owner', 'admin', 'member', 'child'] as const).find((x) => x === r.role) ?? 'member',
    created_at: str(r.created_at),
    deleted_at: str(r.deleted_at),
  };
}
export function asList(r: Row): List {
  return {
    id: String(r.id),
    group_id: String(r.group_id),
    kind: r.kind === 'shopping' ? 'shopping' : 'tasks',
    name: String(r.name ?? ''),
    visibility: r.visibility === 'restricted' || r.visibility === 'private' ? r.visibility : 'group',
    owner_member_id: str(r.owner_member_id),
    sort_key: String(r.sort_key ?? 'a0'),
    deleted_at: str(r.deleted_at),
  };
}
/**
 * Zadanie z wiersza, pamiętane po samym wierszu: wiersze są niezmienne (applyOp i pull podmieniają wiersz na nowy obiekt,
 * materialize kopiuje tabele płytko), a widoki przy każdej zmianie danych zamieniają całą historię — tysiące zadań
 * (budżet czasu, config.perf). Wynik zamrożony: przypadkowa zmiana pola rzuca błąd zamiast psuć pamięć innym widokom.
 */
const tasks = new WeakMap<Row, Task>();
export function asTask(r: Row): Task {
  let x = tasks.get(r);
  if (x === undefined) {
    x = Object.freeze(toTask(r));
    tasks.set(r, x);
  }
  return x;
}
function toTask(r: Row): Task {
  return {
    id: String(r.id),
    group_id: String(r.group_id),
    list_id: String(r.list_id),
    parent_id: str(r.parent_id),
    title: String(r.title ?? ''),
    note: str(r.note),
    sort_key: String(r.sort_key ?? 'a0'),
    assignee_member_id: str(r.assignee_member_id),
    deadline_mode: r.deadline_mode === 'own' || r.deadline_mode === 'inherit' || r.deadline_mode === 'event' ? r.deadline_mode : 'none',
    due_date: str(r.due_date),
    due_time: str(r.due_time),
    start_date: str(r.start_date),
    event_id: str(r.event_id),
    occurrence_date: str(r.occurrence_date),
    rollover: r.rollover !== false,
    series_id: str(r.series_id),
    cycle_date: str(r.cycle_date),
    completed_at: str(r.completed_at),
    deleted_at: str(r.deleted_at),
  };
}

/**
 * Chwila usunięcia w ms (audyt 3, N-171). Usunięcie jeszcze niewysłane ma znacznik „pending:N” (applyOp) — liczy się od
 * `nowMs`. Rozpoznajemy go jawnie: Date.parse('pending:5') w V8 (testy, Node) daje datę z 2001 r., a 'pending:2500' — rok
 * 2500; Hermes zwraca NaN. Brak albo nieczytelny znacznik — też `nowMs`.
 */
export function stampMs(at: unknown, nowMs: number): number {
  if (typeof at !== 'string' || at.startsWith('pending:')) return nowMs;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : nowMs;
}

export const rows = <T>(t: Tables, e: string, f: (r: Row) => T): T[] => Object.values(t[e] ?? {}).map(f);
