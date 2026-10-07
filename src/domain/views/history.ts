/**
 * Historia zadania (D76: „kto, co, kiedy” na ekranie zadania). Źródło: kanał aktywności z serwera (activity,
 * private.log_activity: {kolumna: [stara, nowa]}), widoczny tylko dla tych, którzy widzą listę.
 * Odhaczenie i cofnięcie rozpoznajemy po zmianie completed_at; pola techniczne pomijamy.
 */
import type { Tables } from './model';

export type HistoryEntry = { id: string; who: string | null; at: string; verb: 'create' | 'delete' | 'restore' | 'done' | 'undone' | 'update'; fields: string[] };

const TECHNICAL = new Set(['id', 'group_id', 'version', 'created_at', 'deleted_at', 'completed_at', 'sort_key', 'parent_id', 'depth', 'event_id', 'occurrence_date', 'series_id']);

export function taskHistory(t: Tables, taskId: string, limit: number): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const [id, r] of Object.entries(t.activity ?? {})) {
    if (r.entity !== 'tasks' || r.entity_id !== taskId) continue;
    const changes = (r.changes ?? {}) as Record<string, [unknown, unknown]>;
    const at = String(r.created_at ?? '');
    const who = r.actor_name == null ? null : String(r.actor_name);
    const base = { id, who, at };
    if (r.verb === 'create' || r.verb === 'delete' || r.verb === 'restore') {
      out.push({ ...base, verb: r.verb, fields: [] });
      continue;
    }
    const done = changes.completed_at;
    if (done) out.push({ ...base, verb: done[1] == null ? 'undone' : 'done', fields: [] });
    const fields = [...new Set(Object.keys(changes).filter((k) => !TECHNICAL.has(k)).map((k) => (k === 'deadline_mode' || k === 'due_time' ? 'due_date' : k)))].sort();
    if (fields.length) out.push({ ...base, id: `${id}|u`, verb: 'update', fields });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}
