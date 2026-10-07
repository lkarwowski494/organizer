/**
 * Daty i terminy na ekranach, po polsku (nazwy: src/config/calendar.pl.ts i quickadd.pl.ts, CLDR 48.2.3).
 * Wzorzec pełnej daty CLDR „EEEE, d MMMM y”; rok pomijamy, gdy jest bieżący.
 */
import { MONTHS_NOMINATIVE, WEEKDAYS_ABBREVIATED, WEEKDAYS_NOMINATIVE } from '../config/calendar.pl';
import { MONTHS_ABBREVIATED, MONTHS_GENITIVE } from '../config/quickadd.pl';
import { addDays, type CivilDate, formatIsoDate, isoWeekday } from './civil-date';

export function parseIsoDate(iso: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`format: oczekiwano daty RRRR-MM-DD, jest ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);

/** „Środa, 7 października” (z rokiem, gdy inny niż `today`). */
export function formatLongDate(date: CivilDate, today: CivilDate): string {
  const base = `${WEEKDAYS_NOMINATIVE[isoWeekday(date)]}, ${date.d} ${MONTHS_GENITIVE[date.m - 1]}`;
  return cap(date.y === today.y ? base : `${base} ${date.y}`);
}

/** „Październik 2026” — nagłówek miesiąca kalendarza. */
export function formatMonth(y: number, m: number): string {
  return cap(`${MONTHS_NOMINATIVE[m - 1]} ${y}`);
}

/** Godzina z bazy („17:30:00”) albo z parsera („17:30”) → „17:30”. */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/** Krótki termin: „dziś”, „jutro”, „wczoraj”, inaczej „pt. 9 paź” (z rokiem, gdy inny); z godziną po „·”. */
export function formatDue(due: { date: string; time: string | null }, today: CivilDate): string {
  const d = parseIsoDate(due.date);
  const rel: Record<string, string> = {
    [formatIsoDate(today)]: 'dziś',
    [formatIsoDate(addDays(today, 1))]: 'jutro',
    [formatIsoDate(addDays(today, -1))]: 'wczoraj',
  };
  const day = rel[due.date] ?? `${WEEKDAYS_ABBREVIATED[isoWeekday(d)]} ${d.d} ${MONTHS_ABBREVIATED[d.m - 1]}${d.y === today.y ? '' : ` ${d.y}`}`;
  return due.time === null ? day : `${day} · ${formatTime(due.time)}`;
}
