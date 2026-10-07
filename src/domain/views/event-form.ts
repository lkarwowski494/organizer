/**
 * Formularz wydarzenia ↔ EventFields. Kilka terminów naraz (np. pon. 18:00 i sob. 12:00) = kilka serii o tym samym
 * tytule i uczestnikach — reguła RRULE ma jedną godzinę startu (RFC 5545: DTSTART), więc różne godziny to różne serie.
 * Błędy jako kody; teksty dla nich są w src/i18n/strings.pl.ts.
 */
import { daysInMonth, isoWeekday, isValidDate } from '../civil-date';
import { parseIsoDate } from '../format';
import type { Rule } from '../rrule';
import type { EventFields } from './events';

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
/** Co miesiąc: tego samego dnia, w n-ty dzień tygodnia (1.–4.) albo w ostatni dzień tygodnia. */
export type Monthly = 'day' | 'nth' | 'last';
export type Slot = { days: number[]; start: string; end: string };
export type EventForm = {
  title: string;
  date: string;
  allDay: boolean;
  slots: Slot[];
  repeat: Repeat;
  interval: string;
  monthly: Monthly;
  ends: 'never' | 'until';
  until: string;
  audience: 'group' | 'members';
  participantIds: string[];
};
export type FormError = 'title' | 'date' | 'time' | 'endBeforeStart' | 'days' | 'interval' | 'until' | 'participants' | 'monthly';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const;
const REPEAT = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as const;

const validDate = (s: string) => {
  const m = DATE.exec(s);
  return !!m && isValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
};
const hm = (t: string | null) => (t === null ? '' : t.slice(0, 5));

/** Który to dzień tygodnia w miesiącu (1–5) i czy ostatni. */
export function weekdayPosition(date: string): { n: number; last: boolean; wd: number } {
  const d = parseIsoDate(date);
  return { n: Math.ceil(d.d / 7), last: d.d + 7 > daysInMonth(d.y, d.m), wd: isoWeekday(d) };
}

export function emptyForm(date: string, participantIds: string[] = []): EventForm {
  return {
    title: '',
    date,
    allDay: false,
    slots: [{ days: [isoWeekday(parseIsoDate(date))], start: '', end: '' }],
    repeat: 'none',
    interval: '1',
    monthly: 'day',
    ends: 'never',
    until: '',
    audience: participantIds.length ? 'members' : 'group',
    participantIds,
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
    slots: [{ days: r?.freq === 'WEEKLY' && r.byday.length ? [...new Set(r.byday.map((x) => x.wd))].sort((x, y) => x - y) : [wd], start: hm(f.startTime), end: hm(f.endTime) }],
    repeat: r ? REPEAT[r.freq] : 'none',
    interval: String(r?.interval ?? 1),
    monthly: b && b.n !== null ? (b.n === -1 ? 'last' : 'nth') : 'day',
    ends: f.until ? 'until' : 'never',
    until: f.until ?? '',
    audience: f.audience,
    participantIds: f.participantIds,
  };
}

function ruleFor(s: EventForm, slot: Slot): Rule | null {
  if (s.repeat === 'none') return null;
  const base: Rule = { freq: FREQ[s.repeat], interval: Number(s.interval), byday: [], bymonthday: [], count: null, until: null };
  if (s.repeat === 'weekly') return { ...base, byday: [...new Set(slot.days)].sort((a, b) => a - b).map((wd) => ({ n: null, wd })) };
  if (s.repeat === 'monthly' && s.monthly !== 'day') {
    const p = weekdayPosition(s.date);
    return { ...base, byday: [{ n: s.monthly === 'last' ? -1 : p.n, wd: p.wd }] };
  }
  return base;
}

/** Sprawdzenie i zamiana na EventFields — po jednym na termin (tylko „co tydzień” ma kilka terminów). */
export function validateForm(s: EventForm): { error: FormError } | { fields: EventFields[] } {
  const title = s.title.trim();
  if (title === '') return { error: 'title' };
  const date = s.date.trim();
  if (!validDate(date)) return { error: 'date' };
  const slots = s.repeat === 'weekly' ? s.slots : s.slots.slice(0, 1);
  for (const slot of slots) {
    if (!s.allDay) {
      if (!TIME.test(slot.start.trim()) || (slot.end.trim() !== '' && !TIME.test(slot.end.trim()))) return { error: 'time' };
      if (slot.end.trim() !== '' && slot.end.trim() <= slot.start.trim()) return { error: 'endBeforeStart' };
    }
    if (s.repeat === 'weekly' && slot.days.length === 0) return { error: 'days' };
  }
  if (s.repeat !== 'none' && (!/^\d{1,2}$/.test(s.interval.trim()) || Number(s.interval) < 1)) return { error: 'interval' };
  if (s.repeat === 'monthly' && s.monthly === 'nth' && weekdayPosition(date).n > 4) return { error: 'monthly' };
  if (s.repeat === 'monthly' && s.monthly === 'last' && !weekdayPosition(date).last) return { error: 'monthly' };
  const until = s.repeat !== 'none' && s.ends === 'until' ? s.until.trim() : null;
  if (until !== null && (!validDate(until) || until < date)) return { error: 'until' };
  if (s.audience === 'members' && s.participantIds.length === 0) return { error: 'participants' };
  return {
    fields: slots.map((slot) => ({
      title,
      date,
      startTime: s.allDay ? null : slot.start.trim(),
      endTime: s.allDay || slot.end.trim() === '' ? null : slot.end.trim(),
      rule: ruleFor({ ...s, date, interval: s.interval.trim() }, slot),
      until,
      audience: s.audience,
      participantIds: s.audience === 'members' ? s.participantIds : [],
    })),
  };
}
