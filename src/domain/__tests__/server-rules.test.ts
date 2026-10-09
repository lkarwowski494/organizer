/**
 * Model reguł serwera (server-rules.ts, audyt 2 M-50) na przykładach — każda reguła i kolejność sprawdzeń. Zgodność
 * z prawdziwym SQL na losowych operacjach: tests/db/rules-vs-sql.test.ts.
 */
import { applyOnServer, type ServerTables, serverVerdict } from '../server-rules';
import { overrideId } from '../views/events';
import { scopeRowId } from '../views/my-scope';
import type { NewOp, Row } from '../sync-engine/client';

const U = { owner: 'u-o', admin: 'u-a', member: 'u-m', child: 'u-c', stranger: 'u-x' };
const M = { owner: 'm-o', admin: 'm-a', member: 'm-m', child: 'm-c', profile: 'm-p', stranger: 'm-x' };

function world(): { [e: string]: { [k: string]: Row } } {
  const t: { [e: string]: { [k: string]: Row } } = {};
  const put = (e: string, k: string, r: Row) => void ((t[e] ??= {})[k] = r);
  put('groups', 'g', { id: 'g', name: 'G', deleted_at: null });
  put('groups', 'g2', { id: 'g2', name: 'Obca', deleted_at: null });
  put('groups', 'g3', { id: 'g3', name: 'Kosz', deleted_at: '2026-10-01T00:00:00Z' });
  const m = (id: string, g: string, user: string | null, role: string, extra: Row = {}) => put('group_members', id, { member_id: id, group_id: g, user_id: user, role, display_name: id, color: null, week_a: null, deleted_at: null, ...extra });
  m(M.owner, 'g', U.owner, 'owner');
  m(M.admin, 'g', U.admin, 'admin');
  m(M.member, 'g', U.member, 'member');
  m(M.child, 'g', U.child, 'child');
  m(M.profile, 'g', null, 'child');
  m('m-gone', 'g', 'u-gone', 'member', { deleted_at: '2026-10-01T00:00:00Z' });
  m(M.stranger, 'g2', U.stranger, 'owner');
  m('m-trash', 'g3', U.owner, 'owner');
  const l = (id: string, g: string, extra: Row = {}) => put('lists', id, { id, group_id: g, kind: 'tasks', name: id, visibility: 'group', owner_member_id: M.owner, responsible_member_id: null, deleted_at: null, ...extra });
  l('l', 'g');
  l('l-r', 'g', { visibility: 'restricted' });
  l('l-p', 'g', { visibility: 'private', owner_member_id: M.admin });
  l('l-del', 'g', { deleted_at: '2026-10-01T00:00:00Z' });
  l('l-shop', 'g', { kind: 'shopping', responsible_member_id: M.child });
  l('l-shop2', 'g', { kind: 'shopping', responsible_member_id: M.member });
  l('l2', 'g2', { owner_member_id: M.stranger });
  l('l3', 'g3', { owner_member_id: 'm-trash' });
  put('object_members', 'l-r:m-m', { scope_entity: 'lists', scope_id: 'l-r', member_id: M.member, group_id: 'g', deleted_at: null });
  put('object_members', 'l-r:m-a', { scope_entity: 'lists', scope_id: 'l-r', member_id: M.admin, group_id: 'g', deleted_at: '2026-10-01T00:00:00Z' });
  const task = (id: string, list: string, g: string, extra: Row = {}) => put('tasks', id, { id, group_id: g, list_id: list, parent_id: null, title: id, assignee_member_id: null, completed_at: null, event_id: null, occurrence_date: null, series_id: null, deleted_at: null, ...extra });
  task('t', 'l', 'g');
  task('t-child', 'l', 'g', { assignee_member_id: M.child });
  task('t-sub', 'l', 'g', { parent_id: 't-child' });
  task('t-gone', 'l', 'g', { assignee_member_id: 'm-gone' });
  task('t-owner', 'l', 'g', { assignee_member_id: M.owner });
  task('t-member', 'l', 'g', { assignee_member_id: M.member });
  task('t-r', 'l-r', 'g', { assignee_member_id: M.owner });
  task('t-del', 'l', 'g', { deleted_at: '2026-10-01T00:00:00Z' });
  task('t-delsub', 'l', 'g', { parent_id: 't-del', deleted_at: '2026-10-01T00:00:00Z' });
  task('t-inlistdel', 'l-del', 'g', { deleted_at: '2026-10-01T00:00:00Z' });
  task('t-shop', 'l-shop', 'g');
  task('t-shop2', 'l-shop2', 'g');
  task('t-ev', 'l', 'g', { event_id: 'ev', occurrence_date: '2026-10-07' });
  task('t-ev-m', 'l', 'g', { event_id: 'ev-m', occurrence_date: '2026-10-07' });
  task('t-ev-resp', 'l', 'g', { event_id: 'ev-resp', occurrence_date: '2026-10-07' });
  task('t-ev-gone', 'l', 'g', { event_id: 'ev-gone-resp', occurrence_date: '2026-10-07' });
  task('t-ev-over', 'l', 'g', { event_id: 'ev-resp', occurrence_date: '2026-10-14' });
  task('t-ev-del', 'l', 'g', { event_id: 'ev-del', occurrence_date: '2026-10-07' });
  task('t-deep', 'l', 'g', { parent_id: 'x1' });
  for (let i = 1; i <= 9; i++) task(`x${i}`, 'l', 'g', { parent_id: i < 9 ? `x${i + 1}` : null });
  task('t2', 'l2', 'g2');
  task('t3', 'l3', 'g3');
  const ev = (id: string, extra: Row = {}) => put('events', id, { id, group_id: 'g', title: id, audience: 'group', responsible_member_id: null, deleted_at: null, ...extra });
  ev('ev');
  ev('ev-m', { audience: 'members' });
  ev('ev-resp', { responsible_member_id: M.owner, audience: 'members' });
  ev('ev-gone-resp', { responsible_member_id: 'm-gone', audience: 'members' });
  ev('ev-del', { deleted_at: '2026-10-01T00:00:00Z' });
  put('events', 'ev2', { id: 'ev2', group_id: 'g2', title: 'x', audience: 'group', deleted_at: null });
  put('event_participants', 'p', { id: 'p', event_id: 'ev-m', group_id: 'g', member_id: M.child, deleted_at: null });
  put('event_participants', 'p-gone', { id: 'p-gone', event_id: 'ev-gone-resp', group_id: 'g', member_id: M.child, deleted_at: '2026-10-01T00:00:00Z' });
  put('event_overrides', 'o', { id: 'o', event_id: 'ev-resp', group_id: 'g', occurrence_date: '2026-10-14', responsible_member_id: null, responsible_cleared: true, deleted_at: null });
  put('event_overrides', 'o2', { id: 'o2', event_id: 'ev-resp', group_id: 'g', occurrence_date: '2026-10-21', responsible_member_id: M.member, responsible_cleared: false, deleted_at: null });
  put('event_rsvps', 'r', { id: 'r', event_id: 'ev', group_id: 'g', occurrence_date: '2026-10-07', member_id: M.member, answer: 'yes', deleted_at: null });
  put('event_task_series', 's', { id: 's', event_id: 'ev', group_id: 'g', list_id: 'l', title: 's', deleted_at: null });
  put('event_task_series', 's-del', { id: 's-del', event_id: 'ev', group_id: 'g', list_id: 'l-del', title: 's', deleted_at: '2026-10-01T00:00:00Z' });
  put('event_task_series', 's-evdel', { id: 's-evdel', event_id: 'ev-del', group_id: 'g', list_id: 'l', title: 's', deleted_at: '2026-10-01T00:00:00Z' });
  put('handoffs', 'h', { id: 'h', group_id: 'g', entity: 'tasks', entity_id: 't-owner', occurrence_date: null, from_member: M.owner, to_member: M.member, status: 'pending', closed: false });
  put('handoffs', 'h-done', { id: 'h-done', group_id: 'g', entity: 'tasks', entity_id: 't', occurrence_date: null, from_member: M.owner, to_member: M.member, status: 'accepted', closed: false });
  return t;
}

const v = (user: string, op: NewOp, t: ServerTables = world()) => serverVerdict(t, user, op) ?? 'ok';
const create = (entity: NewOp['kind'] extends never ? never : string, set: Row, group = 'g', id = 'new'): NewOp => ({ kind: 'create', entity: entity as never, id, group_id: group, set });
const patch = (entity: string, id: string, set: Row): NewOp => ({ kind: 'patch', entity: entity as never, id, set });
const del = (entity: string, id: string, kind: 'delete' | 'restore' = 'delete'): NewOp => ({ kind, entity: entity as never, id });

describe('model reguł serwera', () => {
  it('polecenia poza modelem; nieznana encja; kolumny spoza sync_entities (pierwszy klucz jak w jsonb)', () => {
    expect(v(U.child, { kind: 'cmd', cmd: 'move_task', args: {} })).toBe('ok');
    expect(v(U.owner, create('profiles', {}))).toBe('unknown_entity');
    expect(v(U.owner, create('groups', { name: 'X' }))).toBe('invalid_field:id');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: 'x', zzz: 1, aa: 2 }))).toBe('invalid_field:aa');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: 'x', bb: 1, ab: 2 }))).toBe('invalid_field:ab');
    expect(v(U.owner, patch('tasks', 't', { list_id: 'l2' }))).toBe('invalid_field:list_id');
    expect(v(U.owner, patch('tasks', 'brak', {}))).toBe('ok');
  });

  it('zakres Moich spraw (my_day_scopes_guard): tylko za siebie, id z member_id; cudzy wiersz niewidoczny', () => {
    const w = world();
    expect(v(U.member, create('my_day_scopes', { member_id: M.member, scope: 'mine' }, 'g', scopeRowId(M.member)), w)).toBe('ok');
    expect(v(U.child, create('my_day_scopes', { member_id: M.child, scope: 'mine' }, 'g', scopeRowId(M.child)), w)).toBe('ok');
    expect(v(U.member, create('my_day_scopes', { member_id: M.member, scope: 'mine' }, 'g', 'inne-id'), w)).toBe('invalid_id');
    expect(v(U.member, create('my_day_scopes', { member_id: M.owner, scope: 'mine' }, 'g', scopeRowId(M.owner)), w)).toBe('forbidden:not_self');
    expect(v(U.stranger, create('my_day_scopes', { member_id: M.stranger, scope: 'mine' }, 'g', scopeRowId(M.stranger)), w)).toBe('forbidden:not_self');
    (w.my_day_scopes ??= {})[scopeRowId(M.owner)] = { id: scopeRowId(M.owner), group_id: 'g', member_id: M.owner, scope: 'mine', deleted_at: null };
    // Ten sam klucz cudzego wiersza: strażnik przed konfliktem klucza; własny — powtórzone utworzenie.
    expect(v(U.member, create('my_day_scopes', { member_id: M.owner, scope: 'all' }, 'g', scopeRowId(M.owner)), w)).toBe('forbidden:not_self');
    expect(v(U.owner, create('my_day_scopes', { member_id: M.owner, scope: 'all' }, 'g', scopeRowId(M.owner)), w)).toBe('ok');
    expect(v(U.owner, patch('my_day_scopes', scopeRowId(M.owner), { scope: 'all' }), w)).toBe('ok');
    expect(v(U.member, patch('my_day_scopes', scopeRowId(M.owner), { scope: 'all' }), w)).toBe('not_found');
    expect(v(U.owner, patch('my_day_scopes', scopeRowId(M.owner), { member_id: M.member }), w)).toBe('invalid_field:member_id');
  });

  it('zrobione zakupy (shopping_trips_guard): dorosły z listą zakupów, dziecko nie; zmienić można tylko usunięciem', () => {
    const w = world();
    const trip = (list: string, group = 'g') => create('shopping_trips', { list_id: list, done_at: '2026-10-07T10:00:00Z' }, group, 'trip');
    expect(v(U.member, trip('l-shop'), w)).toBe('ok');
    expect(v(U.child, trip('l-shop'), w)).toBe('forbidden:child');
    expect(v(U.stranger, trip('l-shop'), w)).toBe('forbidden');
    expect(v(U.member, trip('l'), w)).toBe('invalid_list');
    expect(v(U.member, trip('brak'), w)).toBe('invalid_list');
    expect(v(U.member, trip('l2'), w)).toBe('invalid_list');
    expect(v(U.member, trip('l-del'), w)).toBe('invalid_list');
    (w.lists as { [k: string]: Row })['l-shop-p'] = { ...w.lists!['l-shop']!, id: 'l-shop-p', visibility: 'private', owner_member_id: M.admin };
    expect(v(U.member, trip('l-shop-p'), w)).toBe('forbidden'); // RLS: lista, której nie widzę
    (w.shopping_trips ??= {}).t1 = { id: 't1', group_id: 'g', list_id: 'l-shop', done_at: '2026-10-07T10:00:00Z', deleted_at: null };
    expect(v(U.member, del('shopping_trips', 't1'), w)).toBe('ok');
    expect(v(U.child, del('shopping_trips', 't1'), w)).toBe('forbidden:child');
    expect(v(U.stranger, del('shopping_trips', 't1'), w)).toBe('not_found');
    expect(v(U.member, patch('shopping_trips', 't1', { done_at: null }), w)).toBe('invalid_field:done_at');
  });

  it('tabela bez wierszy w danych', () => {
    const w = world();
    delete w.event_rsvps;
    delete w.object_members;
    expect(v(U.member, create('event_rsvps', { event_id: 'ev', occurrence_date: '2026-10-14', member_id: M.member, answer: 'yes' }), w)).toBe('ok');
    expect(v(U.admin, create('tasks', { list_id: 'l-r', title: 'x' }), w)).toBe('forbidden');
  });

  it('długości tekstów (audyt 3, N-134): CHECK char_length — znaki, nie jednostki UTF-16; null przechodzi', () => {
    const x = (n: number) => 'x'.repeat(n);
    expect(v(U.owner, create('tasks', { list_id: 'l', title: x(500) }))).toBe('ok');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: '😀'.repeat(500) }))).toBe('ok');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: x(501) }))).toBe('invalid:23514');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: '' }))).toBe('invalid:23514');
    expect(v(U.owner, create('tasks', { list_id: 'l', title: 'x', note: null }))).toBe('ok');
    expect(v(U.owner, patch('tasks', 't', { note: x(10_001) }))).toBe('invalid:23514');
    expect(v(U.owner, patch('tasks', 't', { note: '' }))).toBe('ok');
    expect(v(U.owner, patch('events', 'ev', { title: x(201) }))).toBe('invalid:23514');
    expect(v(U.owner, patch('events', 'ev', { location: x(301) }))).toBe('invalid:23514');
    expect(v(U.owner, patch('events', 'ev', { location: null }))).toBe('ok');
    expect(v(U.owner, patch('event_task_series', 's', { title: x(501) }))).toBe('invalid:23514');
    expect(v(U.owner, patch('lists', 'l', { name: x(201) }))).toBe('invalid:23514');
  });

  it('powtórzone utworzenie: widoczne — przyjęte, niewidoczne — konflikt klucza', () => {
    expect(v(U.owner, create('tasks', { list_id: 'l', title: 'x' }, 'g', 't'))).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x' }, 'g', 't2'))).toBe('invalid:23505');
  });

  it('zadania: członkostwo, dziecko, lista (inna grupa, usunięta, niewidoczna), rodzic, osoba bez dostępu, kosz grupy', () => {
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x' }))).toBe('ok');
    expect(v(U.stranger, create('tasks', { list_id: 'l', title: 'x' }))).toBe('forbidden');
    expect(v(U.child, create('tasks', { list_id: 'l', title: 'x' }))).toBe('forbidden:child');
    // Audyt 3 (Q6d A): dziecko dopisuje produkt do listy zakupów — tylko pozycję główną bez osoby, terminu i reszty.
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'szampon', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null }))).toBe('ok');
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'szampon' }))).toBe('ok');
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'x', assignee_member_id: M.child }))).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'x', deadline_mode: 'own', due_date: '2026-10-08' }))).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'x', parent_id: 't-shop2' }))).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'l-shop2', title: 'x', note: 'duży' }))).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'nie-ma', title: 'x' }))).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'l2', title: 'x' }))).toBe('forbidden:child');
    expect(v(U.member, create('tasks', { list_id: 'l2', title: 'x' }))).toBe('invalid_list');
    expect(v(U.member, create('tasks', { list_id: 'nie-ma', title: 'x' }))).toBe('invalid_list');
    expect(v(U.member, create('tasks', { list_id: 'l-del', title: 'x' }))).toBe('deleted:list');
    expect(v(U.member, create('tasks', { list_id: 'l-p', title: 'x' }))).toBe('forbidden');
    expect(v(U.admin, create('tasks', { list_id: 'l-r', title: 'x' }))).toBe('forbidden');
    expect(v(U.member, create('tasks', { list_id: 'l-r', title: 'x' }))).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', parent_id: 't-r' }))).toBe('invalid_parent');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', parent_id: 'nie-ma' }))).toBe('invalid_parent');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', parent_id: 't-del' }))).toBe('deleted:parent');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', parent_id: 't' }))).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l-r', title: 'x', assignee_member_id: M.admin }))).toBe('invalid_assignee');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', assignee_member_id: 'm-gone' }))).toBe('invalid_assignee');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', assignee_member_id: M.stranger }))).toBe('invalid_assignee');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', assignee_member_id: 'nikt' }))).toBe('invalid_assignee');
    expect(v(U.owner, create('tasks', { list_id: 'l3', title: 'x' }, 'g3'))).toBe('deleted:group');
  });

  it('zadania: wydarzenie i seria przy utworzeniu i zmianie', () => {
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', event_id: 'ev', occurrence_date: '2026-10-07' }))).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', event_id: 'ev2', occurrence_date: '2026-10-07' }))).toBe('invalid_event');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', event_id: 'nie-ma', occurrence_date: '2026-10-07' }))).toBe('invalid_event');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', event_id: 'ev-del', occurrence_date: '2026-10-07' }))).toBe('deleted:event');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', series_id: 's' }))).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', series_id: 'nie-ma' }))).toBe('invalid_series');
    expect(v(U.member, patch('tasks', 't-ev-del', { title: 'y' }))).toBe('ok');
    expect(v(U.member, patch('tasks', 't', { event_id: 'ev-del' }))).toBe('deleted:event');
  });

  it('zmiana zadania: niewidoczne, usunięte, dziecko odhacza tylko swoje (także po rodzicu, wydarzeniu i zakupach)', () => {
    expect(v(U.member, patch('tasks', 't', { title: 'y' }))).toBe('ok');
    expect(v(U.stranger, patch('tasks', 't', { title: 'y' }))).toBe('not_found');
    expect(v(U.member, patch('tasks', 'nie-ma', { title: 'y' }))).toBe('not_found');
    expect(v(U.admin, patch('tasks', 't-r', { title: 'y' }))).toBe('not_found');
    expect(v(U.member, patch('tasks', 't-del', { title: 'y' }))).toBe('deleted');
    expect(v(U.child, patch('tasks', 't', { title: 'y' }))).toBe('forbidden:child');
    expect(v(U.child, patch('tasks', 't-child', { title: 't-child' }))).toBe('ok');
    const done = { completed_at: '2026-10-07T10:00:00Z' };
    expect(v(U.child, patch('tasks', 't', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-child', done))).toBe('ok');
    expect(v(U.child, patch('tasks', 't-sub', done))).toBe('ok');
    expect(v(U.child, patch('tasks', 't-gone', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-member', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-shop', done))).toBe('ok');
    expect(v(U.child, patch('tasks', 't-shop2', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-ev', done))).toBe('ok'); // cała grupa, bez osoby odpowiedzialnej
    expect(v(U.child, patch('tasks', 't-ev-m', done))).toBe('ok'); // uczestnik
    expect(v(U.child, patch('tasks', 't-ev-resp', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-ev-gone', done))).toBe('forbidden:not_own'); // odpowiedzialny wyszedł, udział usunięty
    expect(v(U.child, patch('tasks', 't-ev-over', done))).toBe('forbidden:not_own'); // wyjątek bez osoby, wydarzenie „wybrane osoby”
    expect(v(U.child, patch('tasks', 't-ev-del', done))).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-deep', done))).toBe('forbidden:not_own'); // najwyżej 8 kroków w górę
    const w = world();
    w.event_participants!['p2'] = { id: 'p2', event_id: 'ev-resp', group_id: 'g', member_id: M.child, deleted_at: null };
    expect(v(U.child, patch('tasks', 't-ev-resp', done), w)).toBe('ok');
    w.event_overrides!['o3'] = { id: 'o3', event_id: 'ev', group_id: 'g', occurrence_date: '2026-10-07', responsible_member_id: M.child, deleted_at: null };
    expect(v(U.child, patch('tasks', 't-ev', done), w)).toBe('ok');
  });

  it('usunięcie i przywrócenie zadania: idempotentne, dziecko nie, podzadanie pod usuniętym rodzicem, lista w koszu', () => {
    expect(v(U.member, del('tasks', 't'))).toBe('ok');
    expect(v(U.member, del('tasks', 't-del'))).toBe('ok');
    expect(v(U.member, del('tasks', 't', 'restore'))).toBe('ok');
    expect(v(U.child, del('tasks', 't'))).toBe('forbidden:child');
    expect(v(U.member, del('tasks', 't-delsub', 'restore'))).toBe('deleted:parent');
    expect(v(U.member, del('tasks', 't-del', 'restore'))).toBe('ok');
    expect(v(U.member, del('tasks', 't-inlistdel', 'restore'))).toBe('deleted:list');
    expect(v(U.stranger, del('tasks', 't'))).toBe('not_found');
    expect(v(U.owner, del('tasks', 't3'))).toBe('deleted:group');
    expect(v(U.owner, del('handoffs', 'h'))).toBe('unsupported');
  });

  it('listy: dziecko, widoczność zmienia tylko twórca, osoba od zakupów widzi listę', () => {
    expect(v(U.member, create('lists', { kind: 'tasks', name: 'x' }))).toBe('ok');
    expect(v(U.child, create('lists', { kind: 'tasks', name: 'x' }))).toBe('forbidden:child');
    expect(v(U.stranger, create('lists', { kind: 'tasks', name: 'x' }))).toBe('forbidden');
    expect(v(U.member, patch('lists', 'l', { name: 'y' }))).toBe('ok');
    expect(v(U.member, patch('lists', 'l', { visibility: 'private' }))).toBe('forbidden:not_list_owner');
    expect(v(U.owner, patch('lists', 'l', { visibility: 'private' }))).toBe('ok');
    expect(v(U.child, patch('lists', 'l', { name: 'y' }))).toBe('forbidden:child');
    expect(v(U.member, patch('lists', 'l-shop', { responsible_member_id: M.admin }))).toBe('ok');
    expect(v(U.member, patch('lists', 'l-shop', { responsible_member_id: M.profile }))).toBe('invalid_member');
    expect(v(U.member, patch('lists', 'l-shop', { responsible_member_id: 'nikt' }))).toBe('invalid_member');
    expect(v(U.member, patch('lists', 'l-shop', { responsible_member_id: M.stranger }))).toBe('invalid_member');
    expect(v(U.member, patch('lists', 'l-shop', { name: 'y' }))).toBe('ok'); // dziecko już ustawione — bez sprawdzania
    expect(v(U.owner, patch('lists', 'l-shop2', { visibility: 'private' }))).toBe('invalid_member'); // osoba od zakupów straciłaby dostęp
    expect(v(U.member, create('lists', { kind: 'shopping', name: 'x', visibility: 'private', responsible_member_id: M.admin }))).toBe('invalid_member');
    expect(v(U.member, create('lists', { kind: 'shopping', name: 'x', responsible_member_id: M.admin }))).toBe('ok');
  });

  it('wydarzenia, wyjątki, uczestnicy, seria zadań', () => {
    expect(v(U.member, create('events', { title: 'x', audience: 'group' }))).toBe('ok');
    expect(v(U.child, create('events', { title: 'x' }))).toBe('forbidden:child');
    expect(v(U.stranger, create('events', { title: 'x' }))).toBe('forbidden');
    expect(v(U.member, create('events', { title: 'x', responsible_member_id: M.child }))).toBe('invalid_member');
    expect(v(U.member, patch('events', 'ev', { responsible_member_id: M.admin }))).toBe('ok');
    expect(v(U.member, patch('events', 'ev-resp', { responsible_member_id: M.owner }))).toBe('ok');
    expect(v(U.member, create('event_overrides', { event_id: 'ev', occurrence_date: '2026-10-21', cancelled: true }))).toBe('ok');
    expect(v(U.member, create('event_overrides', { event_id: 'ev-resp', occurrence_date: '2026-10-14', cancelled: true }))).toBe('invalid:23505');
    expect(v(U.member, create('event_overrides', { event_id: 'ev2', occurrence_date: '2026-10-21' }))).toBe('invalid_event');
    expect(v(U.member, create('event_participants', { event_id: 'ev', member_id: M.child }))).toBe('ok');
    expect(v(U.member, create('event_participants', { event_id: 'ev-m', member_id: M.child }))).toBe('invalid:23505');
    expect(v(U.member, create('event_participants', { event_id: 'ev', member_id: 'm-gone' }))).toBe('invalid_member');
    expect(v(U.member, create('event_participants', { event_id: 'ev', member_id: M.stranger }))).toBe('invalid_member');
    expect(v(U.member, del('event_participants', 'p'))).toBe('ok');
    expect(v(U.member, patch('event_participants', 'p', { member_id: M.admin }))).toBe('invalid_field:member_id');
    expect(v(U.member, create('event_task_series', { event_id: 'ev', list_id: 'l', title: 'x' }))).toBe('ok');
    expect(v(U.child, create('event_task_series', { event_id: 'ev', list_id: 'l', title: 'x' }))).toBe('forbidden:child');
    expect(v(U.stranger, create('event_task_series', { event_id: 'ev', list_id: 'l', title: 'x' }))).toBe('forbidden');
    expect(v(U.member, create('event_task_series', { event_id: 'ev2', list_id: 'l', title: 'x' }))).toBe('invalid_event');
    expect(v(U.member, create('event_task_series', { event_id: 'ev', list_id: 'l2', title: 'x' }))).toBe('invalid_list');
    expect(v(U.member, create('event_task_series', { event_id: 'ev', list_id: 'l-shop', title: 'x' }))).toBe('invalid_list:kind');
    expect(v(U.member, create('event_task_series', { event_id: 'ev', list_id: 'l-del', title: 'x' }))).toBe('deleted:list');
    expect(v(U.member, create('event_task_series', { event_id: 'ev-del', list_id: 'l', title: 'x' }))).toBe('deleted:event');
    expect(v(U.member, create('event_task_series', { event_id: 'ev', list_id: 'l-p', title: 'x' }))).toBe('forbidden'); // RLS: lista niewidoczna
    expect(v(U.member, patch('event_task_series', 's', { title: 'y' }))).toBe('ok');
    expect(v(U.member, patch('event_task_series', 's', { event_id: 'ev-del' }))).toBe('deleted:event');
    expect(v(U.member, del('event_task_series', 's'))).toBe('ok');
    expect(v(U.member, del('event_task_series', 's-del', 'restore'))).toBe('deleted:list');
    expect(v(U.member, del('event_task_series', 's-evdel', 'restore'))).toBe('deleted:event');
  });

  it('obecność: za siebie, dorosły za profil dziecka bez konta; wydarzenie usunięte albo obce', () => {
    const r = (member: string, event = 'ev') => create('event_rsvps', { event_id: event, occurrence_date: '2026-10-14', member_id: member, answer: 'yes' });
    expect(v(U.child, r(M.child))).toBe('ok');
    expect(v(U.member, r(M.profile))).toBe('ok');
    expect(v(U.child, r(M.profile))).toBe('forbidden:not_self');
    expect(v(U.member, r(M.child))).toBe('forbidden:not_self');
    expect(v(U.member, r('m-gone'))).toBe('invalid_member');
    expect(v(U.member, r(M.member, 'ev-del'))).toBe('invalid_event');
    expect(v(U.stranger, r(M.stranger))).toBe('forbidden');
    expect(v(U.member, patch('event_rsvps', 'r', { answer: 'no' }))).toBe('ok');
    expect(v(U.admin, patch('event_rsvps', 'r', { answer: 'no' }))).toBe('forbidden:not_self');
    expect(v(U.member, create('event_rsvps', { event_id: 'ev', occurrence_date: '2026-10-07', member_id: M.member, answer: 'no' }))).toBe('invalid:23505');
  });

  it('przekazania: kto, czego i komu; decyzje stron; widzą je tylko strony', () => {
    const h = (entity: string, entity_id: string, to: string, extra: Row = {}) => create('handoffs', { entity, entity_id, to_member: to, ...extra });
    expect(v(U.owner, h('tasks', 't-r', M.member))).toBe('ok');
    expect(v(U.child, h('tasks', 't-child', M.owner))).toBe('forbidden:child');
    expect(v(U.stranger, h('tasks', 't-r', M.member))).toBe('forbidden');
    expect(v(U.owner, h('tasks', 't-r', M.owner))).toBe('invalid_member');
    expect(v(U.owner, h('tasks', 't-r', M.profile))).toBe('invalid_member');
    expect(v(U.owner, h('tasks', 't-r', M.child))).toBe('invalid_member');
    expect(v(U.owner, h('tasks', 't-r', M.admin))).toBe('invalid_member'); // admin nie widzi listy
    expect(v(U.owner, h('tasks', 't-del', M.member))).toBe('invalid_entity');
    expect(v(U.owner, h('tasks', 't-member', M.admin))).toBe('forbidden:not_responsible');
    expect(v(U.owner, h('tasks', 't-owner', M.admin))).toBe('invalid:23505'); // jedno oczekujące przekazanie
    expect(v(U.member, h('lists', 'l-shop2', M.admin))).toBe('ok');
    expect(v(U.owner, h('lists', 'l-shop2', M.admin))).toBe('forbidden:not_responsible');
    expect(v(U.member, h('lists', 'l', M.admin))).toBe('invalid_entity');
    const w = world();
    w.lists!['l-shop2'] = { ...w.lists!['l-shop2']!, visibility: 'private', owner_member_id: M.member };
    expect(v(U.member, h('lists', 'l-shop2', M.admin), w)).toBe('invalid_member');
    expect(v(U.owner, h('events', 'ev-resp', M.admin))).toBe('ok');
    expect(v(U.owner, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-14' }))).toBe('forbidden:not_responsible'); // wyjątek bez osoby
    expect(v(U.member, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-21' }))).toBe('ok'); // wyjątek z osobą
    expect(v(U.owner, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-28' }))).toBe('ok'); // bez wyjątku — osoba serii
    expect(v(U.owner, h('events', 'ev-del', M.admin))).toBe('invalid_entity');
    expect(v(U.owner, h('events', 'ev', M.admin))).toBe('forbidden:not_responsible'); // seria bez osoby
    const w2 = world();
    w2.event_overrides!['o4'] = { id: 'o4', event_id: 'ev-resp', group_id: 'g', occurrence_date: '2026-11-04', responsible_member_id: null, responsible_cleared: false, deleted_at: null };
    expect(v(U.owner, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-11-04' }), w2)).toBe('ok'); // wyjątek bez osoby, nie wyczyszczony — osoba serii
    expect(v(U.member, patch('handoffs', 'h', { status: 'accepted' }))).toBe('ok');
    expect(v(U.owner, patch('handoffs', 'h', { status: 'accepted' }))).toBe('forbidden');
    expect(v(U.owner, patch('handoffs', 'h', { status: 'cancelled' }))).toBe('ok');
    expect(v(U.member, patch('handoffs', 'h', { status: 'cancelled' }))).toBe('forbidden');
    expect(v(U.member, patch('handoffs', 'h', { closed: true }))).toBe('forbidden');
    expect(v(U.owner, patch('handoffs', 'h', { closed: true }))).toBe('ok');
    expect(v(U.member, patch('handoffs', 'h-done', { status: 'declined' }))).toBe('invalid_value:status');
    expect(v(U.admin, patch('handoffs', 'h', { status: 'accepted' }))).toBe('not_found');
    expect(v(U.member, patch('handoffs', 'h', { status: 'pending' }))).toBe('ok');
  });

  it('członkowie: profile dzieci dodaje owner i admin; role zmienia owner; nazwy; wyjście; tydzień A', () => {
    const child = { display_name: 'Nowe', role: 'child' };
    expect(v(U.admin, create('group_members', child))).toBe('ok');
    expect(v(U.member, create('group_members', child))).toBe('forbidden');
    expect(v(U.stranger, create('group_members', child))).toBe('forbidden');
    expect(v(U.admin, create('group_members', { display_name: 'X', role: 'member' }))).toBe('forbidden:role');
    expect(v(U.admin, create('group_members', { ...child, user_id: 'u-y' } as Row))).toBe('invalid_field:user_id');
    expect(v(U.owner, patch('group_members', M.member, { role: 'admin' }))).toBe('ok');
    expect(v(U.owner, patch('group_members', M.member, { role: 'owner' }))).toBe('forbidden:role');
    expect(v(U.owner, patch('group_members', M.owner, { role: 'admin' }))).toBe('forbidden:owner_cannot_demote_self');
    expect(v(U.owner, patch('group_members', M.profile, { role: 'member' }))).toBe('forbidden:role'); // profil bez konta zostaje dzieckiem
    expect(v(U.admin, patch('group_members', M.member, { role: 'child' }))).toBe('forbidden:role');
    // Audyt 3 (N-42, Q6b A): na dziecko tylko konto połączone kiedyś kodem profilu dziecka (child_linked_at).
    expect(v(U.owner, patch('group_members', M.member, { role: 'child' }))).toBe('forbidden:role');
    expect(v(U.owner, patch('group_members', M.child, { role: 'member' }))).toBe('ok');
    const linked = world();
    linked.group_members![M.member] = { ...linked.group_members![M.member]!, child_linked_at: '2026-10-01T00:00:00Z' };
    expect(v(U.owner, patch('group_members', M.member, { role: 'child' }), linked)).toBe('ok');
    expect(v(U.owner, patch('group_members', M.child, { display_name: 'Ala' }))).toBe('ok'); // dziecko bez znacznika zostaje dzieckiem
    expect(v(U.admin, del('group_members', M.member))).toBe('ok'); // admin usuwa dorosłego członka
    expect(v(U.admin, del('group_members', M.owner))).toBe('forbidden:role');
    expect(v(U.admin, del('group_members', M.profile))).toBe('ok');
    expect(v(U.member, del('group_members', M.profile))).toBe('forbidden:role');
    expect(v(U.member, del('group_members', M.member))).toBe('ok'); // wyjście z grupy
    expect(v(U.child, del('group_members', M.child))).toBe('forbidden:child');
    expect(v(U.owner, del('group_members', M.owner))).toBe('forbidden:owner_cannot_demote_self');
    expect(v(U.admin, patch('group_members', M.profile, { display_name: 'Y' }))).toBe('ok');
    expect(v(U.admin, patch('group_members', M.member, { display_name: 'Y' }))).toBe('forbidden');
    expect(v(U.member, patch('group_members', M.member, { color: '#00aa00' }))).toBe('ok');
    expect(v(U.owner, patch('group_members', M.member, { color: '#00aa00' }))).toBe('ok');
    expect(v(U.member, patch('group_members', M.profile, { week_a: '2026-10-05' }))).toBe('ok');
    expect(v(U.child, patch('group_members', M.child, { week_a: '2026-10-05' }))).toBe('forbidden');
    expect(v(U.child, patch('group_members', M.child, { color: '#00aa00' }))).toBe('ok');
    expect(v(U.stranger, patch('group_members', M.member, { color: '#00aa00' }))).toBe('not_found');
  });

  it('błąd w danych (nie odrzucenie) nie jest połykany', () => {
    const broken = { get lists(): never { throw new TypeError('zepsute dane'); } } as unknown as ServerTables;
    expect(() => serverVerdict(broken, U.owner, create('lists', { kind: 'tasks', name: 'x' }))).toThrow('zepsute dane');
  });

  it('grupa: zmienia owner i admin, kolor tylko owner; grupa w koszu', () => {
    expect(v(U.admin, patch('groups', 'g', { name: 'Nowa' }))).toBe('ok');
    expect(v(U.member, patch('groups', 'g', { name: 'Nowa' }))).toBe('forbidden');
    expect(v(U.admin, patch('groups', 'g', { color: 'blue' }))).toBe('forbidden:role');
    expect(v(U.owner, patch('groups', 'g', { color: 'blue' }))).toBe('ok');
    expect(v(U.stranger, patch('groups', 'g', { name: 'Nowa' }))).toBe('not_found');
    expect(v(U.owner, patch('groups', 'g3', { name: 'Nowa' }))).toBe('deleted:group');
  });

  describe('skutek przyjętej operacji na serwerze (applyOnServer)', () => {
    const AT = '2026-10-07T08:00:00.000Z';
    const run = (user: string, op: NewOp, t = world()) => {
      expect(serverVerdict(t, user, op)).toBeNull();
      applyOnServer(t, user, op, AT);
      return t;
    };

    it('wydarzenie wielodniowe (D199): z godziną zawsze days = 1, całodniowe zachowuje liczbę dni', () => {
      expect(run(U.member, create('events', { title: 'Obóz', audience: 'group', start_time: null, days: 5 })).events!.new).toMatchObject({ days: 5 });
      expect(run(U.member, create('events', { title: 'x', audience: 'group' })).events!.new).toMatchObject({ days: 1 });
      expect(run(U.member, create('events', { title: 'x', audience: 'group', start_time: '10:00', days: 3 })).events!.new).toMatchObject({ days: 1 });
      const t = run(U.member, create('events', { title: 'Obóz', audience: 'group', start_time: null, days: 5 }));
      expect(run(U.member, patch('events', 'new', { title: 'Obóz 2' }), t).events!.new).toMatchObject({ days: 5 });
      expect(run(U.member, patch('events', 'new', { start_time: '09:00' }), t).events!.new).toMatchObject({ days: 1 });
    });

    it('zrobione zakupy: kto zrobił nadaje serwer; wyjście z grupy zdejmuje zakres Moich spraw tej osoby', () => {
      expect(run(U.member, create('shopping_trips', { list_id: 'l-shop', done_at: AT })).shopping_trips!.new).toMatchObject({ done_by: M.member });
      const t = world();
      (t.my_day_scopes ??= {}).a = { id: 'a', group_id: 'g', member_id: M.member, scope: 'mine', deleted_at: null };
      t.my_day_scopes.b = { id: 'b', group_id: 'g', member_id: M.admin, scope: 'all', deleted_at: null };
      expect(Object.keys(run(U.member, del('group_members', M.member), t).my_day_scopes!)).toEqual(['b']);
    });

    it('utworzenie: wartości domyślne, klucz główny, twórca listy, nadawca i stan przekazania', () => {
      const t = run(U.member, create('lists', { kind: 'tasks', name: 'x' }));
      expect(t.lists!.new).toMatchObject({ id: 'new', owner_member_id: M.member, sort_key: 'a0', staples: [], visibility: 'group' });
      expect(run(U.admin, create('group_members', { display_name: 'Nowe', role: 'child' })).group_members!.new).toMatchObject({ member_id: 'new', role: 'child' });
      expect(run(U.owner, create('handoffs', { entity: 'tasks', entity_id: 't-r', to_member: M.member })).handoffs!.new).toMatchObject({ from_member: M.owner, status: 'pending', closed: false, decided_at: null });
      expect(run(U.member, create('events', { title: 'x', audience: 'members' })).events!.new).toMatchObject({ audience: 'members' });
      expect(run(U.member, create('event_participants', { event_id: 'ev', member_id: M.child })).event_participants!.new).toMatchObject({ id: 'new', member_id: M.child });
    });

    it('polecenie: ten sam skutek co na telefonie (stałe zakupy)', () => {
      expect(run(U.member, { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'l-shop', name: 'Mleko' } }).lists!['l-shop']!.staples).toEqual(['Mleko']);
    });

    it('usunięcie: znacznik czasu serwera, kaskada na zadania; zmiana zwykła bez skutków', () => {
      const t = run(U.member, del('tasks', 't-child'));
      expect(t.tasks!['t-child']!.deleted_at).toBe(AT);
      expect(t.tasks!['t-sub']!.deleted_at).toBe(AT);
      expect(run(U.member, patch('tasks', 't', { title: 'y' })).tasks!.t).toMatchObject({ title: 'y' });
      expect(run(U.owner, patch('handoffs', 'h', { closed: true })).handoffs!.h).toEqual(expect.not.objectContaining({ decided_at: expect.anything() }));
    });

    it('seria zadań przy wydarzeniu znika z wydarzeniem albo listą i wraca tylko z nimi (gdy drugi rodzic żyje)', () => {
      const t = world();
      t.event_task_series!.s2 = { id: 's2', event_id: 'ev', group_id: 'g', list_id: 'l', title: 's2', deleted_at: '2026-09-01T00:00:00Z' };
      run(U.member, del('events', 'ev'), t);
      expect(t.event_task_series!.s!.deleted_at).toBe(AT);
      expect(t.event_task_series!.s2!.deleted_at).toBe('2026-09-01T00:00:00Z'); // usunięta wcześniej osobno
      run(U.member, del('events', 'ev', 'restore'), t);
      expect(t.event_task_series!.s!.deleted_at).toBeNull();
      expect(t.event_task_series!.s2!.deleted_at).toBe('2026-09-01T00:00:00Z');
      run(U.member, del('lists', 'l'), t);
      expect(t.event_task_series!.s!.deleted_at).toBe(AT);
      run(U.member, del('events', 'ev'), t);
      run(U.member, del('lists', 'l', 'restore'), t);
      expect(t.event_task_series!.s!.deleted_at).toBe(AT); // wydarzenie nadal usunięte
      const noSeries = world();
      delete noSeries.event_task_series;
      expect(run(U.member, del('events', 'ev'), noSeries).events!.ev!.deleted_at).toBe(AT);
      const t2 = world();
      run(U.member, del('lists', 'l'), t2);
      run(U.member, del('lists', 'l', 'restore'), t2);
      expect(t2.event_task_series!.s!.deleted_at).toBeNull(); // lista wraca, wydarzenie żyje — seria też
      const noEvents = world();
      delete noEvents.events;
      noEvents.event_task_series!.s = { ...noEvents.event_task_series!.s!, deleted_at: '2026-09-02T00:00:00Z' };
      noEvents.lists!.l = { ...noEvents.lists!.l!, deleted_at: '2026-09-02T00:00:00Z' };
      applyOnServer(noEvents, U.member, del('lists', 'l', 'restore'), AT);
      expect(noEvents.event_task_series!.s!.deleted_at).toBeNull();
    });

    it('wyjście członka: przekazania anulowane, listy prywatne usunięte (z zadaniami i seriami), udostępnienia odebrane; powrót przywraca listy', () => {
      const t = world();
      t.lists!['l-mp'] = { id: 'l-mp', group_id: 'g', kind: 'tasks', name: 'Moja', visibility: 'private', owner_member_id: M.member, deleted_at: null };
      t.lists!['l-mp-old'] = { id: 'l-mp-old', group_id: 'g', kind: 'tasks', name: 'Stara', visibility: 'private', owner_member_id: M.member, deleted_at: '2026-01-01T00:00:00Z' };
      t.tasks!['t-mp'] = { id: 't-mp', group_id: 'g', list_id: 'l-mp', parent_id: null, title: 'x', deleted_at: null };
      t.event_task_series!['s-mp'] = { id: 's-mp', event_id: 'ev', group_id: 'g', list_id: 'l-mp', title: 's', deleted_at: null };
      const gone = { ...t.group_members![M.member]! };
      run(U.member, del('group_members', M.member), t);
      expect(t.handoffs!.h).toMatchObject({ status: 'cancelled', decided_at: AT });
      expect(t.handoffs!['h-done']!.status).toBe('accepted');
      expect([t.lists!['l-mp']!.deleted_at, t.tasks!['t-mp']!.deleted_at, t.event_task_series!['s-mp']!.deleted_at]).toEqual([AT, AT, AT]);
      expect(t.lists!.l!.deleted_at).toBeNull();
      expect(t.object_members!['l-r:m-m']!.deleted_at).toBe(AT);
      expect(t.object_members!['l-r:m-a']!.deleted_at).toBe('2026-10-01T00:00:00Z');
      applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
      expect(t.lists!['l-mp']!.deleted_at).toBeNull();
      expect(t.lists!['l-mp-old']!.deleted_at).toBe('2026-01-01T00:00:00Z');
      expect(gone.deleted_at).toBeNull();
      const bare = world();
      delete bare.handoffs;
      delete bare.object_members;
      delete bare.lists;
      applyOnServer(bare, U.owner, del('group_members', M.member), AT);
      applyOnServer(bare, U.owner, del('group_members', M.member, 'restore'), AT);
      expect(bare.group_members![M.member]!.deleted_at).toBeNull();
    });

    it('przekazanie: odrzucenie i anulowanie zapisują decyzję; przyjęcie zmienia osobę zadania, zakupów, wydarzenia i terminu', () => {
      expect(run(U.member, patch('handoffs', 'h', { status: 'declined' }))).toMatchObject({ handoffs: { h: { status: 'declined', decided_at: AT } }, tasks: { 't-owner': { assignee_member_id: M.owner } } });
      expect(run(U.member, patch('handoffs', 'h', { status: 'accepted' })).tasks!['t-owner']!.assignee_member_id).toBe(M.member);
      const done = world();
      done.tasks!['t-owner'] = { ...done.tasks!['t-owner']!, completed_at: AT };
      expect(run(U.member, patch('handoffs', 'h', { status: 'accepted' }), done).tasks!['t-owner']!.assignee_member_id).toBe(M.owner); // zrobione — bez zmian
      const t = world();
      const put = (id: string, row: Row) => void (t.handoffs![id] = { id, group_id: 'g', occurrence_date: null, from_member: M.owner, to_member: M.admin, status: 'pending', closed: false, ...row });
      put('hl', { entity: 'lists', entity_id: 'l-shop2', from_member: M.member });
      put('he', { entity: 'events', entity_id: 'ev-resp' });
      put('ho', { entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-28' });
      put('ho2', { entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-14' });
      for (const id of ['hl', 'he', 'ho', 'ho2']) run(U.admin, patch('handoffs', id, { status: 'accepted' }), t);
      expect(t.lists!['l-shop2']!.responsible_member_id).toBe(M.admin);
      expect(t.events!['ev-resp']!.responsible_member_id).toBe(M.admin);
      expect(t.event_overrides![overrideId('ev-resp', '2026-10-28')]).toMatchObject({ event_id: 'ev-resp', occurrence_date: '2026-10-28', responsible_member_id: M.admin, responsible_cleared: false, cancelled: false });
      expect(t.event_overrides!.o).toMatchObject({ responsible_member_id: M.admin, responsible_cleared: false });
      const empty = world();
      delete empty.event_overrides;
      empty.handoffs!.ho = { id: 'ho', group_id: 'g', entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-28', from_member: M.owner, to_member: M.admin, status: 'pending', closed: false };
      expect(run(U.admin, patch('handoffs', 'ho', { status: 'accepted' }), empty).event_overrides![overrideId('ev-resp', '2026-10-28')]).toMatchObject({ responsible_member_id: M.admin });
      // Już rozstrzygnięte albo ten sam stan — bez skutków.
      const again = world();
      applyOnServer(again, U.member, patch('handoffs', 'h-done', { status: 'accepted' }), AT);
      expect(again.handoffs!['h-done']!.decided_at).toBeUndefined();
      applyOnServer(again, U.member, patch('handoffs', 'h', { status: 'pending' }), AT);
      expect(again.handoffs!.h!.decided_at).toBeUndefined();
      applyOnServer(again, U.member, patch('handoffs', 'nie-ma', { status: 'accepted' }), AT);
      expect(again.handoffs!['nie-ma']).toBeUndefined();
    });
  });
});

describe('przeniesienie do innej grupy jednym poleceniem (audyt 3: N-12, N-131; pgTAP move_task_to_group.test.sql)', () => {
  const AT = '2026-10-07T10:00:00Z';
  /** Druga grupa właściciela: Klasa (lista ogólna lk, usunięta lk-del), w niej też członek, ale bez dziecka. */
  const two = () => {
    const t = world();
    t.groups!.gk = { id: 'gk', name: 'Klasa', deleted_at: null };
    t.group_members!['k-o'] = { member_id: 'k-o', group_id: 'gk', user_id: U.owner, role: 'owner', display_name: 'O', deleted_at: null };
    t.group_members!['k-m'] = { member_id: 'k-m', group_id: 'gk', user_id: U.member, role: 'member', display_name: 'M', deleted_at: null };
    t.lists!.lk = { id: 'lk', group_id: 'gk', kind: 'tasks', name: 'Ogólne', visibility: 'group', owner_member_id: 'k-o', deleted_at: null };
    t.lists!['lk-del'] = { ...t.lists!.lk, id: 'lk-del', deleted_at: '2026-10-01T00:00:00Z' };
    t.tasks!['t-subm'] = { ...t.tasks!.t!, id: 't-subm', parent_id: 't-member', title: 'pod' };
    return t;
  };
  const cp = (id: string, from: string, list: string, extra: Row = {}) => ({ id, from, set: { list_id: list, parent_id: null, title: from, ...extra } });
  const mv = (task: string, group: string, tasks: Row[], list: Row | null = null): NewOp => ({ kind: 'cmd', cmd: 'move_task_to_group', args: { task_id: task, group_id: group, list, tasks } });
  const un = (task: string, copy: string): NewOp => ({ kind: 'cmd', cmd: 'unmove_task', args: { task_id: task, copy_id: copy, title: 'x' } });

  it('odrzucenia przed zapisami: niewidoczne, dziecko, ta sama grupa, podzadanie, w koszu, kształt kopii', () => {
    const t = two();
    expect(v(U.stranger, mv('t-member', 'gk', [cp('c', 't-member', 'lk')]), t)).toBe('not_found');
    expect(v(U.child, mv('t-member', 'gk', [cp('c', 't-member', 'lk')]), t)).toBe('forbidden:child');
    expect(v(U.owner, mv('t-member', 'g', [cp('c', 't-member', 'l')]), t)).toBe('invalid_value');
    expect(v(U.owner, mv('t-subm', 'gk', [cp('c', 't-subm', 'lk')]), t)).toBe('invalid_value');
    expect(v(U.owner, mv('t-del', 'gk', [cp('c', 't-del', 'lk')]), t)).toBe('deleted');
    expect(v(U.owner, mv('t-member', 'gk', []), t)).toBe('invalid_value');
    expect(v(U.owner, { kind: 'cmd', cmd: 'move_task_to_group', args: { task_id: 't-member' } }, t)).toBe('invalid_value');
    expect(v(U.owner, mv('t-member', 'gk', [cp('c', 't-subm', 'lk')]), t)).toBe('invalid_value');
    expect(v(U.owner, mv('t-member', 'gk', [cp('c', 't-member', 'lk', { parent_id: 'x' })]), t)).toBe('invalid_value');
    expect(v(U.owner, mv('t-member', 'gk', [cp('c', 't-member', 'lk'), cp('c2', 't', 'lk')]), t)).toBe('invalid_value');
    // Kopia o id istniejącego zadania (utworzenie = powtórzenie) — nie.
    expect(v(U.owner, mv('t-member', 'gk', [cp('t', 't-member', 'lk')]), t)).toBe('invalid_value');
  });

  it('N-12: pierwsze odrzucenie kroku odrzuca całe polecenie', () => {
    const t = two();
    expect(v(U.owner, mv('t-member', 'gk', [cp('c', 't-member', 'lk-del')]), t)).toBe('deleted:list');
    expect(v(U.owner, mv('t-member', 'gk', [cp('c', 't-member', 'nl'), { ...cp('c2', 't-subm', 'nl', { assignee_member_id: M.member }), set: { list_id: 'nl', parent_id: 'c', title: 'pod', assignee_member_id: M.member } }], { id: 'nl', set: { kind: 'tasks', name: 'Ogólne' } }), t)).toBe('invalid_assignee');
    expect(t.lists!.nl).toBeUndefined();
  });

  it('przyjęte: kopie, oryginał w koszu ze znacznikiem; przywrócenie — „moved”; „Cofnij” i jego odrzucenia', () => {
    const t = two();
    const op = mv('t-member', 'gk', [cp('c', 't-member', 'lk', { assignee_member_id: 'k-m' }), { id: 'c2', from: 't-subm', set: { list_id: 'lk', parent_id: 'c', title: 'pod' } }]);
    expect(v(U.owner, op, t)).toBe('ok');
    applyOnServer(t, U.owner, op, AT);
    expect(t.tasks!['t-member']).toMatchObject({ deleted_at: AT, moved_to: 'c' });
    expect(t.tasks!['t-subm']!.deleted_at).toBe(AT);
    expect(t.tasks!.c2).toMatchObject({ group_id: 'gk', parent_id: 'c', deleted_at: null });
    expect(v(U.owner, del('tasks', 't-member', 'restore'), t)).toBe('moved');
    expect(v(U.owner, un('t-member', 'inna'), t)).toBe('invalid_value');
    expect(v(U.child, un('t-member', 'c'), t)).toBe('forbidden:child');
    expect(v(U.owner, un('brak', 'c'), t)).toBe('not_found');
    expect(v(U.owner, { kind: 'cmd', cmd: 'unmove_task', args: {} }, t)).toBe('invalid_value');
    expect(v(U.owner, un('t-member', 'c'), t)).toBe('ok');
    applyOnServer(t, U.owner, un('t-member', 'c'), AT);
    expect(t.tasks!['t-member']).toMatchObject({ deleted_at: null, moved_to: null });
    expect(t.tasks!.c).toMatchObject({ deleted_at: AT, moved_to: 't-member' });
    expect(v(U.owner, del('tasks', 'c', 'restore'), t)).toBe('moved');
    expect(v(U.owner, un('t-member', 'c'), t)).toBe('ok');
  });

  it('bez tabeli zadań — nie ma czego przenieść', () => {
    expect(v(U.owner, mv('t', 'gk', [cp('c', 't', 'lk')]), { groups: world().groups })).toBe('not_found');
  });

  it('cofnięcie, gdy kopii już nie widzę, a żyje — „moved”', () => {
    const t = two();
    const op = mv('t-member', 'gk', [cp('c', 't-member', 'lk')]);
    applyOnServer(t, U.owner, op, AT);
    t.group_members!['k-o'] = { ...t.group_members!['k-o']!, deleted_at: AT };
    expect(v(U.owner, un('t-member', 'c'), t)).toBe('moved');
  });
});
