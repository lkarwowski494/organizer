/**
 * Wydarzenia przez kilka dni i przez północ (D199; audyt 2, M-99 / PW-53).
 *
 * Model (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545):
 *  - całodniowe: liczba dni `days` (1 = jeden dzień). §3.6.1: „The "DTEND" property for a "VEVENT" calendar component
 *    specifies the non-inclusive end of the event” — koniec wyłączny = dzień startu + `days`; ostatni dzień, który
 *    pokazujemy („do dnia”), to dzień startu + `days` − 1. Długość zamiast daty końca, bo w serii każde wystąpienie trwa
 *    tyle samo: §3.8.5.3 „If the duration of the recurring component is specified with the "DTEND" or "DUE" property,
 *    then the same exact duration will apply to all the members of the generated recurrence set”, a wyjątek może ją
 *    zmienić: „The duration of a specific recurrence may be modified in an exception component” (event_overrides.days);
 *  - z godziną: koniec nie później niż początek („22:00–06:00”, także „8:00–8:00” = doba) znaczy koniec następnego dnia.
 *    Godziny to czas lokalny (R2), więc długość liczymy na zegarze (jak „nominal duration” z §3.8.5.3).
 * Telefony z buildem 21 nie znają `days`: widzą takie wydarzenie w dniu startu.
 */
import { minutesOf } from './format';

/** Dzień wielodniowego wystąpienia: który z ilu (od 1). */
export type DayPart = { day: number; days: number };

const hm = (t: string) => t.slice(0, 5);

/** Koniec z godziną nie później niż początek = następnego dnia. */
export const endsNextDay = (start: string | null, end: string | null) => start !== null && end !== null && hm(end) <= hm(start);

/**
 * Ile dni kalendarzowych obejmuje wystąpienie: całodniowe — `days`, z godziną — 1 albo 2 (przez północ). Koniec o północy
 * („20:00–00:00”) nie wchodzi na następny dzień — koniec jest wyłączny (jak DTEND, RFC 5545 §3.6.1).
 */
export const coveredDays = (start: string | null, end: string | null, days: number) => (start === null ? days : endsNextDay(start, end) && hm(end!) !== '00:00' ? 2 : 1);

/** Długość w minutach (koniec następnego dnia — z dobą), `null` bez końca albo bez godziny. */
export function lengthMinutes(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const m = minutesOf(end) - minutesOf(start);
  return m > 0 ? m : m + 24 * 60;
}

/**
 * Godziny tego dnia do kolejności i przerw w planie dnia (D122): pierwszy dzień od początku do północy („24:00”), ostatni
 * od północy („00:00”) do końca, środkowe — cały dzień. Całodniowe i jednodniowe bez zmian.
 */
export function daySpan(start: string | null, end: string | null, part: DayPart | null): { start: string | null; end: string | null } {
  if (start === null) return { start, end };
  // Jednodniowe do północy („20:00–00:00”) — zajęte do końca dnia.
  if (part === null) return { start, end: endsNextDay(start, end) ? '24:00' : end };
  if (part.day === 1) return { start, end: '24:00' };
  return { start: '00:00', end: part.day === part.days && end !== null ? end : '24:00' };
}

/**
 * Co pokazać jako „kiedy” w wierszu tego dnia: godziny („22:00–06:00” pierwszego dnia wydarzenia przez jedną noc),
 * „od 18:00” (pierwszy dzień dłuższego), „do 06:00” (ostatni), cały dzień (środkowe i całodniowe).
 */
export type DayWhen = { kind: 'allDay' } | { kind: 'time'; start: string; end: string | null } | { kind: 'from'; start: string } | { kind: 'until'; end: string };

export function dayWhen(start: string | null, end: string | null, part: DayPart | null): DayWhen {
  if (start === null) return { kind: 'allDay' };
  if (part === null || (part.day === 1 && part.days === 2 && endsNextDay(start, end))) return { kind: 'time', start: hm(start), end: end === null ? null : hm(end) };
  if (part.day === 1) return { kind: 'from', start: hm(start) };
  return part.day === part.days && end !== null ? { kind: 'until', end: hm(end) } : { kind: 'allDay' };
}

/** Kolejny dzień wielodniowego (bez przypomnienia, poza porannym podsumowaniem — przypomina się raz, przed startem). */
export const isContinuation = (part: DayPart | null) => part !== null && part.day > 1;
