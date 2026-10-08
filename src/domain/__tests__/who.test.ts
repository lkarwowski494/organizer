import { personOf } from '../views/who';

const t = {
  group_members: {
    m1: { member_id: 'm1', user_id: 'u1', display_name: 'Łukasz' },
    m2: { member_id: 'm2', user_id: null, display_name: 'Róża' },
    m3: { member_id: 'm3', user_id: 'u3' },
  },
};

describe('kto (D119)', () => {
  it('ja, inna osoba, dziecko bez konta', () => {
    expect(personOf(t, 'u1', 'm1')).toEqual({ name: 'Łukasz', me: true });
    expect(personOf(t, 'u1', 'm2')).toEqual({ name: 'Róża', me: false });
    expect(personOf(t, 'u1', 'm3')).toEqual({ name: '', me: false });
  });
  it('bez osoby albo nieznany członek', () => {
    expect(personOf(t, 'u1', null)).toBeNull();
    expect(personOf(t, 'u1', 'mx')).toBeNull();
    expect(personOf({}, 'u1', 'm1')).toBeNull();
    // D132: usunięty z grupy — nikt konkretny.
    expect(personOf({ group_members: { m9: { member_id: 'm9', user_id: 'u9', display_name: 'X', deleted_at: '2026-10-01' } } }, 'u1', 'm9')).toBeNull();
  });
});
