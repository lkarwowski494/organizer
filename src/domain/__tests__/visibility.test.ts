/** Kto widzi listę — reguła jak `private.member_can_see_list` na serwerze (supabase/migrations/20261006120100_lists_tasks.sql). */
import { applyOp, type Op, type Row } from '../sync-engine/client';
import { createList } from '../views/commands';
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

  it('N-170: świeża lista „Tylko ja” (przed odpowiedzią serwera, bez właściciela) — widzi ją konto tego telefonu', () => {
    const t: T = {
      groups: { 'u-me': { id: 'u-me', kind: 'personal', deleted_at: null }, g: { id: 'g', kind: 'shared', deleted_at: null } },
      group_members: {
        me: { member_id: 'me', group_id: 'g', user_id: 'u-me', deleted_at: null },
        ala: { member_id: 'ala', group_id: 'g', user_id: 'u-ala', deleted_at: null },
        tymek: { member_id: 'tymek', group_id: 'g', user_id: null, deleted_at: null },
      },
      lists: {},
    };
    const op = createList({ id: 'l1', groupId: 'g', kind: 'shopping', name: 'Prezenty', visibility: 'private', trip: { date: null, time: null, responsibleId: 'me' } });
    applyOp(t, { ...op, seq: 1, op_id: 'o1' } as Op);
    // Właściciela nadaje serwer — telefon go nie wysyła.
    expect(op.kind === 'create' && 'owner_member_id' in op.set).toBe(false);
    expect(memberCanSeeList(t, 'me', 'l1')).toBe(true);
    expect(memberCanSeeList(t, 'ala', 'l1')).toBe(false);
    expect(memberCanSeeList(t, 'tymek', 'l1')).toBe(false);
    // Bez znanej grupy osobistej — nikt (jak przed poprawką).
    delete t.groups!['u-me'];
    expect(memberCanSeeList(t, 'me', 'l1')).toBe(false);
    delete t.groups;
    expect(memberCanSeeList(t, 'me', 'l1')).toBe(false);
  });
});
