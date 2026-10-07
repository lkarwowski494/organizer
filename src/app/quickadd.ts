/**
 * Dodanie zadania z pola szybkiego dodawania: gdzie trafia i jakie operacje wysyła.
 * Bez wskazanej listy — pierwsza lista zadań w grupie osobistej; gdy jej nie ma, powstaje „Moje zadania”.
 */
import type { LocalDateTime } from '../domain/civil-date';
import { parseQuickAdd } from '../domain/quickadd';
import type { NewOp } from '../domain/sync-engine/client';
import { createList, createTask } from '../domain/views/commands';
import { groupsView, listsView, type Tables } from '../domain/views';

export const DEFAULT_LIST_NAME = 'Moje zadania';

export function quickAddOps(a: {
  tables: Tables;
  userId: string;
  text: string;
  now: LocalDateTime;
  ignore: readonly { start: number; end: number }[];
  newId: () => string;
  listId?: string;
}): NewOp[] {
  const parsed = parseQuickAdd(a.text, a.now, { ignore: a.ignore });
  if (parsed.title.trim() === '') return [];
  const ops: NewOp[] = [];
  const chosen = a.listId ? listsView(a.tables, a.userId).find((l) => l.id === a.listId) : undefined;
  let target: { groupId: string; listId: string };
  if (chosen) target = { groupId: chosen.group_id, listId: chosen.id };
  else {
    const personal = groupsView(a.tables, a.userId).find((g) => g.kind === 'personal');
    if (!personal) return [];
    const first = listsView(a.tables, a.userId, personal.id).find((l) => l.kind === 'tasks');
    target = { groupId: personal.id, listId: first?.id ?? a.newId() };
    if (!first) ops.push(createList({ id: target.listId, groupId: personal.id, kind: 'tasks', name: DEFAULT_LIST_NAME }));
  }
  ops.push(createTask({ id: a.newId(), groupId: target.groupId, listId: target.listId, parsed }));
  return ops;
}
