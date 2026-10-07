import type { Row } from '../sync-engine/client';
import { addresseeRequired, lacksAddressee } from '../views/addressee';
import { createTask } from '../views/commands';
import { parseQuickAdd } from '../quickadd';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gp', { id: 'gp', name: 'Osobiste', kind: 'personal', deleted_at: null });
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', deleted_at: null });
  put(t, 'group_members', 'mp', { member_id: 'mp', group_id: 'gp', user_id: ME, role: 'owner', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, role: 'admin', deleted_at: null });
  put(t, 'lists', 'lp', { id: 'lp', group_id: 'gp', kind: 'tasks', name: 'Moje', deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dzisiaj', deleted_at: null });
  put(t, 'lists', 'lz', { id: 'lz', group_id: 'gf', kind: 'shopping', name: 'Zakupy', deleted_at: null });
  put(t, 'lists', 'lx', { id: 'lx', group_id: 'gx', kind: 'tasks', name: 'Obca', deleted_at: null });
  return t;
}

describe('adresat zadania (D68)', () => {
  it('wymagany tylko dla zadań głównych na listach zadań grup wspólnych', () => {
    const t = world();
    expect(addresseeRequired(t, ME, 'lf', null)).toBe(true);
    expect(addresseeRequired(t, ME, 'lf', 'rodzic')).toBe(false);
    expect(addresseeRequired(t, ME, 'lp', null)).toBe(false);
    expect(addresseeRequired(t, ME, 'lz', null)).toBe(false);
    expect(addresseeRequired(t, ME, 'lx', null)).toBe(false); // obca grupa
    expect(addresseeRequired(t, ME, 'nie-ma', null)).toBe(false);
  });

  it('brak adresata = bez osoby i bez terminu (termin własny, dziedziczony i ze spotkania się liczy)', () => {
    const t = world();
    const x = { list_id: 'lf', parent_id: null, assignee_member_id: null, deadline_mode: 'none' as const };
    expect(lacksAddressee(t, ME, x)).toBe(true);
    expect(lacksAddressee(t, ME, { ...x, assignee_member_id: 'mf' })).toBe(false);
    for (const m of ['own', 'inherit', 'event'] as const) expect(lacksAddressee(t, ME, { ...x, deadline_mode: m })).toBe(false);
    expect(lacksAddressee(t, ME, { ...x, list_id: 'lp' })).toBe(false);
  });

  it('nowe zadanie z osobą wybraną po dodaniu', () => {
    const p = parseQuickAdd('rosół', { y: 2026, m: 10, d: 7, hh: 10, mm: 0 });
    expect(createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p, assigneeId: 'mf' })).toMatchObject({ set: { assignee_member_id: 'mf', deadline_mode: 'none' } });
    expect(createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p }).kind === 'create' && 'assignee_member_id' in (createTask({ id: 't', groupId: 'gf', listId: 'lf', parsed: p }) as { set: object }).set).toBe(false);
  });
});
