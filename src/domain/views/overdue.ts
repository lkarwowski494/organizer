/**
 * „Przenieś zaległe na dziś” (D111): zaległe zadania z własnym terminem dostają termin na dziś (godzina zostaje),
 * więc znika czerwone „zaległe od …”. Pomijamy zakupy (termin listy) i zadania z terminem po rodzicu albo
 * wydarzeniu — tam termin zmienia się u rodzica. Zwraca też operacje cofnięcia (poprzednie terminy).
 */
import type { NewOp } from '../sync-engine/client';
import { setDue } from './commands';
import type { MyTask } from './my-days';

export function movableOverdue(tasks: readonly MyTask[]): MyTask[] {
  return tasks.filter((x) => !x.trip && x.deadline_mode === 'own' && x.due !== null);
}

export function moveOverdueOps(tasks: readonly MyTask[], isoToday: string): { ops: NewOp[]; undo: NewOp[] } {
  const movable = movableOverdue(tasks);
  return {
    ops: movable.map((x) => setDue(x.id, { date: isoToday, time: x.due!.time })),
    undo: movable.map((x) => setDue(x.id, { date: x.due!.date, time: x.due!.time })),
  };
}
