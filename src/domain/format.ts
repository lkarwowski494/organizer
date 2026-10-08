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

/** Ta sama data w środku zdania, małą literą: „Przeniesione z: środa, 7 października” (audyt 2, U-55). */
export function formatDateInline(date: CivilDate, today: CivilDate): string {
  const long = formatLongDate(date, today);
  return long.charAt(0).toLocaleLowerCase('pl') + long.slice(1);
}

/**
 * Zakres tygodnia: „5–11 października”, „28 września – 4 października”, z rokiem, gdy inny niż bieżący.
 * Wzorce CLDR 48.2.3 pl, intervalFormats MMMMd / yMMMMd: „d–d MMMM”, „d MMMM\u2009–\u2009d MMMM”,
 * „d MMMM y\u2009–\u2009d MMMM y” (cienka spacja U+2009 wokół półpauzy).
 */
export function formatRange(from: CivilDate, to: CivilDate, today: CivilDate): string {
  const g = (d: CivilDate) => MONTHS_GENITIVE[d.m - 1];
  const year = from.y !== today.y || to.y !== today.y;
  if (from.y !== to.y) return `${from.d} ${g(from)} ${from.y}\u2009–\u2009${to.d} ${g(to)} ${to.y}`;
  const yy = year ? ` ${to.y}` : '';
  return from.m === to.m ? `${from.d}–${to.d} ${g(to)}${yy}` : `${from.d} ${g(from)}\u2009–\u2009${to.d} ${g(to)}${yy}`;
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

/**
 * Długość wydarzenia (D120): „45 min”, „1 h”, „1 h 30 min”. Koniec zawsze po początku tego samego dnia
 * (ograniczenie events_end_after_start w bazie). Symbole „h” i „min” ze spacją po liczbie — BIPM, Broszura SI, wyd. 9
 * (https://doi.org/10.59161/AUEZ1291), tabela 8: „hour h 1 h = 60 min = 3600 s”; 5.4.3: „The numerical value always
 * precedes the unit and a space is always used to separate the unit from the number”.
 */
export function formatLength(start: string, end: string): string {
  return formatMinutes(minutesOf(end) - minutesOf(start));
}

/** Godzina „17:30” albo „17:30:00” → minuty od północy. */
export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Liczba minut jak długość (D120): „45 min”, „1 h”, „2 h 30 min”. */
export function formatMinutes(all: number): string {
  const h = Math.floor(all / 60);
  const m = all % 60;
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}
