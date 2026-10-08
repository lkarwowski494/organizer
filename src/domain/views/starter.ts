/**
 * Grupa założona w Pierwszych krokach (decyzja właściciela z 8.10.2026, PW-36 A): od razu lista zakupów i ogólna lista
 * zadań — ta sama, na którą formularz zadania kładzie nowe zadania (generalList, NEW_LIST_NAME), więc nie powstanie druga.
 */
import type { NewOp } from '../sync-engine/client';
import { createList } from './commands';
import { NEW_LIST_NAME } from './task-form';

export const STARTER_SHOPPING_LIST_NAME = 'Zakupy';

export function starterListsOps(groupId: string, newId: () => string): NewOp[] {
  return [
    createList({ id: newId(), groupId, kind: 'shopping', name: STARTER_SHOPPING_LIST_NAME }),
    createList({ id: newId(), groupId, kind: 'tasks', name: NEW_LIST_NAME }),
  ];
}

/** Klucz w prefs telefonu: karta „Następne kroki” tej grupy ('1' — pokaż, '0' — schowana). */
export const nextStepsKey = (groupId: string) => `nextSteps.${groupId}`;
