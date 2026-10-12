/**
 * Model reguł serwera (server-rules.ts, audyt 2 M-50) na przykładach — każda reguła i kolejność sprawdzeń. Zgodność
 * z prawdziwym SQL na losowych operacjach: tests/db/rules-vs-sql.test.ts.
 */
import { config } from '../../config';
import { applyOnServer, type ServerTables, SYNC_ENTITIES, serverVerdict } from '../server-rules';
import { overrideId } from '../views/events';
import { scopeRowId } from '../views/my-scope';
import { nextId } from '../views/task-repeat';
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

  it('audyt 3 (Q16 A, N-123): dziecko — następny termin swojego zadania powtarzanego i kopie podzadań, jak robi je telefon', () => {
    const t = world();
    const put = (k: string, r: Row) => void (t.tasks![k] = { group_id: 'g', list_id: 'l', parent_id: null, assignee_member_id: null, completed_at: null, deleted_at: null, ...r, id: k });
    put('r', { title: 'Łóżko', assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-12', repeat: 'FREQ=DAILY' });
    put('rs', { title: 'Pościel', parent_id: 'r', deadline_mode: 'inherit' });
    put('rss', { title: 'Poszewka', parent_id: 'rs', deadline_mode: 'own', due_time: '08:00' });
    put('o', { title: 'Rachunki', assignee_member_id: M.owner, deadline_mode: 'own', due_date: '2026-10-12', repeat: 'FREQ=DAILY' });
    const c = nextId('r');
    const root = (extra: Row = {}, id = c) => create('tasks', { list_id: 'l', parent_id: null, title: 'Łóżko', note: null, sort_key: 'a0', assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-13', due_time: null, rollover: true, repeat: 'FREQ=DAILY', ...extra }, 'g', id);
    expect(v(U.child, root(), t)).toBe('ok');
    expect(v(U.child, root({ assignee_member_id: null }), t)).toBe('ok');
    for (const bad of [{ title: 'Inne' }, { assignee_member_id: M.owner }, { repeat: null }, { due_date: null }, { deadline_mode: 'none' }, { cycle_date: '2026-10-12' }, { due_time: '09:00' }, { rollover: false }])
      expect([bad, v(U.child, root(bad), t)]).toEqual([bad, 'forbidden:child']);
    expect(v(U.child, root({}, 'zwykle'), t)).toBe('forbidden:child');
    expect(v(U.child, create('tasks', { list_id: 'l', title: 'Rachunki', assignee_member_id: M.owner, deadline_mode: 'own', due_date: '2026-10-13', repeat: 'FREQ=DAILY' }, 'g', nextId('o')), t)).toBe('forbidden:child');
    // Kopie podzadań — pod następnym (gdy już jest), bez powtarzania.
    const sub = (id: string, parent: string, extra: Row = {}) => create('tasks', { list_id: 'l', parent_id: parent, title: 'Pościel', deadline_mode: 'inherit', ...extra }, 'g', id);
    expect(v(U.child, sub(nextId('rs'), c), t)).toBe('forbidden:child'); // następnego jeszcze nie ma
    put(c, { title: 'Łóżko', assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-13', repeat: 'FREQ=DAILY' });
    expect(v(U.child, sub(nextId('rs'), c), t)).toBe('ok');
    expect(v(U.child, sub(nextId('rs'), c, { repeat: 'FREQ=DAILY' }), t)).toBe('forbidden:child');
    expect(v(U.child, sub(nextId('rs'), c, { deadline_mode: 'event' }), t)).toBe('forbidden:child');
    expect(v(U.child, sub(nextId('rs'), 'nie-ma'), t)).toBe('forbidden:child');
    expect(v(U.child, sub('inne-id', c), t)).toBe('forbidden:child');
    put(nextId('rs'), { title: 'Pościel', parent_id: c, deadline_mode: 'inherit' });
    expect(v(U.child, sub(nextId('rss'), nextId('rs'), { title: 'Poszewka', deadline_mode: 'own', due_date: '2026-10-13', due_time: '08:00' }), t)).toBe('ok');
    expect(v(U.child, sub(nextId('rss'), nextId('rs'), { title: 'Poszewka', due_time: '09:00' }), t)).toBe('forbidden:child');
    // Zdjęcie i przywrócenie następnego (z wierszami pod nim), jego termin; reszta — nie.
    expect(v(U.child, del('tasks', c), t)).toBe('ok');
    expect(v(U.child, del('tasks', nextId('rs')), t)).toBe('ok');
    expect(v(U.child, patch('tasks', c, { due_date: '2026-10-14', due_time: null, cycle_date: null }), t)).toBe('ok');
    expect(v(U.child, patch('tasks', c, { title: 'x' }), t)).toBe('forbidden:child');
    expect(v(U.child, patch('tasks', nextId('rs'), { due_date: '2026-10-14' }), t)).toBe('forbidden:child');
    expect(v(U.child, del('tasks', 'r'), t)).toBe('forbidden:child');
    expect(v(U.child, del('tasks', 'rs'), t)).toBe('forbidden:child');
    t.tasks![c] = { ...t.tasks![c]!, completed_at: '2026-10-13T08:00:00Z' };
    expect(v(U.child, del('tasks', c), t)).toBe('forbidden:child');
    // Wartości domyślne kolumn (wiersz bez kolejności i „przenoś”), głębokie drzewo bez zadania głównego w 8 krokach.
    put('m', { title: 'Mycie', assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-12', repeat: 'FREQ=DAILY' });
    expect(v(U.child, create('tasks', { list_id: 'l', title: 'Mycie', deadline_mode: 'own', due_date: '2026-10-13', repeat: 'FREQ=DAILY' }, 'g', nextId('m')), t)).toBe('ok');
    expect(v(U.child, create('tasks', { list_id: 'l', title: 'Mycie', due_date: '2026-10-13', repeat: 'FREQ=DAILY' }, 'g', nextId('m')), t)).toBe('forbidden:child');
    expect(v(U.child, del('tasks', 't-deep'), t)).toBe('forbidden:child');
    // Pod następnym podzadanie dodane ręcznie (nie kopia) — pod nim dziecko nic nie zakłada.
    put('reczne', { title: 'Ręczne', parent_id: c, deadline_mode: 'inherit' });
    expect(v(U.child, sub(nextId('cokolwiek'), 'reczne'), t)).toBe('forbidden:child');
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

    it('zrobione zakupy: kto zrobił nadaje serwer; wyjście z grupy zdejmuje zakres Moich spraw tej osoby (do kosza, N-87)', () => {
      expect(run(U.member, create('shopping_trips', { list_id: 'l-shop', done_at: AT })).shopping_trips!.new).toMatchObject({ done_by: M.member });
      const t = world();
      (t.my_day_scopes ??= {}).a = { id: 'a', group_id: 'g', member_id: M.member, scope: 'mine', deleted_at: null };
      t.my_day_scopes.b = { id: 'b', group_id: 'g', member_id: M.admin, scope: 'all', deleted_at: null };
      t.my_day_scopes.c = { id: 'c', group_id: 'g', member_id: M.member, scope: 'mine', deleted_at: '2026-10-01T00:00:00Z' };
      const s = run(U.member, del('group_members', M.member), t).my_day_scopes!;
      expect([s.a!.deleted_at, s.b!.deleted_at, s.c!.deleted_at]).toEqual([AT, null, '2026-10-01T00:00:00Z']);
      applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
      expect([t.my_day_scopes!.a!.deleted_at, t.my_day_scopes!.c!.deleted_at]).toEqual([null, '2026-10-01T00:00:00Z']); // wcześniej usunięty zostaje
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

    it('audyt 3 (N-40, N-87): „Cofnij” po usunięciu przywraca przekazania, które nadal mają sens, udostępnienia i zakres Moich spraw', () => {
      const t = world();
      const h = (id: string, from: string, to: string, entity: string, entityId: string, extra: Row = {}) =>
        (t.handoffs![id] = { id, group_id: 'g', entity, entity_id: entityId, occurrence_date: null, from_member: from, to_member: to, status: 'pending', closed: false, decided_at: null, ...extra });
      const task = (id: string, list: string, assignee: string, extra: Row = {}) =>
        (t.tasks![id] = { id, group_id: 'g', list_id: list, parent_id: null, title: id, assignee_member_id: assignee, completed_at: null, deleted_at: null, ...extra });
      task('t-m1', 'l', M.member);
      task('t-m2', 'l', M.member);
      task('t-m3', 'l', M.member);
      task('t-m4', 'l', M.member);
      task('t-mr', 'l-r', M.member);
      task('t-mdel', 'l', M.member, { deleted_at: '2026-10-01T00:00:00Z' });
      t.events!['ev-mem'] = { id: 'ev-mem', group_id: 'g', title: 'x', audience: 'group', responsible_member_id: M.member, deleted_at: null };
      t.event_overrides!.o2 = { ...t.event_overrides!.o2!, responsible_member_id: M.member };
      h('h-task', M.member, M.admin, 'tasks', 't-m1'); // od niej
      h('h-list', M.member, M.admin, 'lists', 'l-shop2'); // zakupy, za które odpowiada
      h('h-series', M.member, M.admin, 'events', 'ev-mem');
      h('h-day', M.member, M.admin, 'events', 'ev-resp', { occurrence_date: '2026-10-21' }); // termin z wyjątkiem: ona
      h('h-r', M.owner, M.member, 'tasks', 't-r'); // do niej, na liście „Wybrane osoby” (dostęp wraca wcześniej)
      h('h-r-no', M.member, M.admin, 'tasks', 't-mr'); // admin nie widzi listy „Wybrane osoby”
      h('h-moved', M.member, M.admin, 'tasks', 't-m2'); // zadanie zmieni osobę w czasie usunięcia
      h('h-gone', 'm-gone', M.member, 'tasks', 't-gone'); // nadawcy już nie ma
      h('h-child', M.member, M.child, 'tasks', 't-m3'); // odbiorca to dziecko
      h('h-profile', M.member, M.profile, 'tasks', 't-m3', { status: 'declined' }); // odbiorca bez konta (niżej: anulowane z usunięciem)
      h('h-busy', M.member, M.admin, 'tasks', 't-m4'); // w czasie usunięcia ktoś inny przekazał tę rzecz
      h('h-del', M.member, M.admin, 'tasks', 't-mdel'); // zadanie w koszu
      h('h-old', M.member, M.admin, 'tasks', 't-m1', { status: 'cancelled', decided_at: '2026-10-01T00:00:00Z' }); // anulowane wcześniej
      const sid = scopeRowId(M.member);
      t.my_day_scopes = { [sid]: { id: sid, group_id: 'g', member_id: M.member, scope: 'mine', deleted_at: null }, x: { id: 'x', group_id: 'g', member_id: M.admin, scope: 'mine', deleted_at: null } };
      applyOnServer(t, U.owner, del('group_members', M.member), AT);
      // N-87: zakres do kosza (nagrobek), nie skasowany; cudzy bez zmian.
      expect(t.my_day_scopes[sid]).toMatchObject({ scope: 'mine', deleted_at: AT });
      expect(t.my_day_scopes.x!.deleted_at).toBeNull();
      t.tasks!['t-m2'] = { ...t.tasks!['t-m2']!, assignee_member_id: M.owner };
      h('h-busy2', M.owner, M.admin, 'tasks', 't-m4');
      t.handoffs!['h-profile'] = { ...t.handoffs!['h-profile']!, status: 'cancelled', decided_at: AT };
      applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
      const st = Object.fromEntries(Object.entries(t.handoffs!).map(([k, x]) => [k, x.status]));
      expect(st).toMatchObject({ h: 'pending', 'h-task': 'pending', 'h-list': 'pending', 'h-series': 'pending', 'h-day': 'pending', 'h-r': 'pending', 'h-busy2': 'pending' });
      expect(st).toMatchObject({ 'h-r-no': 'cancelled', 'h-moved': 'cancelled', 'h-gone': 'cancelled', 'h-child': 'cancelled', 'h-profile': 'cancelled', 'h-busy': 'cancelled', 'h-del': 'cancelled', 'h-old': 'cancelled' });
      expect(t.handoffs!['h-task']!.decided_at).toBeNull();
      expect(t.object_members!['l-r:m-m']!.deleted_at).toBeNull();
      expect(t.object_members!['l-r:m-a']!.deleted_at).toBe('2026-10-01T00:00:00Z');
      expect(t.my_day_scopes[sid]!.deleted_at).toBeNull();
      // Bez tabel przekazań i zakresów (świeży serwer) — nic do zrobienia.
      const bare = world();
      delete bare.handoffs;
      delete bare.object_members;
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

/**
 * Testy mutacyjne (nocny przebieg 38237696587): scenariusze, które rozróżniają subtelne warunki modelu. Oczekiwania z SQL
 * (migracje w supabase/migrations), nie z kodu modelu.
 */
describe('model reguł serwera — kontrakt kolumn, długości, unikalność', () => {
  // Kopia private.sync_entities (zgodność modelu z bazą pilnuje tests/db/rules-vs-sql.test.ts, więc ta kopia jest przypięta do SQL).
  const EXPECTED_SYNC_ENTITIES = {
    groups: { pk: 'id', insert: [], patch: ['name', 'color'], softDelete: false },
    group_members: { pk: 'member_id', insert: ['member_id', 'group_id', 'display_name', 'color', 'role'], patch: ['display_name', 'color', 'role', 'week_a'], softDelete: true },
    lists: { pk: 'id', insert: ['id', 'group_id', 'kind', 'name', 'visibility', 'sort_key', 'due_date', 'due_time', 'responsible_member_id', 'staples'], patch: ['name', 'visibility', 'sort_key', 'due_date', 'due_time', 'responsible_member_id', 'staples'], softDelete: true },
    tasks: {
      pk: 'id',
      insert: ['id', 'group_id', 'list_id', 'parent_id', 'title', 'note', 'sort_key', 'assignee_member_id', 'deadline_mode', 'due_date', 'due_time', 'start_date', 'completed_at', 'event_id', 'occurrence_date', 'rollover', 'series_id', 'repeat', 'category', 'cycle_date'],
      patch: ['title', 'note', 'sort_key', 'assignee_member_id', 'deadline_mode', 'due_date', 'due_time', 'start_date', 'completed_at', 'event_id', 'occurrence_date', 'rollover', 'repeat', 'category', 'cycle_date'],
      softDelete: true,
    },
    events: { pk: 'id', insert: ['id', 'group_id', 'title', 'note', 'start_date', 'start_time', 'end_time', 'rrule', 'audience', 'responsible_member_id', 'location', 'kind', 'days', 'duration_min'], patch: ['title', 'note', 'start_date', 'start_time', 'end_time', 'rrule', 'audience', 'responsible_member_id', 'location', 'days', 'duration_min'], softDelete: true },
    event_participants: { pk: 'id', insert: ['id', 'event_id', 'member_id', 'group_id'], patch: [], softDelete: true },
    event_overrides: { pk: 'id', insert: ['id', 'event_id', 'group_id', 'occurrence_date', 'cancelled', 'start_date', 'start_time', 'end_time', 'title', 'responsible_member_id', 'all_day', 'responsible_cleared', 'days', 'duration_min'], patch: ['cancelled', 'start_date', 'start_time', 'end_time', 'title', 'responsible_member_id', 'all_day', 'responsible_cleared', 'days', 'duration_min'], softDelete: true },
    event_rsvps: { pk: 'id', insert: ['id', 'group_id', 'event_id', 'occurrence_date', 'member_id', 'answer'], patch: ['answer'], softDelete: true },
    event_task_series: { pk: 'id', insert: ['id', 'group_id', 'event_id', 'list_id', 'title'], patch: ['event_id', 'title'], softDelete: true },
    handoffs: { pk: 'id', insert: ['id', 'group_id', 'entity', 'entity_id', 'occurrence_date', 'to_member'], patch: ['status', 'closed'], softDelete: false },
    my_day_scopes: { pk: 'id', insert: ['id', 'group_id', 'member_id', 'scope'], patch: ['scope'], softDelete: true },
    shopping_trips: { pk: 'id', insert: ['id', 'group_id', 'list_id', 'planned_date', 'done_at'], patch: [], softDelete: true },
  };

  it('kolumny i klucze encji = private.sync_entities', () => {
    expect(SYNC_ENTITIES).toEqual(EXPECTED_SYNC_ENTITIES);
  });

  const x = (n: number) => 'x'.repeat(n);
  const L = config.lengths;
  const cases: [string, string, string, number, number, string][] = [
    ['groups', 'g', 'name', 1, L.GROUP_NAME, U.owner],
    ['group_members', M.member, 'display_name', 1, config.profile.NAME_MAX_LENGTH, U.member],
    ['lists', 'l', 'name', 1, L.LIST_NAME, U.owner],
    ['tasks', 't', 'title', 1, L.TASK_TITLE, U.owner],
    ['tasks', 't', 'note', 0, L.NOTE, U.owner],
    ['events', 'ev', 'title', 1, L.EVENT_TITLE, U.owner],
    ['events', 'ev', 'note', 0, L.NOTE, U.owner],
    ['events', 'ev', 'location', 1, config.events.LOCATION_MAX_LENGTH, U.owner],
    ['event_overrides', 'o', 'title', 1, L.EVENT_TITLE, U.owner],
    ['event_task_series', 's', 'title', 1, L.TASK_TITLE, U.owner],
  ];
  it.each(cases)('%s.%s: granice długości', (entity, id, col, min, max, user) => {
    expect(v(user, patch(entity, id, { [col]: x(max) }))).toBe('ok');
    expect(v(user, patch(entity, id, { [col]: x(max + 1) }))).toBe('invalid:23514');
    expect(v(user, patch(entity, id, { [col]: x(min) }))).toBe('ok');
    expect(v(user, patch(entity, id, { [col]: min > 0 ? x(min - 1) : x(min) }))).toBe(min > 0 ? 'invalid:23514' : 'ok');
  });

  it('unikalność: konflikt tylko przy zgodności wszystkich kolumn indeksu', () => {
    const ov = (event_id: string, occurrence_date: string) => create('event_overrides', { event_id, occurrence_date, cancelled: true });
    expect(v(U.member, ov('ev-resp', '2026-10-14'))).toBe('invalid:23505');
    expect(v(U.member, ov('ev', '2026-10-14'))).toBe('ok'); // inne wydarzenie, ta sama data
    expect(v(U.member, ov('ev-resp', '2026-10-28'))).toBe('ok'); // to samo wydarzenie, inna data
    const pa = (event_id: string, member_id: string) => create('event_participants', { event_id, member_id });
    expect(v(U.member, pa('ev-m', M.child))).toBe('invalid:23505');
    expect(v(U.member, pa('ev', M.child))).toBe('ok'); // ta sama osoba, inne wydarzenie
    expect(v(U.member, pa('ev-m', M.admin))).toBe('ok'); // to samo wydarzenie, inna osoba
    const rs = (event_id: string, occurrence_date: string, member_id: string) => create('event_rsvps', { event_id, occurrence_date, member_id, answer: 'yes' });
    expect(v(U.member, rs('ev', '2026-10-07', M.member))).toBe('invalid:23505');
    expect(v(U.member, rs('ev-m', '2026-10-07', M.member))).toBe('ok'); // inne wydarzenie
    expect(v(U.member, rs('ev', '2026-10-14', M.member))).toBe('ok'); // inna data
    expect(v(U.admin, rs('ev', '2026-10-07', M.admin))).toBe('ok'); // inna osoba
    const h = (entity: string, entity_id: string, to: string, extra: Row = {}) => create('handoffs', { entity, entity_id, to_member: to, ...extra });
    expect(v(U.owner, h('tasks', 't-owner', M.admin))).toBe('invalid:23505');
    expect(v(U.owner, h('lists', 't-owner', M.admin))).not.toBe('invalid:23505'); // inna encja, ten sam identyfikator
    expect(v(U.owner, h('tasks', 't-r', M.member))).toBe('ok'); // inny identyfikator
    const w = world();
    w.handoffs!.h2 = { ...w.handoffs!.h!, id: 'h2', entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-28' };
    expect(v(U.owner, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-28' }), w)).toBe('invalid:23505');
    expect(v(U.owner, h('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-21' }), w)).not.toBe('invalid:23505'); // inna data
    // Rozstrzygnięte przekazanie nie blokuje nowego (indeks częściowy: tylko oczekujące).
    const w2 = world();
    w2.handoffs!.h = { ...w2.handoffs!.h!, status: 'accepted' };
    expect(v(U.owner, h('tasks', 't-owner', M.admin), w2)).toBe('ok');
  });
});

describe('model reguł serwera — warunki szczegółowe (nocne testy mutacyjne)', () => {
  const AT = '2026-10-07T08:00:00.000Z';
  const task = (extra: Row = {}) => create('tasks', { list_id: 'l', title: 'x', ...extra });
  const run = (user: string, op: NewOp, t = world()) => {
    expect(serverVerdict(t, user, op)).toBeNull();
    applyOnServer(t, user, op, AT);
    return t;
  };

  it('pierwszy zbędny klucz: krótsze nazwy najpierw, potem alfabetycznie (jak jsonb)', () => {
    expect(v(U.owner, task({ ab: 1, bb: 2, cb: 3 }))).toBe('invalid_field:ab');
    expect(v(U.owner, task({ cb: 3, bb: 2, ab: 1 }))).toBe('invalid_field:ab');
    expect(v(U.owner, task({ zz: 1, a: 2 }))).toBe('invalid_field:a');
    expect(v(U.owner, patch('tasks', 't', { cd: 1, ab: 2, ef: 3 }))).toBe('invalid_field:ab');
  });

  it('członkostwo: usunięty członek nie jest członkiem; członek innej grupy też nie', () => {
    expect(v('u-gone', task())).toBe('forbidden');
    expect(v('u-gone', create('lists', { kind: 'tasks', name: 'x' }))).toBe('forbidden'); // usunięty członek nie zakłada list
    expect(v(U.stranger, task())).toBe('forbidden');
    expect(v(U.member, task())).toBe('ok');
  });

  it('widoczność listy: prywatna tylko twórca; „Wybrane osoby” tylko żywy wpis tej listy i tej osoby', () => {
    const inPrivate = (extra: Row = {}) => create('tasks', { list_id: 'l-p', title: 'x', ...extra });
    expect(v(U.admin, inPrivate())).toBe('ok'); // twórca
    expect(v(U.owner, inPrivate())).toBe('forbidden');
    const w = world();
    const share = (k: string, row: Row) => void (w.object_members![k] = { group_id: 'g', deleted_at: null, ...row });
    share('p1', { scope_entity: 'lists', scope_id: 'l-p', member_id: M.member }); // udostępnienie nie otwiera listy prywatnej
    expect(v(U.member, inPrivate(), w)).toBe('forbidden');
    const r = (extra: Row = {}) => create('tasks', { list_id: 'l-r', title: 'x', ...extra });
    expect(v(U.admin, r(), w)).toBe('forbidden'); // wpis admina w świecie jest usunięty
    share('r1', { scope_entity: 'lists', scope_id: 'l', member_id: M.admin }); // inna lista
    share('r2', { scope_entity: 'events', scope_id: 'l-r', member_id: M.admin }); // inny rodzaj obiektu
    share('r3', { scope_entity: 'lists', scope_id: 'l-r', member_id: M.owner }); // inna osoba
    expect(v(U.admin, r(), w)).toBe('forbidden');
    expect(v(U.member, r(), w)).toBe('ok'); // żywy wpis
    share('r4', { scope_entity: 'lists', scope_id: 'l-r', member_id: M.admin });
    expect(v(U.admin, r(), w)).toBe('ok');
  });

  it('lista, której nie widzę, jest dla mnie „nie ma” (RLS SELECT)', () => {
    expect(v(U.member, patch('lists', 'l-p', { name: 'y' }))).toBe('not_found');
    expect(v(U.owner, del('lists', 'l-p'))).toBe('not_found');
    expect(v(U.admin, patch('lists', 'l-p', { name: 'y' }))).toBe('ok');
  });

  it('osoba odpowiedzialna musi być żywym dorosłym tej grupy', () => {
    const ev = (responsible_member_id: string) => create('events', { title: 'x', audience: 'group', responsible_member_id });
    expect(v(U.member, ev(M.admin))).toBe('ok');
    expect(v(U.member, ev(M.stranger))).toBe('invalid_member'); // z innej grupy
    expect(v(U.member, ev('m-gone'))).toBe('invalid_member'); // usunięta
    expect(v(U.member, ev(M.profile))).toBe('invalid_member'); // dziecko
    const ov = (responsible_member_id: string) => create('event_overrides', { event_id: 'ev', occurrence_date: '2026-10-21', responsible_member_id });
    expect(v(U.member, ov(M.stranger))).toBe('invalid_member');
    expect(v(U.member, ov(M.admin))).toBe('ok');
    const list = (responsible_member_id: string) => create('lists', { kind: 'shopping', name: 'x', responsible_member_id });
    expect(v(U.member, list(M.stranger))).toBe('invalid_member');
  });

  it('zadanie: odhaczenie przez dorosłego nie wymaga „swojego”; dziecko tylko swoje', () => {
    const done = { completed_at: '2026-10-07T10:00:00Z' };
    expect(v(U.member, patch('tasks', 't', done))).toBe('ok');
    expect(v(U.owner, patch('tasks', 't-child', done))).toBe('ok');
    expect(v(U.admin, patch('tasks', 't-member', done))).toBe('ok');
    expect(v(U.child, patch('tasks', 't-child', { completed_at: null }))).toBe('ok'); // jedno pole: odhaczenie bez innych zmian
    expect(v(U.child, patch('tasks', 't-child', { ...done, title: 'inny' }))).toBe('forbidden:child');
  });

  it('przywrócenie podzadania: tylko pod usuniętym rodzicem odrzucone; zwykła zmiana żywego podzadania — nie', () => {
    const w = world();
    const put = (id: string, row: Row) => void (w.tasks![id] = { id, group_id: 'g', list_id: 'l', parent_id: null, title: id, assignee_member_id: null, completed_at: null, deleted_at: null, ...row });
    put('s-live', { parent_id: 't', deleted_at: '2026-10-01T00:00:00Z' });
    put('s-orphan', { parent_id: 't-del' });
    expect(v(U.member, del('tasks', 's-live', 'restore'), w)).toBe('ok'); // rodzic żyje
    expect(v(U.member, patch('tasks', 's-orphan', { title: 'y' }), w)).toBe('ok'); // żywe podzadanie pod usuniętym rodzicem
    expect(v(U.member, del('tasks', 's-orphan'), w)).toBe('ok');
    put('top-deleted', { deleted_at: '2026-10-01T00:00:00Z' });
    expect(v(U.member, del('tasks', 'top-deleted', 'restore'), w)).toBe('ok');
  });

  it('usunięcie żywego zadania z usuniętej listy jest dozwolone; zmiana — nie', () => {
    const w = world();
    w.tasks!.live = { id: 'live', group_id: 'g', list_id: 'l-del', parent_id: null, title: 'x', assignee_member_id: null, completed_at: null, deleted_at: null };
    expect(v(U.member, del('tasks', 'live'), w)).toBe('ok');
    expect(v(U.member, patch('tasks', 'live', { title: 'y' }), w)).toBe('deleted:list');
  });

  it('osoba przypisana: sprawdzana tylko przy zmianie (zadanie z osobą bez dostępu można dalej edytować)', () => {
    const w = world();
    w.tasks!.hid = { id: 'hid', group_id: 'g', list_id: 'l-p', parent_id: null, title: 'x', assignee_member_id: M.member, completed_at: null, deleted_at: null };
    expect(v(U.admin, patch('tasks', 'hid', { title: 'y' }), w)).toBe('ok');
    expect(v(U.admin, patch('tasks', 'hid', { assignee_member_id: M.member }), w)).toBe('ok'); // ta sama wartość
    expect(v(U.admin, patch('tasks', 'hid', { assignee_member_id: M.owner }), w)).toBe('invalid_assignee');
    expect(v(U.admin, create('tasks', { list_id: 'l-p', title: 'x', assignee_member_id: M.member }), w)).toBe('invalid_assignee');
    expect(v(U.admin, create('tasks', { list_id: 'l-p', title: 'x', assignee_member_id: null }), w)).toBe('ok');
  });

  it('dziecko dopisuje do zakupów tylko produkt: każde inne pole zamyka drogę', () => {
    const item = (extra: Row = {}) => create('tasks', { list_id: 'l-shop', title: 'Mleko', ...extra });
    expect(v(U.child, item())).toBe('ok');
    expect(v(U.child, item({ deadline_mode: 'none' }))).toBe('ok');
    const fields: Row = {
      parent_id: 't-shop', assignee_member_id: M.child, due_date: '2026-10-08', due_time: '10:00', start_date: '2026-10-07', completed_at: '2026-10-07T10:00:00Z',
      event_id: 'ev', occurrence_date: '2026-10-07', series_id: 's', repeat: 'FREQ=DAILY', note: 'uwaga', deadline_mode: 'own',
    };
    for (const [k, val] of Object.entries(fields)) expect([k, v(U.child, item({ [k]: val }))]).toEqual([k, 'forbidden:child']);
    expect(v(U.child, create('tasks', { list_id: 'l', title: 'Mleko' }))).toBe('forbidden:child'); // nie lista zakupów
  });

  it('wyjście członka: tylko jego oczekujące przekazania i tylko jego prywatne listy w tej grupie', () => {
    const t = world();
    const ho = (id: string, row: Row) => void (t.handoffs![id] = { id, group_id: 'g', entity: 'tasks', entity_id: 't', occurrence_date: null, from_member: M.owner, to_member: M.admin, status: 'pending', closed: false, decided_at: null, ...row });
    ho('h-other', {}); // nie dotyczy odchodzącego
    ho('h-from', { from_member: M.member, to_member: M.admin, entity_id: 't-member' });
    ho('h-to', { to_member: M.member, entity_id: 't-owner' });
    ho('h-foreign', { group_id: 'g2', from_member: M.member }); // inna grupa
    ho('h-accepted', { from_member: M.member, status: 'accepted' });
    const L = (id: string, row: Row) => void (t.lists![id] = { id, group_id: 'g', kind: 'tasks', name: id, visibility: 'private', owner_member_id: M.member, deleted_at: null, ...row });
    L('lp-mine', {});
    L('lp-group-vis', { visibility: 'group' });
    L('lp-other-owner', { owner_member_id: M.admin });
    L('lp-other-group', { group_id: 'g2' });
    L('lp-old-del', { deleted_at: '2026-09-01T00:00:00Z' });
    t.tasks!['tk-mine'] = { id: 'tk-mine', group_id: 'g', list_id: 'lp-mine', parent_id: null, title: 'x', deleted_at: null };
    const om = (k: string, row: Row) => void (t.object_members![k] = { group_id: 'g', scope_entity: 'lists', scope_id: 'l-r', member_id: M.member, deleted_at: null, ...row });
    om('om-other', { member_id: M.admin });
    om('om-old', { deleted_at: '2026-09-02T00:00:00Z' });
    run(U.member, del('group_members', M.member), t);
    const st = (id: string) => t.handoffs![id]!.status;
    expect(['h', 'h-other', 'h-from', 'h-to', 'h-foreign', 'h-accepted'].map(st)).toEqual(['cancelled', 'pending', 'cancelled', 'cancelled', 'pending', 'accepted']);
    expect(t.handoffs!['h-other']!.decided_at).toBeNull();
    expect(t.handoffs!['h-from']!.decided_at).toBe(AT);
    const del_ = (id: string) => t.lists![id]!.deleted_at;
    expect(['lp-mine', 'lp-group-vis', 'lp-other-owner', 'lp-other-group', 'lp-old-del'].map(del_)).toEqual([AT, null, null, null, '2026-09-01T00:00:00Z']);
    expect(t.tasks!['tk-mine']!.deleted_at).toBe(AT);
    expect(['l-r:m-m', 'om-other', 'om-old'].map((k) => t.object_members![k]!.deleted_at)).toEqual([AT, null, '2026-09-02T00:00:00Z']);
  });

  it('powrót członka: tylko to, co ma znacznik jego wyjścia', () => {
    const t = world();
    const LEFT = '2026-10-05T00:00:00Z';
    t.group_members![M.member] = { ...t.group_members![M.member]!, deleted_at: LEFT };
    const L = (id: string, row: Row) => void (t.lists![id] = { id, group_id: 'g', kind: 'tasks', name: id, visibility: 'private', owner_member_id: M.member, deleted_at: LEFT, ...row });
    L('lp-same', {}); // usunięta z członkiem
    L('lp-later', { deleted_at: '2026-10-06T00:00:00Z' });
    L('lp-earlier', { deleted_at: '2026-10-04T00:00:00Z' }); // usunięta wcześniej, sama
    L('lp-live', { deleted_at: null });
    L('lp-other-owner', { owner_member_id: M.admin });
    L('lp-group', { visibility: 'group' });
    L('lp-other-group', { group_id: 'g2' });
    const om = (k: string, row: Row) => void (t.object_members![k] = { group_id: 'g', scope_entity: 'lists', scope_id: 'l-r', member_id: M.member, deleted_at: LEFT, ...row });
    om('om-back', {});
    om('om-other-time', { deleted_at: '2026-09-01T00:00:00Z' });
    om('om-other-member', { member_id: M.admin });
    om('om-live', { deleted_at: null });
    const ho = (id: string, row: Row) => {
      const h = { id, group_id: 'g', entity: 'tasks', entity_id: `tk-${id}`, occurrence_date: null, from_member: M.member, to_member: M.admin, status: 'cancelled', closed: false, decided_at: LEFT, ...row };
      t.tasks![`tk-${id}`] = { id: `tk-${id}`, group_id: 'g', list_id: 'l', parent_id: null, title: id, assignee_member_id: h.from_member, completed_at: null, deleted_at: null };
      t.handoffs![id] = h;
    };
    ho('hb-ok', {});
    ho('hb-to', { from_member: M.owner, to_member: M.member });
    ho('hb-pending', { status: 'pending', decided_at: null });
    ho('hb-declined', { status: 'declined' });
    ho('hb-time', { decided_at: '2026-09-01T00:00:00Z' });
    ho('hb-uninvolved', { from_member: M.owner, to_member: M.admin });
    ho('hb-group', { group_id: 'g2' });
    applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
    const d = (id: string) => t.lists![id]!.deleted_at;
    expect(['lp-same', 'lp-later', 'lp-earlier', 'lp-live', 'lp-other-owner', 'lp-group', 'lp-other-group'].map(d)).toEqual([null, null, '2026-10-04T00:00:00Z', null, LEFT, LEFT, LEFT]);
    expect(['om-back', 'om-other-time', 'om-other-member', 'om-live'].map((k) => t.object_members![k]!.deleted_at)).toEqual([null, '2026-09-01T00:00:00Z', LEFT, null]);
    const hs = (id: string) => t.handoffs![id]!.status;
    expect(['hb-ok', 'hb-to', 'hb-pending', 'hb-declined', 'hb-time', 'hb-uninvolved', 'hb-group'].map(hs)).toEqual(['pending', 'pending', 'pending', 'declined', 'cancelled', 'cancelled', 'cancelled']);
  });
});

describe('model reguł serwera — członkowie, przekazania, zakupy, kaskady (nocne testy mutacyjne, część 2)', () => {
  const AT = '2026-10-07T08:00:00.000Z';
  const row = (t: { [e: string]: { [k: string]: Row } }, e: string, id: string, r: Row) => void ((t[e] ??= {})[id] = { id, deleted_at: null, ...r });
  const withNoAccount = () => {
    const t = world();
    // Dorosły bez konta (np. po odłączeniu): nie może dostać przekazania ani zmienić roli na dziecko.
    t.group_members!['m-noacct'] = { member_id: 'm-noacct', group_id: 'g', user_id: null, role: 'member', display_name: 'Bez konta', color: null, week_a: null, deleted_at: null };
    return t;
  };
  const ho = (entity: string, entity_id: string, to: string, extra: Row = {}) => create('handoffs', { entity, entity_id, to_member: to, ...extra });

  it('przekazanie: odbiorca musi być żywym dorosłym z kontem z tej samej grupy', () => {
    const t = withNoAccount();
    t.tasks!['t-o2'] = { ...t.tasks!['t-owner']!, id: 't-o2' };
    expect(v(U.owner, ho('tasks', 't-o2', M.admin), t)).toBe('ok');
    expect(v(U.owner, ho('tasks', 't-o2', 'm-noacct'), t)).toBe('invalid_member'); // dorosły bez konta
    expect(v(U.owner, ho('tasks', 't-o2', M.stranger), t)).toBe('invalid_member'); // z innej grupy
    expect(v(U.owner, ho('tasks', 't-o2', 'm-gone'), t)).toBe('invalid_member'); // usunięty
    expect(v(U.owner, ho('tasks', 't-o2', M.child), t)).toBe('invalid_member'); // dziecko z kontem, widzi listę
  });

  it('przekazanie: rzecz musi być żywa i z tej samej grupy', () => {
    const t = world();
    row(t, 'lists', 'l-shop-g2', { group_id: 'g2', kind: 'shopping', responsible_member_id: M.owner, visibility: 'group', owner_member_id: M.stranger });
    expect(v(U.owner, ho('tasks', 't2', M.member), t)).toBe('invalid_entity');
    expect(v(U.owner, ho('lists', 'l-shop-g2', M.member), t)).toBe('invalid_entity');
    expect(v(U.owner, ho('lists', 'l-del', M.member), t)).toBe('invalid_entity');
    expect(v(U.owner, ho('events', 'ev2', M.member), t)).toBe('invalid_entity');
  });

  it('przekazanie wydarzenia: osobę terminu wyznacza tylko żywy wyjątek tego wydarzenia', () => {
    const t = world();
    row(t, 'event_overrides', 'o-other-ev', { event_id: 'ev', group_id: 'g', occurrence_date: '2026-10-28', responsible_member_id: M.member, responsible_cleared: false });
    row(t, 'event_overrides', 'o-deleted', { event_id: 'ev-resp', group_id: 'g', occurrence_date: '2026-11-11', responsible_member_id: M.member, responsible_cleared: false, deleted_at: '2026-10-02T00:00:00Z' });
    expect(v(U.owner, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-28' }), t)).toBe('ok');
    expect(v(U.member, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-28' }), t)).toBe('forbidden:not_responsible');
    expect(v(U.owner, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-11-11' }), t)).toBe('ok');
    expect(v(U.member, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-11-11' }), t)).toBe('forbidden:not_responsible');
  });

  it('decyzje stron: odrzucenie tylko przez adresata; zamknięcie przez nadawcę także po rozstrzygnięciu', () => {
    expect(v(U.owner, patch('handoffs', 'h', { status: 'declined' }))).toBe('forbidden');
    expect(v(U.member, patch('handoffs', 'h', { status: 'declined' }))).toBe('ok');
    expect(v(U.owner, patch('handoffs', 'h-done', { closed: true }))).toBe('ok'); // status bez zmiany
    expect(v(U.member, patch('handoffs', 'h-done', { closed: true }))).toBe('forbidden');
    expect(v(U.owner, patch('handoffs', 'h-done', { status: 'cancelled' }))).toBe('invalid_value:status');
  });

  it('obecność: wydarzenie i osoba z tej samej grupy; dorosły za dorosłego bez konta nie może', () => {
    const t = withNoAccount();
    const r = (member: string, event = 'ev') => create('event_rsvps', { event_id: event, occurrence_date: '2026-10-14', member_id: member, answer: 'yes' });
    expect(v(U.member, r(M.member, 'ev2'), t)).toBe('invalid_event');
    expect(v(U.member, r(M.stranger), t)).toBe('invalid_member');
    expect(v(U.member, r('m-noacct'), t)).toBe('forbidden:not_self');
    expect(v(U.member, r(M.profile), t)).toBe('ok');
  });

  it('uczestnik wydarzenia: usunięcie nie sprawdza osoby, przywrócenie sprawdza', () => {
    const t = world();
    row(t, 'event_participants', 'p-g', { event_id: 'ev', group_id: 'g', member_id: 'm-gone' });
    row(t, 'event_participants', 'p-g-del', { event_id: 'ev', group_id: 'g', member_id: 'm-gone', deleted_at: '2026-10-01T00:00:00Z' });
    expect(v(U.member, del('event_participants', 'p-g'), t)).toBe('ok');
    expect(v(U.member, del('event_participants', 'p-g-del', 'restore'), t)).toBe('invalid_member');
    expect(v(U.member, del('event_participants', 'p-gone', 'restore'), t)).toBe('ok');
  });

  it('seria zadań przy wydarzeniu: usunięcie, zmiana i dalsze życie nie zależą od rodziców, którzy już zniknęli', () => {
    const t = world();
    row(t, 'event_task_series', 's-in-del-list', { event_id: 'ev', group_id: 'g', list_id: 'l-del', title: 's' });
    row(t, 'event_task_series', 's-of-del-event', { event_id: 'ev-del', group_id: 'g', list_id: 'l', title: 's' });
    expect(v(U.member, del('event_task_series', 's-in-del-list'), t)).toBe('ok');
    expect(v(U.member, patch('event_task_series', 's-in-del-list', { title: 'y' }), t)).toBe('ok'); // lista zniknęła już po utworzeniu serii
    expect(v(U.member, patch('event_task_series', 's-of-del-event', { title: 'y' }), t)).toBe('ok');
    expect(v(U.member, patch('event_task_series', 's-of-del-event', { event_id: 'ev' }), t)).toBe('ok');
    expect(v(U.member, patch('event_task_series', 's', { event_id: 'ev-del' }), t)).toBe('deleted:event');
  });

  it('zrobione zakupy: lista musi istnieć, żyć i być listą zakupów tej grupy; usunięcie wpisu nie sprawdza listy', () => {
    const t = world();
    row(t, 'lists', 'l-shop-del', { group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, deleted_at: '2026-10-01T00:00:00Z' });
    row(t, 'shopping_trips', 'tr1', { group_id: 'g', list_id: 'l-shop-del', done_at: AT });
    const trip = (list_id: string) => create('shopping_trips', { list_id, done_at: AT });
    expect(v(U.member, trip('nie-ma'), t)).toBe('invalid_list');
    expect(v(U.member, trip('l-shop-del'), t)).toBe('invalid_list');
    expect(v(U.member, trip('l-shop'), t)).toBe('ok');
    expect(v(U.member, del('shopping_trips', 'tr1'), t)).toBe('ok');
  });

  it('osoba od zakupów: widoczność sprawdzana tylko przy zmianie osoby albo widoczności listy', () => {
    const t = world();
    row(t, 'lists', 'l-shop-x', { group_id: 'g', kind: 'shopping', visibility: 'private', owner_member_id: M.admin, responsible_member_id: M.member });
    expect(v(U.admin, patch('lists', 'l-shop-x', { name: 'nowa' }), t)).toBe('ok');
    expect(v(U.admin, patch('lists', 'l-shop-x', { responsible_member_id: M.member }), t)).toBe('ok');
    expect(v(U.admin, patch('lists', 'l-shop-x', { visibility: 'private' }), t)).toBe('ok');
    expect(v(U.admin, patch('lists', 'l-shop-x', { sort_key: 'b1', responsible_member_id: M.owner }), t)).toBe('invalid_member');
  });

  it('członkowie: dorosły bez konta można zrobić dzieckiem; drugi właściciel i drugi admin', () => {
    const t = withNoAccount();
    t.group_members!['m-o2'] = { member_id: 'm-o2', group_id: 'g', user_id: 'u-o2', role: 'owner', display_name: 'O2', color: null, week_a: null, deleted_at: null };
    t.group_members!['m-a2'] = { member_id: 'm-a2', group_id: 'g', user_id: 'u-a2', role: 'admin', display_name: 'A2', color: null, week_a: null, deleted_at: null };
    expect(v(U.owner, patch('group_members', 'm-noacct', { role: 'child' }), t)).toBe('ok');
    expect(v(U.owner, patch('group_members', 'm-o2', { role: 'admin' }), t)).toBe('ok'); // inny właściciel: to nie „zdegradowanie siebie”
    expect(v(U.owner, patch('group_members', M.owner, { role: 'admin' }), t)).toBe('forbidden:owner_cannot_demote_self');
    expect(v(U.admin, del('group_members', 'm-a2'), t)).toBe('forbidden:role');
    expect(v(U.admin, del('group_members', 'm-o2'), t)).toBe('forbidden:role');
    expect(v(U.admin, del('group_members', M.member), t)).toBe('ok');
    expect(v(U.member, patch('group_members', M.profile, { display_name: 'Y' }), t)).toBe('forbidden'); // profil dziecka zmienia tylko owner/admin
    expect(v(U.member, patch('group_members', M.profile, { color: '#00aa00' }), t)).toBe('forbidden');
    expect(v(U.admin, patch('group_members', M.profile, { color: '#00aa00' }), t)).toBe('ok');
    expect(v(U.member, del('group_members', 'm-o2'), t)).toBe('forbidden:role');
  });

  it('grupa w koszu: zmiana i usunięcie czegokolwiek w niej jest odrzucone', () => {
    const t = world();
    expect(v(U.owner, patch('tasks', 't3', { title: 'y' }), t)).toBe('deleted:group');
    expect(v(U.owner, patch('lists', 'l3', { name: 'y' }), t)).toBe('deleted:group');
    expect(v(U.owner, patch('groups', 'g3', { name: 'y' }), t)).toBe('deleted:group');
  });

  it('usunięcie i przywrócenie są idempotentne bez sprawdzania uprawnień (nic się nie zmienia)', () => {
    expect(v(U.child, del('tasks', 't-del'))).toBe('ok'); // już usunięte
    expect(v(U.child, del('tasks', 't', 'restore'))).toBe('ok'); // już żywe
    expect(v(U.child, del('tasks', 't'))).toBe('forbidden:child');
  });

  it('kaskada serii zadań: tylko serie tego wydarzenia albo tej listy, tylko usunięte razem z nim', () => {
    const t = world();
    row(t, 'event_task_series', 's-other-ev', { event_id: 'ev-m', group_id: 'g', list_id: 'l', title: 's' });
    row(t, 'event_task_series', 's-other-list', { event_id: 'ev', group_id: 'g', list_id: 'l-r', title: 's' });
    row(t, 'event_task_series', 's-of-del-ev', { event_id: 'ev-del', group_id: 'g', list_id: 'l', title: 's' });
    applyOnServer(t, U.member, del('events', 'ev'), AT);
    expect([t.event_task_series!.s!.deleted_at, t.event_task_series!['s-other-ev']!.deleted_at, t.event_task_series!['s-other-list']!.deleted_at]).toEqual([AT, null, AT]);
    applyOnServer(t, U.member, del('events', 'ev-del'), AT); // powtórne usunięcie już usuniętego nic nie kaskaduje
    expect(t.event_task_series!['s-of-del-ev']!.deleted_at).toBeNull();
    applyOnServer(t, U.member, del('lists', 'l-r'), AT);
    expect(t.event_task_series!['s-other-list']!.deleted_at).toBe(AT); // już usunięta razem z wydarzeniem, znacznik bez zmian
    expect(t.event_task_series!['s-other-ev']!.deleted_at).toBeNull();
    const restored = world();
    row(restored, 'event_task_series', 's-late', { event_id: 'ev', group_id: 'g', list_id: 'l', title: 's', deleted_at: '2026-09-01T00:00:00Z' });
    applyOnServer(restored, U.member, del('events', 'ev'), AT);
    applyOnServer(restored, U.member, del('events', 'ev', 'restore'), AT);
    expect([restored.event_task_series!.s!.deleted_at, restored.event_task_series!['s-late']!.deleted_at]).toEqual([null, '2026-09-01T00:00:00Z']);
  });

  it('powrót członka: przekazania, które przestały mieć sens, zostają anulowane', () => {
    const LEFT = '2026-10-05T00:00:00Z';
    const t = withNoAccount();
    t.group_members![M.member] = { ...t.group_members![M.member]!, deleted_at: LEFT };
    t.lists!['l-shop-gone'] = { id: 'l-shop-gone', group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.member, deleted_at: null };
    t.lists!['l-shop-moved'] = { id: 'l-shop-moved', group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.owner, deleted_at: null };
    t.lists!['l-shop-deleted'] = { id: 'l-shop-deleted', group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.member, deleted_at: '2026-10-01T00:00:00Z' };
    t.events!['ev-gone-day'] = { id: 'ev-gone-day', group_id: 'g', title: 'x', audience: 'group', responsible_member_id: M.owner, deleted_at: null };
    t.events!['ev-deleted'] = { id: 'ev-deleted', group_id: 'g', title: 'x', audience: 'group', responsible_member_id: M.member, deleted_at: '2026-10-01T00:00:00Z' };
    const h = (id: string, entity: string, entity_id: string, extra: Row = {}) =>
      (t.handoffs![id] = { id, group_id: 'g', entity, entity_id, occurrence_date: null, from_member: M.member, to_member: M.admin, status: 'cancelled', closed: false, decided_at: LEFT, ...extra });
    h('b-list', 'lists', 'l-shop-gone');
    h('b-list-moved', 'lists', 'l-shop-moved');
    h('b-list-del', 'lists', 'l-shop-deleted');
    h('b-event-moved', 'events', 'ev-gone-day');
    h('b-event-del', 'events', 'ev-deleted');
    h('b-noacct', 'lists', 'l-shop-gone', { to_member: 'm-noacct' });
    h('b-dup-date-a', 'events', 'ev-resp', { occurrence_date: '2026-10-21', from_member: M.member });
    h('b-dup-date-b', 'events', 'ev-resp', { occurrence_date: '2026-10-28', from_member: M.owner, to_member: M.admin, status: 'pending', decided_at: null });
    applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
    const st = (id: string) => t.handoffs![id]!.status;
    expect(['b-list', 'b-list-moved', 'b-list-del', 'b-event-moved', 'b-event-del', 'b-noacct'].map(st)).toEqual(['pending', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
    // Oczekujące przekazanie tej samej rzeczy w innym terminie nie blokuje (inny termin = inna rzecz); w tym samym — blokuje.
    expect(st('b-dup-date-a')).toBe('pending');
    t.handoffs!['b-dup-date-b'] = { ...t.handoffs!['b-dup-date-b']!, occurrence_date: '2026-10-21' };
    t.handoffs!['b-dup-date-a'] = { ...t.handoffs!['b-dup-date-a']!, status: 'cancelled', decided_at: LEFT };
    applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), AT);
    expect(st('b-dup-date-a')).toBe('cancelled');
  });

  it('przyjęcie przekazania nie nadpisuje rzeczy, która zmieniła osobę; wyjątki innych wydarzeń są nietknięte', () => {
    const t = world();
    row(t, 'event_overrides', 'ox', { event_id: 'ev', group_id: 'g', occurrence_date: '2026-10-28', responsible_member_id: M.member, responsible_cleared: false });
    row(t, 'handoffs', 'ho1', { group_id: 'g', entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-28', from_member: M.owner, to_member: M.admin, status: 'pending', closed: false });
    applyOnServer(t, U.admin, patch('handoffs', 'ho1', { status: 'accepted' }), AT);
    expect(t.event_overrides!.ox).toMatchObject({ event_id: 'ev', responsible_member_id: M.member });
    expect(t.event_overrides![overrideId('ev-resp', '2026-10-28')]).toMatchObject({ event_id: 'ev-resp', responsible_member_id: M.admin });
    const u = world();
    u.tasks!['t-owner'] = { ...u.tasks!['t-owner']!, assignee_member_id: M.admin }; // zadanie już ma kogoś innego
    applyOnServer(u, U.member, patch('handoffs', 'h', { status: 'accepted' }), AT);
    expect(u.tasks!['t-owner']!.assignee_member_id).toBe(M.admin);
    // Rozstrzygnięte przekazanie (nie „oczekujące”) nie dostaje nowej decyzji ani skutku.
    const d = world();
    applyOnServer(d, U.member, patch('handoffs', 'h-done', { status: 'declined' }), AT);
    expect(d.handoffs!['h-done']).toMatchObject({ status: 'declined' });
    expect(d.handoffs!['h-done']!.decided_at).toBeUndefined();
  });

  it('nowy wiersz dostaje tylko pola nadawane dla swojej encji; usunięcie wydarzenia z godziną nie zmienia liczby dni', () => {
    const t = run(U.member, create('tasks', { list_id: 'l', title: 'x' }));
    expect(t.tasks!.new).not.toHaveProperty('owner_member_id');
    expect(t.tasks!.new).not.toHaveProperty('done_by');
    expect(t.tasks!.new).not.toHaveProperty('from_member');
    const w = world();
    w.events!.ev = { ...w.events!.ev!, start_time: '10:00', days: 3 };
    applyOnServer(w, U.member, del('events', 'ev'), AT);
    expect(w.events!.ev).toMatchObject({ days: 3, deleted_at: AT });
    function run(user: string, op: NewOp) {
      const world_ = world();
      expect(serverVerdict(world_, user, op)).toBeNull();
      applyOnServer(world_, user, op, AT);
      return world_;
    }
  });

  it('polecenie przeniesienia: kopie powstają, a oryginał trafia do kosza; zadania z niewidocznych list są dla mnie „nie ma”', () => {
    const t = world();
    t.groups!.gk = { id: 'gk', name: 'Klasa', deleted_at: null };
    t.group_members!['k-o'] = { member_id: 'k-o', group_id: 'gk', user_id: U.owner, role: 'owner', display_name: 'O', deleted_at: null };
    t.group_members!['k-a'] = { member_id: 'k-a', group_id: 'gk', user_id: U.admin, role: 'admin', display_name: 'A', deleted_at: null };
    t.lists!.lk = { id: 'lk', group_id: 'gk', kind: 'tasks', name: 'Ogólne', visibility: 'group', owner_member_id: 'k-o', deleted_at: null };
    const mv = (task: string): NewOp => ({ kind: 'cmd', cmd: 'move_task_to_group', args: { task_id: task, group_id: 'gk', list: null, tasks: [{ id: 'c', from: task, set: { list_id: 'lk', parent_id: null, title: task } }] } });
    expect(serverVerdict(t, U.admin, mv('t-r'))).toBe('not_found'); // lista „Wybrane osoby”, admin bez dostępu
    expect(serverVerdict(t, U.owner, mv('t-r'))).toBeNull();
    applyOnServer(t, U.owner, mv('t-r'), AT);
    expect(t.tasks!.c).toMatchObject({ group_id: 'gk', list_id: 'lk' });
    expect(t.tasks!['t-r']).toMatchObject({ deleted_at: AT, moved_to: 'c' });
  });

  it('polecenie przeniesienia: całe poddrzewo, także gdy wiersze są w tabeli w odwrotnej kolejności', () => {
    const t = world();
    t.groups!.gk = { id: 'gk', name: 'Klasa', deleted_at: null };
    t.group_members!['k-o'] = { member_id: 'k-o', group_id: 'gk', user_id: U.owner, role: 'owner', display_name: 'O', deleted_at: null };
    t.lists!.lk = { id: 'lk', group_id: 'gk', kind: 'tasks', name: 'Ogólne', visibility: 'group', owner_member_id: 'k-o', deleted_at: null };
    const put = (id: string, parent: string | null) => void (t.tasks![id] = { id, group_id: 'g', list_id: 'l', parent_id: parent, title: id, assignee_member_id: null, completed_at: null, deleted_at: null });
    put('gc', 'c1'); // wnuk przed dzieckiem
    put('c1', 'root');
    put('root', null);
    put('stranger-sub', 'inne');
    put('inne', null);
    const set = (id: string, parent: string | null) => ({ id: `n-${id}`, from: id, set: { list_id: 'lk', parent_id: parent, title: id } });
    const op = (tasks: Row[]): NewOp => ({ kind: 'cmd', cmd: 'move_task_to_group', args: { task_id: 'root', group_id: 'gk', list: null, tasks } });
    expect(serverVerdict(t, U.owner, op([set('root', null), set('c1', 'n-root'), set('gc', 'n-c1')]))).toBeNull();
    expect(serverVerdict(t, U.owner, op([set('root', null), set('stranger-sub', 'n-root')]))).toBe('invalid_value');
    expect(serverVerdict(t, U.owner, op([set('root', null), set('inne', 'n-root')]))).toBe('invalid_value');
  });
});

describe('model reguł serwera — własność zadania przez dziecko i następny termin (nocne testy mutacyjne, część 3)', () => {
  const done = { completed_at: '2026-10-07T10:00:00Z' };
  const putTask = (t: { [e: string]: { [k: string]: Row } }, id: string, r: Row = {}) =>
    void (t.tasks![id] = { id, group_id: 'g', list_id: 'l', parent_id: null, title: id, assignee_member_id: null, completed_at: null, event_id: null, occurrence_date: null, deleted_at: null, ...r });
  const putEvent = (t: { [e: string]: { [k: string]: Row } }, id: string, r: Row = {}) => void (t.events![id] = { id, group_id: 'g', title: id, audience: 'group', responsible_member_id: null, deleted_at: null, ...r });

  it('odhaczanie przez dziecko: wydarzenie — osoba odpowiedzialna, uczestnicy, wyjątki tylko tego wydarzenia, tego dnia, nieusunięte', () => {
    const t = world();
    t.group_members!['m-c2'] = { member_id: 'm-c2', group_id: 'g', user_id: 'u-c2', role: 'child', display_name: 'D2', color: null, week_a: null, deleted_at: null };
    putEvent(t, 'e-resp-child', { audience: 'members', responsible_member_id: M.child });
    putEvent(t, 'e-grp-resp', { audience: 'group', responsible_member_id: M.owner });
    putEvent(t, 'e-gone-grp', { audience: 'group', responsible_member_id: 'm-gone' });
    putTask(t, 'k-resp-child', { event_id: 'e-resp-child', occurrence_date: '2026-10-07' });
    putTask(t, 'k-grp-resp', { event_id: 'e-grp-resp', occurrence_date: '2026-10-07' });
    putTask(t, 'k-gone-grp', { event_id: 'e-gone-grp', occurrence_date: '2026-10-07' });
    t.event_participants!['p-grp-resp'] = { id: 'p-grp-resp', event_id: 'e-grp-resp', group_id: 'g', member_id: M.child, deleted_at: null };
    expect(v(U.child, patch('tasks', 'k-resp-child', done), t)).toBe('ok'); // odpowiedzialne dziecko, bez udziału
    expect(v(U.child, patch('tasks', 'k-grp-resp', done), t)).toBe('forbidden:not_own'); // odpowiada dorosły, wydarzenie dla całej grupy
    expect(v(U.child, patch('tasks', 'k-gone-grp', done), t)).toBe('ok'); // odpowiedzialny odszedł — liczy się cała grupa
    // Uczestnik innego dziecka nie jest uczestnikiem tego wydarzenia.
    expect(v('u-c2', patch('tasks', 't-ev-m', done), t)).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 't-ev-m', done), t)).toBe('ok');
    // Wyjątki: tylko to samo wydarzenie, ten sam dzień i żywe.
    const ov = (id: string, r: Row) => void (t.event_overrides![id] = { id, group_id: 'g', responsible_member_id: M.owner, responsible_cleared: false, deleted_at: null, ...r });
    ov('o-other-event', { event_id: 'ev-m', occurrence_date: '2026-10-07' });
    ov('o-other-day', { event_id: 'ev', occurrence_date: '2026-10-14' });
    ov('o-deleted', { event_id: 'ev', occurrence_date: '2026-10-07', deleted_at: '2026-10-02T00:00:00Z' });
    expect(v(U.child, patch('tasks', 't-ev', done), t)).toBe('ok');
    ov('o-live', { event_id: 'ev', occurrence_date: '2026-10-07' });
    expect(v(U.child, patch('tasks', 't-ev', done), t)).toBe('forbidden:not_own');
  });

  it('odhaczanie przez dziecko: zadanie z brakującym rodzicem, lista nie-zakupowa, za głębokie drzewo', () => {
    const t = world();
    t.lists!['l-tasks-resp'] = { id: 'l-tasks-resp', group_id: 'g', kind: 'tasks', name: 'x', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.child, deleted_at: null };
    putTask(t, 'k-orphan', { parent_id: 'nie-ma' });
    putTask(t, 'k-tasklist', { list_id: 'l-tasks-resp' });
    putTask(t, 'k-gone-event', { assignee_member_id: 'm-gone', event_id: 'ev', occurrence_date: '2026-10-07' });
    expect(v(U.child, patch('tasks', 'k-orphan', done), t)).toBe('forbidden:not_own');
    expect(v(U.child, patch('tasks', 'k-tasklist', done), t)).toBe('forbidden:not_own'); // „osoba od zakupów” liczy się tylko na liście zakupów
    expect(v(U.child, patch('tasks', 'k-gone-event', done), t)).toBe('ok'); // osoba przypisana odeszła — rozstrzyga wydarzenie
    // Osiem kroków w górę: właściciel dziewiątego zadania w łańcuchu już się nie liczy.
    t.tasks!.x8 = { ...t.tasks!.x8!, assignee_member_id: M.child };
    expect(v(U.child, patch('tasks', 't-deep', done), t)).toBe('forbidden:not_own');
    t.tasks!.x7 = { ...t.tasks!.x7!, assignee_member_id: M.child };
    expect(v(U.child, patch('tasks', 't-deep', done), t)).toBe('ok');
  });

  it('następny termin dziecka: źródło tylko z tej samej listy, głównego i powtarzanego; reszta pól kopii zgodna ze źródłem', () => {
    const t = world();
    const put = (id: string, r: Row) => putTask(t, id, { assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-12', repeat: 'FREQ=DAILY', title: 'Łóżko', ...r });
    put('r', {});
    put('r-other-list', { list_id: 'l-p' }); // nie ta lista
    put('r-sub', { parent_id: 't' }); // nie główne
    put('r-norepeat', { repeat: null });
    const next = (id: string, extra: Row = {}) => create('tasks', { list_id: 'l', title: 'Łóżko', deadline_mode: 'own', due_date: '2026-10-13', repeat: 'FREQ=DAILY', assignee_member_id: M.child, ...extra }, 'g', nextId(id));
    expect(v(U.child, next('r'), t)).toBe('ok');
    expect(v(U.child, next('r-other-list'), t)).toBe('forbidden:child');
    expect(v(U.child, next('r-sub'), t)).toBe('forbidden:child');
    expect(v(U.child, next('r-norepeat'), t)).toBe('forbidden:child');
    for (const bad of [{ sort_key: 'zz' }, { note: 'x' }, { start_date: '2026-10-01' }, { completed_at: '2026-10-12T10:00:00Z' }, { event_id: 'ev' }, { occurrence_date: '2026-10-12' }, { series_id: 's' }, { category: 'dom' }, { cycle_date: '2026-10-12' }])
      expect([bad, v(U.child, next('r', bad), t)]).toEqual([bad, 'forbidden:child']);
    expect(v(U.child, next('r', { sort_key: 'a0' }), t)).toBe('ok');
  });

  it('następny termin dziecka: podzadania (czas jak w źródle albo bez), zmiany dozwolone tylko w wymienionych polach', () => {
    const t = world();
    const put = (id: string, r: Row) => putTask(t, id, r);
    put('r', { assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-12', repeat: 'FREQ=DAILY', title: 'Łóżko' });
    put('rs', { parent_id: 'r', title: 'Pościel', deadline_mode: 'inherit' });
    put('rss', { parent_id: 'rs', title: 'Poszewka', deadline_mode: 'own', due_time: '08:00' });
    const c = nextId('r');
    put(c, { assignee_member_id: M.child, deadline_mode: 'own', due_date: '2026-10-13', repeat: 'FREQ=DAILY', title: 'Łóżko' });
    put(nextId('rs'), { parent_id: c, title: 'Pościel', deadline_mode: 'inherit' });
    const sub = (id: string, parent: string, extra: Row = {}) => create('tasks', { list_id: 'l', parent_id: parent, title: 'Poszewka', deadline_mode: 'own', ...extra }, 'g', id);
    expect(v(U.child, sub(nextId('rss'), nextId('rs'), { due_time: '08:00' }), t)).toBe('ok');
    expect(v(U.child, sub(nextId('rss'), nextId('rs')), t)).toBe('ok'); // bez godziny
    expect(v(U.child, sub(nextId('rss'), nextId('rs'), { sort_key: 'zz' }), t)).toBe('forbidden:child');
    // Zmiany: każde pole z listy osobno, ale nic poza nią.
    expect(v(U.child, patch('tasks', c, { due_time: '07:00' }), t)).toBe('ok');
    expect(v(U.child, patch('tasks', c, { cycle_date: '2026-10-13' }), t)).toBe('ok');
    expect(v(U.child, patch('tasks', c, { due_date: '2026-10-14', title: 'inny' }), t)).toBe('forbidden:child');
    expect(v(U.child, patch('tasks', c, { due_date: '2026-10-14', note: 'x' }), t)).toBe('forbidden:child');
    // Podzadanie: tylko zdjęcie i przywrócenie, także zrobione; termin podzadania nie.
    t.tasks![nextId('rs')] = { ...t.tasks![nextId('rs')]!, completed_at: '2026-10-13T08:00:00Z' };
    expect(v(U.child, del('tasks', nextId('rs')), t)).toBe('ok');
    expect(v(U.child, patch('tasks', nextId('rs'), { due_date: '2026-10-14' }), t)).toBe('forbidden:child');
  });

  it('przeniesione zadanie: zwykła zmiana żywego zadania ze wskaźnikiem kopii jest dozwolona; przywrócenie — dopiero po zniknięciu kopii', () => {
    const t = world();
    putTask(t, 'orig', { moved_to: 'copy' });
    putTask(t, 'copy');
    expect(v(U.member, patch('tasks', 'orig', { title: 'y' }), t)).toBe('ok');
    t.tasks!.orig = { ...t.tasks!.orig!, deleted_at: '2026-10-01T00:00:00Z' };
    expect(v(U.member, del('tasks', 'orig', 'restore'), t)).toBe('moved');
    t.tasks!.copy = { ...t.tasks!.copy!, deleted_at: '2026-10-02T00:00:00Z' };
    expect(v(U.member, del('tasks', 'orig', 'restore'), t)).toBe('ok');
    t.tasks!.orig = { ...t.tasks!.orig!, moved_to: null };
    t.tasks!.copy = { ...t.tasks!.copy!, deleted_at: null };
    expect(v(U.member, del('tasks', 'orig', 'restore'), t)).toBe('ok');
  });

  it('seria zadań przy utworzeniu zadania: musi istnieć i być z tej samej grupy', () => {
    const t = world();
    t.event_task_series!['s-g2'] = { id: 's-g2', event_id: 'ev2', group_id: 'g2', list_id: 'l2', title: 's', deleted_at: null };
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', series_id: 's' }), t)).toBe('ok');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', series_id: 's-g2' }), t)).toBe('invalid_series');
    expect(v(U.member, create('tasks', { list_id: 'l', title: 'x', series_id: 'nie-ma' }), t)).toBe('invalid_series');
  });

  it('polecenia przeniesienia: brakujące albo błędne argumenty to invalid_value', () => {
    const t = world();
    t.groups!.gk = { id: 'gk', name: 'Klasa', deleted_at: null };
    t.group_members!['k-o'] = { member_id: 'k-o', group_id: 'gk', user_id: U.owner, role: 'owner', display_name: 'O', deleted_at: null };
    const cmd = (name: 'move_task_to_group' | 'unmove_task', args: Row): NewOp => ({ kind: 'cmd', cmd: name, args });
    const one = [{ id: 'c', from: 't', set: { list_id: 'l', parent_id: null, title: 't' } }];
    expect(serverVerdict(t, U.owner, cmd('move_task_to_group', { task_id: 't', tasks: one }))).toBe('invalid_value'); // bez grupy
    expect(serverVerdict(t, U.owner, cmd('move_task_to_group', { task_id: 't', group_id: 'gk', tasks: 'x' }))).toBe('invalid_value'); // nie tablica
    expect(serverVerdict(t, U.owner, cmd('move_task_to_group', { task_id: 't', group_id: 'gk' }))).toBe('invalid_value');
    expect(serverVerdict(t, U.owner, cmd('move_task_to_group', { group_id: 'gk', tasks: one }))).toBe('invalid_value'); // bez zadania
    expect(serverVerdict(t, U.owner, cmd('unmove_task', { task_id: 't' }))).toBe('invalid_value'); // bez kopii
    expect(serverVerdict(t, U.owner, cmd('unmove_task', { copy_id: 'c' }))).toBe('invalid_value');
  });

  it('przekazanie wydarzenia: odbiorca musi być żywym dorosłym z kontem z tej samej grupy (wydarzenie nie sprawdza widoczności listy)', () => {
    const t = world();
    t.group_members!['m-noacct'] = { member_id: 'm-noacct', group_id: 'g', user_id: null, role: 'member', display_name: 'B', color: null, week_a: null, deleted_at: null };
    const ev = (to: string) => create('handoffs', { entity: 'events', entity_id: 'ev-resp', to_member: to });
    expect(v(U.owner, ev(M.admin), t)).toBe('ok');
    for (const to of [M.stranger, 'm-gone', M.child, M.profile, 'm-noacct', 'nikt']) expect([to, v(U.owner, ev(to), t)]).toEqual([to, 'invalid_member']);
  });

  it('zrobione zakupy: lista z innej grupy jest nieprawidłowa', () => {
    const t = world();
    t.lists!['l-shop-g2'] = { id: 'l-shop-g2', group_id: 'g2', kind: 'shopping', visibility: 'group', owner_member_id: M.stranger, deleted_at: null };
    expect(v(U.member, create('shopping_trips', { list_id: 'l-shop-g2', done_at: '2026-10-07T08:00:00.000Z' }), t)).toBe('invalid_list');
  });

  it('unikalność przekazań: inna encja o tym samym identyfikatorze i inny termin nie kolidują', () => {
    const t = world();
    const ho = (entity: string, entity_id: string, to: string, extra: Row = {}) => create('handoffs', { entity, entity_id, to_member: to, ...extra });
    t.lists!['t-owner'] = { id: 't-owner', group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.owner, deleted_at: null };
    expect(v(U.owner, ho('lists', 't-owner', M.admin), t)).toBe('ok'); // zadanie t-owner ma oczekujące przekazanie, lista o tym id — nie
    t.handoffs!.h2 = { ...t.handoffs!.h!, id: 'h2', entity: 'events', entity_id: 'ev-resp', occurrence_date: '2026-10-28' };
    expect(v(U.member, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-21' }), t)).toBe('ok'); // inny termin tego samego wydarzenia
    expect(v(U.owner, ho('events', 'ev-resp', M.admin, { occurrence_date: '2026-10-28' }), t)).toBe('invalid:23505');
  });

  it('seria zadań: przywrócenie wydarzenia nie wskrzesza serii, której lista wciąż jest usunięta; powtórne usunięcie niczego nie wskrzesza', () => {
    const AT1 = '2026-10-07T08:00:00.000Z';
    const AT2 = '2026-10-08T08:00:00.000Z';
    const AT3 = '2026-10-09T08:00:00.000Z';
    const t = world();
    const del_ = (e: string, id: string, kind: 'delete' | 'restore', at: string) => applyOnServer(t, U.member, { kind, entity: e as never, id }, at);
    del_('events', 'ev', 'delete', AT1); // seria s znika z wydarzeniem
    del_('lists', 'l', 'delete', AT2); // lista znika później
    del_('events', 'ev', 'restore', AT3);
    expect(t.event_task_series!.s!.deleted_at).toBe(AT1); // lista nadal usunięta
    del_('lists', 'l', 'restore', AT3);
    expect(t.event_task_series!.s!.deleted_at).toBe(AT1); // wydarzenie wróciło wcześniej, a znacznik serii jest jego — wraca dopiero z wydarzeniem
    // Powtórne usunięcie już usuniętego wydarzenia nie rusza serii, której znacznik się zgadza.
    const u = world();
    applyOnServer(u, U.member, { kind: 'delete', entity: 'events', id: 'ev-del' }, AT3);
    expect(u.event_task_series!['s-evdel']!.deleted_at).toBe('2026-10-01T00:00:00Z');
  });

  it('powrót członka: przekazanie wraca tylko, gdy nikt inny nie przekazuje tej samej rzeczy (ten sam rodzaj i identyfikator) i odbiorca ma konto', () => {
    const LEFT = '2026-10-05T00:00:00Z';
    const t = world();
    t.group_members![M.member] = { ...t.group_members![M.member]!, deleted_at: LEFT };
    t.group_members!['m-noacct'] = { member_id: 'm-noacct', group_id: 'g', user_id: null, role: 'member', display_name: 'B', color: null, week_a: null, deleted_at: null };
    t.tasks!['tk-a'] = { id: 'tk-a', group_id: 'g', list_id: 'l', parent_id: null, title: 'a', assignee_member_id: M.member, completed_at: null, deleted_at: null };
    t.tasks!['tk-b'] = { ...t.tasks!['tk-a']!, id: 'tk-b' };
    t.lists!['tk-a'] = { id: 'tk-a', group_id: 'g', kind: 'shopping', visibility: 'group', owner_member_id: M.owner, responsible_member_id: M.owner, deleted_at: null };
    const h = (id: string, row: Row) => (t.handoffs![id] = { id, group_id: 'g', entity: 'tasks', entity_id: 'tk-a', occurrence_date: null, from_member: M.member, to_member: M.admin, status: 'cancelled', closed: false, decided_at: LEFT, ...row });
    h('h-back', {});
    // Inna rzecz (lista) o tym samym identyfikatorze, przekazywana teraz przez kogoś innego — nie blokuje zadania.
    t.handoffs!['h-list-pending'] = { id: 'h-list-pending', group_id: 'g', entity: 'lists', entity_id: 'tk-a', occurrence_date: null, from_member: M.owner, to_member: M.admin, status: 'pending', closed: false, decided_at: null };
    h('h-noacct', { entity_id: 'tk-b', to_member: 'm-noacct' });
    applyOnServer(t, U.owner, del('group_members', M.member, 'restore'), '2026-10-07T08:00:00.000Z');
    expect(t.handoffs!['h-back']!.status).toBe('pending');
    expect(t.handoffs!['h-noacct']!.status).toBe('cancelled');
  });
});
