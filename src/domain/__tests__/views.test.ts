import * as fc from 'fast-check';

import { groupLines } from '../../config/theme';
import type { CivilDate } from '../civil-date';
import { parseQuickAdd } from '../quickadd';
import { applyOp, type Row } from '../sync-engine/client';
import * as cmd from '../views/commands';
import { asGroup, asList, asMember, asTask, calendarMonth, groupDetail, groupsView, listDetail, listsView, myMemberships, type Tables, todayView } from '../views';

const ME = 'u-me';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 };

type T = { [e: string]: { [id: string]: Row } };
function put(t: T, e: string, key: string, row: Row) {
  (t[e] ??= {})[key] = row;
}
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gk', { id: 'gk', name: 'Klasa 2b', kind: 'shared', created_at: '2026-03-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gx', { id: 'gx', name: 'Obca', kind: 'shared', created_at: '2026-01-15T00:00:00Z', deleted_at: null });
  const m = (id: string, g: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, created_at: '2026-01-01T00:00:00Z', deleted_at: null, ...extra });
  m('mp', 'gp', ME, 'Ja', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('old', 'gf', 'u-old', 'Dawny', 'member', { deleted_at: '2026-05-01T00:00:00Z' });
  m('mk', 'gk', ME, 'Łukasz', 'member');
  m('kx', 'gx', 'u-x', 'Obcy', 'owner');
  const l = (id: string, g: string, name: string, kind = 'tasks', extra: Row = {}) =>
    put(t, 'lists', id, { id, group_id: g, kind, name, visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: null, ...extra });
  l('lp', 'gp', 'Moje');
  l('lf', 'gf', 'Dom');
  l('lz', 'gf', 'Zakupy', 'shopping', { sort_key: 'a1' });
  l('lk', 'gk', 'Szkoła');
  l('lx', 'gx', 'Cudza');
  l('ldel', 'gf', 'Usunięta', 'tasks', { deleted_at: '2026-09-01T00:00:00Z' });
  return t;
}
let n = 0;
function task(t: T, over: Row) {
  const id = String(over.id ?? `t${++n}`);
  put(t, 'tasks', id, {
    id,
    group_id: 'gf',
    list_id: 'lf',
    parent_id: null,
    title: id,
    note: null,
    sort_key: 'a0',
    assignee_member_id: null,
    deadline_mode: 'none',
    due_date: null,
    due_time: null,
    start_date: null,
    completed_at: null,
    deleted_at: null,
    ...over,
  });
  return id;
}
const own = (date: string, time: string | null = null) => ({ deadline_mode: 'own', due_date: date, due_time: time });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('model: wiersze lokalne bez pól serwera dostają wartości domyślne z migracji', () => {
  it('as*', () => {
    expect(asGroup({ id: 'g' })).toEqual({ id: 'g', name: '', kind: 'shared', created_at: null, deleted_at: null });
    expect(asMember({ member_id: 'm', group_id: 'g', role: 'zly' })).toMatchObject({ role: 'member', display_name: '', user_id: null });
    expect(asList({ id: 'l', group_id: 'g', visibility: 'zla' })).toMatchObject({ kind: 'tasks', visibility: 'group', sort_key: 'a0', name: '', owner_member_id: null });
    expect(asList({ id: 'l', group_id: 'g', kind: 'shopping', visibility: 'private' })).toMatchObject({ kind: 'shopping', visibility: 'private' });
    expect(asList({ id: 'l', group_id: 'g', visibility: 'restricted' }).visibility).toBe('restricted');
    expect(asTask({ id: 't', group_id: 'g', list_id: 'l' })).toMatchObject({ title: '', deadline_mode: 'none', sort_key: 'a0', due_date: null, completed_at: null });
    expect(asTask({ id: 't', group_id: 'g', list_id: 'l', deadline_mode: 'inherit' }).deadline_mode).toBe('inherit');
    expect(asTask({ id: 't', group_id: 'g', list_id: 'l', deadline_mode: 'own', due_date: '2026-10-07' }).due_date).toBe('2026-10-07');
    expect(asMember({ member_id: 'm', group_id: 'g', role: 'child' }).role).toBe('child');
  });
});

describe('grupy', () => {
  it('tylko moje aktywne członkostwa', () => {
    const t = world();
    put(t, 'group_members', 'gone', { member_id: 'gone', group_id: 'gx', user_id: ME, display_name: 'X', role: 'member', deleted_at: '2026-01-01' });
    expect([...myMemberships(t, ME).keys()].sort()).toEqual(['gf', 'gk', 'gp']);
  });

  it('osobista pierwsza, potem kolejność utworzenia; kolory po kolei, bez obcych i usuniętych', () => {
    const t = world();
    put(t, 'groups', 'gd', { id: 'gd', name: 'Usunięta', kind: 'shared', created_at: '2025-01-01', deleted_at: '2026-01-01' });
    put(t, 'group_members', 'md', { member_id: 'md', group_id: 'gd', user_id: ME, display_name: 'Ł', role: 'member', deleted_at: null });
    const g = groupsView(t, ME);
    expect(ids(g)).toEqual(['gp', 'gf', 'gk']);
    expect(g.map((x) => x.line)).toEqual([0, 1, 2]);
    expect(g[1]).toMatchObject({ memberCount: 3, me: { member_id: 'mf', role: 'admin' } });
  });

  it('grupa bez daty utworzenia (świeża, lokalna) idzie na koniec; remis po id', () => {
    const t = world();
    put(t, 'groups', 'gnew', { id: 'gnew', name: 'Nowa', kind: 'shared', created_at: null, deleted_at: null });
    put(t, 'groups', 'gaa', { id: 'gaa', name: 'Nowa2', kind: 'shared', created_at: null, deleted_at: null });
    for (const g of ['gnew', 'gaa']) put(t, 'group_members', `m-${g}`, { member_id: `m-${g}`, group_id: g, user_id: ME, display_name: 'Ł', role: 'owner', deleted_at: null });
    expect(ids(groupsView(t, ME))).toEqual(['gp', 'gf', 'gk', 'gaa', 'gnew']);
  });

  it('osobista zawsze pierwsza, nawet utworzona później', () => {
    const t = world();
    put(t, 'groups', 'gp', { ...t.groups!.gp, created_at: '2027-01-01' });
    expect(ids(groupsView(t, ME))[0]).toBe('gp');
    put(t, 'groups', 'gp', { ...t.groups!.gp, created_at: '2025-01-01' });
    expect(ids(groupsView(t, ME))[0]).toBe('gp');
  });

  it('kolory zawijają się po wyczerpaniu palety', () => {
    const t: T = {};
    for (let i = 0; i < groupLines.length + 2; i++) {
      const id = `g${String(i).padStart(2, '0')}`;
      put(t, 'groups', id, { id, name: id, kind: 'shared', created_at: `2026-01-${String(i + 1).padStart(2, '0')}`, deleted_at: null });
      put(t, 'group_members', `m${id}`, { member_id: `m${id}`, group_id: id, user_id: ME, display_name: 'Ł', role: 'owner', deleted_at: null });
    }
    expect(groupsView(t, ME).map((g) => g.line)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  it('szczegóły: kolejność ról, uprawnienia jak strażnik członkostw', () => {
    const t = world();
    const d = groupDetail(t, ME, 'gf')!;
    expect(d.members.map((m) => m.member_id)).toEqual(['ala', 'mf', 'kuba']);
    expect(d).toMatchObject({ canInvite: true, canManageMembers: true, canLeave: true, canRename: true });
    expect(groupDetail(t, ME, 'gk')).toMatchObject({ canInvite: false, canManageMembers: false, canLeave: true, canRename: false });
    expect(groupDetail(t, ME, 'gp')).toMatchObject({ canInvite: false, canLeave: false, canRename: false });
    expect(groupDetail(t, ME, 'gx')).toBeNull();
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'owner' });
    expect(groupDetail(t, ME, 'gf')).toMatchObject({ canInvite: true, canLeave: false });
  });

  it('członkowie tej samej roli po imieniu (polska kolejność)', () => {
    const t = world();
    put(t, 'group_members', 'z1', { member_id: 'z1', group_id: 'gf', user_id: null, display_name: 'Żaneta', role: 'child', deleted_at: null });
    put(t, 'group_members', 'z2', { member_id: 'z2', group_id: 'gf', user_id: null, display_name: 'Łucja', role: 'child', deleted_at: null });
    expect(groupDetail(t, ME, 'gf')!.members.filter((m) => m.role === 'child').map((m) => m.display_name)).toEqual(['Kuba', 'Łucja', 'Żaneta']);
  });
});

describe('listy', () => {
  it('moje listy w kolejności grup, potem sort_key i nazwy; liczba otwartych', () => {
    const t = world();
    task(t, { list_id: 'lf' });
    task(t, { list_id: 'lf', completed_at: '2026-10-01' });
    task(t, { list_id: 'lf', deleted_at: '2026-10-01' });
    put(t, 'lists', 'lf2', { id: 'lf2', group_id: 'gf', kind: 'tasks', name: 'Auto', visibility: 'group', sort_key: 'a0', deleted_at: null });
    const v = listsView(t, ME);
    expect(ids(v)).toEqual(['lp', 'lf2', 'lf', 'lz', 'lk']);
    expect(v.find((l) => l.id === 'lf')).toMatchObject({ open: 1, line: 1, groupName: 'Rodzina' });
    expect(ids(listsView(t, ME, 'gk'))).toEqual(['lk']);
  });

  it('drzewo zadań: przypięte na górze, terminy, podzadania, zrobione osobno, ukryte do start_date', () => {
    const t = world();
    task(t, { id: 'a', title: 'A', ...own('2026-10-08') });
    task(t, { id: 'b', title: 'B' });
    task(t, { id: 'c', title: 'C', ...own('2026-10-07', '17:00') });
    task(t, { id: 'c1', title: 'C1', parent_id: 'c', deadline_mode: 'inherit' });
    task(t, { id: 'c11', title: 'C11', parent_id: 'c1', deadline_mode: 'inherit', assignee_member_id: 'ala' });
    task(t, { id: 'c12', title: 'C12', parent_id: 'c1', completed_at: '2026-10-06' });
    task(t, { id: 'd', title: 'D', completed_at: '2026-10-06' });
    task(t, { id: 'e', title: 'E', start_date: '2026-10-09' });
    task(t, { id: 'f', title: 'F', assignee_member_id: 'nieznany' });
    const d = listDetail(t, ME, 'lf', TODAY)!;
    expect(ids(d.open)).toEqual(['b', 'f', 'c', 'a']);
    expect(d.open[0]!.due).toBeNull();
    const c = d.open[2]!;
    expect(c.due).toEqual({ date: '2026-10-07', time: '17:00' });
    expect(ids(c.children)).toEqual(['c1']);
    expect(c.children[0]!.due).toEqual(c.due);
    expect(c.children[0]!.depth).toBe(1);
    // Na drugim poziomie zrobione podzadania zostają przy rodzicu; c12 ma tryb „none”, więc jest przypięte nad c11.
    expect(ids(c.children[0]!.children)).toEqual(['c12', 'c11']);
    expect(c.children[0]!.children[1]).toMatchObject({ depth: 2, assignee: 'Ala', children: [] });
    expect(d.open[1]!.assignee).toBeNull();
    expect(ids(d.done)).toEqual(['d']);
    expect(d.members.map((m) => m.member_id).sort()).toEqual(['ala', 'kuba', 'mf', 'old'].filter((x) => x !== 'old').sort());
    expect(listDetail(t, ME, 'lx', TODAY)).toBeNull();
    expect(listDetail(t, ME, 'ldel', TODAY)).toBeNull();
  });

  it('remis terminu i sort_key rozstrzyga tytuł', () => {
    const t = world();
    task(t, { id: 'x2', title: 'Żurek' });
    task(t, { id: 'x1', title: 'Łopata' });
    task(t, { id: 'x3', title: 'Agrest', sort_key: 'a1' });
    expect(ids(listDetail(t, ME, 'lf', TODAY)!.open)).toEqual(['x1', 'x2', 'x3']);
  });

  it('głębokość ograniczona do MAX_TASK_DEPTH nawet przy uszkodzonych danych', () => {
    const t = world();
    task(t, { id: 'p0' });
    task(t, { id: 'p1', parent_id: 'p0' });
    task(t, { id: 'p2', parent_id: 'p1' });
    task(t, { id: 'p3', parent_id: 'p2' });
    expect(listDetail(t, ME, 'lf', TODAY)!.open[0]!.children[0]!.children[0]!.children).toEqual([]);
  });
});

describe('Dotyczy mnie', () => {
  it('reguła i sekcje', () => {
    const t = world();
    task(t, { id: 'mine-today', assignee_member_id: 'mf', ...own('2026-10-07', '18:00') });
    task(t, { id: 'mine-pinned', assignee_member_id: 'mf' });
    task(t, { id: 'open-today', ...own('2026-10-07') });
    task(t, { id: 'open-pinned' }); // wspólne bez terminu i bez osoby — nie zalewa widoku
    task(t, { id: 'ala-today', assignee_member_id: 'ala', ...own('2026-10-07') });
    task(t, { id: 'personal', group_id: 'gp', list_id: 'lp' });
    task(t, { id: 'overdue', group_id: 'gk', list_id: 'lk', ...own('2026-10-01') });
    task(t, { id: 'tomorrow', group_id: 'gk', list_id: 'lk', ...own('2026-10-08') });
    task(t, { id: 'later', ...own('2026-10-09') });
    task(t, { id: 'done', assignee_member_id: 'mf', ...own('2026-10-07'), completed_at: '2026-10-07' });
    task(t, { id: 'deleted', assignee_member_id: 'mf', deleted_at: '2026-10-07' });
    task(t, { id: 'hidden', assignee_member_id: 'mf', start_date: '2026-10-08' });
    task(t, { id: 'foreign', group_id: 'gx', list_id: 'lx', ...own('2026-10-07') });
    task(t, { id: 'deleted-list', list_id: 'ldel', assignee_member_id: 'mf' });
    task(t, { id: 'child-inherits', parent_id: 'mine-today', deadline_mode: 'inherit' });
    const v = todayView(t, ME, TODAY);
    expect(ids(v.overdue)).toEqual(['overdue']);
    expect(ids(v.pinned)).toEqual(['mine-pinned', 'personal']);
    expect(ids(v.today)).toEqual(['open-today', 'child-inherits', 'mine-today']);
    expect(ids(v.tomorrow)).toEqual(['tomorrow']);
    expect(v.today.find((x) => x.id === 'mine-today')).toMatchObject({ assignee: 'Łukasz', groupName: 'Rodzina', listName: 'Dom', line: 1 });
    expect(v.today[0]!.assignee).toBeNull();
  });

  it('remis terminu i tytułu rozstrzyga id (stała kolejność)', () => {
    const t = world();
    task(t, { id: 'z2', title: 'Same', ...own('2026-10-07') });
    task(t, { id: 'z1', title: 'Same', ...own('2026-10-07') });
    expect(ids(todayView(t, ME, TODAY).today)).toEqual(['z1', 'z2']);
  });

  it('własności: każde zadanie w co najwyżej jednej sekcji; wszystkie otwarte, widoczne i z moich grup', () => {
    const date = fc.integer({ min: 1, max: 14 }).map((d) => `2026-10-${String(d).padStart(2, '0')}`);
    const arbTask = fc.record({
      group: fc.constantFrom(['gp', 'lp'], ['gf', 'lf'], ['gk', 'lk'], ['gx', 'lx'], ['gf', 'ldel']),
      assignee: fc.constantFrom(null, 'mf', 'ala', 'mk', 'mp'),
      due: fc.option(date),
      start: fc.option(date),
      done: fc.boolean(),
      deleted: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbTask, { maxLength: 30 }), (specs) => {
        const t = world();
        specs.forEach((s, i) =>
          task(t, {
            id: `p${i}`,
            group_id: s.group[0],
            list_id: s.group[1],
            assignee_member_id: s.assignee,
            ...(s.due ? own(s.due) : {}),
            start_date: s.start,
            completed_at: s.done ? '2026-10-01' : null,
            deleted_at: s.deleted ? '2026-10-01' : null,
          }),
        );
        const v = todayView(t, ME, TODAY);
        const all = [...v.overdue, ...v.pinned, ...v.today, ...v.tomorrow];
        expect(new Set(ids(all)).size).toBe(all.length);
        for (const x of all) {
          expect(x.completed_at).toBeNull();
          expect(x.deleted_at).toBeNull();
          expect(x.group_id).not.toBe('gx');
          expect(x.list_id).not.toBe('ldel');
          expect(x.start_date === null || x.start_date <= '2026-10-07').toBe(true);
        }
        for (const x of v.overdue) expect(x.due!.date < '2026-10-07').toBe(true);
        for (const x of v.today) expect(x.due!.date).toBe('2026-10-07');
        for (const x of v.tomorrow) expect(x.due!.date).toBe('2026-10-08');
        for (const x of v.pinned) expect(x.due).toBeNull();
      }),
    );
  });
});

describe('kalendarz', () => {
  it('październik 2026: od poniedziałku 28.09, 5 tygodni, święto i zadania z terminem', () => {
    const t = world();
    task(t, { id: 'k1', ...own('2026-10-14', '09:00') });
    task(t, { id: 'k0', ...own('2026-10-14') });
    task(t, { id: 'k2', ...own('2026-10-14'), completed_at: '2026-10-01' });
    task(t, { id: 'kx', group_id: 'gx', list_id: 'lx', ...own('2026-10-14') });
    task(t, { id: 'kd', list_id: 'ldel', ...own('2026-10-14') });
    task(t, { id: 'kn' });
    task(t, { id: 'kb', title: 'B', ...own('2026-10-20') });
    task(t, { id: 'ka', title: 'A', ...own('2026-10-20') });
    const days = calendarMonth(t, ME, 2026, 10);
    expect(days[0]).toMatchObject({ date: '2026-09-28', inMonth: false });
    expect(days).toHaveLength(35);
    expect(days.at(-1)!.date).toBe('2026-11-01');
    expect(days.find((d) => d.date === '2026-11-01')!.holiday).toBe('Wszystkich Świętych');
    expect(ids(days.find((d) => d.date === '2026-10-14')!.items)).toEqual(['k0', 'k1']);
    expect(ids(days.find((d) => d.date === '2026-10-20')!.items)).toEqual(['ka', 'kb']);
    expect(days.filter((d) => d.items.length > 0)).toHaveLength(2);
  });

  it('liczba tygodni zgodna z modułem calendar Pythona (Calendar(0).monthdatescalendar)', () => {
    expect(calendarMonth({}, ME, 2026, 6)[0]!.date).toBe('2026-06-01'); // 1.06.2026 to poniedziałek
    expect(calendarMonth({}, ME, 2026, 8)).toHaveLength(42); // sierpień 2026: od soboty, 31 dni
    expect(calendarMonth({}, ME, 2021, 2)).toHaveLength(28); // luty 2021: od poniedziałku, 28 dni (python calendar)
  });

  it('pierwszy rok tabeli świąt nie wymaga roku poprzedniego', () => {
    const days = calendarMonth({}, ME, 2011, 1);
    expect(days.find((d) => d.date === '2011-01-06')!.holiday).toBe('Święto Trzech Króli');
  });
});

describe('operacje ekranów', () => {
  const apply = (ops: ReturnType<typeof cmd.createTask>[]) => {
    const t: T = {};
    ops.forEach((op, i) => applyOp(t, { ...op, seq: i + 1, op_id: `o${i}` } as never));
    return t as Tables;
  };
  const now = { y: 2026, m: 10, d: 7, hh: 10, mm: 0 };

  it('nowe zadanie z szybkiego dodawania: termin własny, przypięte albo dziedziczone', () => {
    const withDue = cmd.createTask({ id: 't1', groupId: 'gf', listId: 'lf', parsed: parseQuickAdd('mleko jutro o 17', now) });
    expect(withDue).toMatchObject({ kind: 'create', entity: 'tasks', set: { title: 'mleko', deadline_mode: 'own', due_date: '2026-10-08', due_time: '17:00', parent_id: null, sort_key: 'a0' } });
    expect(cmd.createTask({ id: 't2', groupId: 'gf', listId: 'lf', parsed: parseQuickAdd('chleb', now) })).toMatchObject({ set: { deadline_mode: 'none', due_date: null, due_time: null } });
    expect(cmd.createTask({ id: 't3', groupId: 'gf', listId: 'lf', parentId: 't1', sortKey: 'b', parsed: parseQuickAdd('masło', now) })).toMatchObject({ set: { deadline_mode: 'inherit', parent_id: 't1', sort_key: 'b' } });
    const t = apply([withDue]);
    expect(asTask(t.tasks!.t1!)).toMatchObject({ title: 'mleko', due_date: '2026-10-08' });
  });

  it('odhaczenie i cofnięcie', () => {
    expect(cmd.toggleDone({ id: 't', completed_at: null }, 'X')).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { completed_at: 'X' } });
    expect(cmd.toggleDone({ id: 't', completed_at: 'X' }, 'Y')).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { completed_at: null } });
  });

  it('pozostałe operacje mają kształt zgodny z private.sync_entities', () => {
    expect(cmd.patchTask('t', { title: 'x' })).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { title: 'x' } });
    expect(cmd.setDue('t', null)).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { deadline_mode: 'none', due_date: null, due_time: null } });
    expect(cmd.setDue('t', { date: '2026-10-09', time: null })).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { deadline_mode: 'own', due_date: '2026-10-09', due_time: null } });
    expect(cmd.remove('lists', 'l')).toEqual({ kind: 'delete', entity: 'lists', id: 'l' });
    expect(cmd.restore('tasks', 't')).toEqual({ kind: 'restore', entity: 'tasks', id: 't' });
    expect(cmd.createList({ id: 'l', groupId: 'g', kind: 'shopping', name: 'Z' })).toEqual({ kind: 'create', entity: 'lists', id: 'l', group_id: 'g', set: { kind: 'shopping', name: 'Z', visibility: 'group' } });
    expect(cmd.createList({ id: 'l', groupId: 'g', kind: 'tasks', name: 'P', visibility: 'private' }).kind).toBe('create');
    expect(cmd.renameList('l', 'N')).toEqual({ kind: 'patch', entity: 'lists', id: 'l', set: { name: 'N' } });
    expect(cmd.renameGroup('g', 'N')).toEqual({ kind: 'patch', entity: 'groups', id: 'g', set: { name: 'N' } });
    expect(cmd.addChild({ memberId: 'm', groupId: 'g', name: 'Kuba' })).toEqual({ kind: 'create', entity: 'group_members', id: 'm', group_id: 'g', set: { member_id: 'm', display_name: 'Kuba', role: 'child' } });
    expect(cmd.renameMember('m', 'K')).toEqual({ kind: 'patch', entity: 'group_members', id: 'm', set: { display_name: 'K' } });
    expect(cmd.moveTask('t', 'p')).toEqual({ kind: 'cmd', cmd: 'move_task', args: { id: 't', parent_id: 'p' } });
    expect(cmd.moveTask('t', null, 'l2')).toEqual({ kind: 'cmd', cmd: 'move_task', args: { id: 't', parent_id: null, list_id: 'l2' } });
  });
});
