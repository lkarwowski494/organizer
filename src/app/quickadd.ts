/**
 * Dodanie zadania z pola szybkiego dodawania: gdzie trafia i jakie operacje wysyła.
 * Bez wskazanej listy — ogólna lista grupy (D97, `generalList`): w osobistej pierwsza lista zadań albo nowa „Moje zadania”,
 * w grupie z „@imię” (D91) lista „Zadania” (powstaje, gdy jej nie ma).
 */
import type { LocalDateTime } from '../domain/civil-date';
import { parseQuickAdd } from '../domain/quickadd';
import type { NewOp } from '../domain/sync-engine/client';
import { createTask } from '../domain/views/commands';
import { groupsView, listsView, type Tables } from '../domain/views';
import { generalList, PERSONAL_LIST_NAME } from '../domain/views/task-form';

export const DEFAULT_LIST_NAME = PERSONAL_LIST_NAME;

export function quickAddOps(a: {
  tables: Tables;
  userId: string;
  text: string;
  now: LocalDateTime;
  ignore: readonly { start: number; end: number }[];
  newId: () => string;
  listId?: string;
  /** D91: grupa z „@imię” — jej ogólna lista „Zadania” (D97). */
  groupId?: string;
  /** D68: adresat wybrany po dodaniu (osoba albo dzień), gdy tekst go nie podał. */
  assigneeId?: string | null;
  dueDate?: string | null;
}): NewOp[] {
  const p0 = parseQuickAdd(a.text, a.now, { ignore: a.ignore });
  const parsed = a.dueDate && !p0.due ? { ...p0, due: { date: a.dueDate, time: null } } : p0;
  if (parsed.title.trim() === '') return [];
  const ops: NewOp[] = [];
  const chosen = a.listId ? listsView(a.tables, a.userId).find((l) => l.id === a.listId) : undefined;
  let target: { groupId: string; listId: string };
  const groups = groupsView(a.tables, a.userId);
  const groupId = (groups.find((g) => g.id === a.groupId) ?? groups.find((g) => g.kind === 'personal'))?.id;
  if (chosen) target = { groupId: chosen.group_id, listId: chosen.id };
  else if (groupId) {
    const g = generalList(a.tables, a.userId, groupId, a.newId);
    target = { groupId, listId: g.listId };
    ops.push(...g.ops);
  } else return [];
  ops.push(createTask({ id: a.newId(), groupId: target.groupId, listId: target.listId, parsed, assigneeId: a.assigneeId }));
  return ops;
}
