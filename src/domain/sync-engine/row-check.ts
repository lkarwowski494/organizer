/**
 * Bezpiecznik dat w wierszach z serwera (audyt 3, N-1, część telefonowa). Serwer od migracji 20261010010000_date_ranges.sql
 * przyjmuje tylko daty z config.dates, godziny przed 24:00 i chwile z tego samego zakresu (ograniczenia *_range). Wiersz,
 * który mimo to przyjdzie z czymś innym (stara kopia, błąd serwera), wyłączałby widoki całej grupy: parseIsoDate rzuca
 * dla „infinity” albo roku „-0044”. Telefon taki wiersz pomija (jakby był niewidoczny) i zgłasza nazwę pola, bez treści.
 *
 * Pola = kolumny z ograniczeniem *_range w bazie (kontrakt: tests/db/config-sql.test.ts).
 */
import { config } from '../../config';
import type { Entity, Row } from './client';

type Fields = { readonly date?: readonly string[]; readonly time?: readonly string[]; readonly instant?: readonly string[] };

export const CHECKED_FIELDS: { readonly [e in Entity]?: Fields } = {
  group_members: { date: ['week_a'] },
  lists: { date: ['due_date'], time: ['due_time'] },
  tasks: { date: ['due_date', 'start_date', 'occurrence_date', 'cycle_date'], time: ['due_time'], instant: ['completed_at'] },
  events: { date: ['start_date'], time: ['start_time', 'end_time'] },
  event_overrides: { date: ['occurrence_date', 'start_date'], time: ['start_time', 'end_time'] },
  event_rsvps: { date: ['occurrence_date'] },
  handoffs: { date: ['occurrence_date'] },
  shopping_trips: { date: ['planned_date'], instant: ['done_at'] },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?$/;
const DAY_MS = 86_400_000;
const MIN_MS = Date.parse(`${config.dates.MIN}T00:00:00Z`);
const END_MS = Date.parse(`${config.dates.MAX}T00:00:00Z`) + DAY_MS;

const okDate = (v: unknown) => typeof v === 'string' && DATE.test(v) && v >= config.dates.MIN && v <= config.dates.MAX;
const okTime = (v: unknown) => typeof v === 'string' && TIME.test(v);
const okInstant = (v: unknown) => {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return ms >= MIN_MS && ms < END_MS;
};

/** Pierwsze pole wiersza z wartością spoza zakresu („tasks.due_date”) albo null, gdy wiersz jest w porządku. Brak wartości jest w porządku. */
export function badField(e: Entity, row: Row): string | null {
  const f = CHECKED_FIELDS[e];
  if (!f) return null;
  for (const [names, ok] of [
    [f.date, okDate],
    [f.time, okTime],
    [f.instant, okInstant],
  ] as const) {
    for (const k of names ?? []) if (row[k] != null && !ok(row[k])) return `${e}.${k}`;
  }
  return null;
}
