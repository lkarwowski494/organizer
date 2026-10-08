/**
 * Siatka miesiąca od poniedziałku (norma PN-EN ISO 8601: tydzień zaczyna się w poniedziałek), ze świętami —
 * wspólna dla zakładki Kalendarz i mini kalendarza przy wyborze daty (D103). Pełne tygodnie, 4–6 wierszy.
 */
import { HOLIDAYS_FROM_YEAR } from '../config/holidays.pl';
import { addDays, type CivilDate, formatIsoDate, isoWeekday, isValidDate } from './civil-date';
import { polishHolidays } from './holidays';

export type GridDay = { date: string; d: number; inMonth: boolean; holiday: string | null };
export type YearMonth = { y: number; m: number };

export function monthGrid(year: number, month: number): GridDay[] {
  const first: CivilDate = { y: year, m: month, d: 1 };
  const start = addDays(first, -isoWeekday(first));
  const holidays = new Map([year - 1, year, year + 1].filter((y) => y >= HOLIDAYS_FROM_YEAR).flatMap((y) => polishHolidays(y)).map((h) => [h.date, h.name]));
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    if (i % 7 === 0 && i > 0 && (day.m !== month || day.y !== year)) break;
    const iso = formatIsoDate(day);
    days.push({ date: iso, d: day.d, inMonth: day.m === month && day.y === year, holiday: holidays.get(iso) ?? null });
  }
  return days;
}

export function shiftMonth(ym: YearMonth, k: number): YearMonth {
  const n = ym.y * 12 + (ym.m - 1) + k;
  return { y: Math.floor(n / 12), m: (n % 12) + 1 };
}

/** Miesiąc, od którego otwiera się mini kalendarz: wybranej daty, a bez (poprawnej) daty — dzisiejszy. */
export function monthOf(value: string, today: CivilDate): YearMonth {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3])) ? { y: Number(m[1]), m: Number(m[2]) } : { y: today.y, m: today.m };
}
