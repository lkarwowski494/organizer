/**
 * Adresat zadania (D68, decyzja właściciela z 7.10.2026, ADR 0012): we wspólnej grupie zadanie główne na liście zadań
 * musi mieć osobę albo termin (własny, z zadania nadrzędnego albo ze spotkania) — inaczej nie trafi do niczyjego
 * „Moje sprawy”. Grupa osobista, listy zakupów i podzadania (mają kontekst rodzica) są poza regułą.
 */
import { groupsView } from './index';
import { asList, type Tables, type Task } from './model';

export function addresseeRequired(t: Tables, userId: string, listId: string, parentId: string | null): boolean {
  if (parentId !== null) return false;
  const raw = t.lists?.[listId];
  if (!raw) return false;
  const l = asList(raw);
  return l.kind === 'tasks' && groupsView(t, userId).find((g) => g.id === l.group_id)?.kind === 'shared';
}

/** Czy po zmianie zadanie zostałoby bez adresata, choć go potrzebuje. */
export function lacksAddressee(t: Tables, userId: string, x: Pick<Task, 'list_id' | 'parent_id' | 'assignee_member_id' | 'deadline_mode'>): boolean {
  return addresseeRequired(t, userId, x.list_id, x.parent_id) && x.assignee_member_id === null && x.deadline_mode === 'none';
}
