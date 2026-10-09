import { config } from '../../config';
import type { Row } from '../sync-engine/client';
import { emailName, PLACEHOLDER_NAME, renameMeOps, validateName } from '../views/my-name';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
const m = (t: T, id: string, user: string | null, name: unknown, deleted: string | null = null, groupDeleted: string | null = null) => {
  put(t, 'groups', `g-${id}`, { id: `g-${id}`, name: id, kind: 'shared', deleted_at: groupDeleted });
  put(t, 'group_members', id, { member_id: id, group_id: `g-${id}`, user_id: user, display_name: name, role: 'member', deleted_at: deleted });
};

describe('moje imię (D100)', () => {
  it('początek adresu e-mail; walidacja imienia', () => {
    expect(emailName('jan.kowalski85@example.com')).toBe('jan.kowalski85');
    expect(emailName(null)).toBeNull();
    expect(emailName(undefined)).toBeNull();
    expect(validateName('  Łukasz ')).toBeNull();
    expect(validateName('   ')).toBe('empty');
    expect(validateName('x'.repeat(config.profile.NAME_MAX_LENGTH))).toBeNull();
    expect(validateName('x'.repeat(config.profile.NAME_MAX_LENGTH + 1))).toBe('tooLong');
  });

  it('zmienia tylko moje członkostwa z dawnym imieniem, „Ja” albo pustym; imię grupowe i cudze zostają', () => {
    const t: T = {};
    m(t, 'a', ME, 'jan.kowalski85');
    m(t, 'b', ME, PLACEHOLDER_NAME);
    m(t, 'c', ME, 'Tata');
    m(t, 'd', ME, 'jan.kowalski85', 'x');
    m(t, 'e', 'u-ala', 'jan.kowalski85');
    m(t, 'f', ME, null);
    m(t, 'g', ME, 'Łukasz');
    expect(renameMeOps(t, ME, ' Łukasz ', ['jan.kowalski85', null, undefined])).toEqual([
      { kind: 'patch', entity: 'group_members', id: 'a', set: { display_name: 'Łukasz' } },
      { kind: 'patch', entity: 'group_members', id: 'b', set: { display_name: 'Łukasz' } },
      { kind: 'patch', entity: 'group_members', id: 'f', set: { display_name: 'Łukasz' } },
    ]);
    expect(renameMeOps(t, ME, 'Łukasz', ['Łukasz'])).toEqual(renameMeOps(t, ME, 'Łukasz', []));
    expect(renameMeOps({}, ME, 'Łukasz', [])).toEqual([]);
  });

  it('pomija grupy z kosza i członkostwa bez grupy — serwer i tak by je odrzucił (audyt 2, R-35)', () => {
    const t: T = {};
    m(t, 'a', ME, 'Ja');
    m(t, 'z', ME, 'Ja', null, '2026-10-01T00:00:00Z');
    put(t, 'group_members', 'bez-grupy', { member_id: 'bez-grupy', group_id: 'g-brak', user_id: ME, display_name: 'Ja', role: 'member', deleted_at: null });
    expect(renameMeOps(t, ME, 'Łukasz', []).map((o) => (o as { id: string }).id)).toEqual(['a']);
  });
});
