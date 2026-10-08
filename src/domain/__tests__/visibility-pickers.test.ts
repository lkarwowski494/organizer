/** Wybór osoby tylko spośród tych, którzy widzą listę (audyt 2: R-3, R-4, R-5, R-6, T-10). */
import type { Row } from '../sync-engine/client';
import { listDetail } from '../views';
import { handoffTargets } from '../views/handoffs';
import { tripAdults } from '../views/shopping-trip';
import { generalList } from '../views/task-form';
import { memberCanSeeList } from '../views/visibility';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
function world(): T {
  const t: T = {
    groups: { gf: { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null } },
    group_members: {
      mf: { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null },
      ala: { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null },
      kuba: { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null },
    },
    lists: {
      prez: { id: 'prez', group_id: 'gf', kind: 'tasks', name: 'Zadania', visibility: 'private', owner_member_id: 'mf', sort_key: 'a0', deleted_at: null },
      zak: { id: 'zak', group_id: 'gf', kind: 'shopping', name: 'Prezenty', visibility: 'private', owner_member_id: 'mf', sort_key: 'a1', deleted_at: null },
      dom: { id: 'dom', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', owner_member_id: 'mf', sort_key: 'a2', deleted_at: null },
    },
  };
  return t;
}
const today = { y: 2026, m: 10, d: 8 };

describe('wybór osoby a widoczność listy', () => {
  it('lista prywatna: do przypisania tylko ja; lista całej grupy: wszyscy (także dziecko)', () => {
    const t = world();
    expect(listDetail(t, ME, 'prez', today)!.members.map((m) => m.member_id)).toEqual(['mf']);
    expect(listDetail(t, ME, 'dom', today)!.members.map((m) => m.member_id).sort()).toEqual(['ala', 'kuba', 'mf']);
  });

  it('kto robi zakupy i komu przekazać: tylko osoby widzące listę', () => {
    const t = world();
    expect(tripAdults(t, 'gf', (m) => memberCanSeeList(t, m, 'zak')).map((m) => m.member_id)).toEqual(['mf']);
    expect(tripAdults(t, 'gf').map((m) => m.member_id)).toEqual(['ala', 'mf']);
    expect(handoffTargets(t, ME, 'gf', 'zak')).toEqual([]);
    expect(handoffTargets(t, ME, 'gf', 'dom').map((m) => m.member_id)).toEqual(['ala']);
    expect(handoffTargets(t, ME, 'gf').map((m) => m.member_id)).toEqual(['ala']);
  });

  it('@imię: ogólna lista „Zadania” tylko całej grupy — prywatna o tej nazwie nie jest brana (powstaje nowa)', () => {
    const r = generalList(world(), ME, 'gf', () => 'nowa');
    expect(r.listId).toBe('nowa');
    expect(r.ops).toEqual([expect.objectContaining({ kind: 'create', entity: 'lists', id: 'nowa', set: expect.objectContaining({ name: 'Zadania', visibility: 'group' }) })]);
  });
});
