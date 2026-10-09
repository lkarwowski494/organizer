/**
 * Operacje szybkiego dodawania (views/quick-add-ops.ts; audyt 2, M-51: logika przeniesiona z src/app pod progi i testy
 * mutacyjne) — dokładnie te operacje dla każdego celu: wskazana lista zadań i zakupów, ogólna lista grupy osobistej
 * i wspólnej (z utworzeniem, gdy jej nie ma), brak grup, pusty tytuł, termin i osoba spoza tekstu.
 */
import type { Row } from '../sync-engine/client';
import { quickAddOps } from '../views/quick-add-ops';

const ME = 'u-me';
const NOW = { y: 2026, m: 10, d: 7, hh: 10, mm: 0 };
type T = { [e: string]: { [k: string]: Row } };

function tables(withLists = true): T {
  const t: T = { groups: {}, group_members: {}, lists: {} };
  t.groups!.p = { id: 'p', name: 'Osobiste', kind: 'personal', deleted_at: null };
  t.groups!.g = { id: 'g', name: 'Rodzina', kind: 'shared', deleted_at: null };
  t.group_members!.mp = { member_id: 'mp', group_id: 'p', user_id: ME, role: 'owner', display_name: 'Ja', deleted_at: null };
  t.group_members!.mg = { member_id: 'mg', group_id: 'g', user_id: ME, role: 'member', display_name: 'Ja', deleted_at: null };
  if (withLists) {
    t.lists!.lp = { id: 'lp', group_id: 'p', kind: 'tasks', name: 'Moje', visibility: 'group', sort_key: 'a0', deleted_at: null };
    t.lists!.ls = { id: 'ls', group_id: 'g', kind: 'shopping', name: 'Zakupy', visibility: 'group', sort_key: 'a0', deleted_at: null };
  }
  return t;
}

function run(t: T, text: string, extra: Partial<Parameters<typeof quickAddOps>[0]> = {}) {
  let n = 0;
  return quickAddOps({ tables: t, userId: ME, text, now: NOW, ignore: [], newId: () => `n${++n}`, ...extra });
}

const task = (id: string, group: string, list: string, set: Row) => ({
  kind: 'create',
  entity: 'tasks',
  id,
  group_id: group,
  set: { list_id: list, parent_id: null, sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null, ...set },
});

describe('quickAddOps', () => {
  it('bez listy: ogólna lista grupy osobistej (pierwsza lista zadań), termin z tekstu', () => {
    expect(run(tables(), 'Oddać książki jutro')).toEqual([task('n1', 'p', 'lp', { title: 'Oddać książki', deadline_mode: 'own', due_date: '2026-10-08' })]);
  });

  it('wskazana lista zakupów: tytuł dosłownie (ilość z datą nie staje się terminem)', () => {
    expect(run(tables(), 'mąka  1.5 kg', { listId: 'ls' })).toEqual([task('n1', 'g', 'ls', { title: 'mąka 1.5 kg' })]);
  });

  it('wskazana lista zadań — termin z tekstu; osoba i termin spoza tekstu, gdy tekst ich nie podał', () => {
    expect(run(tables(), 'Wynieść śmieci', { listId: 'lp', assigneeId: 'mp', dueDate: '2026-10-10' })).toEqual([
      task('n1', 'p', 'lp', { title: 'Wynieść śmieci', deadline_mode: 'own', due_date: '2026-10-10', assignee_member_id: 'mp' }),
    ]);
    expect(run(tables(), 'Wynieść śmieci jutro', { listId: 'lp', dueDate: '2026-10-10' })[0]).toMatchObject({ set: { due_date: '2026-10-08' } });
  });

  it('grupa wspólna bez listy „Zadania”: najpierw nowa lista, potem zadanie; z istniejącą — tylko zadanie', () => {
    const t = tables();
    const ops = run(t, 'Zebranie', { groupId: 'g' });
    expect(ops).toEqual([
      { kind: 'create', entity: 'lists', id: 'n1', group_id: 'g', set: expect.objectContaining({ kind: 'tasks', name: 'Zadania' }) },
      task('n2', 'g', 'n1', { title: 'Zebranie' }),
    ]);
    t.lists!.lz = { id: 'lz', group_id: 'g', kind: 'tasks', name: 'Zadania', visibility: 'group', sort_key: 'a0', deleted_at: null };
    expect(run(t, 'Zebranie', { groupId: 'g' })).toEqual([task('n1', 'g', 'lz', { title: 'Zebranie' })]);
  });

  it('nieznana grupa — osobista; bez list w osobistej — nowa „Moje zadania”', () => {
    expect(run(tables(false), 'Coś', { groupId: 'nie-ma' })).toEqual([
      { kind: 'create', entity: 'lists', id: 'n1', group_id: 'p', set: expect.objectContaining({ name: 'Moje zadania' }) },
      task('n2', 'p', 'n1', { title: 'Coś' }),
    ]);
  });

  it('pusty tytuł i brak grup — nic', () => {
    expect(run(tables(), '   ')).toEqual([]);
    expect(run(tables(), 'jutro')).toEqual([]);
    expect(run({}, 'Coś')).toEqual([]);
  });
});
