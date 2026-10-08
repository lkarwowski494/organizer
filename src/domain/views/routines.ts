/**
 * Rutyny i serie (D113, D114; ADR 0028).
 *  - Rutyna = wydarzenie cykliczne (dni, godzina, osoby) + stałe zadania serii jako kroki (D65). Telefon dokłada kroki na
 *    każde wystąpienie (series-tasks.ts), w „Moich sprawach” stoją pod rutyną (D104), a niezrobione po dniu mijają
 *    (zadania na spotkaniu, D61) — rutyna nie zostawia zaległości.
 *  - Seria rutyny: ile ostatnich wystąpień z rzędu ma zrobione wszystkie kroki (dzisiejsze liczy się, gdy już zrobione;
 *    niezrobione dzisiejsze serii nie przerywa).
 *  - Seria zadania powtarzanego: ile ostatnich powtórzeń z rzędu odhaczono najpóźniej w dniu terminu (łańcuch kopii
 *    po identyfikatorze następnego, task-repeat.ts).
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate } from '../civil-date';
import { parseIsoDate } from '../format';
import { occurrences } from '../rrule';
import type { Entity, NewOp } from '../sync-engine/client';
import { asEvent, asOverride, asSeries, ruleOf } from './event-rows';
import { emptyForm, type FormError, validateForm } from './event-form';
import { createEvent } from './events';
import { createSeries } from './series-tasks';
import { generalList } from './task-form';
import { nextId } from './task-repeat';
import { asTask, rows, type Tables } from './model';

/** Jak daleko wstecz liczymy serię (dni, config.streak.DAYS). */
const STREAK_DAYS = config.streak.DAYS;

export function routineOps(a: {
  tables: Tables;
  userId: string;
  groupId: string;
  title: string;
  days: number[];
  start: string;
  end: string;
  participantIds: string[];
  steps: string[];
  today: CivilDate;
  newId: () => string;
}): { ops: NewOp[]; eventId: string } | { error: FormError | 'steps' } {
  const steps = a.steps.map((s) => s.trim()).filter(Boolean);
  const f = emptyForm(formatIsoDate(a.today), a.participantIds);
  const r = validateForm({ ...f, title: a.title, repeat: a.days.length === 7 ? 'daily' : 'weekly', slots: [{ days: a.days, start: a.start, end: a.end }] });
  if ('error' in r) return { error: r.error };
  if (steps.length === 0) return { error: 'steps' };
  const ev = createEvent(a.groupId, { ...r.fields[0]!, kind: 'routine' }, a.newId);
  const list = generalList(a.tables, a.userId, a.groupId, a.newId);
  return {
    eventId: ev.id,
    ops: [...ev.ops, ...list.ops, ...steps.map((title) => createSeries({ id: a.newId(), groupId: a.groupId, eventId: ev.id, listId: list.listId, title }))],
  };
}

/**
 * Audyt 2 (E-3): cofnięcie nowej rutyny — liczone w chwili cofnięcia, bo SeriesFiller zdążył już dołożyć kopie kroków
 * na kolejne tygodnie. Usuwa wydarzenie, definicje kroków, ich kopie i listę „Ogólne”, jeśli powstała przy tym
 * zapisie i nie ma w niej nic innego.
 */
export function routineUndoOps(t: Tables, created: readonly NewOp[]): NewOp[] {
  const ids = (entity: Entity) => created.flatMap((o) => (o.kind === 'create' && o.entity === entity ? [o.id] : []));
  const series = new Set(ids('event_task_series'));
  const lists = new Set(ids('lists'));
  const copies = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null && x.series_id !== null && series.has(x.series_id));
  const gone = new Set(copies.map((x) => x.id));
  const emptyLists = [...lists].filter((l) => !rows(t, 'tasks', asTask).some((x) => x.list_id === l && x.deleted_at === null && !gone.has(x.id)));
  const del = (entity: Entity, id: string): NewOp => ({ kind: 'delete', entity, id });
  return [...copies.map((x) => del('tasks', x.id)), ...[...series].map((id) => del('event_task_series', id)), ...ids('events').map((id) => del('events', id)), ...emptyLists.map((id) => del('lists', id))];
}

export function routineStreak(t: Tables, eventId: string, today: CivilDate): number {
  const raw = t.events?.[eventId];
  if (!raw || raw.deleted_at != null) return 0;
  const e = asEvent(raw);
  const series = new Set(rows(t, 'event_task_series', asSeries).filter((s) => s.event_id === eventId).map((s) => s.id));
  const copies = rows(t, 'tasks', asTask).filter((x) => x.event_id === eventId && x.series_id !== null && series.has(x.series_id) && x.deleted_at === null);
  const isoToday = formatIsoDate(today);
  // Odwołany termin nie ma kroków i nie przerywa serii (audyt 8.10.2026).
  const cancelled = new Set(rows(t, 'event_overrides', asOverride).filter((o) => o.event_id === eventId && o.deleted_at === null && o.cancelled).map((o) => o.occurrence_date));
  const dates = occurrences(parseIsoDate(e.start_date), ruleOf(e), addDays(today, -STREAK_DAYS), today).map(formatIsoDate).filter((d) => !cancelled.has(d)).reverse();
  let n = 0;
  for (const d of dates) {
    const mine = copies.filter((x) => x.occurrence_date === d);
    const done = mine.length > 0 && mine.every((x) => x.completed_at !== null);
    if (done) n++;
    else if (d !== isoToday) break;
  }
  return n;
}

export function taskStreak(t: Tables, taskId: string, localDate: (iso: string) => string): number {
  const all = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
  const repeating = new Set(Object.values(t.tasks ?? {}).filter((r) => r.repeat != null).map((r) => String(r.id)));
  const prev = new Map(all.filter((x) => repeating.has(x.id)).map((x) => [nextId(x.id), x]));
  const start = all.find((x) => x.id === taskId);
  if (!start) return 0;
  const onTime = (x: (typeof all)[number]) => x.completed_at !== null && x.due_date !== null && localDate(x.completed_at) <= x.due_date;
  let n = 0;
  let cur: (typeof all)[number] | undefined = start.completed_at === null ? prev.get(start.id) : start;
  for (let i = 0; cur && onTime(cur) && i < STREAK_DAYS; i++) {
    n++;
    cur = prev.get(cur.id);
  }
  return n;
}
