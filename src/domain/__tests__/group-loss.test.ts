import { lostGroups } from '../views/group-loss';
import type { Tables } from '../views/model';

const ME = 'u-me';
const world = (): Tables => ({
  groups: {
    [ME]: { id: ME, name: 'Osobiste', kind: 'personal', created_at: '2026-01-01T00:00:00Z', deleted_at: null },
    gf: { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-02T00:00:00Z', deleted_at: null },
    gk: { id: 'gk', name: 'Klasa 2b', kind: 'shared', created_at: '2026-01-03T00:00:00Z', deleted_at: null },
  },
  group_members: {
    [ME]: { member_id: ME, group_id: ME, user_id: ME, display_name: 'Ja', role: 'owner', deleted_at: null },
    mf: { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ja', role: 'member', deleted_at: null },
    mk: { member_id: 'mk', group_id: 'gk', user_id: ME, display_name: 'Ja', role: 'child', deleted_at: null },
  },
});
const without = (t: Tables, g: string): Tables => ({
  groups: Object.fromEntries(Object.entries(t.groups!).filter(([id]) => id !== g)),
  group_members: Object.fromEntries(Object.entries(t.group_members!).filter(([, m]) => m.group_id !== g)),
});

describe('grupy, do których już nie należę (audyt 3, N-162, Q33 A)', () => {
  it('serwer przestał pokazywać grupę — z nazwą sprzed pobrania; kilka naraz; także grupa, w której jestem dzieckiem', () => {
    const t = world();
    expect(lostGroups(t, without(t, 'gf'), ME)).toEqual([{ id: 'gf', name: 'Rodzina' }]);
    expect(lostGroups(t, without(without(t, 'gf'), 'gk'), ME)).toEqual([{ id: 'gf', name: 'Rodzina' }, { id: 'gk', name: 'Klasa 2b' }]);
    expect(lostGroups(t, t, ME)).toEqual([]);
  });

  it('bez paska: moje wyjście (już przed pobraniem nie moja), grupa w koszu (wiersz zostaje), osobista, pierwsze dane', () => {
    const t = world();
    const left: Tables = { ...t, group_members: { ...t.group_members!, mf: { ...t.group_members!.mf!, deleted_at: '2026-10-07T08:00:00Z' } } };
    expect(lostGroups(left, without(t, 'gf'), ME)).toEqual([]);
    const trashed: Tables = { ...t, groups: { ...t.groups!, gf: { ...t.groups!.gf!, deleted_at: '2026-10-07T08:00:00Z' } } };
    expect(lostGroups(t, trashed, ME)).toEqual([]);
    expect(lostGroups(t, without(t, ME), ME)).toEqual([]);
    expect(lostGroups({}, t, ME)).toEqual([]);
  });
});
