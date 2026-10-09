/**
 * Wydarzenie z pola szybkiego dodawania (D98, D99): tekst z zakresem godzin („basen jutro 17–18”) to wydarzenie, bo ma
 * czas trwania. Zakres wycina src/domain/time-range.ts, resztę (nazwa, dzień, „co tydzień”) czyta zwykły parser.
 *  - Bez dnia: dziś, a gdy początek już minął — jutro (jak jedna godzina bez dnia, D43).
 *  - „co tydzień” — co tydzień w dzień wydarzenia.
 *  - Grupa: osobista albo z „@imię” (D91); osoba z „@imię” zostaje odpowiedzialną, jeśli jest dorosła w grupie
 *    wspólnej (D66 — inaczej serwer by odrzucił).
 *  - Dzień nazwany, ale nierozpoznany („basen w przyszły wtorek 17–18”, audyt 2 M-23): bez wydarzenia — nie zgadujemy
 *    dnia; wpis zostaje zadaniem z całym tekstem w nazwie.
 */
import { addDays, formatIsoDate, isoWeekday, type LocalDateTime } from '../civil-date';
import { parseIsoDate } from '../format';
import { type Fragment, parseQuickAdd, type QuickAddResult } from '../quickadd';
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
  if (parsed.unrecognizedDay) return null;
  const groups = groupsView(a.tables, a.userId).filter((g) => g.me.role !== 'child');
  const group = groups.find((g) => g.id === a.groupId) ?? groups.find((g) => g.kind === 'personal');
  if (!group) return null;
  const nowHm = `${String(a.now.hh).padStart(2, '0')}:${String(a.now.mm).padStart(2, '0')}`;
  const date = parsed.due?.date ?? formatIsoDate(addDays(a.now, range.from > nowHm ? 0 : 1));
  const members = group.kind === 'shared' ? groupDetail(a.tables, a.userId, group.id)!.members : [];
  const adult = members.some((m) => m.member_id === a.memberId && m.role !== 'child');
  // @dziecko: dziecko uczestnikiem (D58 — wtedy dotyczy też rodziców), jak przy zadaniu (audyt 8.10.2026).
  const child = members.some((m) => m.member_id === a.memberId && m.role === 'child');
  const f = emptyForm(date, child ? [a.memberId!] : []);
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

export type QuickPreview = {
  title: string;
  tokens: Fragment[];
  event: boolean;
  unrecognizedDay: Fragment | null;
  /** Data liczbowa bez roku w przyszłym roku — ostrzeżenie pod polem (audyt 3, N-28). */
  farDate: QuickAddResult['farDate'];
  /** Czy wpis będzie miał dzień (termin zadania albo wydarzenie) — D68: inaczej we wspólnej grupie potrzebna osoba. */
  dated: boolean;
};

/**
 * Podgląd pola szybkiego dodawania — to samo, co potem zapisze quickEvent albo quickAddOps: nazwa (pusta = nie ma czego
 * dodać, audyt 2 M-168), rozpoznane fragmenty (chipy do odklikania, D18, D99), czy powstanie wydarzenie (zakres godzin,
 * M-256) i nierozpoznany dzień (M-23).
 */
export function quickPreview(text: string, now: LocalDateTime, ignore: readonly { start: number; end: number }[]): QuickPreview {
  const range = findTimeRange(text, ignore);
  const parsed = parseQuickAdd(range ? withoutRange(text, range) : text, now, { ignore });
  const event = !!range && !parsed.unrecognizedDay;
  // Zakres bez wydarzenia (nierozpoznany dzień) zostaje w nazwie zadania, jak w quickAddOps.
  const task = range && !event ? parseQuickAdd(text, now, { ignore }) : parsed;
  const tokens = [...(event ? [{ start: range.start, end: range.end, text: range.text }] : []), ...parsed.tokens.map(({ start, end, text: t }) => ({ start, end, text: t }))];
  return { title: task.title, tokens: tokens.sort((a, b) => a.start - b.start), event, unrecognizedDay: parsed.unrecognizedDay, farDate: task.farDate, dated: event || task.due !== null };
}
