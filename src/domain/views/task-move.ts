/**
 * „Przenieś do grupy” na ekranie zadania (decyzja właściciela 8.10.2026, D178 / PW-19 A; audyt 2, M-122, T-33).
 * Grupa to granica bezpieczeństwa (D3) i serwer nie zmienia grupy zadania (synchronizacja liczy wersje osobno w każdej
 * grupie, D32 — wiersz przeniesiony między grupami nie dotarłby jako usunięty do osób z pierwszej grupy). Dlatego
 * przeniesienie to kopia całego zadania z podzadaniami w nowej grupie i oryginał w koszu — w jednej transakcji, z „Cofnij”
 * (`undo`: kopie do kosza, oryginał z powrotem; serwer przywraca podzadania kaskadą, jak przy każdym usunięciu).
 *  - Kopia: tytuły, notatki, kolejność, terminy, „Gdy nie zrobisz w terminie”, powtarzanie, odhaczenia — na ogólnej liście
 *    nowej grupy (D97), z tą samą strukturą podzadań.
 *  - Osoba: ta sama osoba (to samo konto) w nowej grupie, inaczej „nikt konkretny” (D132; profil dziecka bez konta należy
 *    do jednej grupy).
 *  - Podpięcie do wydarzenia (D13) zostaje w starej grupie: termin z wydarzenia staje się własnym terminem (odwołane —
 *    bez terminu); stała kopia serii (D65) w nowej grupie jest zwykłym zadaniem.
 *  - Nowe id (UUIDv7, R3) — historia zmian zostaje przy oryginale w koszu.
 */
import type { NewOp, Row } from '../sync-engine/client';
import { inverseOps, remove } from './commands';
import { occurrenceResolver } from './event-rows';
import { asTask, type Tables, type Task } from './model';
import { subtasksOf } from './nesting';
import { formGroups, generalList } from './task-form';

/** Grupy, do których mogę przenieść zadanie (jak w formularzu: nie jako dziecko), bez jego grupy. */
export const moveTargets = (t: Tables, userId: string, task: Pick<Task, 'group_id'>) => formGroups(t, userId).filter((g) => g.id !== task.group_id);

/** Ta sama osoba (konto) w grupie `groupId` albo null. */
function sameperson(t: Tables, memberId: string | null, groupId: string): string | null {
  const user = memberId === null ? null : t.group_members?.[memberId]?.user_id;
  if (user == null) return null;
  const m = Object.values(t.group_members!).find((x) => x.group_id === groupId && x.user_id === user && x.deleted_at == null);
  return m ? String(m.member_id) : null;
}

export function moveTaskOps(t: Tables, userId: string, taskId: string, groupId: string, newId: () => string): { ops: NewOp[]; undo: NewOp[]; taskId: string } | null {
  const raw = t.tasks?.[taskId];
  // Tylko zadanie główne — podzadanie przenosi się razem ze swoim zadaniem.
  if (!raw || raw.deleted_at != null || raw.parent_id != null || !moveTargets(t, userId, asTask(raw)).some((g) => g.id === groupId)) return null;
  const root = asTask(raw);
  const list = generalList(t, userId, groupId, newId);
  const ids = new Map<string, string>();
  const resolve = occurrenceResolver(t);
  const copy = (x: Task, r: Row): NewOp => {
    const id = newId();
    ids.set(x.id, id);
    const linked = x.deadline_mode === 'event';
    const eventDue = linked && x.event_id !== null && x.occurrence_date !== null ? resolve(x.event_id, x.occurrence_date) : null;
    const mode = linked ? (eventDue ? 'own' : x.parent_id ? 'inherit' : 'none') : x.deadline_mode;
    const due = linked ? eventDue : { date: x.due_date, time: x.due_time };
    // Powtarzanie ma tylko zadanie główne z własnym terminem (podpięte go nie miało — RepeatEditor jest wtedy ukryty).
    const repeat = x.id === root.id && !linked && mode === 'own' && r.repeat != null ? r.repeat : null;
    return {
      kind: 'create',
      entity: 'tasks',
      id,
      group_id: groupId,
      set: {
        list_id: list.listId,
        parent_id: x.id === root.id ? null : ids.get(x.parent_id!)!,
        title: x.title,
        note: x.note,
        sort_key: x.sort_key,
        assignee_member_id: sameperson(t, x.assignee_member_id, groupId),
        deadline_mode: mode,
        due_date: mode === 'own' ? due!.date : null,
        due_time: mode === 'own' ? due!.time : null,
        rollover: x.rollover,
        ...(repeat ? { repeat } : {}),
        ...(x.start_date ? { start_date: x.start_date } : {}),
        ...(x.completed_at ? { completed_at: x.completed_at } : {}),
      },
    };
  };
  const ops: NewOp[] = [...list.ops, copy(root, raw), ...subtasksOf(t, root.id).map((x) => copy(x, t.tasks![x.id]!)), remove('tasks', root.id)];
  return { ops, undo: inverseOps(t, ops)!, taskId: ids.get(root.id)! };
}
