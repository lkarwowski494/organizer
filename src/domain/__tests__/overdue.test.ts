import type { GroupItem } from '../views';
import type { MyTask } from '../views/my-days';
import { movableOverdue, moveOverdueOps, takeOps } from '../views/overdue';
import { asTask } from '../views/model';

const task = (id: string, o: Partial<MyTask> = {}) => ({ id, group_id: 'gp', assignee_member_id: null, deadline_mode: 'own', due: { date: '2026-10-05', time: '17:00' }, overdueDays: 3, ...o }) as MyTask;
const group = (id: string, kind: 'personal' | 'shared', member_id: string, role: GroupItem['me']['role']) => ({ id, kind, me: { member_id, role } }) as GroupItem;
const groups = [group('gp', 'personal', 'mp', 'owner'), group('gf', 'shared', 'mf', 'admin'), group('gk', 'shared', 'mk', 'child')];
const member = (member_id: string, group_id: string, deleted_at: string | null = null) => ({ member_id, group_id, deleted_at });
const people = { group_members: { mp: member('mp', 'gp'), mf: member('mf', 'gf'), mk: member('mk', 'gk'), ala: member('ala', 'gf'), tymek: member('tymek', 'gf'), ola: member('ola', 'gf', 'x') } };

describe('przenieś zaległe na dziś (D111)', () => {
  it('tylko zadania z własnym terminem; godzina zostaje (audyt 3, N-126: wysyłany sam dzień); cofnięcie przywraca dawne terminy', () => {
    const list = [task('a'), task('b', { due: { date: '2026-10-06', time: null } }), task('c', { deadline_mode: 'inherit' }), task('e', { due: null as never })];
    expect(movableOverdue(list, groups, {}).map((x) => x.id)).toEqual(['a', 'b']);
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
    expect(movableOverdue(list, groups, people).map((x) => x.id)).toEqual(['osobiste', 'moje']);
  });

  it('audyt 2 (T-11, P-56): liczba zadań, nie operacji; bez grup, w których jestem dzieckiem; moje zakupy z terminem też', () => {
    const t = { ...people, tasks: { czynsz: { id: 'czynsz', repeat: 'FREQ=MONTHLY' } } };
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

describe('audyt 3: „moje” jak w Moich sprawach (N-122, Q15 A)', () => {
  const lists = {
    lpriv: { id: 'lpriv', group_id: 'gf', kind: 'tasks', visibility: 'private', owner_member_id: 'mf' },
    lnew: { id: 'lnew', group_id: 'gf', kind: 'tasks', visibility: 'private', owner_member_id: null },
    lala: { id: 'lala', group_id: 'gf', kind: 'tasks', visibility: 'private', owner_member_id: 'ala' },
    lf: { id: 'lf', group_id: 'gf', kind: 'tasks', visibility: 'group', owner_member_id: null },
    lz: { id: 'lz', group_id: 'gf', kind: 'shopping', visibility: 'private', owner_member_id: 'mf' },
  };
  it('bez osoby z mojej listy „Tylko ja” (także świeżej, bez właściciela) — tak; z cudzej i ze wspólnej — nie; osoba usunięta = nikt', () => {
    const t = { ...people, lists };
    const list = [task('prv', { group_id: 'gf', list_id: 'lpriv' }), task('nowa', { group_id: 'gf', list_id: 'lnew' }), task('ali', { group_id: 'gf', list_id: 'lala' }), task('wsp', { group_id: 'gf', list_id: 'lf' }), task('byla', { group_id: 'gf', list_id: 'lpriv', assignee_member_id: 'ola' }), task('nieznana', { group_id: 'gf', list_id: 'brak' })];
    expect(movableOverdue(list, groups, t).map((x) => x.id)).toEqual(['prv', 'nowa', 'byla']);
    // Zakupy z mojej listy „Tylko ja” bez osoby zakupów — też moje.
    expect(movableOverdue([task('lz', { group_id: 'gf', trip: { listId: 'lz', open: 1 } })], groups, t).map((x) => x.id)).toEqual(['lz']);
  });

  it('podzadanie bez osoby w moim zadaniu — moje; w zadaniu Ali — nie (osoba zadania nadrzędnego)', () => {
    const t = { ...people, lists, tasks: { mojeR: { id: 'mojeR', assignee_member_id: 'mf', parent_id: null }, aliR: { id: 'aliR', assignee_member_id: 'ala', parent_id: null } } };
    const list = [task('pod', { group_id: 'gf', list_id: 'lf', parent_id: 'mojeR' }), task('podAli', { group_id: 'gf', list_id: 'lf', parent_id: 'aliR' })];
    expect(movableOverdue(list, groups, t).map((x) => x.id)).toEqual(['pod']);
  });
});

describe('„Biorę to” (Q35 A, N-133)', () => {
  const raw = (o: Record<string, unknown> = {}) => asTask({ id: 'w', group_id: 'gf', list_id: 'lf', parent_id: null, title: 'Wynieść szkło', deadline_mode: 'own', due_date: '2026-10-05', due_time: '18:00:00', completed_at: null, deleted_at: null, assignee_member_id: null, ...o });
  it('wspólne zaległe bez osoby: przypisanie do mnie i dziś (godzina zostaje); cofnięcie wraca', () => {
    expect(takeOps(people, raw(), groups, '2026-10-08')).toEqual({
      ops: [
        { kind: 'patch', entity: 'tasks', id: 'w', set: { assignee_member_id: 'mf' } },
        { kind: 'patch', entity: 'tasks', id: 'w', set: { deadline_mode: 'own', due_date: '2026-10-08', due_time: '18:00:00' } },
      ],
      undo: [
        { kind: 'patch', entity: 'tasks', id: 'w', set: { assignee_member_id: null } },
        { kind: 'patch', entity: 'tasks', id: 'w', set: { deadline_mode: 'own', due_date: '2026-10-05', due_time: '18:00:00' } },
      ],
    });
    // Osoba usunięta z grupy to nikt konkretny (D132) — też można wziąć; cofnięcie przywraca jej id.
    expect(takeOps(people, raw({ assignee_member_id: 'ola' }), groups, '2026-10-08')!.undo[0]).toEqual({ kind: 'patch', entity: 'tasks', id: 'w', set: { assignee_member_id: 'ola' } });
    // D137: stare „co miesiąc” dostaje dzień miesiąca.
    const t = { ...people, tasks: { w: { id: 'w', repeat: 'FREQ=MONTHLY' } } };
    const r = takeOps(t, raw(), groups, '2026-10-08')!;
    expect(r.ops.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'w', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=5' } });
    expect(r.undo.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'w', set: { repeat: 'FREQ=MONTHLY' } });
  });

  it('nie dotyczy: z osobą, zrobione, nie zaległe, bez własnego terminu, grupa osobista, dziecko, nieznana grupa', () => {
    const no = (o: Record<string, unknown>) => takeOps(people, raw(o), groups, '2026-10-08');
    expect(no({ assignee_member_id: 'ala' })).toBeNull();
    expect(no({ completed_at: 'x' })).toBeNull();
    expect(no({ due_date: '2026-10-08' })).toBeNull();
    expect(no({ deadline_mode: 'inherit' })).toBeNull();
    expect(no({ deadline_mode: 'none', due_date: null })).toBeNull();
    expect(no({ own: 1, due_date: null })).toBeNull();
    expect(no({ group_id: 'gp' })).toBeNull();
    expect(no({ group_id: 'gk' })).toBeNull();
    expect(no({ group_id: 'gx' })).toBeNull();
  });
});
