/**
 * Zadania na wystąpieniu wydarzenia (D13) i co z nimi, gdy spotkanie się zmienia (D14):
 *  - przeniesienie jednego wystąpienia — zadania idą za nim same (klucz = data według reguły, termin liczy resolver),
 *  - odwołanie / usunięcie — telefon pyta: przepnij na kolejne wystąpienie serii, na inne spotkanie, odepnij, usuń,
 *  - zmiana serii („to i następne”, „wszystkie”) — podgląd skutków: zadania z wystąpień, które zostają, przechodzą
 *    same; z wystąpień, które znikają — na najbliższe nowe wystąpienie albo odpięte (wybór w podglądzie).
 */
import { addDays, formatIsoDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { occurrences, type Rule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { asEvent, ruleOf } from './event-rows';
import { type EventDetail, expandEvents, type Occurrence, type Scope } from './events';
import { asTask, rows, type Tables, type Task } from './model';

/** Jak daleko szukamy kolejnego wystąpienia / spotkań do wyboru. */
const LOOKAHEAD_DAYS = 400;
const PICKER_DAYS = 62;

/** Otwarte zadania podpięte do serii (opcjonalnie: tylko do jednego wystąpienia). */
export function attachedTasks(t: Tables, eventId: string, occurrenceDate?: string): Task[] {
  return rows(t, 'tasks', asTask)
    .filter((x) => x.deleted_at === null && x.completed_at === null && x.event_id === eventId && (occurrenceDate === undefined || x.occurrence_date === occurrenceDate))
    .sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

/** Zadania, których dotyczy odwołanie / usunięcie w danym zakresie. */
export function affectedByCancel(t: Tables, d: EventDetail, occurrenceDate: string, scope: Scope): Task[] {
  const all = attachedTasks(t, d.event.id);
  if (d.rule === null || scope === 'all' || (scope === 'following' && occurrenceDate === d.event.start_date)) return all;
  return all.filter((x) => (scope === 'this' ? x.occurrence_date === occurrenceDate : x.occurrence_date! >= occurrenceDate));
}

/** Kolejne (nieodwołane) wystąpienie tej serii po danym dniu, albo `null`. */
export function nextOccurrence(t: Tables, userId: string, eventId: string, after: string): string | null {
  const from = addDays(parseIsoDate(after), 1);
  return expandEvents(t, userId, from, addDays(from, LOOKAHEAD_DAYS)).find((o) => o.eventId === eventId && o.occurrenceDate > after)?.occurrenceDate ?? null;
}

/** Spotkania grupy do wyboru (najbliższe tygodnie), bez wskazanego wystąpienia. */
export function upcomingInGroup(t: Tables, userId: string, groupId: string, from: string, skip?: { eventId: string; occurrenceDate: string }): Occurrence[] {
  const start = parseIsoDate(from);
  return expandEvents(t, userId, start, addDays(start, PICKER_DAYS)).filter((o) => o.groupId === groupId && !(skip && o.eventId === skip.eventId && o.occurrenceDate === skip.occurrenceDate));
}

export type Relink = { kind: 'occurrence'; eventId: string; occurrenceDate: string } | { kind: 'unlink' } | { kind: 'delete' };

/** Operacje przepięcia zadań. Odpięte zadanie z terminem „jak spotkanie” zostaje bez terminu (przypięte, D16). */
export function relinkOps(tasks: Task[], to: Relink): NewOp[] {
  return tasks.map((x): NewOp => {
    if (to.kind === 'delete') return { kind: 'delete', entity: 'tasks', id: x.id };
    if (to.kind === 'unlink') return { kind: 'patch', entity: 'tasks', id: x.id, set: { event_id: null, occurrence_date: null, ...(x.deadline_mode === 'event' ? { deadline_mode: 'none' } : {}) } };
    return { kind: 'patch', entity: 'tasks', id: x.id, set: { event_id: to.eventId, occurrence_date: to.occurrenceDate } };
  });
}

/** Nowe zadanie na wystąpieniu: termin jak spotkanie (D13). */
export function createEventTask(a: { id: string; groupId: string; listId: string; eventId: string; occurrenceDate: string; title: string }): NewOp {
  return {
    kind: 'create',
    entity: 'tasks',
    id: a.id,
    group_id: a.groupId,
    set: { list_id: a.listId, parent_id: null, title: a.title, sort_key: 'a0', deadline_mode: 'event', due_date: null, due_time: null, event_id: a.eventId, occurrence_date: a.occurrenceDate },
  };
}

/** Podpięcie istniejącego zadania do wystąpienia; termin od teraz „jak spotkanie”. */
export function attachOps(task: Pick<Task, 'id'>, eventId: string, occurrenceDate: string): NewOp[] {
  return [{ kind: 'patch', entity: 'tasks', id: task.id, set: { event_id: eventId, occurrence_date: occurrenceDate, deadline_mode: 'event', due_date: null, due_time: null } }];
}

type Series = { id: string; start: string; rule: Rule | null };
const occursIn = (s: Series, date: string) => occurrences(parseIsoDate(s.start), s.rule, parseIsoDate(date), parseIsoDate(date)).length > 0;
const firstFrom = (s: Series, date: string) => {
  const d = parseIsoDate(date);
  const [first] = occurrences(parseIsoDate(s.start), s.rule, d, addDays(d, LOOKAHEAD_DAYS));
  return first ? formatIsoDate(first) : null;
};

export type SeriesEffects = {
  /** Najbliższe wystąpienia po zmianie (od dnia zmiany), do podglądu. */
  preview: string[];
  /** Zadania, których wystąpienie zostaje (przechodzą same, ewentualnie do nowej serii). */
  kept: Task[];
  /** Zadania, których wystąpienie znika; `nearest` — najbliższe nowe wystąpienie od ich dnia (albo brak). */
  lost: { task: Task; nearest: string | null }[];
};

/** Seria po zmianie: wiersz z operacji editEvent (nowa seria przy „to i następne”, ta sama przy „wszystkie”). */
function resulting(d: EventDetail, ops: NewOp[]): Series {
  type SetOp = Extract<NewOp, { kind: 'create' | 'patch' }>;
  const created = ops.find((o): o is SetOp => o.kind === 'create' && o.entity === 'events');
  const patched = ops.find((o): o is SetOp => o.kind === 'patch' && o.entity === 'events' && o.id === d.event.id);
  const row = asEvent({ ...d.event, ...(created ?? patched)?.set, id: created?.id ?? d.event.id });
  return { id: row.id, start: row.start_date, rule: ruleOf(row) };
}

/** Skutki zmiany serii (podgląd przed zapisem) dla zadań podpiętych do wystąpień od `occurrenceDate` (albo wszystkich). */
export function seriesEditEffects(t: Tables, d: EventDetail, occurrenceDate: string, scope: Exclude<Scope, 'this'>, ops: NewOp[]): SeriesEffects {
  const next = resulting(d, ops);
  const tasks = attachedTasks(t, d.event.id).filter((x) => next.id === d.event.id || x.occurrence_date! >= occurrenceDate);
  const p = parseIsoDate(scope === 'all' ? occurrenceDate : next.start);
  return {
    preview: occurrences(parseIsoDate(next.start), next.rule, p, addDays(p, LOOKAHEAD_DAYS)).slice(0, 3).map(formatIsoDate),
    kept: tasks.filter((x) => occursIn(next, x.occurrence_date!)),
    lost: tasks.filter((x) => !occursIn(next, x.occurrence_date!)).map((task) => ({ task, nearest: firstFrom(next, task.occurrence_date!) })),
  };
}

/** Operacje dla zadań po zmianie serii: zostające przechodzą do serii wynikowej, znikające — wg wyboru. */
export function seriesTaskOps(d: EventDetail, occurrenceDate: string, ops: NewOp[], effects: SeriesEffects, lost: 'nearest' | 'unlink'): NewOp[] {
  const next = resulting(d, ops);
  const out: NewOp[] = [];
  if (next.id !== d.event.id) out.push(...effects.kept.flatMap((x) => relinkOps([x], { kind: 'occurrence', eventId: next.id, occurrenceDate: x.occurrence_date! })));
  for (const { task, nearest } of effects.lost) {
    out.push(...relinkOps([task], lost === 'nearest' && nearest ? { kind: 'occurrence', eventId: next.id, occurrenceDate: nearest } : { kind: 'unlink' }));
  }
  return out;
}

