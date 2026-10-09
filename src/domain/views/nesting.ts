/**
 * Podzadania w planie dnia (D104, ADR 0024): zadanie z wystąpienia wydarzenia (D13) i podzadanie innego zadania stoją
 * tuż pod rodzicem, z wcięciem (`depth`). Rodzic dostaje licznik zrobionych („1/3”). Gdy rodzica nie ma w tym dniu
 * (cudze zadanie, wydarzenie mnie nie dotyczy, inny dzień), zadanie zostaje na swoim miejscu z dopiskiem rodzica
 * (`parent`), żeby nie wyglądało na samodzielne.
 */
import { config } from '../../config';
import type { Row } from '../sync-engine/client';
import { asTask, rows, type Tables, type Task } from './model';

/**
 * Potomkowie zadania w kolejności drzewa (rodzic przed dziećmi, rodzeństwo po sort_key), najwyżej `config.MAX_TASK_DEPTH`
 * poziomów niżej (więcej serwer nie pozwala; limit chroni też przed cyklem w uszkodzonych danych lokalnych). Schodzi tylko
 * przez wiersze spełniające `keep`.
 */
/** Dzieci po rodzicu (surowe wiersze) — do wielu wywołań `descendants` na tych samych danych. */
export type ChildIndex = Map<string, Row[]>;
export function childIndex(t: Tables): ChildIndex {
  const byParent: ChildIndex = new Map();
  for (const r of Object.values(t.tasks ?? {})) {
    if (r.parent_id == null) continue;
    const k = String(r.parent_id);
    const list = byParent.get(k);
    if (list) list.push(r);
    else byParent.set(k, [r]);
  }
  return byParent;
}

export function descendants(t: Tables, rootId: string, keep: (x: Task) => boolean, index: ChildIndex = childIndex(t)): Task[] {
  // Audyt 3 (N-27): dzieci po rodzicu bez zamiany i sortowania całej tabeli — plan przypomnień robi to dla każdej
  // przewidywanej kopii, a historia ma tysiące zadań. Kolejność jak dotąd (sort_key, potem id).
  const out: Task[] = [];
  const walk = (id: string, level: number) => {
    if (level > config.MAX_TASK_DEPTH) return;
    const kids = (index.get(id) ?? [])
      .map(asTask)
      .filter(keep)
      .sort((a, b) => a.sort_key.localeCompare(b.sort_key) || a.id.localeCompare(b.id));
    for (const x of kids) {
      out.push(x);
      walk(x.id, level + 1);
    }
  };
  walk(rootId, 1);
  return out;
}

export const subtasksOf = (t: Tables, taskId: string, index?: ChildIndex) => descendants(t, taskId, (x) => x.deleted_at === null, index);

type EventLike = { kind: 'event'; event: { eventId: string; occurrenceDate: string } };
type TaskLike = { kind: 'task' | 'overdue'; task: { id: string; parent_id: string | null; event_id: string | null; occurrence_date: string | null } };
/** Zwinięte lekcje (D127) nie mają podzadań ani rodzica. */
type BlockLike = { kind: 'lessons'; key: string };

export type ParentLabel = { kind: 'event' | 'task'; title: string };
export type Nesting = {
  depth: number;
  /** Rodzic spoza tego dnia — do dopisku „↳ …”. */
  parent: ParentLabel | null;
  /** Ile podzadań (albo zadań wystąpienia) zrobione; `null`, gdy brak. */
  progress: { done: number; total: number } | null;
};
export type Nested<E> = { entry: E } & Nesting;

const keyOf = (e: EventLike | TaskLike | BlockLike) => (e.kind === 'event' ? `e:${e.event.eventId}|${e.event.occurrenceDate}` : e.kind === 'lessons' ? `l:${e.key}` : `t:${e.task.id}`);
const parentOf = (x: TaskLike['task']) => (x.parent_id ? `t:${x.parent_id}` : x.event_id && x.occurrence_date ? `e:${x.event_id}|${x.occurrence_date}` : null);

export type NestIndex = { readonly progress: ReadonlyMap<string, { done: number; total: number }> };

/**
 * Liczniki „zrobione/wszystkie” podzadań i zadań wystąpienia, policzone raz dla tabel (audyt 3, N-6): plan
 * przypomnień układa 14 dni z tym samym indeksem, zamiast za każdym wpisem przeglądać wszystkie zadania. `tasks` —
 * zadania tych tabel, gdy wołający ma je już przeczytane.
 */
export function nestIndex(t: Tables, tasks: Iterable<Task> = rows(t, 'tasks', asTask)): NestIndex {
  const progress = new Map<string, { done: number; total: number }>();
  for (const x of tasks) {
    if (x.deleted_at !== null) continue;
    // Podzadanie liczy się u rodzica; zadanie bez rodzica — u wystąpienia, do którego jest przypięte (jeśli jest).
    const key = x.parent_id !== null ? `t:${x.parent_id}` : x.event_id !== null && x.occurrence_date !== null ? `e:${x.event_id}|${x.occurrence_date}` : null;
    if (key === null) continue;
    const c = progress.get(key) ?? { done: 0, total: 0 };
    c.total++;
    if (x.completed_at !== null) c.done++;
    progress.set(key, c);
  }
  return { progress };
}

export function nestEntries<E extends EventLike | TaskLike | BlockLike>(entries: readonly E[], t: Tables, index: NestIndex = nestIndex(t)): Nested<E>[] {
  const present = new Set(entries.map(keyOf));
  const children = new Map<string, E[]>();
  const roots: E[] = [];
  for (const e of entries) {
    const p = e.kind === 'event' || e.kind === 'lessons' ? null : parentOf(e.task);
    if (p && present.has(p) && p !== keyOf(e)) children.set(p, [...(children.get(p) ?? []), e]);
    else roots.push(e);
  }
  const progressOf = (e: E) => {
    if (e.kind === 'lessons') return null;
    const c = index.progress.get(e.kind === 'event' ? `e:${e.event.eventId}|${e.event.occurrenceDate}` : `t:${e.task.id}`);
    return c ? { ...c } : null;
  };
  const parentLabel = (e: E): ParentLabel | null => {
    if (e.kind === 'event' || e.kind === 'lessons') return null;
    if (e.task.parent_id) {
      const p = t.tasks?.[e.task.parent_id];
      return p && p.deleted_at == null ? { kind: 'task', title: String(p.title) } : null;
    }
    if (e.task.event_id) {
      const ev = t.events?.[e.task.event_id];
      return ev && ev.deleted_at == null ? { kind: 'event', title: String(ev.title) } : null;
    }
    return null;
  };
  const out: Nested<E>[] = [];
  const seen = new Set<string>();
  const walk = (e: E, depth: number) => {
    const k = keyOf(e);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ entry: e, depth, parent: depth === 0 ? parentLabel(e) : null, progress: progressOf(e) });
    for (const c of children.get(k) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Cykl (dane z błędem) — nieodwiedzone dokładamy płasko, żeby nic nie zniknęło.
  for (const e of entries) walk(e, 0);
  return out;
}
