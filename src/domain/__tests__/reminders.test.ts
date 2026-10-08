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

describe('„Czas wyjść” zamiast przypomnienia przed (D117)', () => {
  it('wydarzenie z policzonym dojazdem — o godzinie wyjścia; bez dojazdu — jak dotąd; minione wyjście — nic', () => {
    const leave = Date.UTC(2026, 9, 8, 15, 20);
    const base = opts({ label: { trip: (n: string) => n, morningTitle: 'Dziś', more: (n: number) => `+${n}`, summary: () => 's', leave: (t: string) => `Czas wyjść: ${t}` } });
    const r = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, { ...base, leaveFor: (id, occ) => (id === 'ev' && occ === '2026-10-08' ? { at: leave, body: 'Wyjdź teraz · 25 min autem' } : null) });
    expect(r.filter((x) => x.id.startsWith('l|') || x.id.startsWith('e|'))).toEqual([{ id: 'l|ev|2026-10-08|2026-10-08', at: leave, title: 'Czas wyjść: Tańce', body: 'Wyjdź teraz · 25 min autem' }]);
    const past = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, { ...base, leaveFor: () => ({ at: NOW - 1, body: 'x' }) });
    expect(past.some((x) => x.id.startsWith('l|') || x.id.startsWith('e|'))).toBe(false);
    const none = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, { ...base, leaveFor: () => null });
    expect(none.some((x) => x.id.startsWith('e|ev'))).toBe(true);
  });
});

describe('lekcje dziecka bez przypomnień (D127)', () => {
  it('zwinięte lekcje nie dają przypomnienia ani miejsca w porannym podsumowaniu', () => {
    const t: T = {};
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
    put(t, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-10-08', start_time: '08:00:00', end_time: '08:45:00', rrule: null, audience: 'members', kind: 'lesson', deleted_at: null });
    put(t, 'event_participants', 'p', { id: 'p', event_id: 'mat', member_id: 'kuba', deleted_at: null });
    expect(planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '07:00' }, opts())).toEqual([]);
    // Ta sama lekcja jako zwykłe wydarzenie dziecka — przypomnienie jest.
    put(t, 'events', 'mat', { ...t.events!.mat!, kind: 'event' });
    expect(planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '07:00' }, opts()).map((r) => r.id)).toEqual(['m|2026-10-08', 'e|mat|2026-10-08|2026-10-08']);
  });
});

describe('jedno przypomnienie z podzadaniami (D134)', () => {
  it('podzadania i zadania wystąpienia bez własnych przypomnień; rodzic z listą; poranne liczy rodziców', () => {
    const t = world();
    const task = (id: string, extra: Row) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: id, assignee_member_id: 'mf', deadline_mode: 'inherit', due_date: null, due_time: null, completed_at: null, deleted_at: null, rollover: true, ...extra });
    task('karton', { parent_id: 'paczka' });
    task('taśma', { parent_id: 'karton' });
    // Zadanie wystąpienia „Tańce” jutro.
    task('buty', { deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-08' });
    const label = { ...opts().label, leave: (x: string) => `Wyjdź: ${x}`, subtasks: (xs: string[]) => `do zrobienia: ${xs.join(', ')}` };
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ label }));
    expect(r.filter((x) => /karton|taśma|buty/.test(x.id))).toEqual([]);
    expect(r.find((x) => x.id === 't|paczka|2026-10-07')!.body).toBe('17:30 · Rodzina · do zrobienia: karton, taśma');
    expect(r.find((x) => x.id === 'e|ev|2026-10-08|2026-10-08')!.body).toBe('18:00 · Rodzina · do zrobienia: buty');
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('2/0: kwiaty, 18:00 Tańce'); // bez „buty”
    const leave = planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ label, leaveFor: (id: string) => (id === 'ev' ? { at: NOW + 1000, body: 'Wyjdź teraz' } : null) }));
    expect(leave.find((x) => x.id.startsWith('l|'))!.body).toBe('Wyjdź teraz · do zrobienia: buty');
    // Bez etykiety listy — treść jak dotąd.
    expect(planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts()).find((x) => x.id === 't|paczka|2026-10-07')!.body).toBe('17:30 · Rodzina');
  });
});

describe('zbiorcze przypomnienie nie przychodzi później niż własne (audyt 2: N-2, N-3, T-20)', () => {
  const label = { ...opts().label, leave: (x: string) => `Wyjdź: ${x}`, subtasks: (xs: string[]) => `do zrobienia: ${xs.join(', ')}`, parent: (x: string, ev: boolean) => `↳ ${x}${ev ? ' (wydarzenie)' : ''}` };
  function world2(): T {
    const t = world();
    const task = (id: string, extra: Row) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: id, assignee_member_id: 'mf', deadline_mode: 'own', due_date: null, due_time: null, completed_at: null, deleted_at: null, rollover: true, ...extra });
    // Wcześniej niż rodzic (17:30) — własne; później — w zbiorczym; wnuk bez godziny idzie za swoim rodzicem.
    task('karton', { parent_id: 'paczka', due_date: '2026-10-07', due_time: '12:00' });
    task('taśma', { parent_id: 'karton', deadline_mode: 'inherit' });
    task('etykieta', { parent_id: 'paczka', due_date: '2026-10-07', due_time: '18:00' });
    // Rodzic bez godziny (jutro) i zaległy (dziś) — podzadania z godziną przypominają same.
    task('wazon', { parent_id: 'kwiaty', due_date: '2026-10-08', due_time: '15:00' });
    task('przelew', { parent_id: 'rachunek', due_date: '2026-10-07', due_time: '15:00' });
    // Całodniowe wydarzenie i zadanie tego terminu z własną godziną.
    put(t, 'events', 'ur', { id: 'ur', group_id: 'gf', title: 'Urodziny babci', start_date: '2026-10-08', start_time: null, end_time: null, rrule: null, audience: 'group', deleted_at: null });
    task('tort', { event_id: 'ur', occurrence_date: '2026-10-08', due_date: '2026-10-08', due_time: '09:00' });
    return t;
  }

  it('własne przypomnienie z dopiskiem rodzica; rodzic bez tych pozycji w treści', () => {
    const r = planReminders(world2(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ label }));
    const body = (id: string) => r.find((x) => x.id === id)?.body;
    expect(body('t|karton|2026-10-07')).toBe('12:00 · Rodzina · ↳ paczka · do zrobienia: taśma');
    expect(body('t|paczka|2026-10-07')).toBe('17:30 · Rodzina · do zrobienia: etykieta');
    expect(body('t|wazon|2026-10-08')).toBe('15:00 · Rodzina · ↳ kwiaty');
    expect(body('t|przelew|2026-10-07')).toBe('15:00 · Rodzina · ↳ rachunek');
    expect(body('t|tort|2026-10-08')).toBe('09:00 · Rodzina · ↳ Urodziny babci (wydarzenie)');
    expect(r.filter((x) => /etykieta|taśma/.test(x.id))).toEqual([]);
  });

  it('poranne podsumowanie liczy podzadania z własnym przypomnieniem', () => {
    const r = planReminders(world2(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ label }));
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('5/0: Urodziny babci, kwiaty, 09:00 tort, 15:00 wazon i 1 więcej');
  });

  it('bez przypomnień przed (leadMin 0) podzadania trafiają do „Czas wyjść” wydarzenia', () => {
    const t = world2();
    put(t, 'tasks', 'buty', { id: 'buty', group_id: 'gf', list_id: 'l', parent_id: null, title: 'buty', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-08', due_time: '19:00', event_id: 'ev', occurrence_date: '2026-10-08', completed_at: null, deleted_at: null, rollover: true });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 0, morning: 'off' }, opts({ label, leaveFor: (id: string) => (id === 'ev' ? { at: NOW + 1000, body: 'Wyjdź teraz' } : null) }));
    expect(r.map((x) => [x.id, x.body])).toEqual([['l|ev|2026-10-08|2026-10-08', 'Wyjdź teraz · do zrobienia: buty']]);
  });
});
