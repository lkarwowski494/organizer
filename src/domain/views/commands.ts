/**
 * Operacje, które wysyłają ekrany (NewOp dla `mutate()`). Kolumny i dozwolone zmiany jak w
 * private.sync_entities (supabase/migrations/20261006120200_sync.sql); pola ustawiane przez serwer
 * (owner_member_id, created_by, completed_by, depth) nie są tu wysyłane.
 */
import type { QuickAddResult } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import type { Task } from './model';

export function createTask(a: { id: string; groupId: string; listId: string; parentId?: string | null; parsed: QuickAddResult; sortKey?: string; assigneeId?: string | null }): NewOp {
  const due = a.parsed.due;
  return {
    kind: 'create',
    entity: 'tasks',
    id: a.id,
    group_id: a.groupId,
    set: {
      list_id: a.listId,
      parent_id: a.parentId ?? null,
      title: a.parsed.title,
      sort_key: a.sortKey ?? 'a0',
      // Podzadanie bez własnego terminu dziedziczy termin rodzica (D15); zadanie główne bez terminu jest przypięte (D16).
      deadline_mode: due ? 'own' : a.parentId ? 'inherit' : 'none',
      due_date: due?.date ?? null,
      due_time: due?.time ?? null,
      ...(a.assigneeId ? { assignee_member_id: a.assigneeId } : {}),
    },
  };
}

/** Odhaczenie albo cofnięcie odhaczenia. `nowIso` — chwila odhaczenia (znacznik czasu telefonu). */
export function toggleDone(task: Pick<Task, 'id' | 'completed_at'>, nowIso: string): NewOp {
  return { kind: 'patch', entity: 'tasks', id: task.id, set: { completed_at: task.completed_at === null ? nowIso : null } };
}

export function patchTask(id: string, set: Partial<Pick<Task, 'title' | 'note' | 'assignee_member_id' | 'start_date' | 'rollover'>>): NewOp {
  return { kind: 'patch', entity: 'tasks', id, set };
}

/** Termin: `null` = bez terminu (przypięte), inaczej własny termin (D45: godzina opcjonalna). */
export function setDue(id: string, due: { date: string; time: string | null } | null): NewOp {
  return {
    kind: 'patch',
    entity: 'tasks',
    id,
    set: due === null ? { deadline_mode: 'none', due_date: null, due_time: null } : { deadline_mode: 'own', due_date: due.date, due_time: due.time },
  };
}

export function remove(entity: 'tasks' | 'lists' | 'group_members', id: string): NewOp {
  return { kind: 'delete', entity, id };
}

export function restore(entity: 'tasks' | 'lists' | 'group_members', id: string): NewOp {
  return { kind: 'restore', entity, id };
}

export function createList(a: { id: string; groupId: string; kind: 'tasks' | 'shopping'; name: string; visibility?: 'group' | 'restricted' | 'private' }): NewOp {
  return { kind: 'create', entity: 'lists', id: a.id, group_id: a.groupId, set: { kind: a.kind, name: a.name, visibility: a.visibility ?? 'group' } };
}

export function renameList(id: string, name: string): NewOp {
  return { kind: 'patch', entity: 'lists', id, set: { name } };
}

/** Kolor linii grupy (D56): klucz z palety albo `null` = automatyczny. */
export function setGroupColor(id: string, color: string | null): NewOp {
  return { kind: 'patch', entity: 'groups', id, set: { color } };
}

export function setRole(memberId: string, role: 'admin' | 'member'): NewOp {
  return { kind: 'patch', entity: 'group_members', id: memberId, set: { role } };
}

export function renameGroup(id: string, name: string): NewOp {
  return { kind: 'patch', entity: 'groups', id, set: { name } };
}

/** Profil dziecka bez konta (D10): dodaje owner albo admin. */
export function addChild(a: { memberId: string; groupId: string; name: string }): NewOp {
  return { kind: 'create', entity: 'group_members', id: a.memberId, group_id: a.groupId, set: { member_id: a.memberId, display_name: a.name, role: 'child' } };
}

export function renameMember(memberId: string, name: string): NewOp {
  return { kind: 'patch', entity: 'group_members', id: memberId, set: { display_name: name } };
}

export function moveTask(id: string, parentId: string | null, listId?: string): NewOp {
  return { kind: 'cmd', cmd: 'move_task', args: listId === undefined ? { id, parent_id: parentId } : { id, parent_id: parentId, list_id: listId } };
}
