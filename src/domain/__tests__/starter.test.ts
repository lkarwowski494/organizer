import { applyOp, type Op, type Row } from '../sync-engine/client';
import { generalList, NEW_LIST_NAME } from '../views/task-form';
import { nextStepsKey, STARTER_SHOPPING_LIST_NAME, starterListsOps } from '../views/starter';

describe('grupa z Pierwszych kroków (PW-36 A)', () => {
  it('lista zakupów i ogólna lista zadań; formularz zadania nie zakłada drugiej', () => {
    let n = 0;
    const ops = starterListsOps('g', () => `l${++n}`);
    expect(ops).toEqual([
      { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g', set: { kind: 'shopping', name: STARTER_SHOPPING_LIST_NAME, visibility: 'group' } },
      { kind: 'create', entity: 'lists', id: 'l2', group_id: 'g', set: { kind: 'tasks', name: NEW_LIST_NAME, visibility: 'group' } },
    ]);
    const t: { [e: string]: { [id: string]: Row } } = {
      groups: { g: { id: 'g', name: 'Rodzina', kind: 'shared', created_at: '2026-10-07T08:00:00Z', deleted_at: null } },
      group_members: { m: { member_id: 'm', group_id: 'g', user_id: 'u', display_name: 'Ola', role: 'owner', deleted_at: null } },
    };
    ops.forEach((op, i) => applyOp(t, { ...op, seq: i + 1, op_id: `o${i}` } as Op));
    expect(generalList(t, 'u', 'g', () => 'nowa')).toEqual({ listId: 'l2', ops: [] });
    expect(nextStepsKey('g')).toBe('nextSteps.g');
  });
});
