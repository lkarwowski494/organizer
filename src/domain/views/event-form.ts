/**
 * Formularz wydarzenia ↔ EventFields. Kilka terminów naraz (np. pon. 18:00 i sob. 12:00) = kilka serii o tym samym
 * tytule i uczestnikach — reguła RRULE ma jedną godzinę startu (RFC 5545: DTSTART), więc różne godziny to różne serie.
 * Błędy jako kody; teksty dla nich są w src/i18n/strings.pl.ts.
 */
import { config } from '../../config';
import { addDays, daysInMonth, formatIsoDate, isoWeekday, isValidDate, toDayNumber } from '../civil-date';
import { minutesOf, parseIsoDate } from '../format';
import { coveredDays, endDayOffset, lengthMinutes } from '../span';
import { alignStart, occurrences, type Rule } from '../rrule';
import type { EventFields } from './events';

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
/**
 * Co miesiąc: tego samego dnia, w n-ty dzień tygodnia (1.–4.), w ostatni dzień tygodnia albo ostatniego dnia miesiąca
 * (BYMONTHDAY=-1, decyzja właściciela 8.10.2026, PWD-37; RFC 5545 §3.3.10: „Valid values are 1 to 31 or -31 to -1”,
 * https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10). Jak przy „last”, dzień startu musi pasować do reguły.
 */
export type Monthly = 'day' | 'nth' | 'last' | 'lastDay';
export type Slot = { days: number[]; start: string; end: string };
export type EventForm = {
  title: string;
  date: string;
  allDay: boolean;
  /** D199: ostatni dzień („Kończy się”); pusto = ten sam dzień (z godziną: albo następny, gdy koniec ≤ początek). */
  endDate: string;
  slots: Slot[];
  repeat: Repeat;
  interval: string;
  monthly: Monthly;
  ends: 'never' | 'until';
  until: string;
  audience: 'group' | 'members';
  participantIds: string[];
  /** Osoba odpowiedzialna (D66); `null` = nikt konkretny. */
  responsibleId: string | null;
  /** Miejsce (D115): adres albo nazwa; pusto = brak. */
  location: string;
};
export type FormError = 'title' | 'date' | 'time' | 'endBeforeStart' | 'endDate' | 'endTime' | 'tooLong' | 'overlap' | 'days' | 'interval' | 'until' | 'participants' | 'monthly' | 'location';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const;
const REPEAT = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as const;

const validDate = (s: string) => {
  const m = DATE.exec(s);
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};
const hm = (t: string | null) => (t === null ? '' : t.slice(0, 5));

/** Który dzień tygodnia w miesiącu (1–5), czy ostatni taki dzień tygodnia i czy to ostatni dzień miesiąca. */
export function weekdayPosition(date: string): { n: number; last: boolean; wd: number; lastDay: boolean } {
  const d = parseIsoDate(date);
  const dim = daysInMonth(d.y, d.m);
  return { n: Math.ceil(d.d / 7), last: d.d + 7 > dim, wd: isoWeekday(d), lastDay: d.d === dim };
}

export function emptyForm(date: string, participantIds: string[] = []): EventForm {
  return {
    title: '',
    date,
    allDay: false,
    endDate: '',
    slots: [{ days: [isoWeekday(parseIsoDate(date))], start: '', end: '' }],
    repeat: 'none',
    interval: '1',
    monthly: 'day',
    ends: 'never',
    until: '',
    audience: participantIds.length ? 'members' : 'group',
    participantIds,
    responsibleId: null,
    location: '',
  };
}

/** Wartości zapisanego wydarzenia (fieldsOf) → formularz. */
export function formOf(f: EventFields): EventForm {
  const r = f.rule;
  const wd = isoWeekday(parseIsoDate(f.date));
  const b = r?.byday[0];
  return {
    title: f.title,
    date: f.date,
    allDay: f.startTime === null,
    endDate:
      f.startTime === null
        ? (f.days ?? 1) > 1
          ? formatIsoDate(addDays(parseIsoDate(f.date), f.days! - 1))
          : ''
        : f.durationMin != null
          ? formatIsoDate(addDays(parseIsoDate(f.date), endDayOffset(f.startTime, f.durationMin)))
          : '',
    slots: [{ days: r?.freq === 'WEEKLY' && r.byday.length ? [...new Set(r.byday.map((x) => x.wd))].sort((x, y) => x - y) : [wd], start: hm(f.startTime), end: hm(f.endTime) }],
    repeat: r ? REPEAT[r.freq] : 'none',
    interval: String(r?.interval ?? 1),
    monthly: b && b.n !== null ? (b.n === -1 ? 'last' : 'nth') : r?.bymonthday[0] === -1 ? 'lastDay' : 'day',
    ends: f.until ? 'until' : 'never',
    until: f.until ?? '',
    audience: f.audience,
    participantIds: f.participantIds,
    responsibleId: f.responsibleId,
    location: f.location ?? '',
  };
}

function ruleFor(s: EventForm, slot: Slot): Rule | null {
  if (s.repeat === 'none') return null;
  const base: Rule = { freq: FREQ[s.repeat], interval: Number(s.interval), byday: [], bymonthday: [], count: null, until: null };
  if (s.repeat === 'weekly') return { ...base, byday: [...new Set(slot.days)].sort((a, b) => a - b).map((wd) => ({ n: null, wd })) };
  if (s.repeat === 'monthly' && s.monthly === 'lastDay') return { ...base, bymonthday: [-1] };
  if (s.repeat === 'monthly' && s.monthly !== 'day') {
    const p = weekdayPosition(s.date);
    return { ...base, byday: [{ n: s.monthly === 'last' ? -1 : p.n, wd: p.wd }] };
  }
  return base;
}

/** D199: przesunięcie dnia startu przesuwa też ostatni dzień — długość zostaje (pusty = ten sam dzień, bez zmian). */
export function moveStart(s: Pick<EventForm, 'date' | 'endDate'>, date: string): Pick<EventForm, 'date' | 'endDate'> {
  if (s.endDate === '' || !validDate(s.date) || !validDate(s.endDate) || !validDate(date)) return { date, endDate: s.endDate };
  const days = toDayNumber(parseIsoDate(s.endDate)) - toDayNumber(parseIsoDate(s.date));
  return { date, endDate: formatIsoDate(addDays(parseIsoDate(date), days)) };
}

/** Najkrótszy odstęp w dniach między kolejnymi terminami serii w ciągu config.eventTasks.LOOKAHEAD_DAYS (`null` — jeden). */
function shortestGap(start: string, rule: Rule): number | null {
  const first = alignStart(parseIsoDate(start), rule);
  const all = occurrences(first, rule, first, addDays(first, config.eventTasks.LOOKAHEAD_DAYS)).map(toDayNumber);
  return all.length < 2 ? null : Math.min(...all.slice(1).map((d, i) => d - all[i]!));
}

/**
 * Sprawdzenie i zamiana na EventFields — po jednym na termin (tylko „co tydzień” ma kilka terminów).
 * `overnight` (D199, formularz wydarzenia): koniec nie później niż początek = następnego dnia; plan lekcji i rutyny
 * (bez tej opcji) zostają w jednym dniu — „koniec musi być po początku”.
 */
export function validateForm(s: EventForm, opts: { overnight?: boolean } = {}): { error: FormError } | { fields: EventFields[] } {
  const title = s.title.trim();
  if (title === '') return { error: 'title' };
  const date = s.date.trim();
  if (!validDate(date)) return { error: 'date' };
  const slots = s.repeat === 'weekly' ? s.slots : s.slots.slice(0, 1);
  for (const slot of slots) {
    if (!s.allDay) {
      if (!TIME.test(slot.start.trim()) || (slot.end.trim() !== '' && !TIME.test(slot.end.trim()))) return { error: 'time' };
      if (!opts.overnight && slot.end.trim() !== '' && slot.end.trim() <= slot.start.trim()) return { error: 'endBeforeStart' };
    }
    if (s.repeat === 'weekly' && slot.days.length === 0) return { error: 'days' };
  }
  if (s.repeat !== 'none' && (!/^\d{1,2}$/.test(s.interval.trim()) || Number(s.interval) < 1)) return { error: 'interval' };
  if (s.repeat === 'monthly' && s.monthly === 'nth' && weekdayPosition(date).n > 4) return { error: 'monthly' };
  if (s.repeat === 'monthly' && s.monthly === 'last' && !weekdayPosition(date).last) return { error: 'monthly' };
  if (s.repeat === 'monthly' && s.monthly === 'lastDay' && !weekdayPosition(date).lastDay) return { error: 'monthly' };
  const until = s.repeat !== 'none' && s.ends === 'until' ? s.until.trim() : null;
  if (until !== null && (!validDate(until) || until < date)) return { error: 'until' };
  if (s.audience === 'members' && s.participantIds.length === 0) return { error: 'participants' };
  const location = s.location.trim();
  if (location.length > config.events.LOCATION_MAX_LENGTH) return { error: 'location' };
  // D199: „Kończy się” — ostatni dzień nie przed pierwszym, najwyżej config.events.MAX_DAYS dni. Całodniowe: liczba dni.
  // Z godziną: pusty = jak z godzin (ten sam dzień albo następny, gdy koniec nie później niż początek); wybrany dzień —
  // długość od początku do godziny końca tego dnia (formularz wydarzenia, `overnight`).
  const endDate = s.allDay || opts.overnight ? s.endDate.trim() : '';
  if (endDate !== '' && (!validDate(endDate) || endDate < date)) return { error: 'endDate' };
  const offset = endDate === '' ? 0 : toDayNumber(parseIsoDate(endDate)) - toDayNumber(parseIsoDate(date));
  const days = s.allDay ? offset + 1 : 1;
  if (days > config.events.MAX_DAYS) return { error: 'tooLong' };
  const durations: (number | null)[] = [];
  for (const slot of slots) {
    if (s.allDay || endDate === '') {
      durations.push(null);
      continue;
    }
    if (slot.end.trim() === '') return { error: 'endTime' };
    const minutes = offset * 24 * 60 + minutesOf(slot.end.trim()) - minutesOf(slot.start.trim());
    if (minutes <= 0) return { error: 'endBeforeStart' };
    if (coveredDays(slot.start.trim(), slot.end.trim(), 1, minutes) > config.events.MAX_DAYS) return { error: 'tooLong' };
    durations.push(minutes);
  }
  const fields = slots.map((slot, i) => ({
    title,
    date,
    startTime: s.allDay ? null : slot.start.trim(),
    endTime: s.allDay || slot.end.trim() === '' ? null : slot.end.trim(),
    rule: ruleFor({ ...s, date, interval: s.interval.trim() }, slot),
    until,
    audience: s.audience,
    participantIds: s.audience === 'members' ? s.participantIds : [],
    responsibleId: s.responsibleId,
    location: location || null,
    days,
    durationMin: durations[i]!,
  }));
  // Audyt 2 (E-16): koniec przed pierwszym terminem (np. „co tydzień w pt.” od czwartku do tego czwartku) = seria bez
  // ani jednego terminu — pierwszy termin to start wyrównany do reguły (RFC 5545: DTSTART), nie dzień z formularza.
  if (until !== null && fields.some((f) => f.rule !== null && formatIsoDate(alignStart(parseIsoDate(date), f.rule)) > until)) return { error: 'until' };
  // D199: wystąpienia serii nie mogą na siebie nachodzić (np. trzy dni co dwa dni) — każde trwa tyle samo (RFC 5545
  // §3.8.5.3), więc wystarczy najkrótszy odstęp między terminami.
  const length = (f: EventFields) => (f.startTime === null ? days * 24 * 60 : (lengthMinutes(f.startTime, f.endTime, f.durationMin ?? null) ?? 0));
  if (fields.some((f) => f.rule !== null && length(f) > (shortestGap(date, { ...f.rule, until: f.until }) ?? Infinity) * 24 * 60)) return { error: 'overlap' };
  return { fields };
}
