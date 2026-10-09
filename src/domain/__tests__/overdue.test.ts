import type { GroupItem } from '../views';
import type { MyTask } from '../views/my-days';
import { movableOverdue, moveOverdueOps } from '../views/overdue';

const task = (id: string, o: Partial<MyTask> = {}) => ({ id, group_id: 'gp', assignee_member_id: null, deadline_mode: 'own', due: { date: '2026-10-05', time: '17:00' }, overdueDays: 3, ...o }) as MyTask;
const group = (id: string, kind: 'personal' | 'shared', member_id: string, role: GroupItem['me']['role']) => ({ id, kind, me: { member_id, role } }) as GroupItem;
const groups = [group('gp', 'personal', 'mp', 'owner'), group('gf', 'shared', 'mf', 'admin'), group('gk', 'shared', 'mk', 'child')];

describe('przenieś zaległe na dziś (D111)', () => {
  it('tylko zadania z własnym terminem; godzina zostaje (audyt 3, N-126: wysyłany sam dzień); cofnięcie przywraca dawne terminy', () => {
    const list = [task('a'), task('b', { due: { date: '2026-10-06', time: null } }), task('c', { deadline_mode: 'inherit' }), task('e', { due: null as never })];
    expect(movableOverdue(list, groups).map((x) => x.id)).toEqual(['a', 'b']);
    expect(moveOverdueOps(list, '2026-10-08', {}, groups)).toEqual({
      ops: [
        { kind: 'patch', entity: 'tasks', id: 'a', set: { deadline_mode: 'own', due_date: '2026-10-08' } },
        { kind: 'patch', entity: 'tasks', id: 'b', set: { deadline_mode: 'own', due_date: '2026-10-08' } },
      ],
      undo: [
        { kind: 'patch', entity: 'tasks', id: 'a', set: { deadline_mode: 'own', due_date: '2026-10-05' } },
        { kind: 'patch', entity: 'tasks', id: 'b', set: { deadline_mode: 'own', due_date: '2026-10-06' } },
      ],
      count: 2,
    });
  });

  it('decyzja właściciela z 8.10.2026: tylko moje — przypisane do mnie i z grupy osobistej; wspólne nieprzypisane i cudze zostają', () => {
    const list = [task('osobiste'), task('moje', { group_id: 'gf', assignee_member_id: 'mf' }), task('wspólne', { group_id: 'gf' }), task('tymka', { group_id: 'gf', assignee_member_id: 'tymek' }), task('obca', { group_id: 'gx' })];
    expect(movableOverdue(list, groups).map((x) => x.id)).toEqual(['osobiste', 'moje']);
  });

  it('audyt 2 (T-11, P-56): liczba zadań, nie operacji; bez grup, w których jestem dzieckiem; moje zakupy z terminem też', () => {
    const t = { tasks: { czynsz: { id: 'czynsz', repeat: 'FREQ=MONTHLY' } } };
    const list = [
      task('czynsz', { due: { date: '2026-10-05', time: null } }),
      task('pokój', { group_id: 'gk', assignee_member_id: 'mk' }),
      task('lz', { group_id: 'gf', assignee_member_id: 'mf', due: { date: '2026-10-06', time: '18:00' }, trip: { listId: 'lz', open: 2 } }),
      task('lw', { group_id: 'gf', assignee_member_id: null, due: { date: '2026-10-06', time: null }, trip: { listId: 'lw', open: 1 } }),
    ];
    const r = moveOverdueOps(list, '2026-10-08', t, groups);
    expect(r.count).toBe(2);
    expect(r.ops).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { deadline_mode: 'own', due_date: '2026-10-08' } },
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=5' } },
      // Audyt 3 (N-126, V2-1): sam dzień — osoba przyjęta w tym czasie na drugim telefonie zostaje.
      { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-08' } },
    ]);
    expect(r.undo.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-06' } });
    expect(moveOverdueOps(list, '2026-10-08', t, [])).toEqual({ ops: [], undo: [], count: 0 });
  });
});

describe('D137: przeniesienie nie przesuwa cyklu co miesiąc', () => {
  it('stare „co miesiąc” bez dnia dostaje dzień z dawnego terminu; cofnięcie zdejmuje', () => {
    const t = { tasks: { czynsz: { id: 'czynsz', repeat: 'FREQ=MONTHLY' }, nowy: { id: 'nowy', repeat: 'FREQ=MONTHLY;BYMONTHDAY=5' } } };
    const r = moveOverdueOps([task('czynsz', { due: { date: '2026-10-15', time: null } }), task('nowy')], '2026-10-20', t, groups);
    expect(r.ops.slice(2)).toEqual([{ kind: 'patch', entity: 'tasks', id: 'czynsz', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=15' } }]);
    expect(r.undo.slice(2)).toEqual([{ kind: 'patch', entity: 'tasks', id: 'czynsz', set: { repeat: 'FREQ=MONTHLY' } }]);
    expect(r.count).toBe(2);
  });
});
