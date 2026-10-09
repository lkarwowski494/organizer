import * as fc from 'fast-check';

import { groupLines } from '../../config/theme';
import type { CivilDate } from '../civil-date';
import { parseQuickAdd } from '../quickadd';
import { applyOp, type Row } from '../sync-engine/client';
import * as cmd from '../views/commands';
import { asGroup, asList, asMember, asTask, calendarMonth, childRoleAllowed, groupDetail, groupsView, listDetail, listOpenCount, listsView, memberActions, myMemberships, removedMembers, type TaskNode, type Tables, todayView, trashedGroups } from '../views';
import { tripEntries } from '../views/shopping-trip';
import { nextId } from '../views/task-repeat';
import { config } from '../../config';

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
  m('tymek', 'gf', null, 'Tymek', 'child');
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
    expect(asGroup({ id: 'g' })).toEqual({ id: 'g', name: '', kind: 'shared', color: null, created_at: null, deleted_at: null });
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
    expect(d.members.map((m) => m.member_id)).toEqual(['ala', 'mf', 'tymek']);
    expect(d).toMatchObject({ canInvite: true, canInviteAdmin: false, canManageMembers: true, canLeave: true, canRename: true });
    expect(groupDetail(t, ME, 'gk')).toMatchObject({ canInvite: false, canManageMembers: false, canLeave: true, canRename: false });
    expect(groupDetail(t, ME, 'gp')).toMatchObject({ canInvite: false, canLeave: false, canRename: false });
    expect(groupDetail(t, ME, 'gx')).toBeNull();
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'owner' });
    expect(groupDetail(t, ME, 'gf')).toMatchObject({ canInvite: true, canInviteAdmin: true, canLeave: false });
    // PW-14 B: dziecko z kontem nie wychodzi samo (strażnik: forbidden:child).
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'child' });
    expect(groupDetail(t, ME, 'gf')).toMatchObject({ canInvite: false, canManageMembers: false, canLeave: false });
  });

  it('członkowie tej samej roli po imieniu (polska kolejność)', () => {
    const t = world();
    put(t, 'group_members', 'z1', { member_id: 'z1', group_id: 'gf', user_id: null, display_name: 'Żaneta', role: 'child', deleted_at: null });
    put(t, 'group_members', 'z2', { member_id: 'z2', group_id: 'gf', user_id: null, display_name: 'Łucja', role: 'child', deleted_at: null });
    expect(groupDetail(t, ME, 'gf')!.members.filter((m) => m.role === 'child').map((m) => m.display_name)).toEqual(['Łucja', 'Tymek', 'Żaneta']);
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
    expect(v.find((l) => l.id === 'lf')).toMatchObject({ line: 1, groupName: 'Rodzina' });
    expect(listOpenCount(t, v.find((l) => l.id === 'lf')!, TODAY)).toBe(1);
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
    expect(d.members.map((m) => m.member_id).sort()).toEqual(['ala', 'tymek', 'mf', 'old'].filter((x) => x !== 'old').sort());
    expect(listDetail(t, ME, 'lx', TODAY)).toBeNull();
    expect(listDetail(t, ME, 'ldel', TODAY)).toBeNull();
  });

  it('audyt 2 (M-82, T-7): niezrobione podzadanie zrobionego rodzica stoi w otwartych z dopiskiem rodzica; minione — w zamkniętych bez odhaczenia', () => {
    const t = world();
    task(t, { id: 'sprz', title: 'Sprzątanie', ...own('2026-10-05'), completed_at: '2026-10-05T10:00:00Z' });
    task(t, { id: 'odk', title: 'Odkurzyć', parent_id: 'sprz' });
    task(t, { id: 'kurz', title: 'Zetrzeć kurze', parent_id: 'sprz', deadline_mode: 'inherit' });
    task(t, { id: 'zmyc', title: 'Zmyć', parent_id: 'sprz', deadline_mode: 'inherit', completed_at: '2026-10-05T10:00:00Z' });
    task(t, { id: 'kartka', title: 'Kartka', ...own('2026-10-05'), rollover: false });
    const d = listDetail(t, ME, 'lf', TODAY)!;
    // Podzadanie bez terminu zrobionego rodzica jest do zrobienia (w Moich sprawach przypięte), więc stoi w otwartych.
    expect(d.open.map((x) => [x.id, x.parentTitle, x.depth, x.closed, x.due])).toEqual([['odk', 'Sprzątanie', 1, false, null]]);
    expect(d.done.map((x) => [x.id, x.closed, x.expired, x.completed_at !== null, x.parentTitle])).toEqual([
      ['kartka', true, true, false, null],
      ['sprz', true, false, true, null],
    ]);
    // Ekran zadania dostaje wszystkie podzadania rodzica (także to, które stoi w otwartych). Podzadanie z dziedziczonym,
    // minionym terminem zrobionego rodzica minęło (audyt 2, T-13) — zostaje pod rodzicem w zamkniętych.
    expect(d.done[1]!.children.map((x) => [x.id, x.closed, x.expired])).toEqual([['odk', false, false], ['kurz', true, true], ['zmyc', true, false]]);
    expect(listOpenCount(t, asList(t.lists!.lf!), TODAY)).toBe(1);
  });

  it('audyt 2 (M-82): otwarte w głębi zamkniętych przechodzi do otwartych; zamknięte pod otwartym rodzicem zostaje pod nim', () => {
    const t = world();
    task(t, { id: 'p', title: 'P', completed_at: 'x' });
    task(t, { id: 'c', title: 'C', parent_id: 'p', completed_at: 'x' });
    task(t, { id: 'g', title: 'G', parent_id: 'c' });
    task(t, { id: 'q', title: 'Q' });
    task(t, { id: 'q1', title: 'Q1', parent_id: 'q', completed_at: 'x' });
    // Uszkodzone dane: czwarty poziom (ponad D4) nie trafia nigdzie, także do otwartych.
    task(t, { id: 'd0', title: 'D0', completed_at: 'x' });
    task(t, { id: 'd1', title: 'D1', parent_id: 'd0', completed_at: 'x' });
    task(t, { id: 'd2', title: 'D2', parent_id: 'd1', completed_at: 'x' });
    task(t, { id: 'd3', title: 'D3', parent_id: 'd2' });
    const d = listDetail(t, ME, 'lf', TODAY)!;
    expect(d.open.map((x) => [x.id, x.parentTitle, x.depth])).toEqual([['g', 'C', 2], ['q', null, 0]]);
    expect(d.open[0]!.children).toEqual([]);
    expect(ids(d.open[1]!.children)).toEqual(['q1']);
    expect(ids(d.done)).toEqual(['d0', 'p']);
    expect(listOpenCount(t, asList(t.lists!.lf!), TODAY)).toBe(2);
  });

  it('audyt 2 (M-83, T-8): licznik listy = otwarte na ekranie listy — bez podzadań, ukrytych do daty i minionych', () => {
    const t = world();
    task(t, { id: 'a', ...own('2026-10-08') });
    task(t, { id: 'a1', parent_id: 'a', deadline_mode: 'inherit' });
    task(t, { id: 'minelo', ...own('2026-10-06'), rollover: false });
    task(t, { id: 'pozniej', start_date: '2026-10-20' });
    const list = listsView(t, ME).find((l) => l.id === 'lf')!;
    expect(listOpenCount(t, list, TODAY)).toBe(1);
    expect(listDetail(t, ME, 'lf', TODAY)!.open.length).toBe(1);
    // Ukryte do daty liczy się od tego dnia.
    expect(listOpenCount(t, list, { y: 2026, m: 10, d: 20 })).toBe(2);
  });

  it('audyt 2 (M-83): lista zakupów — pozycje bez terminów i ukrywania (D73); „N do kupienia” jak w Moich sprawach', () => {
    const t = world();
    put(t, 'lists', 'lz', { ...t.lists!.lz!, due_date: '2026-10-08', responsible_member_id: 'mf' });
    task(t, { id: 's1', list_id: 'lz', title: 'Mleko' });
    task(t, { id: 's2', list_id: 'lz', title: 'Pizza', ...own('2026-10-01'), rollover: false });
    task(t, { id: 's3', list_id: 'lz', title: 'Chleb', start_date: '2026-12-01' });
    task(t, { id: 's4', list_id: 'lz', title: 'Masło', completed_at: 'x' });
    const d = listDetail(t, ME, 'lz', TODAY)!;
    expect(d.open.map((x) => [x.id, x.expired, x.closed])).toEqual([['s3', false, false], ['s1', false, false], ['s2', false, false]]);
    expect(ids(d.done)).toEqual(['s4']);
    expect(listOpenCount(t, asList(t.lists!.lz!), TODAY)).toBe(3);
    const groups = new Map(groupsView(t, ME).map((g) => [g.id, g]));
    expect(tripEntries(t, groups).find((x) => x.id === 'lz')!.trip.open).toBe(3);
  });

  it('audyt 2 (M-82, M-83): każde zadanie raz na ekranie listy, licznik = otwarte, „N do kupienia” = licznik (własność)', () => {
    const spec = fc.record({ parent: fc.nat(), done: fc.boolean(), due: fc.constantFrom(null, '2026-10-01', '2026-10-07', '2026-10-09'), rollover: fc.boolean(), inherit: fc.boolean() });
    fc.assert(
      fc.property(fc.array(spec, { maxLength: 20 }), fc.array(spec, { maxLength: 12 }), (tasks, items) => {
        const t = world();
        put(t, 'lists', 'lz', { ...t.lists!.lz!, due_date: '2026-10-08' });
        const expected = new Map<string, Set<string>>([['lf', new Set()], ['lz', new Set()]]);
        for (const [listId, specs] of [['lf', tasks], ['lz', items]] as const) {
          const depth = new Map<string, number>();
          specs.forEach((s, i) => {
            const id = `${listId}-${i}`;
            const p = s.parent % (i + 1);
            const parent = p === i ? null : `${listId}-${p}`;
            depth.set(id, parent === null ? 0 : depth.get(parent)! + 1);
            if (depth.get(id)! <= config.MAX_TASK_DEPTH) expected.get(listId)!.add(id);
            const deadline = s.inherit && parent ? { deadline_mode: 'inherit' } : s.due ? own(s.due) : {};
            task(t, { id, list_id: listId, parent_id: parent, completed_at: s.done ? '2026-10-01T10:00:00Z' : null, rollover: s.rollover, ...deadline });
          });
        }
        for (const listId of ['lf', 'lz']) {
          const d = listDetail(t, ME, listId, TODAY)!;
          // Jak ekran listy: w otwartych całe poddrzewa, w zamkniętych tylko zamknięte.
          const shown: string[] = [];
          const walk = (n: TaskNode, done: boolean) => {
            if (done && !n.closed) return;
            shown.push(n.id);
            n.children.forEach((c) => walk(c, done));
          };
          d.open.forEach((n) => walk(n, false));
          d.done.forEach((n) => walk(n, true));
          expect(shown.length).toBe(new Set(shown).size);
          expect(new Set(shown)).toEqual(expected.get(listId));
          expect(d.open.every((n) => !n.closed) && d.done.every((n) => n.closed)).toBe(true);
          expect(listOpenCount(t, asList(t.lists![listId]!), TODAY)).toBe(d.open.length);
        }
        const groups = new Map(groupsView(t, ME).map((g) => [g.id, g]));
        expect(tripEntries(t, groups).find((x) => x.id === 'lz')!.trip.open).toBe(listOpenCount(t, asList(t.lists!.lz!), TODAY));
      }),
    );
  });

  it('PWD-14 A (M-283): minione kopie zadania powtarzanego „Tylko tego dnia” zwinięte w jeden wiersz; pojedyncze — bez zmian', () => {
    const t = world();
    // Leki codziennie od 1.10, nikt nie odhacza: kopie D133 do dziś (7.10, otwarta).
    let id = 'leki';
    const ids: string[] = [];
    for (let d = 1; d <= 7; d++) {
      task(t, { id, title: 'Leki', ...own(`2026-10-0${d}`), rollover: false, repeat: 'FREQ=DAILY' });
      ids.push(id);
      id = nextId(id);
    }
    // Usunięta kopia (3.10) nie dzieli łańcucha; odhaczona (2.10) zostaje osobno w zrobionych.
    put(t, 'tasks', ids[2]!, { ...t.tasks![ids[2]!]!, deleted_at: '2026-10-03T12:00:00Z' });
    put(t, 'tasks', ids[1]!, { ...t.tasks![ids[1]!]!, completed_at: '2026-10-02T08:00:00Z' });
    // Inny łańcuch z jedną minioną kopią i zwykłe minione zadanie — pojedyncze wiersze.
    task(t, { id: 'kwiaty', title: 'Podlać kwiaty', ...own('2026-10-05'), rollover: false, repeat: 'FREQ=WEEKLY;BYDAY=MO' });
    task(t, { id: nextId('kwiaty'), title: 'Podlać kwiaty', ...own('2026-10-12'), rollover: false, repeat: 'FREQ=WEEKLY;BYDAY=MO' });
    task(t, { id: 'kartka', title: 'Kartka', ...own('2026-10-04'), rollover: false });
    const d = listDetail(t, ME, 'lf', TODAY)!;
    expect(d.open.map((x) => x.id)).toEqual([ids[6], nextId('kwiaty')]);
    const rows = d.doneRows.map((r) => (r.kind === 'run' ? `run:${r.key}:${r.title}:${r.nodes.map((n) => n.due!.date.slice(8)).join(',')}` : `task:${r.node.id}`));
    expect(rows).toEqual([`run:leki:Leki:01,04,05,06`, `task:${ids[1]}`, 'task:kartka', 'task:kwiaty']);
    // Wszystkie zamknięte dalej w `done` (ekran zadania szuka w nich zadania).
    expect(d.done).toHaveLength(7);
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

describe('Moje sprawy', () => {
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
        }
        // start_date względem dnia, w którym zadanie stoi (visibleOnItsDay): zaległe, przypięte i dzisiejsze — dziś, jutrzejsze — jutro.
        for (const x of [...v.overdue, ...v.pinned, ...v.today]) expect(x.start_date === null || x.start_date <= '2026-10-07').toBe(true);
        for (const x of v.tomorrow) expect(x.start_date === null || x.start_date <= '2026-10-08').toBe(true);
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
    expect(ids(days.find((d) => d.date === '2026-10-14')!.items)).toEqual(['k0', 'k2', 'k1']); // D135: zrobione też (przekreślone)
    expect(ids(days.find((d) => d.date === '2026-10-20')!.items)).toEqual(['ka', 'kb']);
    expect(days.filter((d) => d.items.length > 0)).toHaveLength(2);
  });

  it('M-129, PWD-1 C: zrobione w innym dniu — „zrobione” z dniem; minione „tylko tego dnia” — expired; zaległe — liczba dni', () => {
    const t = world();
    task(t, { id: 'inny', ...own('2026-10-05'), completed_at: '2026-10-07T09:00:00Z' });
    task(t, { id: 'tego', ...own('2026-10-05'), completed_at: '2026-10-05T09:00:00Z' });
    task(t, { id: 'minelo', ...own('2026-10-05'), rollover: false });
    task(t, { id: 'zalegle', ...own('2026-10-05') });
    task(t, { id: 'dzis', ...own('2026-10-07') });
    const day = (d: string) => calendarMonth(t, ME, 2026, 10, { today: { y: 2026, m: 10, d: 7 } }).find((x) => x.date === d)!.items.map((x) => [x.id, x.doneOn, x.expired, x.overdueDays, x.projected]);
    expect(day('2026-10-05')).toEqual([
      ['inny', '2026-10-07', false, 0, false],
      ['minelo', null, true, 0, false],
      ['tego', null, false, 0, false],
      ['zalegle', null, false, 2, false],
    ]);
    expect(day('2026-10-07')).toEqual([['dzis', null, false, 0, false]]);
  });

  it('PWD-15 A (M-284): kolejne terminy zadania powtarzanego — policzone w oknie siatki, bez od wykonania, podzadań i zrobionych', () => {
    const t = world();
    task(t, { id: 'tydz', ...own('2026-10-14', '18:00'), repeat: 'FREQ=WEEKLY;BYDAY=WE' });
    task(t, { id: 'mies', ...own('2026-10-31'), repeat: 'FREQ=MONTHLY;BYMONTHDAY=-1' });
    task(t, { id: 'po', ...own('2026-10-14'), repeat: 'AFTER=WEEKLY;INTERVAL=1' });
    task(t, { id: 'zrob', ...own('2026-10-07'), repeat: 'FREQ=DAILY', completed_at: '2026-10-07T08:00:00Z' });
    task(t, { id: 'pod', parent_id: 'tydz', ...own('2026-10-14'), repeat: 'FREQ=DAILY' });
    task(t, { id: 'spotk', deadline_mode: 'event', repeat: 'FREQ=DAILY' });
    // Termin ze spotkania (D13) nie powtarza się sam — kolejne terminy daje seria wydarzenia.
    put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', start_date: '2026-10-07', start_time: '17:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null });
    task(t, { id: 'nasp', deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-07', repeat: 'FREQ=DAILY' });
    const days = calendarMonth(t, ME, 2026, 10, { today: { y: 2026, m: 10, d: 7 } });
    const projected = days.flatMap((d) => d.items.filter((x) => x.projected).map((x) => `${d.date} ${x.id} ${x.due!.time ?? ''}`));
    expect(projected).toEqual(['2026-10-21 tydz 18:00', '2026-10-28 tydz 18:00']);
    // Siatka listopada sięga 6.12 — ostatni dzień listopada.
    expect(calendarMonth(t, ME, 2026, 11).flatMap((d) => d.items.filter((x) => x.projected && x.id === 'mies').map(() => d.date))).toEqual(['2026-11-30']);
    // Siatka kończąca się przed terminem — kolejnych terminów w niej nie ma (sam termin też nie).
    expect(calendarMonth(t, ME, 2026, 9).flatMap((d) => d.items.filter((x) => x.projected))).toEqual([]);
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
    // Audyt 2 (P-3, T-9, R-2): „co tydzień” z szybkiego dodawania zapisuje powtarzanie (dzień tygodnia z terminu);
    // bez „co tydzień” — bez pola. Podzadanie nie powtarza się samo (powtarzanie dotyczy zadania z listy, D76).
    expect(cmd.createTask({ id: 't4', groupId: 'gf', listId: 'lf', parsed: parseQuickAdd('basen co tydzień w piątek', now) })).toMatchObject({ set: { repeat: 'FREQ=WEEKLY;BYDAY=FR', deadline_mode: 'own' } });
    expect((cmd.createTask({ id: 't5', groupId: 'gf', listId: 'lf', parsed: parseQuickAdd('basen w piątek', now) }) as { set: object }).set).not.toHaveProperty('repeat');
    expect((cmd.createTask({ id: 't6', groupId: 'gf', listId: 'lf', parentId: 't1', parsed: parseQuickAdd('ręcznik co tydzień', now) }) as { set: object }).set).not.toHaveProperty('repeat');
    const t = apply([withDue]);
    expect(asTask(t.tasks!.t1!)).toMatchObject({ title: 'mleko', due_date: '2026-10-08' });
  });

  it('odhaczenie i cofnięcie', () => {
    expect(cmd.toggleDone({ id: 't', completed_at: null }, 'X')).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { completed_at: 'X' } });
    expect(cmd.toggleDone({ id: 't', completed_at: 'X' }, 'Y')).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { completed_at: null } });
  });

  it('pozostałe operacje mają kształt zgodny z private.sync_entities', () => {
    expect(cmd.patchTask('t', { title: 'x' })).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { title: 'x' } });
    expect(cmd.setDue('t', null)).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { deadline_mode: 'none', due_date: null, due_time: null, repeat: null } });
    expect(cmd.setDue('t', { date: '2026-10-09', time: null })).toEqual({ kind: 'patch', entity: 'tasks', id: 't', set: { deadline_mode: 'own', due_date: '2026-10-09', due_time: null } });
    expect(cmd.remove('lists', 'l')).toEqual({ kind: 'delete', entity: 'lists', id: 'l' });
    expect(cmd.restore('tasks', 't')).toEqual({ kind: 'restore', entity: 'tasks', id: 't' });
    expect(cmd.createList({ id: 'l', groupId: 'g', kind: 'shopping', name: 'Z' })).toEqual({ kind: 'create', entity: 'lists', id: 'l', group_id: 'g', set: { kind: 'shopping', name: 'Z', visibility: 'group' } });
    expect(cmd.createList({ id: 'l', groupId: 'g', kind: 'tasks', name: 'P', visibility: 'private' }).kind).toBe('create');
    expect(cmd.renameList('l', 'N')).toEqual({ kind: 'patch', entity: 'lists', id: 'l', set: { name: 'N' } });
    expect(cmd.renameGroup('g', 'N')).toEqual({ kind: 'patch', entity: 'groups', id: 'g', set: { name: 'N' } });
    expect(cmd.addChild({ memberId: 'm', groupId: 'g', name: 'Tymek' })).toEqual({ kind: 'create', entity: 'group_members', id: 'm', group_id: 'g', set: { member_id: 'm', display_name: 'Tymek', role: 'child' } });
    expect(cmd.renameMember('m', 'K')).toEqual({ kind: 'patch', entity: 'group_members', id: 'm', set: { display_name: 'K' } });
  });
});

describe('edycja grup (D54–D56)', () => {
  it('kolor wybrany przez właściciela ma pierwszeństwo przed kolejnością; nieznany klucz = automatyczny', () => {
    const t = world();
    put(t, 'groups', 'gk', { ...t.groups!.gk, color: 'red' });
    put(t, 'groups', 'gf', { ...t.groups!.gf, color: 'zielony?' });
    const g = groupsView(t, ME);
    expect(g.find((x) => x.id === 'gk')!.line).toBe(groupLines.findIndex((l) => l.key === 'red'));
    expect(g.find((x) => x.id === 'gf')!.line).toBe(1);
  });

  it('kolor wybrany przez właściciela nie powtarza się w przydziale automatycznym (audyt 2, R-23)', () => {
    const t = world();
    const orange = groupLines.findIndex((l) => l.key === 'orange');
    // Dotąd „Rodzina” (automatycznie druga, pomarańczowa) i „Klasa 2b” (pomarańczowy wybrany) wyglądały tak samo.
    put(t, 'groups', 'gk', { ...t.groups!.gk, color: 'orange' });
    expect(groupsView(t, ME).map((g) => [g.id, g.line])).toEqual([['gp', 0], ['gf', 2], ['gk', orange]]);
    // Bez wyboru — kolejność jak dotąd.
    put(t, 'groups', 'gk', { ...t.groups!.gk, color: null });
    expect(groupsView(t, ME).map((g) => g.line)).toEqual([0, 1, 2]);
  });

  it('wolnych kolorów brakuje: automatyczne powtarzają wolne, a gdy wybrane są wszystkie — całą paletę po kolei', () => {
    const t: T = {};
    const group = (id: string, color: string | null) => {
      put(t, 'groups', id, { id, name: id, kind: 'shared', color, created_at: `2026-01-01T00:00:${id.slice(1)}Z`, deleted_at: null });
      put(t, 'group_members', `m${id}`, { member_id: `m${id}`, group_id: id, user_id: ME, display_name: 'Ł', role: 'owner', deleted_at: null });
    };
    // Siedem kolorów wybranych, jeden wolny (czerwony) dla dwóch grup automatycznych.
    groupLines.slice(0, 7).forEach((l, i) => group(`g${10 + i}`, l.key));
    group('g20', null);
    group('g21', null);
    const red = groupLines.length - 1;
    expect(groupsView(t, ME).slice(-2).map((g) => g.line)).toEqual([red, red]);
    // Wszystkie osiem wybrane: automatyczne idą po całej palecie od początku.
    group('g17', groupLines[red]!.key);
    expect(groupsView(t, ME).filter((g) => g.color === null).map((g) => g.line)).toEqual([0, 1]);
  });

  it('kosz: moje grupy z liczbą dni i terminem przywrócenia; przywraca właściciel; przeterminowane znikają', () => {
    const t = world();
    const now = Date.parse('2026-10-07T10:00:00Z');
    put(t, 'groups', 'gt', { id: 'gt', name: 'Wycieczka', kind: 'shared', created_at: null, deleted_at: '2026-10-05T10:00:00Z' });
    put(t, 'group_members', 'mt', { member_id: 'mt', group_id: 'gt', user_id: ME, display_name: 'Ł', role: 'owner', deleted_at: null });
    put(t, 'groups', 'go', { id: 'go', name: 'Cudza', kind: 'shared', created_at: null, deleted_at: '2026-10-05T10:00:00Z' });
    put(t, 'group_members', 'mo', { member_id: 'mo', group_id: 'go', user_id: ME, display_name: 'Ł', role: 'admin', deleted_at: null });
    put(t, 'groups', 'gx2', { id: 'gx2', name: 'Stara', kind: 'shared', created_at: null, deleted_at: '2026-09-01T10:00:00Z' });
    put(t, 'group_members', 'mx2', { member_id: 'mx2', group_id: 'gx2', user_id: ME, display_name: 'Ł', role: 'owner', deleted_at: null });
    // PWD-21 A (decyzja właściciela z 8.10.2026): członek też widzi grupę w koszu, ale jej nie przywraca.
    expect(trashedGroups(t, ME, now).map((g) => [g.id, g.daysLeft, g.canRestore])).toEqual([['go', 28, false], ['gt', 28, true]]);
    expect(trashedGroups(t, ME, now)[1]!.restoreUntilMs).toBe(Date.parse('2026-11-04T10:00:00Z'));
    expect(groupsView(t, ME).map((g) => g.id)).not.toContain('gt');
    // Grupa w koszu, z której wyszedłem — nie moja.
    put(t, 'group_members', 'mo', { ...t.group_members!.mo, deleted_at: '2026-10-06T10:00:00Z' });
    expect(trashedGroups(t, ME, now).map((g) => g.id)).toEqual(['gt']);
  });

  it('uprawnienia do członków jak strażnik członkostw', () => {
    const t = world();
    const asAdmin = groupDetail(t, ME, 'gf')!; // ja = admin
    const m = (id: string) => asAdmin.members.find((x) => x.member_id === id)!;
    // PW-54 A (decyzja właściciela z 8.10.2026): admin zmienia imię tylko profilom bez konta i sobie.
    expect(memberActions(asAdmin, m('ala'))).toEqual({ rename: false, setRole: false, remove: false, makeOwner: false, link: false });
    expect(memberActions(asAdmin, m('tymek'))).toEqual({ rename: true, setRole: false, remove: true, makeOwner: false, link: true });
    expect(memberActions(asAdmin, m('mf'))).toEqual({ rename: true, setRole: false, remove: false, makeOwner: false, link: false });
    expect(asAdmin).toMatchObject({ canSetColor: false, canDelete: false });
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'owner' });
    put(t, 'group_members', 'ala', { ...t.group_members!.ala, role: 'member' });
    put(t, 'group_members', 'kid', { member_id: 'kid', group_id: 'gf', user_id: 'u-kid', display_name: 'Zuzia', role: 'child', deleted_at: null });
    const asOwner = groupDetail(t, ME, 'gf')!;
    const o = (id: string) => asOwner.members.find((x) => x.member_id === id)!;
    expect(memberActions(asOwner, o('ala'))).toEqual({ rename: true, setRole: true, remove: true, makeOwner: true, link: false });
    expect(memberActions(asOwner, o('tymek'))).toEqual({ rename: true, setRole: false, remove: true, makeOwner: false, link: true });
    // PW-14 B: rolę dziecka z kontem zmienia owner (dorośleje); połączyć można tylko profil bez konta.
    expect(memberActions(asOwner, o('kid'))).toEqual({ rename: true, setRole: true, remove: true, makeOwner: false, link: false });
    expect(memberActions(asOwner, o('mf'))).toEqual({ rename: true, setRole: false, remove: false, makeOwner: false, link: false });
    expect(asOwner).toMatchObject({ canSetColor: true, canDelete: true });
    const personal = groupDetail(t, ME, 'gp')!;
    expect(personal).toMatchObject({ canSetColor: true, canDelete: false });
    expect(memberActions(personal, personal.members[0]!)).toEqual({ rename: true, setRole: false, remove: false, makeOwner: false, link: false });
    // Admin usuwa też zwykłego członka, ale nie zmienia imienia osobie z kontem (także dziecku z kontem).
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'admin' });
    const again = groupDetail(t, ME, 'gf')!;
    expect(memberActions(again, again.members.find((x) => x.member_id === 'ala')!)).toMatchObject({ remove: true, rename: false });
    expect(memberActions(again, again.members.find((x) => x.member_id === 'kid')!).rename).toBe(false);
    // Profil dziecka łączy z kontem owner albo admin (PW-14 B) — nie członek ani dziecko.
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'member' });
    const asMember_ = groupDetail(t, ME, 'gf')!;
    expect(memberActions(asMember_, asMember_.members.find((x) => x.member_id === 'tymek')!)).toMatchObject({ link: false, remove: false });
  });

  it('usunięte osoby do przywrócenia (D165): przez 30 dni, prawa jak przy usuwaniu; kto sam wyszedł — nie', () => {
    const t = world();
    const now = Date.parse('2026-10-07T10:00:00Z');
    const gone = (id: string, user: string | null, role: string, deleted: string, removed: string | null) =>
      put(t, 'group_members', id, { member_id: id, group_id: 'gf', user_id: user, display_name: id, role, deleted_at: deleted, removed_at: removed });
    gone('usunieta', 'u-1', 'member', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z');
    gone('wyszla', 'u-2', 'member', '2026-10-05T10:00:00Z', null);
    gone('dziecko', null, 'child', '2026-10-06T10:00:00Z', null);
    gone('dawno', 'u-3', 'member', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
    gone('admin', 'u-4', 'admin', '2026-10-06T10:00:00Z', '2026-10-06T10:00:00Z');
    gone('obca', null, 'child', '2026-10-06T10:00:00Z', null);
    put(t, 'group_members', 'obca', { ...t.group_members!.obca, group_id: 'gk' });
    // Ja = admin w „Rodzinie”: członek i dziecko tak, admin nie (strażnik), a dawne „old” bez daty usunięcia przez kogoś.
    expect(removedMembers(t, ME, 'gf', now).map((m) => [m.member_id, m.daysLeft])).toEqual([['dziecko', 29], ['usunieta', 28]]);
    put(t, 'group_members', 'mf', { ...t.group_members!.mf, role: 'owner' });
    expect(removedMembers(t, ME, 'gf', now).map((m) => m.member_id)).toEqual(['admin', 'dziecko', 'usunieta']);
    // Członek (nie owner ani admin) i obca grupa — nic.
    expect(removedMembers(t, ME, 'gk', now)).toEqual([]);
    expect(removedMembers(t, ME, 'gx', now)).toEqual([]);
  });

  it('operacje koloru i roli', () => {
    expect(cmd.setRole('m', 'child')).toEqual({ kind: 'patch', entity: 'group_members', id: 'm', set: { role: 'child' } });
    expect(cmd.setGroupColor('g', 'teal')).toEqual({ kind: 'patch', entity: 'groups', id: 'g', set: { color: 'teal' } });
    expect(cmd.setGroupColor('g', null)).toEqual({ kind: 'patch', entity: 'groups', id: 'g', set: { color: null } });
    expect(cmd.setRole('m', 'admin')).toEqual({ kind: 'patch', entity: 'group_members', id: 'm', set: { role: 'admin' } });
  });
});

describe('rola „Dziecko” tylko dla konta połączonego z profilem dziecka (audyt 3, N-42, Q6b A)', () => {
  it('profil i dziecko — tak; konto ze znacznikiem połączenia — tak; dorosły, który dołączył sam — nie', () => {
    const t: Tables = { group_members: { a: { member_id: 'a', role: 'member', child_linked_at: '2026-10-01T00:00:00Z' }, b: { member_id: 'b', role: 'admin', child_linked_at: null } } };
    expect(childRoleAllowed(t, { member_id: 'c', role: 'child' })).toBe(true);
    expect(childRoleAllowed(t, { member_id: 'a', role: 'member' })).toBe(true);
    expect(childRoleAllowed(t, { member_id: 'b', role: 'admin' })).toBe(false);
    expect(childRoleAllowed({}, { member_id: 'b', role: 'member' })).toBe(false);
  });
});
