import { config } from '../../config';
import type { NewOp, Row } from '../sync-engine/client';
import { applyOp } from '../sync-engine/client';
import { fingerprint, isStale, parseRecent, sameValue } from '../views/recent';
import { TRASH_KINDS, trashView } from '../views/trash';

const ME = 'u-me';
const NOW = Date.UTC(2026, 9, 7, 8, 0);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, key: string, row: Row) => ((t[e] ??= {})[key] = row);

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gc', { id: 'gc', name: 'Klasa', kind: 'shared', created_at: '2026-03-01T00:00:00Z', deleted_at: null });
  const m = (id: string, g: string, user: string | null, name: string, role: string, extra: Row = {}) =>
    put(t, 'group_members', id, { member_id: id, group_id: g, user_id: user, display_name: name, role, deleted_at: null, ...extra });
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  m('tymek', 'gf', null, 'Tymek', 'child', { deleted_at: ago(2) });
  const l = (id: string, g: string, name: string, extra: Row = {}) => put(t, 'lists', id, { id, group_id: g, kind: 'tasks', name, visibility: 'group', sort_key: 'a0', deleted_at: null, ...extra });
  l('dom', 'gf', 'Dom');
  l('zak', 'gf', 'Zakupy', { kind: 'shopping' });
  l('stara', 'gf', 'Stara', { deleted_at: ago(1) });
  l('szk', 'gc', 'Szkoła', { deleted_at: ago(1) });
  l('zak2', 'gf', 'Stare zakupy', { kind: 'shopping', deleted_at: ago(10) });
  const task = (id: string, list: string, g: string, title: string, extra: Row = {}) =>
    put(t, 'tasks', id, { id, group_id: g, list_id: list, parent_id: null, title, deleted_at: null, ...extra });
  task('t1', 'dom', 'gf', 'Odkurzyć', { deleted_at: ago(3) });
  task('t1a', 'dom', 'gf', 'Pod odkurzeniem', { parent_id: 't1', deleted_at: ago(3) });
  task('t2', 'dom', 'gf', 'Podzadanie żywego', { parent_id: 'tz', deleted_at: ago(4) });
  task('tz', 'dom', 'gf', 'Żywe');
  task('mleko', 'zak', 'gf', 'Mleko', { deleted_at: ago(0.5) });
  task('w1', 'stara', 'gf', 'W starej', { deleted_at: ago(1) });
  task('w2', 'stara', 'gf', 'Też w starej');
  task('w3', 'stara', 'gf', 'Usunięta wcześniej', { deleted_at: ago(5) });
  task('bez', 'nieznana', 'gf', 'Bez listy', { deleted_at: ago(1) });
  task('stare', 'dom', 'gf', 'Za stare', { deleted_at: ago(config.sync.TOMBSTONE_DAYS + 1) });
  task('kl', 'szk', 'gc', 'Klasowe', { deleted_at: ago(1) });
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Basen', deleted_at: 'pending' });
  put(t, 'events', 'ev2', { id: 'ev2', group_id: 'gf', title: 'Żywe', deleted_at: null });
  put(t, 'events', 'evc', { id: 'evc', group_id: 'gc', title: 'Wycieczka', deleted_at: ago(1) });
  return t;
}

describe('kosz (M-34, D151)', () => {
  it('listy, zadania, pozycje, wydarzenia i osoby, które mogę przywrócić — najnowsze pierwsze', () => {
    const v = trashView(world(), ME, NOW);
    expect(v.map((e) => [e.kind, e.id, e.daysLeft])).toEqual([
      ['event', 'ev', 30],
      ['item', 'mleko', 30],
      ['list', 'stara', 29],
      ['member', 'tymek', 28],
      ['task', 't1', 27],
      ['task', 't2', 26],
      ['list', 'zak2', 20],
    ]);
    expect(v.at(-1)).toMatchObject({ shopping: true, tasks: 0 });
    expect(v.find((e) => e.id === 'stara')).toMatchObject({ title: 'Stara', groupName: 'Rodzina', tasks: 2, listName: null, entity: 'lists', shopping: false });
    expect(v.find((e) => e.id === 'mleko')).toMatchObject({ listName: 'Zakupy', entity: 'tasks' });
    expect(v.find((e) => e.id === 'tymek')).toMatchObject({ title: 'Tymek', entity: 'group_members' });
    expect(TRASH_KINDS).toEqual(['list', 'task', 'item', 'event', 'member']);
  });

  it('osoba z kontem — od dnia usunięcia przez kogoś; brak tytułu wydarzenia = pusty', () => {
    const t = world();
    put(t, 'group_members', 'ola', { member_id: 'ola', group_id: 'gf', user_id: 'u-ola', display_name: 'Ola', role: 'member', deleted_at: ago(1), removed_at: ago(6) });
    put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', deleted_at: ago(1) });
    const v = trashView(t, ME, NOW);
    expect(v.find((e) => e.id === 'ola')?.daysLeft).toBe(24);
    expect(v.find((e) => e.id === 'ev')?.title).toBe('');
  });

  it('pusto bez grup', () => {
    expect(trashView({}, ME, NOW)).toEqual([]);
  });
});

describe('ostatnie zmiany: sprawdzenie, czy rzecz się nie zmieniła (D194)', () => {
  const apply = (t: T, ops: readonly NewOp[]) => {
    ops.forEach((op, i) => applyOp(t, { ...op, seq: i, op_id: `o${i}` } as never));
    return t;
  };

  it('ta sama wartość po serwerze: godzina z sekundami, znacznik czasu, null i brak, tablice', () => {
    expect(sameValue('17:30', '17:30:00')).toBe(true);
    expect(sameValue('17:30', '17:31:00')).toBe(false);
    expect(sameValue('2026-10-07T08:00:00.000Z', '2026-10-07T08:00:00+00:00')).toBe(true);
    expect(sameValue('2026-10-07T08:00:00.000Z', '2026-10-07T09:00:00+00:00')).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue('a', 1)).toBe(false);
    expect(sameValue(['a'], ['a'])).toBe(true);
    expect(sameValue(['a'], ['b'])).toBe(false);
    expect(sameValue(null, 'a')).toBe(false);
  });

  it('usunięcie: przywrócone w międzyczasie = nieaktualne; po pobraniu z serwera (inny znacznik) — aktualne', () => {
    const t = apply(world(), [{ kind: 'delete', entity: 'tasks', id: 'tz' }]);
    const fp = fingerprint(t, [{ kind: 'delete', entity: 'tasks', id: 'tz' }]);
    expect(fp).toEqual([{ entity: 'tasks', id: 'tz', alive: false, fields: {} }]);
    put(t, 'tasks', 'tz', { ...t.tasks!.tz!, deleted_at: '2026-10-07T08:00:01Z', version: 9 });
    expect(isStale(t, fp)).toBe(false);
    put(t, 'tasks', 'tz', { ...t.tasks!.tz!, deleted_at: null });
    expect(isStale(t, fp)).toBe(true);
  });

  it('zmiana pól: ktoś zmienił to samo pole = nieaktualne; inne pole — aktualne; zniknięcie wiersza — nieaktualne', () => {
    const ops: NewOp[] = [
      { kind: 'patch', entity: 'tasks', id: 'tz', set: { due_date: '2026-10-08', due_time: '10:00' } },
      { kind: 'patch', entity: 'tasks', id: 'tz', set: { due_time: '11:00' } },
      { kind: 'create', entity: 'tasks', id: 'nowe', group_id: 'gf', set: { title: 'Nowe', list_id: 'dom' } },
      { kind: 'cmd', cmd: 'move_task', args: { id: 'tz' } },
    ];
    const t = apply(world(), ops);
    const fp = fingerprint(t, ops);
    expect(fp).toEqual([
      { entity: 'tasks', id: 'tz', alive: true, fields: { due_date: '2026-10-08', due_time: '11:00' } },
      { entity: 'tasks', id: 'nowe', alive: true, fields: { title: 'Nowe', list_id: 'dom' } },
    ]);
    put(t, 'tasks', 'tz', { ...t.tasks!.tz!, due_time: '11:00:00', title: 'Inny tytuł' });
    expect(isStale(t, fp)).toBe(false);
    put(t, 'tasks', 'tz', { ...t.tasks!.tz!, due_date: '2026-10-09' });
    expect(isStale(t, fp)).toBe(true);
    const t2 = apply(world(), ops);
    delete t2.tasks!.nowe;
    expect(isStale(t2, fp)).toBe(true);
  });

  it('stałe zakupy: odcisk pola staples listy; wiersz, którego nie ma — nieżywy, z pustymi polami', () => {
    const ops: NewOp[] = [{ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'zak', names: ['Mleko'] } }];
    const t = world();
    put(t, 'lists', 'zak', { ...t.lists!.zak!, staples: ['Chleb'] });
    const fp = fingerprint(t, [...ops, { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'zak', name: 'Chleb' } }]);
    expect(fp).toEqual([{ entity: 'lists', id: 'zak', alive: true, fields: { staples: ['Chleb'] } }]);
    expect(fingerprint({}, [{ kind: 'patch', entity: 'tasks', id: 'x', set: { title: 'a' } }])).toEqual([{ entity: 'tasks', id: 'x', alive: false, fields: { title: null } }]);
    put(t, 'lists', 'zak', { ...t.lists!.zak!, staples: ['Chleb', 'Masło'] });
    expect(isStale(t, fp)).toBe(true);
  });
});

describe('zapis ostatnich zmian w bazie konta (D194 b)', () => {
  const op = { kind: 'restore', entity: 'tasks', id: 't' } as const;
  it('wpisy wracają; otwarte bez zapisanego cofnięcia — „lost” z powodem; przepis rutyny zostaje', () => {
    const json = JSON.stringify([
      { id: 3, message: 'Usunięto: A', at: 5, state: 'open', undo: { ops: [op] }, lost: null, fp: [] },
      { id: 2, message: 'Usunięto grupę: R', at: 4, state: 'open', undo: null, lost: 'server', fp: null },
      { id: 1, message: 'Zapisano plan', at: 3, state: 'open', undo: null, lost: 'plan', fp: null },
      { id: 0, message: 'Rutyna', at: 2, state: 'undone', undo: { ops: [op], recipe: 'routine' }, lost: null, fp: null },
      { id: -1, message: 'Stare', at: 1, state: 'dziwny', undo: { ops: 'x' } },
      { id: 'zły', message: 'x', at: 1 },
      null,
    ]);
    expect(parseRecent(json)).toEqual([
      { id: 3, message: 'Usunięto: A', at: 5, state: 'open', undo: { ops: [op] }, lost: null, fp: [] },
      { id: 2, message: 'Usunięto grupę: R', at: 4, state: 'lost', undo: null, lost: 'server', fp: null },
      { id: 1, message: 'Zapisano plan', at: 3, state: 'lost', undo: null, lost: 'plan', fp: null },
      { id: 0, message: 'Rutyna', at: 2, state: 'undone', undo: { ops: [op], recipe: 'routine' }, lost: null, fp: null },
      { id: -1, message: 'Stare', at: 1, state: 'lost', undo: null, lost: 'server', fp: null },
    ]);
  });
  it('pusto, uszkodzony zapis i nie-tablica — pusta lista', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{')).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([{ id: 1, message: 'm', at: 1, undo: { ops: [1] } }]))[0]).toMatchObject({ state: 'lost', undo: null });
  });
});
