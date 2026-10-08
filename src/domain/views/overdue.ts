/**
 * „Przenieś zaległe na dziś” (D111): zaległe zadania z własnym terminem dostają termin na dziś (godzina zostaje),
 * więc znika czerwone „zaległe od …”. Pomijamy zakupy (termin listy) i zadania z terminem po rodzicu albo
 * wydarzeniu — tam termin zmienia się u rodzica. Zwraca też operacje cofnięcia (poprzednie terminy).
 * D137: powtarzanie co miesiąc zapisane bez dnia miesiąca dostaje dzień z dotychczasowego terminu, więc przeniesienie
 * nie przesuwa cyklu na stałe.
 */
import type { NewOp, Row } from '../sync-engine/client';
import { setRepeat } from './task-repeat';
import { setDue } from './commands';
import type { MyTask } from './my-days';

export function movableOverdue(tasks: readonly MyTask[]): MyTask[] {
  return tasks.filter((x) => !x.trip && x.deadline_mode === 'own' && x.due !== null);
}

export function moveOverdueOps(tasks: readonly MyTask[], isoToday: string, t: { tasks?: Record<string, Row> } = {}): { ops: NewOp[]; undo: NewOp[] } {
  const movable = movableOverdue(tasks);
  const monthly = movable.filter((x) => t.tasks?.[x.id]?.repeat === 'FREQ=MONTHLY');
  return {
    ops: [...movable.map((x) => setDue(x.id, { date: isoToday, time: x.due!.time })), ...monthly.map((x) => setRepeat(x.id, { kind: 'monthly' }, x.due!.date))],
    undo: [...movable.map((x) => setDue(x.id, { date: x.due!.date, time: x.due!.time })), ...monthly.map((x) => ({ kind: 'patch', entity: 'tasks', id: x.id, set: { repeat: 'FREQ=MONTHLY' } }) as NewOp)],
  };
}
