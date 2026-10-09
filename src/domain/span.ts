/**
 * Wydarzenia przez kilka dni i przez północ (D199; audyt 2, M-99 / PW-53).
 *
 * Model (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545):
 *  - całodniowe: liczba dni `days` (1 = jeden dzień). §3.6.1: „The "DTEND" property for a "VEVENT" calendar component
 *    specifies the non-inclusive end of the event” — koniec wyłączny = dzień startu + `days`; ostatni dzień, który
 *    pokazujemy („do dnia”), to dzień startu + `days` − 1. Długość zamiast daty końca, bo w serii każde wystąpienie trwa
 *    tyle samo: §3.8.5.3 „the same exact duration will apply to all the members of the generated recurrence set”,
 *    a wyjątek może ją zmienić (tamże; event_overrides.days);
 *  - z godziną: długość w minutach `duration_min` — §3.8.2.5 DURATION pozwala podać długość wydarzenia zamiast końca
 *    (dla dat jako „dur-day” albo „dur-week” — stąd `days` dla całodniowych).
 *    `null` = długość z godzin: koniec po początku — ten sam dzień, koniec nie później niż początek („22:00–06:00”,
 *    „8:00–8:00” = doba) — następnego dnia. Dłuższe (pt. 18:00 – nd. 16:00) mają `duration_min`; godzina końca zostaje
 *    w wierszu i musi się zgadzać z początkiem + długością (inaczej serwer zeruje długość — zmiana godzin z buildu 21).
 *    Godziny to czas lokalny (R2), więc długość liczymy na zegarze (jak „nominal duration” z §3.8.5.3).
 * Telefony z buildem 21 nie znają `days` ani `duration_min`: widzą takie wydarzenie w dniu startu.
 */
import { minutesOf } from './format';

/** Dzień wielodniowego wystąpienia: który z ilu (od 1). */
export type DayPart = { day: number; days: number };

const hm = (t: string) => t.slice(0, 5);

/** Koniec z godziną nie później niż początek = następnego dnia. */
export const endsNextDay = (start: string | null, end: string | null) => start !== null && end !== null && hm(end) <= hm(start);

const DAY = 24 * 60;

/** Długość z samych godzin (koniec nie później niż początek — z dobą), `null` bez końca albo bez godziny. */
export function clockMinutes(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const m = minutesOf(end) - minutesOf(start);
  return m > 0 ? m : m + DAY;
}

/** Długość w minutach: zapisana (`duration`) albo z godzin; `null` bez końca albo bez godziny. */
export const lengthMinutes = (start: string | null, end: string | null, duration: number | null = null) => (start === null || end === null ? null : (duration ?? clockMinutes(start, end)));

/**
 * Ile dni kalendarzowych obejmuje wystąpienie: całodniowe — `days`, z godziną — od dnia startu do dnia końca. Koniec
 * o północy („20:00–00:00”) nie wchodzi na następny dzień — koniec jest wyłączny (jak DTEND, RFC 5545 §3.6.1).
 */
export function coveredDays(start: string | null, end: string | null, days: number, duration: number | null = null): number {
  if (start === null) return days;
  const m = lengthMinutes(start, end, duration);
  return m === null ? 1 : Math.floor((minutesOf(start) + m - 1) / DAY) + 1;
}

/** O ile dni po dniu startu jest chwila końca (godzina końca tego dnia; koniec o północy — dzień po ostatnim). */
export const endDayOffset = (start: string, minutes: number) => Math.floor((minutesOf(start) + minutes) / DAY);

/**
 * Długość do zapisu w wierszu wydarzenia: `null`, gdy wynika z godzin, albo nie pasuje do godziny końca (tak samo
 * private.event_duration w SQL). Wyjątek terminu zapisuje długość także wtedy, gdy wynika z godzin (EventFields).
 */
export function storedDuration(start: string | null, end: string | null, duration: number | null): number | null {
  if (start === null || end === null || duration === null) return null;
  if ((minutesOf(start) + duration) % DAY !== minutesOf(end)) return null;
  return duration === clockMinutes(start, end) ? null : duration;
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
