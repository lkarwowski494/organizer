/**
 * „Przenieś do grupy” na ekranie zadania (decyzja właściciela 8.10.2026, D178 / PW-19 A; audyt 2, M-122, T-33).
 * Grupa to granica bezpieczeństwa (D3) i serwer nie zmienia grupy zadania (synchronizacja liczy wersje osobno w każdej
 * grupie, D32 — wiersz przeniesiony między grupami nie dotarłby jako usunięty do osób z pierwszej grupy). Dlatego
 * przeniesienie to kopia całego zadania z podzadaniami w nowej grupie i oryginał w koszu ze znacznikiem przeniesienia —
 * jedno polecenie serwera move_task_to_group: wszystko albo nic, także na serwerze (audyt 3, N-12; kroki:
 * src/domain/task-move-cmd.ts). „Cofnij” to polecenie unmove_task: kopia do kosza (ze znacznikiem powrotu — nie stoi w
 * koszu nowej grupy), oryginał wraca z podzadaniami (kaskada, jak przy każdym przywróceniu).
 *  - Tylko niezrobione (audyt 3, N-121): zrobione zadanie powtarzane ma już następny termin w swojej grupie — kopia
 *    w nowej grupie dostałaby drugi.
 *  - Kopia: tytuły, notatki, kolejność, terminy, „Gdy nie zrobisz w terminie”, powtarzanie, odhaczenia — na ogólnej liście
 *    nowej grupy (D97), z tą samą strukturą podzadań.
 *  - Osoba: ta sama osoba (to samo konto) w nowej grupie, inaczej „nikt konkretny” (D132; profil dziecka bez konta należy
 *    do jednej grupy).
 *  - Podpięcie do wydarzenia (D13) zostaje w starej grupie: termin z wydarzenia staje się własnym terminem (odwołane —
 *    bez terminu); stała kopia serii (D65) w nowej grupie jest zwykłym zadaniem.
 *  - Nowe id (UUIDv7, R3) — historia zmian zostaje przy oryginale w koszu.
 */
import type { NewOp, Row } from '../sync-engine/client';
import { type MoveArgs, type MoveCopy, moveSteps, stepOps, type UnmoveArgs } from '../task-move-cmd';
import { occurrenceResolver } from './event-rows';
import { asTask, type Tables, type Task } from './model';
import { subtasksOf } from './nesting';
import { formGroups, generalList } from './task-form';
import { type GroupItem, groupsView } from './index';

/** Grupy, do których mogę przenieść zadanie (jak w formularzu: nie jako dziecko), bez jego grupy. */
export const moveTargets = (t: Tables, userId: string, task: Pick<Task, 'group_id'>) => formGroups(t, userId).filter((g) => g.id !== task.group_id);

/** Ta sama osoba (konto) w grupie `groupId` albo null. */
function sameperson(t: Tables, memberId: string | null, groupId: string): string | null {
  const user = memberId === null ? null : t.group_members?.[memberId]?.user_id;
  if (user == null) return null;
  const m = Object.values(t.group_members!).find((x) => x.group_id === groupId && x.user_id === user && x.deleted_at == null);
  return m ? String(m.member_id) : null;
}

export type MovePlan = {
  /** Jedno polecenie move_task_to_group. */
  ops: NewOp[];
  /** Zwykłe operacje, które polecenie wykona (odcisk dla „Cofnij” i „Ostatnich zmian”). */
  changed: NewOp[];
  /** „Cofnij”: polecenie unmove_task. */
  undo: NewOp[];
  /** Id kopii zadania głównego. */
  taskId: string;
};

export function moveTaskOps(t: Tables, userId: string, taskId: string, groupId: string, newId: () => string): MovePlan | null {
  const raw = t.tasks?.[taskId];
  // Tylko niezrobione zadanie główne — podzadanie przenosi się razem ze swoim zadaniem (N-121: zrobione zostaje).
  if (!raw || raw.deleted_at != null || raw.parent_id != null || raw.completed_at != null || !moveTargets(t, userId, asTask(raw)).some((g) => g.id === groupId)) return null;
  const root = asTask(raw);
  const list = generalList(t, userId, groupId, newId);
  const ids = new Map<string, string>();
  const resolve = occurrenceResolver(t);
  const copy = (x: Task, r: Row): MoveCopy => {
    const id = newId();
    ids.set(x.id, id);
    const linked = x.deadline_mode === 'event';
    const eventDue = linked && x.event_id !== null && x.occurrence_date !== null ? resolve(x.event_id, x.occurrence_date) : null;
    const mode = linked ? (eventDue ? 'own' : x.parent_id ? 'inherit' : 'none') : x.deadline_mode;
    const due = linked ? eventDue : { date: x.due_date, time: x.due_time };
    // Powtarzanie ma tylko zadanie główne z własnym terminem (podpięte go nie miało — RepeatEditor jest wtedy ukryty).
    const repeat = x.id === root.id && !linked && mode === 'own' && r.repeat != null ? r.repeat : null;
    return {
      id,
      from: x.id,
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
        // Audyt 3 (N-25): pierwotny dzień przeniesionego terminu idzie z nim — inaczej następny wróciłby na ten dzień.
        ...(repeat && x.cycle_date ? { cycle_date: x.cycle_date } : {}),
        ...(x.start_date ? { start_date: x.start_date } : {}),
        ...(x.completed_at ? { completed_at: x.completed_at } : {}),
      },
    };
  };
  const created = list.ops[0];
  const args: MoveArgs = {
    task_id: root.id,
    group_id: groupId,
    list: created?.kind === 'create' ? { id: created.id, set: created.set } : null,
    tasks: [copy(root, raw), ...subtasksOf(t, root.id).map((x) => copy(x, t.tasks![x.id]!))],
  };
  const undo: UnmoveArgs = { task_id: root.id, copy_id: ids.get(root.id)!, title: root.title };
  return { ops: [{ kind: 'cmd', cmd: 'move_task_to_group', args }], changed: stepOps(moveSteps(t, args)), undo: [{ kind: 'cmd', cmd: 'unmove_task', args: undo }], taskId: undo.copy_id };
}

/**
 * Przeniesione zadanie (znacznik moved_to, audyt 3: N-36, N-131): dokąd. `taskId` i `group` — kopia i jej grupa, jeśli
 * ją widzę (otwieram ją zamiast oryginału); null — nie należę do tamtej grupy. Null — zadanie nie zostało przeniesione.
 */
export function movedTo(t: Tables, userId: string, taskId: string): { taskId: string | null; group: GroupItem | null } | null {
  const to = t.tasks?.[taskId]?.moved_to;
  if (to == null) return null;
  const copy = t.tasks?.[String(to)];
  const group = (copy && groupsView(t, userId).find((g) => g.id === copy.group_id)) || null;
  return { taskId: group ? String(to) : null, group };
}
