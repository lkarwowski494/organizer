/**
 * Lokalny czas w strefie config.TIME_ZONE (R2: Europe/Warsaw, niezależnie od ustawień telefonu).
 * Intl.DateTimeFormat z timeZone — na iPhonie wymaga Intl w Hermesie (spike S3, otwarte).
 */
import { config } from '../config';
import type { LocalDateTime } from '../domain/civil-date';

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
 * o godzinę do przodu; podwójna (jesienią 2:00–2:59) — wybieramy pierwsze wystąpienie (czas letni).
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
