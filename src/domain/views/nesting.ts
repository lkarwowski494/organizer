/**
 * Podzadania w planie dnia (D104, ADR 0024): zadanie z wystąpienia wydarzenia (D13) i podzadanie innego zadania stoją
 * tuż pod rodzicem, z wcięciem (`depth`). Rodzic dostaje licznik zrobionych („1/3”). Gdy rodzica nie ma w tym dniu
 * (cudze zadanie, wydarzenie mnie nie dotyczy, inny dzień), zadanie zostaje na swoim miejscu z dopiskiem rodzica
 * (`parent`), żeby nie wyglądało na samodzielne.
 */
import { config } from '../../config';
import { asTask, rows, type Tables, type Task } from './model';

/**
 * Potomkowie zadania w kolejności drzewa (rodzic przed dziećmi, rodzeństwo po sort_key), najwyżej `config.MAX_TASK_DEPTH`
 * poziomów niżej (więcej serwer nie pozwala; limit chroni też przed cyklem w uszkodzonych danych lokalnych). Schodzi tylko
 * przez wiersze spełniające `keep`.
 */
export function descendants(t: Tables, rootId: string, keep: (x: Task) => boolean): Task[] {
  const all = rows(t, 'tasks', asTask)
    .filter(keep)
    .sort((a, b) => a.sort_key.localeCompare(b.sort_key) || a.id.localeCompare(b.id));
  const out: Task[] = [];
  const walk = (id: string, level: number) => {
    if (level > config.MAX_TASK_DEPTH) return;
    for (const x of all)
      if (x.parent_id === id) {
        out.push(x);
        walk(x.id, level + 1);
      }
  };
  walk(rootId, 1);
  return out;
}

/** Żywe (nieusunięte) podzadania zadania, wszystkie poziomy. */
export const subtasksOf = (t: Tables, taskId: string) => descendants(t, taskId, (x) => x.deleted_at === null);

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

export function nestEntries<E extends EventLike | TaskLike | BlockLike>(entries: readonly E[], t: Tables): Nested<E>[] {
  const tasks = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
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
    const mine = e.kind === 'event' ? tasks.filter((x) => x.event_id === e.event.eventId && x.occurrence_date === e.event.occurrenceDate && x.parent_id === null) : tasks.filter((x) => x.parent_id === e.task.id);
    return mine.length ? { done: mine.filter((x) => x.completed_at !== null).length, total: mine.length } : null;
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
