import type { NewOp, Row } from '../sync-engine/client';
import { moveTargets, moveTaskOps } from '../views/task-move';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind: string, created: string) => put(t, 'groups', id, { id, name, kind, created_at: created, deleted_at: null });
  g(ME, 'Osobiste', 'personal', '2026-01-01T00:00:00Z');
  g('gf', 'Rodzina', 'shared', '2026-02-01T00:00:00Z');
  g('gc', 'Babcia', 'shared', '2026-04-01T00:00:00Z');
  const m = (id: string, gid: string, user: string | null, name: string, role = 'member', deleted: string | null = null) =>
    put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: deleted });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('tymek', 'gf', null, 'Tymek', 'child');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  m('ala-c', 'gc', 'u-ala', 'Ala', 'owner');
  const l = (id: string, gid: string, name: string) => put(t, 'lists', id, { id, group_id: gid, kind: 'tasks', name, visibility: 'group', sort_key: 'a0', deleted_at: null });
  l('lp', ME, 'Moje');
  l('lf', 'gf', 'Dom');
  const task = (id: string, extra: Row = {}) =>
    put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'lf', parent_id: null, title: id, note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'none', due_date: null, due_time: null, start_date: null, event_id: null, occurrence_date: null, rollover: true, repeat: null, completed_at: null, deleted_at: null, ...extra });
  task('t', { title: 'Prezent', note: 'dla babci', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-12', due_time: '18:00:00', rollover: false, repeat: 'FREQ=WEEKLY;BYDAY=MO' });
  task('s1', { parent_id: 't', sort_key: 'a1', assignee_member_id: 'tymek', deadline_mode: 'inherit' });
  task('s2', { parent_id: 't', sort_key: 'a2', assignee_member_id: 'ala', deadline_mode: 'own', due_date: '2026-10-10', completed_at: '2026-10-07T08:00:00Z' });
  task('s21', { parent_id: 's2', deadline_mode: 'inherit' });
  task('sx', { parent_id: 't', deleted_at: '2026-10-01T00:00:00Z' });
  return t;
}

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('„Przenieś do grupy” (D178, audyt 2 M-122)', () => {
  it('grupy docelowe: moje (nie jako dziecko), bez grupy zadania', () => {
    expect(moveTargets(base(), ME, { group_id: 'gf' }).map((g) => g.id)).toEqual([ME]);
  });

  it('kopia całego zadania z żywymi podzadaniami na ogólnej liście nowej grupy, oryginał do kosza; „Cofnij” odwraca wszystko', () => {
    const t = base();
    const r = moveTaskOps(t, ME, 't', ME, ids())!;
    expect(r.taskId).toBe('n1');
    expect(r.ops).toEqual([
      {
        kind: 'create', entity: 'tasks', id: 'n1', group_id: ME,
        // Ja w nowej grupie (to samo konto); powtarzanie, „Tylko tego dnia”, notatka zostają.
        set: { list_id: 'lp', parent_id: null, title: 'Prezent', note: 'dla babci', sort_key: 'a0', assignee_member_id: ME, deadline_mode: 'own', due_date: '2026-10-12', due_time: '18:00:00', rollover: false, repeat: 'FREQ=WEEKLY;BYDAY=MO' },
      },
      // Dziecko bez konta i Ala (nie ma jej w grupie osobistej) — nikt konkretny (D132).
      { kind: 'create', entity: 'tasks', id: 'n2', group_id: ME, set: { list_id: 'lp', parent_id: 'n1', title: 's1', note: null, sort_key: 'a1', assignee_member_id: null, deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true } },
      { kind: 'create', entity: 'tasks', id: 'n3', group_id: ME, set: { list_id: 'lp', parent_id: 'n1', title: 's2', note: null, sort_key: 'a2', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-10', due_time: null, rollover: true, completed_at: '2026-10-07T08:00:00Z' } },
      { kind: 'create', entity: 'tasks', id: 'n4', group_id: ME, set: { list_id: 'lp', parent_id: 'n3', title: 's21', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true } },
      { kind: 'delete', entity: 'tasks', id: 't' },
    ]);
    expect(r.undo).toEqual([
      { kind: 'restore', entity: 'tasks', id: 't' },
      ...['n4', 'n3', 'n2', 'n1'].map((id): NewOp => ({ kind: 'delete', entity: 'tasks', id })),
    ]);
  });

  it('ta sama osoba (konto) w nowej grupie; nowa ogólna lista, gdy jej nie ma; start_date zostaje', () => {
    const t = base();
    put(t, 'group_members', 'mc', { ...t.group_members!.mc!, role: 'member' });
    put(t, 'tasks', 't', { ...t.tasks!.t!, assignee_member_id: 'ala', start_date: '2026-10-11' });
    const r = moveTaskOps(t, ME, 't', 'gc', ids())!;
    expect(r.ops[0]).toEqual({ kind: 'create', entity: 'lists', id: 'n1', group_id: 'gc', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } });
    expect(r.ops[1]).toMatchObject({ id: 'n2', set: { list_id: 'n1', assignee_member_id: 'ala-c', start_date: '2026-10-11' } });
    expect(r.undo.at(-1)).toEqual({ kind: 'delete', entity: 'lists', id: 'n1' });
  });

  it('podpięte do wydarzenia: termin wystąpienia staje się własnym; odwołane — bez terminu (podzadanie — jak nadrzędne)', () => {
    const t = base();
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Urodziny', start_date: '2026-10-15', start_time: '17:00:00', end_time: null, rrule: null, deleted_at: null });
    const set = (id: string, extra: Row) => put(t, 'tasks', id, { ...t.tasks![id]!, ...extra });
    set('t', { deadline_mode: 'event', due_date: null, due_time: null, event_id: 'e', occurrence_date: '2026-10-15' });
    set('s1', { deadline_mode: 'event', event_id: 'gone', occurrence_date: '2026-10-15' });
    set('s2', { deadline_mode: 'event', event_id: null, occurrence_date: null });
    const r = moveTaskOps(t, ME, 't', ME, ids())!;
    expect(r.ops[0]).toMatchObject({ set: { deadline_mode: 'own', due_date: '2026-10-15', due_time: '17:00:00' } });
    expect(r.ops[0]!.kind === 'create' && 'repeat' in r.ops[0]!.set).toBe(false);
    expect(r.ops[1]).toMatchObject({ set: { deadline_mode: 'inherit', due_date: null } });
    expect(r.ops[2]).toMatchObject({ set: { deadline_mode: 'inherit', due_date: null } });
    set('t', { event_id: 'gone' });
    expect(moveTaskOps(t, ME, 't', ME, ids())!.ops[0]).toMatchObject({ set: { deadline_mode: 'none', due_date: null, due_time: null } });
  });

  it('nie: podzadanie, usunięte, nieznane, grupa niedozwolona albo ta sama', () => {
    const t = base();
    expect(moveTaskOps(t, ME, 's1', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 'sx', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 'brak', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 't', 'gc', ids())).toBeNull();
    expect(moveTaskOps(t, ME, 't', 'gf', ids())).toBeNull();
  });
});
