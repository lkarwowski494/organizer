/**
 * Wiersze wydarzeń (tabele events, event_participants, event_overrides — migracja 20261008100000_events) i termin
 * wystąpienia dla zadań podpiętych do spotkania (D13). Osobny moduł, bo potrzebują go widoki zadań (index.ts),
 * a widoki wydarzeń (events.ts) same korzystają z index.ts.
 */
import type { Due, OccurrenceDue } from '../deadlines';
import { parseIsoDate } from '../format';
import { occurrences, parseRule, type Rule, RuleError } from '../rrule';
import type { Row } from '../sync-engine/client';
import { rows, type Tables } from './model';

export type EventRow = {
  id: string;
  group_id: string;
  title: string;
  note: string | null;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  rrule: string | null;
  audience: 'group' | 'members';
  /** Kto zawozi / odpowiada (D66); `null` = nikt konkretny. */
  responsible_member_id: string | null;
  deleted_at: string | null;
};
export type Participant = { id: string; event_id: string; member_id: string; deleted_at: string | null };
export type Override = {
  id: string;
  event_id: string;
  occurrence_date: string;
  cancelled: boolean;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  title: string | null;
  /** Inna osoba odpowiedzialna w tym wystąpieniu; `null` = jak w serii. */
  responsible_member_id: string | null;
  deleted_at: string | null;
};

const s = (v: unknown) => (v == null ? null : String(v));
export const asEvent = (r: Row): EventRow => ({
  id: String(r.id),
  group_id: String(r.group_id),
  title: String(r.title ?? ''),
  note: s(r.note),
  start_date: String(r.start_date),
  start_time: s(r.start_time),
  end_time: s(r.end_time),
  rrule: s(r.rrule),
  audience: r.audience === 'members' ? 'members' : 'group',
  responsible_member_id: s(r.responsible_member_id),
  deleted_at: s(r.deleted_at),
});
export const asParticipant = (r: Row): Participant => ({ id: String(r.id), event_id: String(r.event_id), member_id: String(r.member_id), deleted_at: s(r.deleted_at) });
export const asOverride = (r: Row): Override => ({
  id: String(r.id),
  event_id: String(r.event_id),
  occurrence_date: String(r.occurrence_date),
  cancelled: r.cancelled === true,
  start_date: s(r.start_date),
  start_time: s(r.start_time),
  end_time: s(r.end_time),
  title: s(r.title),
  responsible_member_id: s(r.responsible_member_id),
  deleted_at: s(r.deleted_at),
});

/** Reguła serii albo `null` (wydarzenie jednorazowe; reguła, której telefon nie rozumie, też = jednorazowe). */
export function ruleOf(e: Pick<EventRow, 'rrule'>): Rule | null {
  if (e.rrule === null) return null;
  try {
    return parseRule(e.rrule);
  } catch (err) {
    if (err instanceof RuleError) return null;
    throw err;
  }
}

/**
 * Termin wystąpienia: data po przeniesieniu (wyjątek) albo pierwotna, godzina startu z wyjątku albo z serii.
 * `null`, gdy seria usunięta, wystąpienie odwołane albo go już nie ma w regule (np. seria skończyła się wcześniej).
 */
export function occurrenceResolver(t: Tables): OccurrenceDue {
  const events = new Map(rows(t, 'events', asEvent).filter((e) => e.deleted_at === null).map((e) => [e.id, e]));
  const overrides = new Map(rows(t, 'event_overrides', asOverride).filter((o) => o.deleted_at === null).map((o) => [`${o.event_id}|${o.occurrence_date}`, o]));
  return (eventId, occurrenceDate): Due => {
    const e = events.get(eventId);
    if (!e) return null;
    const d = parseIsoDate(occurrenceDate);
    if (occurrences(parseIsoDate(e.start_date), ruleOf(e), d, d).length === 0) return null;
    const o = overrides.get(`${eventId}|${occurrenceDate}`);
    if (o?.cancelled) return null;
    return { date: o?.start_date ?? occurrenceDate, time: o?.start_time ?? e.start_time };
  };
}

/** Definicja stałego zadania serii (D65, tabela event_task_series). */
export type SeriesDef = { id: string; group_id: string; event_id: string; list_id: string; title: string; deleted_at: string | null };

export const asSeries = (r: Row): SeriesDef => ({
  id: String(r.id),
  group_id: String(r.group_id),
  event_id: String(r.event_id),
  list_id: String(r.list_id),
  title: String(r.title ?? ''),
  deleted_at: r.deleted_at == null ? null : String(r.deleted_at),
});

/** Żywe definicje dla serii. */
export function seriesOf(t: Tables, eventId: string): SeriesDef[] {
  return rows(t, 'event_task_series', asSeries)
    .filter((s) => s.deleted_at === null && s.event_id === eventId)
    .sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

