/**
 * Operacje, które wysyłają ekrany (NewOp dla `mutate()`). Kolumny i dozwolone zmiany jak w
 * private.sync_entities (supabase/migrations/20261006120200_sync.sql); pola ustawiane przez serwer
 * (owner_member_id, created_by, completed_by, depth) nie są tu wysyłane.
 */
import { config } from '../../config';
import type { QuickAddResult } from '../quickadd';
import type { NewOp } from '../sync-engine/client';
import type { Tables, Task } from './model';

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
      // Audyt 2 (P-3): „co tydzień” rozpoznane w tekście (chip) zapisuje powtarzanie (D76); podzadanie — bez.
      ...(a.parsed.rrule && due && !a.parentId ? { repeat: a.parsed.rrule } : {}),
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
    // Bez terminu nie ma powtarzania (D76; w bazie tasks_repeat_needs_due), więc zdjęcie terminu zdejmuje też regułę.
    set: due === null ? { deadline_mode: 'none', due_date: null, due_time: null, repeat: null } : { deadline_mode: 'own', due_date: due.date, due_time: due.time },
  };
}

/** Podzadanie wraca do terminu zadania nadrzędnego (D15; audyt 2, M-204) — bez własnego terminu i powtarzania. */
export function inheritDue(id: string): NewOp {
  return { kind: 'patch', entity: 'tasks', id, set: { deadline_mode: 'inherit', due_date: null, due_time: null, repeat: null } };
}

export function remove(entity: 'tasks' | 'lists' | 'group_members', id: string): NewOp {
  return { kind: 'delete', entity, id };
}

export function restore(entity: 'tasks' | 'lists' | 'group_members', id: string): NewOp {
  return { kind: 'restore', entity, id };
}

/** `trip` — zakupy na liście zakupów (D73): dzień, godzina, osoba. */
export function createList(a: { id: string; groupId: string; kind: 'tasks' | 'shopping'; name: string; visibility?: 'group' | 'restricted' | 'private'; trip?: { date: string | null; time: string | null; responsibleId: string | null } }): NewOp {
  const trip = a.kind === 'shopping' && a.trip ? { due_date: a.trip.date, due_time: a.trip.date === null ? null : a.trip.time, responsible_member_id: a.trip.responsibleId } : {};
  return { kind: 'create', entity: 'lists', id: a.id, group_id: a.groupId, set: { kind: a.kind, name: a.name, visibility: a.visibility ?? 'group', ...trip } };
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

/**
 * Operacje odwrotne do `ops` względem stanu `t` sprzed nich — do paska „Cofnij” (audyt 8.10.2026: odwołanie albo
 * usunięcie wydarzenia było bez cofnięcia). Od końca: utworzenie → usunięcie, usunięcie ↔ przywrócenie, zmiana →
 * poprzednie wartości pól (brak pola = wartość domyślna serwera albo null). Polecenia serwera (cmd) nie mają odwrotności — wtedy `null`.
 */
export function inverseOps(t: Tables, ops: readonly NewOp[]): NewOp[] | null {
  if (ops.some((o) => o.kind === 'cmd')) return null;
  // Zmiana wiersza utworzonego w tej samej paczce (np. wyjątek terminu: utworzenie i zmiana, audyt 2 S-8) nie ma
  // odwrotności — usunięcie wiersza wystarczy (inaczej „Cofnij” wpisywałby null w kolumny NOT NULL).
  const created = new Set(ops.flatMap((o) => (o.kind === 'create' && !t[o.entity]?.[o.id] ? [`${o.entity}|${o.id}`] : [])));
  return [...ops].reverse().flatMap((o): NewOp[] => {
    if (o.kind === 'create') return [{ kind: 'delete', entity: o.entity, id: o.id }];
    if (o.kind === 'delete') return [{ kind: 'restore', entity: o.entity, id: o.id }];
    if (o.kind === 'restore') return [{ kind: 'delete', entity: o.entity, id: o.id }];
    const p = o as Extract<NewOp, { kind: 'patch' }>;
    if (created.has(`${p.entity}|${p.id}`)) return [];
    const before = t[p.entity]?.[p.id] ?? {};
    // Pola, którego wiersz jeszcze nie ma (utworzony na telefonie, nie wrócił z serwera), serwer ma wartość domyślną
    // kolumny — ją przywracamy, nie null (audyt 2, M-59: „Cofnij” odwołania terminu było odrzucane, invalid:23502).
    const defaults = config.sync.PATCH_DEFAULTS[p.entity] ?? {};
    return [{ kind: 'patch', entity: p.entity, id: p.id, set: Object.fromEntries(Object.keys(p.set).map((k) => [k, k in before ? (before[k] ?? null) : (defaults[k] ?? null)])) }];
  });
}
