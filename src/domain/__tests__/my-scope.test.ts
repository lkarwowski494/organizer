import { occurrenceInScope, parseScopes, scopeAll, scopeLookup } from '../views/my-scope';
import { planReminders } from '../views/reminders';
import type { Row } from '../sync-engine/client';

describe('PW-2: zapis i odczyt zakresu Moich spraw', () => {
  it('JSON grupa → zakres; „Wszystko”, nieznane wartości i uszkodzony zapis pomijane', () => {
    expect(parseScopes(null)).toEqual({});
    expect(parseScopes('nie json')).toEqual({});
    expect(parseScopes('[1]')).toEqual({});
    expect(parseScopes('null')).toEqual({});
    expect(parseScopes('{"a":"mine","b":"mineAndEvents","c":"all","d":"x"}')).toEqual({ a: 'mine', b: 'mineAndEvents' });
    const of = scopeLookup({ a: 'mine' });
    expect([of('a'), of('z'), scopeAll('a')]).toEqual(['mine', 'all', 'all']);
  });
  it('wystąpienie: poza „Tylko przypisane do mnie” wystarczy concernsMe', () => {
    const o = { concernsMe: true, assignedToMe: false, groupId: 'g' };
    expect([occurrenceInScope(o, () => 'all'), occurrenceInScope(o, () => 'mineAndEvents'), occurrenceInScope(o, () => 'mine')]).toEqual([true, true, false]);
    expect(occurrenceInScope({ ...o, assignedToMe: true }, () => 'mine')).toBe(true);
    expect(occurrenceInScope({ ...o, concernsMe: false, assignedToMe: true }, () => 'all')).toBe(false);
  });
});

describe('PW-2 i PWD-32 B w przypomnieniach i porannym podsumowaniu', () => {
  const ME = 'u-me';
  type T = { [e: string]: { [id: string]: Row } };
  const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
  const toMs = (l: { y: number; m: number; d: number; hh: number; mm: number }) => Date.UTC(l.y, l.m - 1, l.d, l.hh - 2, l.mm);
  const opts = { days: 1, max: 40, toMs, localDate: (iso: string) => iso.slice(0, 10), label: { trip: (n: string) => `Zakupy: ${n}`, morningTitle: 'Dziś', more: (n: number) => `i ${n} więcej`, summary: (n: number, o: number) => `${n}/${o}` } };
  const TODAY = { y: 2026, m: 10, d: 7 };
  function world(): T {
    const t: T = {};
    put(t, 'groups', 'gk', { id: 'gk', name: 'Klasa', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mk', { member_id: 'mk', group_id: 'gk', user_id: ME, display_name: 'Łukasz', role: 'member', deleted_at: null });
    put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gk', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
    put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gk', user_id: 'u-ala', display_name: 'Ala', role: 'owner', deleted_at: null });
    put(t, 'lists', 'l', { id: 'l', group_id: 'gk', kind: 'tasks', name: 'Szkoła', visibility: 'group', deleted_at: null });
    put(t, 'tasks', 'zbiorka', { id: 'zbiorka', group_id: 'gk', list_id: 'l', parent_id: null, title: 'Zbiórka', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-07', due_time: '17:00:00', completed_at: null, deleted_at: null, rollover: true });
    put(t, 'events', 'basen', { id: 'basen', group_id: 'gk', title: 'Basen', start_date: '2026-10-07', start_time: '18:00:00', end_time: null, rrule: null, audience: 'members', responsible_member_id: 'ala', deleted_at: null });
    put(t, 'event_participants', 'pk', { id: 'pk', event_id: 'basen', group_id: 'gk', member_id: 'kuba', deleted_at: null });
    return t;
  }
  it('„Wszystko”: wspólne zadanie przypomina; wydarzenie dziecka, które zawozi Ala — nie (tylko informacja w Moich sprawach)', () => {
    const r = planReminders(world(), ME, TODAY, toMs({ ...TODAY, hh: 6, mm: 0 }), { leadMin: 30, morning: '07:00' }, opts);
    expect(r.map((x) => [x.id, x.body])).toEqual([
      ['m|2026-10-07', '1/0: 17:00 Zbiórka'],
      ['t|zbiorka|2026-10-07', '17:00 · Klasa'],
    ]);
  });
  it('„Przypisane do mnie i wydarzenia”: wspólne nieprzypisane zadanie bez przypomnienia i bez porannego podsumowania', () => {
    const r = planReminders(world(), ME, TODAY, toMs({ ...TODAY, hh: 6, mm: 0 }), { leadMin: 30, morning: '07:00' }, { ...opts, scopeOf: () => 'mineAndEvents' as const });
    expect(r).toEqual([]);
  });
});
