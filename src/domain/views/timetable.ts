/**
 * Plan lekcji z tygodniami A/B (D112, ADR 0027): lekcje osoby (np. dziecka) zapisane jako zwykłe wydarzenia cykliczne
 * z tą osobą jako uczestnikiem — od razu w Kalendarzu, „Moich sprawach” uczestnika, lustrze iPhone'a i przypomnieniach.
 *  - „co tydzień” = FREQ=WEEKLY; tydzień A albo B = FREQ=WEEKLY;INTERVAL=2 z pierwszym dniem w tygodniu A albo B
 *    (RFC 5545: INTERVAL liczony od DTSTART, https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10);
 *  - który tydzień jest A, mówi użytkownik o bieżącym tygodniu (tydzień od poniedziałku, PN-EN ISO 8601);
 *  - ta sama lekcja (nazwa, godziny, tydzień) w kilka dni = jedna seria z kilkoma dniami.
 *
 * Edycja planu (D128): ekran otwiera się z obecnym planem osoby (`memberTimetable` — trwające serie lekcji z tą osobą).
 * Zapis kończy dotychczasowe serie przed dziś (UNTIL = wczoraj; seria, która jeszcze się nie zaczęła, idzie do kosza),
 * a nowe zaczynają się od pierwszego pasującego dnia od dziś — miniona część planu zostaje, jak była, a zadania
 * i obecność przy minionych lekcjach nie tracą swojego terminu. Litery A/B nie są zapisywane: przy otwarciu ten tydzień
 * to A, a seria co 2 tygodnie trafia do A albo B według tego, czy wypada w tym tygodniu.
 */
import { addDays, type CivilDate, formatIsoDate, isoWeekday, toDayNumber } from '../civil-date';
import { parseIsoDate } from '../format';
import { endBefore, formatRule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { emptyForm, type FormError, validateForm } from './event-form';
import { asEvent, asParticipant, ruleOf } from './event-rows';
import { createEvent } from './events';
import { rows, type Tables } from './model';

export type Week = 'both' | 'A' | 'B';
export type Lesson = { day: number; title: string; start: string; end: string; week: Week };

/** Seria planu, którą zapis zakończy (D128). */
export type PlanSeries = { id: string; start_date: string; rrule: string };
export type CurrentPlan = { lessons: Lesson[]; until: string; series: PlanSeries[] };

const mondayOf = (d: CivilDate) => addDays(d, -isoWeekday(d));

/** Obecny plan osoby: trwające (jeszcze nie zakończone) cykliczne lekcje z tą osobą jako uczestnikiem. */
export function memberTimetable(t: Tables, groupId: string, memberId: string, today: CivilDate): CurrentPlan {
  const iso = formatIsoDate(today);
  const mine = new Set(rows(t, 'event_participants', asParticipant).filter((p) => p.deleted_at === null && p.member_id === memberId).map((p) => p.event_id));
  const lessons: Lesson[] = [];
  const series: PlanSeries[] = [];
  const untils = new Set<string>();
  for (const e of rows(t, 'events', asEvent)) {
    const rule = ruleOf(e);
    if (e.kind !== 'lesson' || e.deleted_at !== null || e.group_id !== groupId || !mine.has(e.id) || !rule || rule.freq !== 'WEEKLY' || (rule.until !== null && rule.until < iso)) continue;
    series.push({ id: e.id, start_date: e.start_date, rrule: e.rrule! });
    untils.add(rule.until ?? '');
    const start = parseIsoDate(e.start_date);
    // Co 2 tygodnie: tydzień A, gdy seria wypada w tym tygodniu (liczba tygodni od jej początku parzysta).
    const weeks = Math.round((toDayNumber(mondayOf(today)) - toDayNumber(mondayOf(start))) / 7);
    const week: Week = rule.interval === 1 ? 'both' : ((weeks % 2) + 2) % 2 === 0 ? 'A' : 'B';
    const days = rule.byday.length ? rule.byday.map((b) => b.wd) : [isoWeekday(start)];
    for (const day of days) lessons.push({ day, title: e.title, start: (e.start_time ?? '').slice(0, 5), end: (e.end_time ?? '').slice(0, 5), week });
  }
  lessons.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'pl'));
  // Jedna data końca dla całego planu — tylko gdy wszystkie serie ją mają.
  const until = untils.size === 1 ? [...untils][0]! : '';
  return { lessons, until, series };
}

/**
 * Plan do zapisu. Z `existing` (edycja, D128): najpierw zakończenie starych serii, nowe od dziś; `undo` przywraca
 * stary plan (nowe serie do kosza, stare z poprzednią regułą albo z kosza).
 */
export function timetableOps(a: {
  groupId: string;
  memberId: string;
  lessons: readonly Lesson[];
  thisWeek: 'A' | 'B';
  today: CivilDate;
  until: string | null;
  newId: () => string;
  existing?: readonly PlanSeries[];
}): { ops: NewOp[]; undo: NewOp[]; series: number } | { error: FormError | 'empty'; index: number } {
  const existing = a.existing ?? [];
  const lessons = a.lessons.map((l, index) => ({ ...l, index, title: l.title.trim(), start: l.start.trim(), end: l.end.trim() })).filter((l) => l.title || l.start || l.end);
  // Pusty plan przy edycji = zakończenie planu; przy nowym — błąd.
  if (lessons.length === 0 && existing.length === 0) return { error: 'empty', index: -1 };
  const monday = mondayOf(a.today);
  const isoToday = formatIsoDate(a.today);
  const groups = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const k = JSON.stringify([l.title, l.start, l.end, l.week]);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const ops: NewOp[] = [];
  for (const g of groups.values()) {
    const l = g[0]!;
    const offset = l.week === 'both' || l.week === a.thisWeek ? 0 : 7;
    const days = [...new Set(g.map((x) => x.day))].sort((x, y) => x - y);
    let date = formatIsoDate(addDays(monday, offset + days[0]!));
    if (existing.length) {
      // Edycja: pierwszy dzień serii od dziś (w tygodniu właściwym dla A/B; co 2 tygodnie — następny jest 14 dni dalej).
      const step = l.week === 'both' ? 7 : 14;
      const cands = days.flatMap((d) => [0, step].map((k) => formatIsoDate(addDays(monday, offset + d + k))));
      date = cands.filter((x) => x >= isoToday).sort()[0]!;
    }
    const f = emptyForm(date, [a.memberId]);
    const r = validateForm({
      ...f,
      title: l.title,
      repeat: 'weekly',
      interval: l.week === 'both' ? '1' : '2',
      slots: [{ days, start: l.start, end: l.end }],
      ends: a.until ? 'until' : 'never',
      until: a.until ?? '',
    });
    if ('error' in r) return { error: r.error, index: l.index };
    ops.push(...createEvent(a.groupId, { ...r.fields[0]!, kind: 'lesson' }, a.newId).ops);
  }
  const end: NewOp[] = [];
  const undo: NewOp[] = ops.flatMap((o) => (o.kind === 'create' && o.entity === 'events' ? [{ kind: 'delete' as const, entity: 'events', id: o.id }] : []));
  for (const x of existing) {
    if (x.start_date >= isoToday) {
      end.push({ kind: 'delete', entity: 'events', id: x.id });
      undo.push({ kind: 'restore', entity: 'events', id: x.id });
    } else {
      end.push({ kind: 'patch', entity: 'events', id: x.id, set: { rrule: formatRule(endBefore(ruleOf(x)!, a.today)) } });
      undo.push({ kind: 'patch', entity: 'events', id: x.id, set: { rrule: x.rrule } });
    }
  }
  return { ops: [...end, ...ops], undo, series: groups.size };
}
