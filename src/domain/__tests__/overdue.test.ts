import type { MyTask } from '../views/my-days';
import { movableOverdue, moveOverdueOps } from '../views/overdue';

const task = (id: string, o: Partial<MyTask> = {}) => ({ id, deadline_mode: 'own', due: { date: '2026-10-05', time: '17:00' }, overdueDays: 3, ...o }) as MyTask;

describe('przenieś zaległe na dziś (D111)', () => {
  it('tylko zadania z własnym terminem; godzina zostaje; cofnięcie przywraca dawne terminy', () => {
    const list = [task('a'), task('b', { due: { date: '2026-10-06', time: null } }), task('c', { deadline_mode: 'inherit' }), task('d', { trip: { listId: 'l', open: 2 } }), task('e', { due: null as never })];
    expect(movableOverdue(list).map((x) => x.id)).toEqual(['a', 'b']);
    expect(moveOverdueOps(list, '2026-10-08')).toEqual({
      ops: [
        { kind: 'patch', entity: 'tasks', id: 'a', set: { deadline_mode: 'own', due_date: '2026-10-08', due_time: '17:00' } },
        { kind: 'patch', entity: 'tasks', id: 'b', set: { deadline_mode: 'own', due_date: '2026-10-08', due_time: null } },
      ],
      undo: [
        { kind: 'patch', entity: 'tasks', id: 'a', set: { deadline_mode: 'own', due_date: '2026-10-05', due_time: '17:00' } },
        { kind: 'patch', entity: 'tasks', id: 'b', set: { deadline_mode: 'own', due_date: '2026-10-06', due_time: null } },
      ],
    });
  });
});
