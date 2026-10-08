import type { Row } from '../sync-engine/client';
import { quickEvent, quickEventOps } from '../views/quick-event';

const ME = 'u-me';
const NOW = { y: 2026, m: 10, d: 8, hh: 10, mm: 0 };
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

function base(): T {
  const t: T = {};
  const g = (id: string, name: string, kind: string) => put(t, 'groups', id, { id, name, kind, created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  g(ME, 'Osobiste', 'personal');
  g('gf', 'Rodzina', 'shared');
  g('gc', 'Babcia', 'shared');
  const m = (id: string, gid: string, user: string | null, name: string, role: string) =>
    put(t, 'group_members', id, { member_id: id, group_id: gid, user_id: user, display_name: name, role, deleted_at: null });
  m(ME, ME, ME, 'Łukasz', 'owner');
  m('mf', 'gf', ME, 'Łukasz', 'admin');
  m('ala', 'gf', 'u-ala', 'Ala', 'owner');
  m('kuba', 'gf', null, 'Kuba', 'child');
  m('mc', 'gc', ME, 'Łukasz', 'child');
  return t;
}
const q = (text: string, o: { groupId?: string; memberId?: string; now?: typeof NOW; ignore?: { start: number; end: number }[] } = {}) =>
  quickEvent({ tables: base(), userId: ME, text, now: o.now ?? NOW, ignore: o.ignore, groupId: o.groupId, memberId: o.memberId });

describe('wydarzenie z szybkiego dodania (D98, D99)', () => {
  it('bez zakresu — nie wydarzenie; z zakresem: nazwa, dzień, godziny, grupa osobista', () => {
    expect(q('basen jutro 19.00')).toBeNull();
    expect(q('basen jutro 17-18')).toMatchObject({ groupId: ME, form: { title: 'basen', date: '2026-10-09', repeat: 'none', slots: [{ days: [4], start: '17:00', end: '18:00' }], responsibleId: null } });
  });

  it('bez dnia: dziś, a gdy początek minął — jutro; „co tydzień” — co tydzień', () => {
    expect(q('basen 17-18')!.form.date).toBe('2026-10-08');
    expect(q('basen 10-11')!.form.date).toBe('2026-10-09');
    expect(q('basen 9:30-11', { now: { ...NOW, hh: 9, mm: 5 } })!.form.date).toBe('2026-10-08');
    expect(q('basen w piątek 17-18 co tydzień')!.form).toMatchObject({ date: '2026-10-09', repeat: 'weekly', slots: [{ days: [4] }] });
  });

  it('@imię: grupa i dorosła osoba odpowiedzialna; dziecko i grupa osobista — bez osoby; grupa jako dziecko — osobista', () => {
    expect(q('zebranie 17-18', { groupId: 'gf', memberId: 'ala' })).toMatchObject({ groupId: 'gf', form: { responsibleId: 'ala' } });
    expect(q('zebranie 17-18', { groupId: 'gf', memberId: 'kuba' })!.form).toMatchObject({ responsibleId: null, audience: 'members', participantIds: ['kuba'] });
    expect(q('zebranie 17-18', { groupId: 'gf', memberId: 'ala' })!.form).toMatchObject({ audience: 'group', participantIds: [] });
    expect(q('zebranie 17-18', { groupId: ME, memberId: ME })!.form.responsibleId).toBeNull();
    expect(q('zebranie 17-18', { groupId: 'gc' })!.groupId).toBe(ME);
    expect(quickEvent({ tables: {}, userId: ME, text: 'x 17-18', now: NOW })).toBeNull();
  });

  it('odklikany zakres — zadanie; operacje utworzenia; pusta nazwa — brak operacji', () => {
    expect(q('basen 17-18', { ignore: [{ start: 6, end: 11 }] })).toBeNull();
    let n = 0;
    const r = quickEventOps(q('basen jutro 17-18', { groupId: 'gf', memberId: 'ala' })!, () => `n${++n}`)!;
    expect(r.id).toBe('n1');
    expect(r.ops).toEqual([
      { kind: 'create', entity: 'events', id: 'n1', group_id: 'gf', set: { title: 'basen', start_date: '2026-10-09', start_time: '17:00', end_time: '18:00', rrule: null, audience: 'group', responsible_member_id: 'ala' } },
    ]);
    expect(quickEventOps(q('17-18')!, () => 'x')).toBeNull();
  });
});
