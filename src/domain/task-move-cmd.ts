/**
 * „Przenieś do grupy” jako jedno polecenie serwera (audyt 3, N-12, N-131): `private.move_task_to_group` i
 * `private.unmove_task` w migracji 20261010060000_move_task_to_group.sql. Wcześniej przeniesienie było paczką zwykłych
 * operacji, które serwer stosuje niezależnie — odrzucona kopia zostawiała oryginał w koszu i zadanie znikało z obu grup.
 * Teraz albo wszystko, albo nic. Ten moduł opisuje kroki polecenia raz — wykonuje je telefon (applyOp w
 * sync-engine/client.ts, widoczne od razu, także bez sieci — R1) i model serwera (server-rules.ts); serwer robi te same
 * zapisy przez private.apply_op (pgTAP: supabase/tests/move_task_to_group.test.sql).
 *
 *  - move_task_to_group: (lista ogólna w nowej grupie), kopie zadania i podzadań, oryginał do kosza, a w oryginale
 *    znacznik `moved_to` = id kopii. Kosz pomija przeniesione, ekran oryginału mówi „Przeniesiono do …”.
 *  - unmove_task („Cofnij”): kopia do kosza ze znacznikiem `moved_to` = oryginał, oryginał wraca z podzadaniami.
 *  - Przeniesione zadanie nie wraca z kosza, dopóki żyje jego kopia (`movedAlive`; serwer: kod „moved”).
 */
import type { NewOp, Row } from './sync-engine/client';

type Tables = { readonly [e: string]: { readonly [id: string]: Row } | undefined };

export type MoveCopy = { id: string; from: string; set: Row };
export type MoveArgs = { task_id: string; group_id: string; list: { id: string; set: Row } | null; tasks: MoveCopy[] };
export type UnmoveArgs = { task_id: string; copy_id: string; title: string };

/** Krok polecenia: zwykła operacja albo znacznik przeniesienia (`moved_to` wiersza `id` = `to`). */
export type MoveStep = { op: NewOp } | { mark: { id: string; to: string } };

const live = (r: Row | undefined): r is Row => r !== undefined && r.deleted_at == null;

/** Przeniesione zadanie, którego kopia (albo oryginał — po „Cofnij”) żyje: nie wraca z kosza. */
export function movedAlive(t: Tables, row: Row): boolean {
  return row.moved_to != null && live(t.tasks?.[String(row.moved_to)]);
}

/** Kroki przeniesienia; [] — polecenie nic nie zmieni (serwer je odrzuci: zadania nie ma, jest w koszu, jest podzadaniem). */
export function moveSteps(t: Tables, a: MoveArgs): MoveStep[] {
  const src = t.tasks?.[a.task_id];
  const root = a.tasks[0];
  if (!live(src) || src.parent_id != null || src.group_id === a.group_id || !root) return [];
  const create = (entity: 'lists' | 'tasks', id: string, set: Row): MoveStep => ({ op: { kind: 'create', entity, id, group_id: a.group_id, set } });
  return [
    ...(a.list ? [create('lists', a.list.id, a.list.set)] : []),
    ...a.tasks.map((x) => create('tasks', x.id, x.set)),
    { op: { kind: 'delete', entity: 'tasks', id: a.task_id } },
    { mark: { id: a.task_id, to: root.id } },
  ];
}

/** Kroki „Cofnij”; [] — oryginału nie ma, już wrócił albo przeniesiono go gdzie indziej (serwer: invalid_value). */
export function unmoveSteps(t: Tables, a: UnmoveArgs): MoveStep[] {
  const src = t.tasks?.[a.task_id];
  if (!src || src.deleted_at == null || src.moved_to !== a.copy_id) return [];
  const copy = t.tasks?.[a.copy_id];
  return [
    ...(copy ? [{ op: { kind: 'delete', entity: 'tasks', id: a.copy_id } } as const, { mark: { id: a.copy_id, to: a.task_id } }] : []),
    { op: { kind: 'restore', entity: 'tasks', id: a.task_id } },
  ];
}

/** Kroki polecenia przeniesienia albo null — inne polecenie. */
export function moveCmdSteps(t: Tables, cmd: { cmd: string; args: Row }): MoveStep[] | null {
  if (cmd.cmd === 'move_task_to_group') return moveSteps(t, cmd.args as MoveArgs);
  if (cmd.cmd === 'unmove_task') return unmoveSteps(t, cmd.args as UnmoveArgs);
  return null;
}

/** Zwykłe operacje polecenia (odcisk dla „Ostatnich zmian”: co polecenie ustawiło). */
export const stepOps = (steps: readonly MoveStep[]): NewOp[] => steps.flatMap((s) => ('op' in s ? [s.op] : []));
