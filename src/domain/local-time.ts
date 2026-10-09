/**
 * Lokalny czas w strefie config.TIME_ZONE (R2: Europe/Warsaw, niezależnie od ustawień telefonu).
 * Intl.DateTimeFormat z timeZone — na iPhonie wymaga Intl w Hermesie (spike S3; sprawdza to na telefonie samosprawdzenie
 * D83, ADR 0018). Strefy i zmiany czasu bierze silnik z bazy IANA (ECMA-402 §6.5, https://tc39.es/ecma402/#sec-use-of-iana-time-zone-database:
 * „they must use the IANA Time Zone Database … to supply available named time zone identifiers and data used in
 * ECMAScript calculations and formatting”). Europe/Warsaw w tej bazie (https://data.iana.org/time-zones/tzdb/europe):
 * „Zone Europe/Warsaw … 1:00 EU CE%sT” z regułami „Rule EU 1981 max - Mar lastSun 1:00u 1:00 S” i „Rule EU 1996 max
 * - Oct lastSun 1:00u 0 -” — czyli ostatnia niedziela marca 2:00 → 3:00 i ostatnia niedziela października 3:00 → 2:00.
 */
import { config } from '../config';
import type { LocalDateTime } from './civil-date';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function localNow(ms: number): LocalDateTime {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}

/**
 * Chwila (ms UTC) dla czasu lokalnego Europe/Warsaw — do kalendarza iPhone'a (D7). Przesunięcie strefy liczymy
 * z localNow (dwa kroki wystarczą, bo zmiana czasu to ±1 h). Godzina nieistniejąca (wiosną 2:00–2:59) przesuwa się
 * o godzinę do przodu; podwójna (jesienią 2:00–2:59) — wybieramy pierwsze wystąpienie (czas letni). Tak samo jak
 * RFC 5545 §3.3.5 (https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5): „the local time described occurs more than once
 * … the DATE-TIME value refers to the first occurrence”; „If the local time described does not occur … interpreted using
 * the UTC offset before the gap” (np. 2:30 → 3:30 czasu letniego).
 */
export function localToMs(t: LocalDateTime): number {
  const wall = Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mm);
  const offset = (ms: number) => {
    const l = localNow(ms);
    return Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - ms;
  };
  const first = wall - offset(wall - offset(wall));
  const earlier = wall - offset(wall - 3_600_000 * 2);
  return localNow(earlier).hh === t.hh && localNow(earlier).mm === t.mm && earlier < first ? earlier : first;
}

/** Godzina chwili w Warszawie, „16:35”. */
export function formatTime(ms: number): string {
  const t = localNow(ms);
  return `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}`;
}
