/**
 * Daty kalendarzowe bez strefy czasowej (rok, miesiąc, dzień) i proste działania na nich.
 * Domena dostaje „teraz” jako lokalną datę i godzinę w Europe/Warsaw z zewnątrz, więc tu nie ma
 * ani zegara systemowego, ani stref — tylko kalendarz gregoriański.
 *
 * Zamiana daty na numer dnia i z powrotem: algorytmy days_from_civil / civil_from_days
 * (Howard Hinnant, „chrono-Compatible Low-Level Date Algorithms”):
 * https://howardhinnant.github.io/date_algorithms.html
 * Dzień 0 = 1970-01-01 (czwartek).
 */
export type CivilDate = { y: number; m: number; d: number };
export type LocalDateTime = CivilDate & { hh: number; mm: number };

export function isLeapYear(y: number): boolean {
  // Kalendarz gregoriański: podzielny przez 4, z wyjątkiem stuleci niepodzielnych przez 400.
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function isValidDate(y: number, m: number, d: number): boolean {
  return Number.isInteger(y) && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function toDayNumber({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(z: number): CivilDate {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Dzień tygodnia: 0 = poniedziałek … 6 = niedziela (ISO 8601). */
export function isoWeekday(date: CivilDate): number {
  // 1970-01-01 to czwartek (indeks 3).
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Zapis ISO 8601: „2026-10-06”. */
export function formatIsoDate({ y, m, d }: CivilDate): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}
