/**
 * Polskie dni wolne od pracy w danym roku (reguły: src/config/holidays.pl.ts).
 *
 * Data Wielkanocy (kalendarz gregoriański): algorytm „anonimowy gregoriański” (Meeus/Jones/Butcher) —
 * rachunek, sprawdzany różnicowo z dateutil.easter (EASTER_WESTERN) dla lat 2011–2200 w korpusie testowym.
 * Algorytm (zmienne a…m jak niżej): https://en.wikipedia.org/wiki/Date_of_Easter#Anonymous_Gregorian_algorithm —
 * „h + l − 7 m + 114 … the variable n indicates the month of the year … while the day of the month is obtained as
 * (o + 1)”; wzorzec korpusu: https://dateutil.readthedocs.io/en/stable/easter.html — „EASTER_WESTERN = 3 … Revised
 * method, in Gregorian calendar, valid in years 1583 to 4099”.
 */
import { HOLIDAYS_FROM_YEAR, HOLIDAYS_PL } from '../config/holidays.pl';
import { addDays, type CivilDate, formatIsoDate } from './civil-date';

export function easterSunday(y: number): CivilDate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y, m: month, d: day };
}

export type Holiday = { date: string; name: string };

export function polishHolidays(y: number): Holiday[] {
  if (!Number.isInteger(y) || y < HOLIDAYS_FROM_YEAR) {
    throw new RangeError(`polishHolidays: obsługiwane lata od ${HOLIDAYS_FROM_YEAR}`);
  }
  const easter = easterSunday(y);
  return HOLIDAYS_PL.flatMap((h): Holiday[] => {
    switch (h.kind) {
      case 'single':
        return h.date.startsWith(`${y}-`) ? [{ date: h.date, name: h.name }] : [];
      case 'easter':
        return [{ date: formatIsoDate(addDays(easter, h.offset)), name: h.name }];
      case 'fixed': {
        const date = formatIsoDate({ y, m: h.month, d: h.day });
        return date < (h.since ?? '') ? [] : [{ date, name: h.name }];
      }
    }
  }).sort((a, b) => a.date.localeCompare(b.date));
}
