/**
 * Stałe zadania serii (D65, decyzja właściciela z 7.10.2026: „kopie na najbliższe tygodnie”, ADR 0010).
 * Definicja w event_task_series; telefon dokłada prawdziwe zadania na każde wystąpienie w oknie
 * config.SERIES_TASK_WEEKS. Identyfikator kopii = UUIDv5(definicja, data wystąpienia), więc dwa telefony tworzą
 * to samo zadanie, a usunięta kopia nie wraca (wiersz z tym identyfikatorem już istnieje, także w koszu).
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate } from '../civil-date';
import { uuidv5 } from '../ids';
import type { NewOp } from '../sync-engine/client';
import { expandEvents } from './events';
import { asSeries, type SeriesDef } from './event-rows';
import { createEventTask } from './event-tasks';
import { groupsView } from './index';
import { asList, asTask, rows, type Tables } from './model';

export { asSeries, type SeriesDef, seriesOf } from './event-rows';

/** Przestrzeń nazw kopii: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/series-task-copy”). */
export const COPY_NAMESPACE = '6a7d3795-bf51-52d9-a13e-cf7ef1c121af';
export const copyId = (seriesId: string, occurrenceDate: string) => uuidv5(COPY_NAMESPACE, `${seriesId}|${occurrenceDate}`);

export function createSeries(a: { id: string; groupId: string; eventId: string; listId: string; title: string }): NewOp {
  return { kind: 'create', entity: 'event_task_series', id: a.id, group_id: a.groupId, set: { event_id: a.eventId, list_id: a.listId, title: a.title } };
}

/**
 * Brakujące kopie od dziś na SERIES_TASK_WEEKS tygodni. Pomija: grupy, w których jestem dzieckiem (serwer odrzuci),
 * usunięte listy, odwołane wystąpienia (expandEvents) i kopie, które już istnieją (także usunięte).
 */
export function fillOps(t: Tables, userId: string, today: CivilDate): NewOp[] {
  const defs = rows(t, 'event_task_series', asSeries).filter((s) => s.deleted_at === null);
  if (defs.length === 0) return [];
  const adult = new Set(groupsView(t, userId).filter((g) => g.me.role !== 'child').map((g) => g.id));
  const lists = new Set(rows(t, 'lists', asList).filter((l) => l.deleted_at === null).map((l) => l.id));
  const occ = expandEvents(t, userId, today, addDays(today, config.SERIES_TASK_WEEKS * 7 - 1));
  const ops: NewOp[] = [];
  for (const s of defs) {
    if (!adult.has(s.group_id) || !lists.has(s.list_id)) continue;
    for (const o of occ) {
      if (o.eventId !== s.event_id) continue;
      const id = copyId(s.id, o.occurrenceDate);
      if (t.tasks?.[id]) continue;
      ops.push(createEventTask({ id, groupId: s.group_id, listId: s.list_id, eventId: s.event_id, occurrenceDate: o.occurrenceDate, title: s.title, seriesId: s.id }));
    }
  }
  return ops;
}

/** Zakończenie stałego zadania: definicja do kosza i niezrobione kopie od dziś (wcześniejsze zostają w historii). */
export function stopOps(t: Tables, s: SeriesDef, today: CivilDate): NewOp[] {
  const iso = formatIsoDate(today);
  const copies = rows(t, 'tasks', asTask).filter((x) => x.series_id === s.id && x.deleted_at === null && x.completed_at === null && x.occurrence_date !== null && x.occurrence_date >= iso);
  return [{ kind: 'delete', entity: 'event_task_series', id: s.id }, ...copies.map((x): NewOp => ({ kind: 'delete', entity: 'tasks', id: x.id }))];
}
