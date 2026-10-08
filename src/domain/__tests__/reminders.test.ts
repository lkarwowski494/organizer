import type { Row } from '../sync-engine/client';
import { planReminders } from '../views/reminders';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
// Strefa uproszczona do UTC+2 (CEST) — przeliczenie warszawskie testuje clock.test.ts.
const toMs = (l: { y: number; m: number; d: number; hh: number; mm: number }) => Date.UTC(l.y, l.m - 1, l.d, l.hh - 2, l.mm);
const opts = (extra = {}) => ({ days: 3, max: 40, toMs, localDate: (iso: string) => iso.slice(0, 10), label: { trip: (n: string) => `Zakupy: ${n}`, morningTitle: 'Dziś', more: (n: number) => `i ${n} więcej`, summary: (n: number, o: number) => `${n}/${o}` }, ...extra });
const TODAY = { y: 2026, m: 10, d: 7 };
const NOW = toMs({ ...TODAY, hh: 10, mm: 0 });

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'lists', 'l', { id: 'l', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
  const task = (id: string, extra: Row) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: id, assignee_member_id: 'mf', deadline_mode: 'own', due_date: null, due_time: null, completed_at: null, deleted_at: null, rollover: true, ...extra });
  task('paczka', { due_date: '2026-10-07', due_time: '17:30:00' });
  task('rano', { due_date: '2026-10-07', due_time: '09:00' }); // już minęło
  task('kwiaty', { due_date: '2026-10-08' });
  task('rachunek', { due_date: '2026-10-05' }); // zaległe → do dzisiejszego zbiorczego (ale 8:00 dziś minęło)
  task('zrobione', { due_date: '2026-10-08', due_time: '12:00', completed_at: '2026-10-07T08:00:00Z' });
  task('bezterminu', { deadline_mode: 'none' });
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', start_date: '2026-10-08', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: 'mf', deleted_at: null });
  put(t, 'lists', 'z', { id: 'z', group_id: 'gf', kind: 'shopping', name: 'Biedronka', visibility: 'group', deleted_at: null, due_date: '2026-10-09', responsible_member_id: 'mf' });
  return t;
}

describe('plan przypomnień (D75)', () => {
  it('z godziną — 30 min przed; bez godziny — zbiorcze o 8:00; tylko przyszłe; po kolei', () => {
    const r = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts());
    expect(r.map((x) => [x.id, new Date(x.at).toISOString(), x.title, x.body])).toEqual([
      ['t|paczka|2026-10-07', '2026-10-07T15:00:00.000Z', 'paczka', '17:30 · Rodzina'],
      ['m|2026-10-08', '2026-10-08T06:00:00.000Z', 'Dziś', '2/0: kwiaty, 18:00 Tańce'],
      ['e|ev|2026-10-08|2026-10-08', '2026-10-08T15:30:00.000Z', 'Tańce', '18:00 · Rodzina'],
      ['m|2026-10-09', '2026-10-09T06:00:00.000Z', 'Dziś', '1/0: Zakupy: Biedronka'],
    ]);
  });

  it('wyłączone: bez przypomnień przed i bez zbiorczego; rano wcześniej niż teraz — zbiorcze dziś', () => {
    expect(planReminders(world(), ME, TODAY, NOW, { leadMin: 0, morning: 'off' }, opts())).toEqual([]);
    const early = toMs({ ...TODAY, hh: 6, mm: 0 });
    const r = planReminders(world(), ME, TODAY, early, { leadMin: 10, morning: '07:00' }, opts({ days: 1 }));
    expect(r.map((x) => [x.id, x.body])).toEqual([
      ['m|2026-10-07', '3/1: rachunek, 09:00 rano, 17:30 paczka'],
      ['t|rano|2026-10-07', '09:00 · Rodzina'],
      ['t|paczka|2026-10-07', '17:30 · Rodzina'],
    ]);
  });

  it('zbiorcze skraca długą listę; limit liczby powiadomień', () => {
    const t = world();
    for (const n of ['a', 'b', 'c', 'd', 'e']) put(t, 'tasks', n, { ...t.tasks!.kwiaty!, id: n, title: n });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts());
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('7/0: a, b, c, d i 3 więcej');
    expect(planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ max: 2 })).map((x) => x.id)).toEqual(['t|paczka|2026-10-07', 'm|2026-10-08']);
    // Ta sama chwila — kolejność po identyfikatorze (stała na każdym telefonie).
    put(t, 'events', 'ev2', { ...t.events!.ev!, id: 'ev2', title: 'Odbiór', start_date: '2026-10-07', start_time: '17:30:00' });
    expect(planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ max: 2 })).map((x) => x.id)).toEqual(['e|ev2|2026-10-07|2026-10-07', 't|paczka|2026-10-07']);
  });
});
