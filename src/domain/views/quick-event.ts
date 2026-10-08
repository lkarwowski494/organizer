/**
 * Wydarzenie z pola szybkiego dodawania (D98, D99): tekst z zakresem godzin („basen jutro 17–18”) to wydarzenie, bo ma
 * czas trwania. Zakres wycina src/domain/time-range.ts, resztę (nazwa, dzień, „co tydzień”) czyta zwykły parser.
 *  - Bez dnia: dziś, a gdy początek już minął — jutro (jak jedna godzina bez dnia, D43).
 *  - „co tydzień” — co tydzień w dzień wydarzenia.
 *  - Grupa: osobista albo z „@imię” (D91); osoba z „@imię” zostaje odpowiedzialną, jeśli jest dorosła w grupie
 *    wspólnej (D66 — inaczej serwer by odrzucił).
 */
import { addDays, formatIsoDate, isoWeekday, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { parseQuickAdd } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import { findTimeRange, withoutRange } from '../time-range';
import { emptyForm, type EventForm, validateForm } from './event-form';
import { createEvent } from './events';
import { groupDetail, groupsView } from './index';
import type { Tables } from './model';

export type QuickEvent = { groupId: string; form: EventForm };

export function quickEvent(a: {
  tables: Tables;
  userId: string;
  text: string;
  now: LocalDateTime;
  ignore?: readonly { start: number; end: number }[];
  groupId?: string;
  memberId?: string;
}): QuickEvent | null {
  const range = findTimeRange(a.text, a.ignore);
  if (!range) return null;
  const parsed = parseQuickAdd(withoutRange(a.text, range), a.now, { ignore: a.ignore });
  const groups = groupsView(a.tables, a.userId).filter((g) => g.me.role !== 'child');
  const group = groups.find((g) => g.id === a.groupId) ?? groups.find((g) => g.kind === 'personal');
  if (!group) return null;
  const nowHm = `${String(a.now.hh).padStart(2, '0')}:${String(a.now.mm).padStart(2, '0')}`;
  const date = parsed.due?.date ?? formatIsoDate(addDays(a.now, range.from > nowHm ? 0 : 1));
  const adult = group.kind === 'shared' && groupDetail(a.tables, a.userId, group.id)!.members.some((m) => m.member_id === a.memberId && m.role !== 'child');
  const f = emptyForm(date);
  return {
    groupId: group.id,
    form: {
      ...f,
      title: parsed.title,
      repeat: parsed.rrule ? 'weekly' : 'none',
      slots: [{ days: [isoWeekday(parseIsoDate(date))], start: range.from, end: range.to }],
      responsibleId: adult ? a.memberId! : null,
    },
  };
}

/** Operacje utworzenia wydarzenia; `null`, gdy formularz nie przechodzi walidacji (np. pusta nazwa). */
export function quickEventOps(q: QuickEvent, newId: () => string): { id: string; ops: NewOp[] } | null {
  const r = validateForm(q.form);
  if ('error' in r) return null;
  return createEvent(q.groupId, r.fields[0]!, newId);
}
