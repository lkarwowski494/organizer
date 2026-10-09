/**
 * Pole „Dodaj zadanie” na ekranie wydarzenia (D13, D65). Audyt 3 (N-51): „namiot @Kasia” przypisuje osobę jak pole
 * dodawania na liście zadań (resolveListQuick: osoba z grupy, która widzi listę, „@ja” — ja; kilka albo żadna — pytanie),
 * zamiast zostawić „@Kasia” w nazwie. Termin daje wydarzenie (terminów w tekście nie rozpoznajemy).
 * Stałe zadanie „na każde spotkanie” (event_task_series) nie ma osoby — „@imię” zostaje wtedy w nazwie, a ekran o tym mówi.
 */
import { LIST_NAMES } from '../../config/names.pl';
import type { NewOp } from '../sync-engine/client';
import { createList } from './commands';
import { createEventTask } from './event-tasks';
import { extractMention } from './mention';
import type { Tables } from './model';
import { type ListResolution, type QuickAnswers, resolveListQuick } from './quick-target';
import { createSeries } from './series-tasks';
import { appendKey } from './sort-keys';

export type EventTaskAnswers = Pick<QuickAnswers, 'person' | 'skipMention'>;
export type EventTaskAdd = { kind: 'ok'; ops: NewOp[] } | { kind: 'empty' } | Exclude<ListResolution, { kind: 'ok' }>;

/** `listId` — wybrana lista zadań grupy; `null` — grupa bez listy zadań: powstaje lista „Zadania”. */
export function eventTaskOps(
  t: Tables,
  userId: string,
  a: { groupId: string; eventId: string; occurrenceDate: string; listId: string | null; text: string; series: boolean; newId: () => string },
  answers: EventTaskAnswers = {},
): EventTaskAdd {
  const ops: NewOp[] = [];
  let listId = a.listId;
  let tables = t;
  if (listId === null) {
    listId = a.newId();
    ops.push(createList({ id: listId, groupId: a.groupId, kind: 'tasks', name: LIST_NAMES.GENERAL }));
    // Nowa lista całej grupy — osobę z „@imię” szukamy tak, jakby już była (widzi ją każdy członek grupy).
    tables = { ...t, lists: { ...t.lists, [listId]: { id: listId, group_id: a.groupId, kind: 'tasks', name: LIST_NAMES.GENERAL, visibility: 'group', owner_member_id: null, deleted_at: null } } };
  }
  const r: ListResolution = a.series ? { kind: 'ok', memberId: null, body: a.text } : resolveListQuick(tables, userId, listId, a.text, answers);
  if (r.kind !== 'ok') return r;
  const title = r.body.replace(/\s+/g, ' ').trim();
  if (title === '') return { kind: 'empty' };
  if (a.series) ops.push(createSeries({ id: a.newId(), groupId: a.groupId, eventId: a.eventId, listId, title }));
  else ops.push(createEventTask({ id: a.newId(), groupId: a.groupId, listId, eventId: a.eventId, occurrenceDate: a.occurrenceDate, title, sortKey: appendKey(tables, listId, null), ...(r.memberId ? { assigneeId: r.memberId } : {}) }));
  return { kind: 'ok', ops };
}

/** Czy w tekście stałego zadania jest „@imię” (zostanie w nazwie — seria nie ma osoby). */
export const seriesMention = (text: string) => extractMention(text).mention !== null;
