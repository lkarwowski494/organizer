/** Kto widzi listę — reguła jak `private.member_can_see_list` na serwerze (supabase/migrations/20261006120100_lists_tasks.sql). */
import type { Row } from '../sync-engine/client';
import { memberCanSeeList } from '../views/visibility';

type T = { [e: string]: { [id: string]: Row } };
function world(): T {
  return {
    group_members: {
      ja: { member_id: 'ja', group_id: 'g', deleted_at: null },
      ala: { member_id: 'ala', group_id: 'g', deleted_at: null },
      byly: { member_id: 'byly', group_id: 'g', deleted_at: 'x' },
      obcy: { member_id: 'obcy', group_id: 'inna', deleted_at: null },
    },
    lists: {
      cala: { id: 'cala', group_id: 'g', visibility: 'group', owner_member_id: 'ja', deleted_at: null },
      moja: { id: 'moja', group_id: 'g', visibility: 'private', owner_member_id: 'ja', deleted_at: null },
      wybrane: { id: 'wybrane', group_id: 'g', visibility: 'restricted', owner_member_id: 'ja', deleted_at: null },
    },
    object_members: {
      o1: { id: 'o1', scope_entity: 'lists', scope_id: 'wybrane', member_id: 'ala', deleted_at: null },
      o2: { id: 'o2', scope_entity: 'lists', scope_id: 'wybrane', member_id: 'byly', deleted_at: null },
    },
  };
}

describe('kto widzi listę (audyt 2)', () => {
  it.each([
    ['ja', 'cala', true],
    ['ala', 'cala', true],
    ['byly', 'cala', false], // usunięty z grupy
    ['obcy', 'cala', false], // z innej grupy
    ['ja', 'moja', true], // właściciel
    ['ala', 'moja', false],
    ['ja', 'wybrane', true],
    ['ala', 'wybrane', true], // wpis w object_members
    ['byly', 'wybrane', false], // wpis jest, ale osoba nie jest w grupie
    ['ala', 'nie-ma', false],
  ])('%s → %s: %s', (member, list, can) => {
    expect(memberCanSeeList(world(), member, list)).toBe(can);
  });

  it('usunięty wpis w object_members nie daje dostępu; bez tabeli wpisów — tylko właściciel', () => {
    const t = world();
    t.object_members!.o1 = { ...t.object_members!.o1!, deleted_at: 'x' };
    expect(memberCanSeeList(t, 'ala', 'wybrane')).toBe(false);
    delete t.object_members;
    expect(memberCanSeeList(t, 'ja', 'wybrane')).toBe(true);
    expect(memberCanSeeList(t, 'ala', 'wybrane')).toBe(false);
    expect(memberCanSeeList({}, 'ala', 'cala')).toBe(false);
  });
});
