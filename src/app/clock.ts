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
