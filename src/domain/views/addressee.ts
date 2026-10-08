/**
 * Adresat zadania (D68, decyzja właściciela z 7.10.2026, ADR 0012): we wspólnej grupie zadanie główne na liście zadań
 * musi mieć osobę albo termin (własny, z zadania nadrzędnego albo ze spotkania) — inaczej nie trafi do niczyjego
 * „Moje sprawy”. Grupa osobista, listy zakupów i podzadania (mają kontekst rodzica) są poza regułą.
 */
import { effectiveDue, type TaskTerms } from '../deadlines';
import { occurrenceResolver } from './event-rows';
import { groupsView } from './index';
import { asList, type Tables, type Task } from './model';

export function addresseeRequired(t: Tables, userId: string, listId: string, parentId: string | null): boolean {
  if (parentId !== null) return false;
  const raw = t.lists?.[listId];
  if (!raw) return false;
  const l = asList(raw);
  return l.kind === 'tasks' && groupsView(t, userId).find((g) => g.id === l.group_id)?.kind === 'shared';
}

/**
 * Czy po zmianie zadanie zostałoby bez adresata, choć go potrzebuje: bez żywej osoby (usunięta z grupy to „nikt
 * konkretny”, D132) i bez terminu — własnego albo spotkania (odwołane wystąpienie to brak terminu, D14). Audyt 2 (T-15):
 * wcześniej liczyły się samo pole osoby i tryb terminu, więc takie zadanie znikało wszystkim bez ostrzeżenia.
 */
export function lacksAddressee(t: Tables, userId: string, x: TaskTerms & Pick<Task, 'list_id' | 'assignee_member_id'>): boolean {
  if (!addresseeRequired(t, userId, x.list_id, x.parent_id)) return false;
  const person = x.assignee_member_id === null ? undefined : t.group_members?.[x.assignee_member_id];
  if (person && person.deleted_at == null) return false;
  // Zadanie główne, więc termin własny albo spotkania (bez rodziców); wystąpienia spotkań liczymy tylko dla trybu „event”.
  return effectiveDue(x, new Map(), (eventId, date) => occurrenceResolver(t)(eventId, date)) === null;
}
