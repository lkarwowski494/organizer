/**
 * Plan lekcji z tygodniami A/B (D112, ADR 0027): lekcje osoby (np. dziecka) zapisane jako zwykłe wydarzenia cykliczne
 * z tą osobą jako uczestnikiem — od razu w Kalendarzu, „Moich sprawach” uczestnika, lustrze iPhone'a i przypomnieniach.
 *  - „co tydzień” = FREQ=WEEKLY; tydzień A albo B = FREQ=WEEKLY;INTERVAL=2 z pierwszym dniem w tygodniu A albo B
 *    (RFC 5545: INTERVAL liczony od DTSTART, https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10);
 *  - który tydzień jest A, mówi użytkownik o bieżącym tygodniu (tydzień od poniedziałku, PN-EN ISO 8601);
 *  - ta sama lekcja (nazwa, godziny, tydzień) w kilka dni = jedna seria z kilkoma dniami.
 */
import { addDays, type CivilDate, formatIsoDate, isoWeekday } from '../civil-date';
import type { NewOp } from '../sync-engine/client';
import { emptyForm, type FormError, validateForm } from './event-form';
import { createEvent } from './events';

export type Week = 'both' | 'A' | 'B';
export type Lesson = { day: number; title: string; start: string; end: string; week: Week };

export function timetableOps(a: {
  groupId: string;
  memberId: string;
  lessons: readonly Lesson[];
  thisWeek: 'A' | 'B';
  today: CivilDate;
  until: string | null;
  newId: () => string;
}): { ops: NewOp[]; series: number } | { error: FormError | 'empty'; index: number } {
  const lessons = a.lessons.map((l, index) => ({ ...l, index, title: l.title.trim(), start: l.start.trim(), end: l.end.trim() })).filter((l) => l.title || l.start || l.end);
  if (lessons.length === 0) return { error: 'empty', index: -1 };
  const monday = addDays(a.today, -isoWeekday(a.today));
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
    const date = formatIsoDate(addDays(monday, offset + days[0]!));
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
  return { ops, series: groups.size };
}
