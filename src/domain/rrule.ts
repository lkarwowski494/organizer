/**
 * Powtarzanie wydarzeń: podzbiór reguły RRULE z RFC 5545 (https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10),
 * rozwijany na datach cywilnych (godziny są czasem lokalnym Europe/Warsaw, R2 — zmiana czasu nie przesuwa zajęć).
 *
 * Obsługiwane: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (WEEKLY: dni tygodnia; MONTHLY: także z numerem,
 * np. 1MO, -1FR), BYMONTHDAY (MONTHLY, także ujemne), COUNT, UNTIL (data, włącznie). Tydzień od poniedziałku
 * (WKST=MO, domyślny w RFC). Cytaty z RFC:
 *  - UNTIL: „bounds the recurrence rule in an inclusive manner”;
 *  - COUNT: „The "DTSTART" property value always counts as the first occurrence” — telefon zapisuje serie
 *    z DTSTART zgodnym z regułą (alignStart), więc pierwsze wystąpienie to zawsze dzień startu;
 *  - BYDAY z liczbą: „+1MO … the first Monday within the month, whereas -1MO represents the last Monday”;
 *  - nieistniejące daty (np. 30 lutego) są pomijane (RFC, przykład „invalid date … is ignored”).
 * Wynik sprawdzany korpusem z niezależnej implementacji (python-dateutil, scripts/gen-rrule-corpus.py).
 */
import { addDays, type CivilDate, compareDates, daysInMonth, formatIsoDate, isoWeekday, isValidDate } from './civil-date';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type ByDay = { n: number | null; wd: number }; // wd: 0 = poniedziałek

export type Rule = {
  freq: Freq;
  interval: number;
  byday: ByDay[];
  bymonthday: number[];
  count: number | null;
  until: string | null; // RRRR-MM-DD
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const toDate = (iso: string): CivilDate => {
  const m = ISO.exec(iso)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

export class RuleError extends Error {}

/** „FREQ=WEEKLY;BYDAY=MO,SA;UNTIL=20261231” → Rule. Zła reguła = RuleError (serwer ma ten sam wzorzec w CHECK). */
export function parseRule(text: string): Rule {
  const parts = new Map<string, string>();
  for (const p of text.split(';')) {
    const [k, v, ...rest] = p.split('=');
    if (!k || v === undefined || rest.length || parts.has(k)) throw new RuleError(`rrule: zła część „${p}”`);
    parts.set(k, v);
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') throw new RuleError('rrule: FREQ');
  for (const k of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST'].includes(k)) throw new RuleError(`rrule: nieobsługiwane ${k}`);
  if (parts.has('WKST') && parts.get('WKST') !== 'MO') throw new RuleError('rrule: WKST');
  const int = (k: string, min: number, max: number) => {
    const v = parts.get(k);
    if (v === undefined) return null;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new RuleError(`rrule: ${k}`);
    return Number(v);
  };
  const interval = int('INTERVAL', 1, 99) ?? 1;
  const count = int('COUNT', 1, 1000);
  const untilRaw = parts.get('UNTIL');
  let until: string | null = null;
  if (untilRaw !== undefined) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(untilRaw);
    if (!m || !isValidDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw new RuleError('rrule: UNTIL');
    until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (count !== null && until !== null) throw new RuleError('rrule: COUNT i UNTIL naraz'); // RFC: „MUST NOT occur in the same 'recur'”
  const byday = (parts.get('BYDAY')?.split(',') ?? []).map((s) => {
    const m = /^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(s);
    if (!m) throw new RuleError(`rrule: BYDAY ${s}`);
    return { n: m[1] ? Number(m[1]) : null, wd: WEEKDAY_CODES.indexOf(m[2] as (typeof WEEKDAY_CODES)[number]) };
  });
  if (byday.some((b) => b.n !== null) && freq !== 'MONTHLY') throw new RuleError('rrule: BYDAY z liczbą tylko przy MONTHLY');
  if (byday.length && freq !== 'WEEKLY' && freq !== 'MONTHLY') throw new RuleError('rrule: BYDAY');
  const bymonthday = (parts.get('BYMONTHDAY')?.split(',') ?? []).map((s) => {
    if (!/^-?\d{1,2}$/.test(s) || Number(s) === 0 || Math.abs(Number(s)) > 31) throw new RuleError(`rrule: BYMONTHDAY ${s}`);
    return Number(s);
  });
  if (bymonthday.length && (freq !== 'MONTHLY' || byday.length)) throw new RuleError('rrule: BYMONTHDAY');
  return { freq, interval, byday, bymonthday, count, until };
}

export function formatRule(r: Rule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval !== 1) out.push(`INTERVAL=${r.interval}`);
  if (r.byday.length) out.push(`BYDAY=${r.byday.map((b) => `${b.n ?? ''}${WEEKDAY_CODES[b.wd]}`).join(',')}`);
  if (r.bymonthday.length) out.push(`BYMONTHDAY=${r.bymonthday.join(',')}`);
  if (r.count !== null) out.push(`COUNT=${r.count}`);
  if (r.until !== null) out.push(`UNTIL=${r.until.replaceAll('-', '')}`);
  return out.join(';');
}

/** Dni pasujące do reguły w jednym okresie (tydzień / miesiąc / rok), rosnąco. */
function periodDays(r: Rule, start: CivilDate, k: number): CivilDate[] {
  switch (r.freq) {
    case 'DAILY':
      return [addDays(start, k * r.interval)];
    case 'WEEKLY': {
      const monday = addDays(start, -isoWeekday(start) + 7 * k * r.interval);
      const wds = r.byday.length ? [...new Set(r.byday.map((b) => b.wd))].sort((a, b) => a - b) : [isoWeekday(start)];
      return wds.map((wd) => addDays(monday, wd));
    }
    case 'MONTHLY': {
      const idx = start.y * 12 + (start.m - 1) + k * r.interval;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const dim = daysInMonth(y, m);
      const days = new Set<number>();
      if (r.byday.length) {
        for (const b of r.byday) {
          const all: number[] = [];
          const firstWd = isoWeekday({ y, m, d: 1 });
          for (let d = 1 + ((b.wd - firstWd + 7) % 7); d <= dim; d += 7) all.push(d);
          if (b.n === null) all.forEach((d) => days.add(d));
          else {
            const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
            if (d !== undefined) days.add(d);
          }
        }
      } else if (r.bymonthday.length) {
        for (const md of r.bymonthday) {
          const d = md > 0 ? md : dim + 1 + md;
          if (d >= 1 && d <= dim) days.add(d);
        }
      } else if (start.d <= dim) days.add(start.d);
      return [...days].sort((a, b) => a - b).map((d) => ({ y, m, d }));
    }
    case 'YEARLY': {
      const y = start.y + k * r.interval;
      return isValidDate(y, start.m, start.d) ? [{ y, m: start.m, d: start.d }] : [];
    }
  }
}

/** Ile okresów najwyżej przeglądamy — bezpiecznik na regułę, która nic nie daje (np. 31. dzień co 12 miesięcy w lutym). */
const MAX_PERIODS = 20_000;

/**
 * Wystąpienia od `start` (pierwsze wystąpienie, zgodne z regułą) w zakresie [from, to], z COUNT i UNTIL liczonymi
 * od początku serii. Bez reguły — tylko `start`.
 */
export function occurrences(start: CivilDate, rule: Rule | null, from: CivilDate, to: CivilDate): CivilDate[] {
  if (rule === null) return compareDates(start, from) >= 0 && compareDates(start, to) <= 0 ? [start] : [];
  const until = rule.until === null ? null : toDate(rule.until);
  const out: CivilDate[] = [];
  let n = 0;
  for (let k = 0; k < MAX_PERIODS; k++) {
    for (const d of periodDays(rule, start, k)) {
      if (compareDates(d, start) < 0) continue;
      if (until && compareDates(d, until) > 0) return out;
      if (compareDates(d, to) > 0) return out;
      n++;
      if (rule.count !== null && n > rule.count) return out;
      if (compareDates(d, from) >= 0) out.push(d);
    }
  }
  return out;
}

/** Pierwszy dzień ≥ `date` pasujący do reguły — DTSTART serii (RFC: DTSTART to pierwsze wystąpienie). */
export function alignStart(date: CivilDate, rule: Rule): CivilDate {
  const free: Rule = { ...rule, count: null, until: null };
  const [first] = occurrences(date, free, date, addDays(date, 366 * 8));
  return first ?? date;
}

/** Reguła kończąca serię dzień przed `date` (dla „to i następne”): UNTIL zamiast COUNT. */
export function endBefore(rule: Rule, date: CivilDate): Rule {
  return { ...rule, count: null, until: formatIsoDate(addDays(date, -1)) };
}
