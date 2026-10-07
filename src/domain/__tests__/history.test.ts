import { taskHistory } from '../views/history';

const a = (id: string, extra: Record<string, unknown>) => ({ id, group_id: 'g', entity: 'tasks', entity_id: 't1', actor_name: 'Ala', verb: 'update', changes: {}, created_at: '2026-10-07T10:00:00Z', ...extra });

describe('historia zadania (D76)', () => {
  it('kto, co, kiedy: dodanie, odhaczenie, cofnięcie, zmiany pól (techniczne pominięte), usunięcie, przywrócenie', () => {
    const t = {
      activity: {
        a1: a('a1', { verb: 'create', created_at: '2026-10-07T08:00:00Z', changes: { title: [null, 'Śmieci'] } }),
        a2: a('a2', { created_at: '2026-10-07T09:00:00Z', changes: { title: ['Śmieci', 'Worki'], due_time: [null, '07:00'], deadline_mode: ['none', 'own'], version: [1, 2] } }),
        a3: a('a3', { actor_name: null, created_at: '2026-10-07T10:00:00Z', changes: { completed_at: [null, '2026-10-07T10:00:00Z'], sort_key: ['a0', 'a1'] } }),
        a4: a('a4', { created_at: '2026-10-07T11:00:00Z', changes: { completed_at: ['x', null], note: [null, 'n'] } }),
        a5: a('a5', { verb: 'delete', created_at: '2026-10-07T12:00:00Z' }),
        a6: a('a6', { verb: 'restore', created_at: '2026-10-07T13:00:00Z', changes: undefined }),
        a7: a('a7', { changes: { version: [1, 2] } }),
        other: a('other', { entity_id: 't2' }),
        list: a('list', { entity: 'lists' }),
      },
    };
    expect(taskHistory(t, 't1', 20)).toEqual([
      { id: 'a6', who: 'Ala', at: '2026-10-07T13:00:00Z', verb: 'restore', fields: [] },
      { id: 'a5', who: 'Ala', at: '2026-10-07T12:00:00Z', verb: 'delete', fields: [] },
      { id: 'a4', who: 'Ala', at: '2026-10-07T11:00:00Z', verb: 'undone', fields: [] },
      { id: 'a4|u', who: 'Ala', at: '2026-10-07T11:00:00Z', verb: 'update', fields: ['note'] },
      { id: 'a3', who: null, at: '2026-10-07T10:00:00Z', verb: 'done', fields: [] },
      { id: 'a2|u', who: 'Ala', at: '2026-10-07T09:00:00Z', verb: 'update', fields: ['due_date', 'title'] },
      { id: 'a1', who: 'Ala', at: '2026-10-07T08:00:00Z', verb: 'create', fields: [] },
    ]);
    expect(taskHistory(t, 't1', 2).map((e) => e.id)).toEqual(['a6', 'a5']);
    expect(taskHistory({}, 't1', 5)).toEqual([]);
    expect(taskHistory({ activity: { x: a('x', { created_at: undefined, verb: 'create' }) } }, 't1', 5)).toEqual([{ id: 'x', who: 'Ala', at: '', verb: 'create', fields: [] }]);
  });
});
