import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { moveCmdSteps, movedAlive, moveSteps, unmoveSteps } from '../task-move-cmd';
import { movedTo, moveTargets, moveTaskOps } from '../views/task-move';
import { trashView } from '../views/trash';

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
    // Audyt 3 (N-12): jedno polecenie serwera — wszystko albo nic; `changed` to jego zwykłe operacje (odcisk „Cofnij”).
    expect(r.changed).toEqual([
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
    expect(r.ops).toEqual([
      {
        kind: 'cmd',
        cmd: 'move_task_to_group',
        args: {
          task_id: 't',
          group_id: ME,
          list: null,
          tasks: r.changed.slice(0, 4).map((o) => (o.kind === 'create' ? { id: o.id, from: { n1: 't', n2: 's1', n3: 's2', n4: 's21' }[o.id], set: o.set } : null)),
        },
      },
    ]);
    expect(r.undo).toEqual([{ kind: 'cmd', cmd: 'unmove_task', args: { task_id: 't', copy_id: 'n1', title: 'Prezent' } }]);
  });

  it('ta sama osoba (konto) w nowej grupie; nowa ogólna lista, gdy jej nie ma; start_date zostaje', () => {
    const t = base();
    put(t, 'group_members', 'mc', { ...t.group_members!.mc!, role: 'member' });
    put(t, 'tasks', 't', { ...t.tasks!.t!, assignee_member_id: 'ala', start_date: '2026-10-11' });
    const r = moveTaskOps(t, ME, 't', 'gc', ids())!;
    expect(r.changed[0]).toEqual({ kind: 'create', entity: 'lists', id: 'n1', group_id: 'gc', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } });
    expect(r.changed[1]).toMatchObject({ id: 'n2', set: { list_id: 'n1', assignee_member_id: 'ala-c', start_date: '2026-10-11' } });
    expect(r.ops[0]).toMatchObject({ args: { list: { id: 'n1', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } } } });
    // Lista ogólna założona dla przeniesienia zostaje po „Cofnij” (pusta lista ogólna to zwykły stan grupy).
    expect(r.undo).toEqual([{ kind: 'cmd', cmd: 'unmove_task', args: { task_id: 't', copy_id: 'n2', title: 'Prezent' } }]);
  });

  it('audyt 3 (N-25): pierwotny dzień przeniesionego terminu idzie z zadaniem; bez niego — bez pola', () => {
    const t = base();
    put(t, 'tasks', 't', { ...t.tasks!.t!, due_date: '2026-10-09', cycle_date: '2026-10-12' });
    expect(moveTaskOps(t, ME, 't', ME, ids())!.changed.find((o) => o.kind === 'create' && o.set.title === 'Prezent')).toMatchObject({ set: { due_date: '2026-10-09', cycle_date: '2026-10-12' } });
    const plain = moveTaskOps(base(), ME, 't', ME, ids())!.changed.find((o) => o.kind === 'create' && o.set.title === 'Prezent') as { set: Row };
    expect('cycle_date' in plain.set).toBe(false);
  });

  it('podpięte do wydarzenia: termin wystąpienia staje się własnym; odwołane — bez terminu (podzadanie — jak nadrzędne)', () => {
    const t = base();
    put(t, 'events', 'e', { id: 'e', group_id: 'gf', title: 'Urodziny', start_date: '2026-10-15', start_time: '17:00:00', end_time: null, rrule: null, deleted_at: null });
    const set = (id: string, extra: Row) => put(t, 'tasks', id, { ...t.tasks![id]!, ...extra });
    set('t', { deadline_mode: 'event', due_date: null, due_time: null, event_id: 'e', occurrence_date: '2026-10-15' });
    set('s1', { deadline_mode: 'event', event_id: 'gone', occurrence_date: '2026-10-15' });
    set('s2', { deadline_mode: 'event', event_id: null, occurrence_date: null });
    const r = moveTaskOps(t, ME, 't', ME, ids())!;
    expect(r.changed[0]).toMatchObject({ set: { deadline_mode: 'own', due_date: '2026-10-15', due_time: '17:00:00' } });
    expect(r.changed[0]!.kind === 'create' && 'repeat' in r.changed[0]!.set).toBe(false);
    expect(r.changed[1]).toMatchObject({ set: { deadline_mode: 'inherit', due_date: null } });
    expect(r.changed[2]).toMatchObject({ set: { deadline_mode: 'inherit', due_date: null } });
    set('t', { event_id: 'gone' });
    expect(moveTaskOps(t, ME, 't', ME, ids())!.changed[0]).toMatchObject({ set: { deadline_mode: 'none', due_date: null, due_time: null } });
  });

  it('nie: podzadanie, usunięte, nieznane, zrobione (N-121), grupa niedozwolona albo ta sama', () => {
    const t = base();
    // Audyt 3 (N-121): zrobione zadanie powtarzane ma już następny termin w swojej grupie — kopia dostałaby drugi.
    expect(moveTaskOps({ ...t, tasks: { ...t.tasks, t: { ...t.tasks!.t!, completed_at: '2026-10-07T08:00:00Z' } } }, ME, 't', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 's1', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 'sx', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 'brak', ME, ids())).toBeNull();
    expect(moveTaskOps(t, ME, 't', 'gc', ids())).toBeNull();
    expect(moveTaskOps(t, ME, 't', 'gf', ids())).toBeNull();
  });
});

/** Telefon: skutek polecenia (applyOp), jak na serwerze (pgTAP: move_task_to_group.test.sql). */
const run = (t: T, op: NewOp, seq: number) => applyOp(t, { ...op, seq, op_id: `o${seq}` } as Op);

describe('polecenie przeniesienia na telefonie (audyt 3: N-12, N-131, N-36)', () => {
  it('kopie w nowej grupie, oryginał z podzadaniami w koszu ze znacznikiem; nie w koszu i nie wraca, dopóki żyje kopia', () => {
    const t = base();
    const r = moveTaskOps(t, ME, 't', ME, ids())!;
    run(t, r.ops[0]!, 7);
    expect(t.tasks!.t).toMatchObject({ deleted_at: 'pending:7', moved_to: 'n1' });
    expect(t.tasks!.s1!.deleted_at).toBe('pending:7');
    expect(t.tasks!.n4).toMatchObject({ group_id: ME, parent_id: 'n3', deleted_at: null });
    expect(trashView(t, ME, Date.parse('2026-10-07T10:00:00Z')).map((e) => e.id)).toEqual([]);
    expect(movedTo(t, ME, 't')).toEqual({ taskId: 'n1', group: expect.objectContaining({ id: ME }) });
    expect(movedAlive(t, t.tasks!.t!)).toBe(true);
    run(t, { kind: 'restore', entity: 'tasks', id: 't' }, 8);
    expect(t.tasks!.t!.deleted_at).toBe('pending:7');
    // „Cofnij”: kopia do kosza ze znacznikiem powrotu, oryginał wraca z podzadaniami, bez znacznika.
    run(t, r.undo[0]!, 9);
    expect(t.tasks!.t).toMatchObject({ deleted_at: null, moved_to: null });
    expect(t.tasks!.s1!.deleted_at).toBeNull();
    expect(t.tasks!.n1).toMatchObject({ deleted_at: 'pending:9', moved_to: 't' });
    expect(t.tasks!.n4!.deleted_at).toBe('pending:9');
    expect(trashView(t, ME, Date.parse('2026-10-07T10:00:00Z')).map((e) => e.id)).toEqual(['sx']);
    expect(movedTo(t, ME, 'n1')).toEqual({ taskId: 't', group: expect.objectContaining({ id: 'gf' }) });
    // Powtórzone cofnięcie i przeniesienie wróconego (inne id kopii) — bez zmian.
    run(t, r.undo[0]!, 10);
    run(t, r.ops[0]!, 11);
    expect(t.tasks!.n1!.deleted_at).toBe('pending:9');
    expect(t.tasks!.t!.deleted_at).toBe('pending:11');
  });

  it('kopia usunięta zwykłym usunięciem — oryginał wraca z kosza i traci znacznik; niewidoczna kopia — dokąd nie wiem', () => {
    const t = base();
    run(t, moveTaskOps(t, ME, 't', ME, ids())!.ops[0]!, 1);
    expect(movedTo(t, 'u-ala', 't')).toEqual({ taskId: null, group: null });
    run(t, { kind: 'delete', entity: 'tasks', id: 'n1' }, 2);
    run(t, { kind: 'restore', entity: 'tasks', id: 't' }, 3);
    expect(t.tasks!.t).toMatchObject({ deleted_at: null, moved_to: null });
    expect(movedTo(t, ME, 't')).toBeNull();
  });

  it('kroki: nic dla nieznanego, usuniętego, podzadania, tej samej grupy, bez kopii; cofnięcie innej kopii albo bez kopii', () => {
    const t = base();
    const a = { task_id: 't', group_id: ME, list: null, tasks: [{ id: 'c', from: 't', set: {} }] };
    expect(moveSteps(t, { ...a, task_id: 'brak' })).toEqual([]);
    expect(moveSteps(t, { ...a, task_id: 'sx' })).toEqual([]);
    expect(moveSteps(t, { ...a, task_id: 's1' })).toEqual([]);
    expect(moveSteps(t, { ...a, group_id: 'gf' })).toEqual([]);
    expect(moveSteps(t, { ...a, tasks: [] })).toEqual([]);
    expect(moveCmdSteps(t, { cmd: 'staple_add', args: {} })).toBeNull();
    put(t, 'tasks', 't', { ...t.tasks!.t!, deleted_at: 'x', moved_to: 'c' });
    expect(unmoveSteps(t, { task_id: 't', copy_id: 'inna', title: '' })).toEqual([]);
    expect(unmoveSteps(t, { task_id: 'brak', copy_id: 'c', title: '' })).toEqual([]);
    // Kopii nie widzę: tylko przywrócenie (serwer odrzuci „moved”, jeśli kopia żyje).
    expect(unmoveSteps(t, { task_id: 't', copy_id: 'c', title: '' })).toEqual([{ op: { kind: 'restore', entity: 'tasks', id: 't' } }]);
  });
});
