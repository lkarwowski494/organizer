import * as fc from 'fast-check';

import type { Row } from '../sync-engine/client';
import { planReminders } from '../views/reminders';
import { nextId } from '../views/task-repeat';

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
  put(t, 'lists', 'z', { id: 'z', group_id: 'gf', kind: 'shopping', name: 'Bazar', visibility: 'group', deleted_at: null, due_date: '2026-10-09', responsible_member_id: 'mf' });
  return t;
}

describe('plan przypomnień (D75)', () => {
  it('z godziną — 30 min przed; bez godziny — zbiorcze o 8:00; tylko przyszłe; po kolei', () => {
    const r = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts());
    expect(r.map((x) => [x.id, new Date(x.at).toISOString(), x.title, x.body])).toEqual([
      ['t|paczka|2026-10-07', '2026-10-07T15:00:00.000Z', 'paczka', '17:30 · Rodzina'],
      // Audyt 2 (T-21, Q-9): jutro i pojutrze z zaległymi („rachunek” i dzisiejsze niezrobione z „przenoś”).
      ['m|2026-10-08', '2026-10-08T06:00:00.000Z', 'Dziś', '5/3: rachunek, paczka, rano, kwiaty i 1 więcej'],
      ['e|ev|2026-10-08|2026-10-08', '2026-10-08T15:30:00.000Z', 'Tańce', '18:00 · Rodzina'],
      ['m|2026-10-09', '2026-10-09T06:00:00.000Z', 'Dziś', '5/4: rachunek, paczka, rano, kwiaty i 1 więcej'],
    ]);
  });

  it('dotknięcie otwiera sprawę (PWD-16): zadanie, zakupy (lista), termin wydarzenia, poranne — „Moje sprawy”', () => {
    const r = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, { ...opts(), days: 3 });
    const target = (id: string) => r.find((x) => x.id === id)?.target;
    expect(target('t|paczka|2026-10-07')).toEqual({ screen: 'task', id: 'paczka' });
    expect(target('e|ev|2026-10-08|2026-10-08')).toEqual({ screen: 'event', id: 'ev', date: '2026-10-08' });
    expect(target('m|2026-10-08')).toEqual({ screen: 'today' });
    const trip = planReminders({ ...world(), lists: { ...world().lists, z: { ...world().lists!.z!, due_time: '18:00' } } }, ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts());
    expect(trip.find((x) => x.id.startsWith('t|z|'))!.target).toEqual({ screen: 'list', id: 'z' });
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
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('10/3: rachunek, paczka, rano, a i 6 więcej');
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
    expect(r.filter((x) => x.id.startsWith('l|') || x.id.startsWith('e|'))).toEqual([{ id: 'l|ev|2026-10-08|2026-10-08', at: leave, title: 'Czas wyjść: Tańce', body: 'Wyjdź teraz · 25 min autem', target: { screen: 'event', id: 'ev', date: '2026-10-08' } }]);
    const past = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, { ...base, leaveFor: () => ({ at: NOW - 1, body: 'x' }) });
    expect(past.some((x) => x.id.startsWith('l|') || x.id.startsWith('e|'))).toBe(false);
    const none = planReminders(world(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, { ...base, leaveFor: () => null });
    expect(none.some((x) => x.id.startsWith('e|ev'))).toBe(true);
  });
});

describe('„Czas wyjść” osobno od „Przed sprawą z godziną” (PWD-17, decyzja właściciela 8.10.2026)', () => {
  it('wyłączony — wydarzenie z dojazdem dostaje zwykłe „N min przed”; oba wyłączone — nic', () => {
    const leaveFor = (id: string) => (id === 'ev' ? { at: Date.UTC(2026, 9, 8, 15, 20), body: 'Wyjdź teraz' } : null);
    const base = opts({ leaveFor, label: { ...opts().label, leave: (x: string) => `Czas wyjść: ${x}` } });
    const ids = (s: { leadMin: number; leave?: boolean }) => planReminders(world(), ME, TODAY, NOW, { ...s, morning: 'off' }, base).filter((x) => x.id.includes('|ev|')).map((x) => x.id);
    expect(ids({ leadMin: 30 })).toEqual(['l|ev|2026-10-08|2026-10-08']);
    expect(ids({ leadMin: 30, leave: true })).toEqual(['l|ev|2026-10-08|2026-10-08']);
    expect(ids({ leadMin: 0, leave: true })).toEqual(['l|ev|2026-10-08|2026-10-08']);
    expect(ids({ leadMin: 30, leave: false })).toEqual(['e|ev|2026-10-08|2026-10-08']);
    expect(ids({ leadMin: 0, leave: false })).toEqual([]);
  });
});

describe('lekcje dziecka bez przypomnień (D127)', () => {
  it('zwinięte lekcje nie dają przypomnienia ani miejsca w porannym podsumowaniu', () => {
    const t: T = {};
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
    put(t, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-10-08', start_time: '08:00:00', end_time: '08:45:00', rrule: null, audience: 'members', kind: 'lesson', deleted_at: null });
    put(t, 'event_participants', 'p', { id: 'p', event_id: 'mat', member_id: 'tymek', deleted_at: null });
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
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('5/3: rachunek, paczka, rano, kwiaty i 1 więcej'); // 5 bez „buty” (pod Tańcami)
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
    // 8: zaległe rachunek, paczka, rano; Urodziny babci, kwiaty; 09:00 tort, 15:00 wazon (własne), 18:00 Tańce.
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('8/3: rachunek, paczka, rano, Urodziny babci i 4 więcej');
  });

  it('bez przypomnień przed (leadMin 0) podzadania trafiają do „Czas wyjść” wydarzenia', () => {
    const t = world2();
    put(t, 'tasks', 'buty', { id: 'buty', group_id: 'gf', list_id: 'l', parent_id: null, title: 'buty', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-08', due_time: '19:00', event_id: 'ev', occurrence_date: '2026-10-08', completed_at: null, deleted_at: null, rollover: true });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 0, morning: 'off' }, opts({ label, leaveFor: (id: string) => (id === 'ev' ? { at: NOW + 1000, body: 'Wyjdź teraz' } : null) }));
    expect(r.map((x) => [x.id, x.body])).toEqual([['l|ev|2026-10-08|2026-10-08', 'Wyjdź teraz · do zrobienia: buty']]);
  });
});

describe('poranne podsumowanie na kolejne dni liczy zaległe (audyt 2: T-21, N-12, Q-9)', () => {
  function world3(): T {
    const t: T = {};
    put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
    put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
    put(t, 'lists', 'l', { id: 'l', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
    const task = (id: string, extra: Row) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: id, assignee_member_id: 'mf', deadline_mode: 'own', due_date: null, due_time: null, completed_at: null, deleted_at: null, rollover: true, ...extra });
    task('rachunek', { due_date: '2026-10-05' });
    task('dzisiaj', { due_date: '2026-10-07', due_time: '17:00' });
    task('jednorazowe', { due_date: '2026-10-07', rollover: false }); // „Tylko tego dnia” — jutro już wygasłe
    task('jutro', { due_date: '2026-10-08' });
    task('zrobione', { due_date: '2026-10-06', completed_at: '2026-10-07T08:00:00Z' });
    return t;
  }

  it('jutro i pojutrze: niezrobione z „przenoś” sprzed tego dnia to zaległe (jak pokaże aplikacja tego dnia)', () => {
    const r = planReminders(world3(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts());
    const body = (id: string) => r.find((x) => x.id === id)?.body;
    expect(body('m|2026-10-08')).toBe('3/2: rachunek, dzisiaj, jutro');
    expect(body('m|2026-10-09')).toBe('3/3: rachunek, dzisiaj, jutro');
  });

  // Wyrocznia niezależna od myDays: dzień D liczy niezrobione z terminem D oraz z „przenoś” i terminem przed D.
  it('własność: podsumowanie dnia D = moje sprawy D, w tym zaległe', () => {
    const DATES = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    const spec = fc.record({ date: fc.constantFrom(...DATES), time: fc.constantFrom(null, '12:00', '20:00'), rollover: fc.boolean(), done: fc.boolean() });
    fc.assert(
      fc.property(fc.array(spec, { minLength: 1, maxLength: 8 }), (specs) => {
        const t: T = {};
        put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
        put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ł', role: 'admin', deleted_at: null });
        put(t, 'lists', 'l', { id: 'l', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
        specs.forEach((x, i) =>
          put(t, 'tasks', `k${i}`, { id: `k${i}`, group_id: 'gf', list_id: 'l', parent_id: null, title: `zad${i}`, assignee_member_id: 'mf', deadline_mode: 'own', due_date: x.date, due_time: x.time, completed_at: x.done ? '2026-10-06T08:00:00Z' : null, deleted_at: null, rollover: x.rollover }),
        );
        const r = planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, { ...opts(), max: 500 });
        for (const day of ['2026-10-08', '2026-10-09']) {
          const open = specs.filter((x) => !x.done);
          const overdue = open.filter((x) => x.rollover && x.date < day).length;
          const total = open.filter((x) => x.date === day).length + overdue;
          const got = r.find((x) => x.id === `m|${day}`)?.body.split(':')[0];
          if (got !== (total ? `${total}/${overdue}` : undefined)) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  // Audyt 2 (Q-4): własność audytora 12 na stałe — zmiana widoku przyszłych dni nie może zgubić przypomnień podzadań.
  it('własność: każde moje niezrobione zadanie z własną godziną w przyszłości ma przypomnienie nie później niż swoje', () => {
    const LEAD = 30;
    const label = { trip: (n: string) => n, morningTitle: 'Dziś', more: (n: number) => `+${n}`, summary: (n: number, o: number) => `${n}/${o}`, leave: (x: string) => x, subtasks: (xs: string[]) => `pod: ${xs.join(', ')}` };
    const spec = fc.record({ parent: fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }), date: fc.constantFrom('2026-10-06', '2026-10-07', '2026-10-08'), time: fc.constantFrom(null, '12:00', '18:00', '20:00'), own: fc.boolean() });
    fc.assert(
      fc.property(fc.array(spec, { minLength: 1, maxLength: 6 }), (specs) => {
        const t: T = {};
        put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
        put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ł', role: 'admin', deleted_at: null });
        put(t, 'lists', 'l', { id: 'l', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', deleted_at: null });
        specs.forEach((x, i) => {
          const parent = x.parent !== undefined && x.parent < i ? `k${x.parent}` : null;
          const own = parent === null || x.own;
          put(t, 'tasks', `k${i}`, { id: `k${i}`, group_id: 'gf', list_id: 'l', parent_id: parent, title: `zad${i}`, assignee_member_id: 'mf', deadline_mode: own ? 'own' : 'inherit', due_date: own ? x.date : null, due_time: own ? x.time : null, completed_at: null, deleted_at: null, rollover: true });
        });
        const r = planReminders(t, ME, TODAY, NOW, { leadMin: LEAD, morning: 'off' }, { days: 2, max: 200, toMs, localDate: (iso: string) => iso.slice(0, 10), label });
        return Object.values(t.tasks!).every((x) => {
          if (x.deadline_mode !== 'own' || !x.due_time) return true;
          const [y, m, d] = String(x.due_date).split('-').map(Number) as [number, number, number];
          const [hh, mm] = String(x.due_time).split(':').map(Number) as [number, number];
          const moment = toMs({ y, m, d, hh, mm }) - LEAD * 60_000;
          if (moment <= NOW) return true;
          return r.some((z) => (z.id === `t|${x.id}|${x.due_date}` && z.at === moment) || (z.at <= moment && z.body.includes(String(x.title))));
        });
      }),
      { numRuns: 300 },
    );
  });
});

describe('„Nie będę” wycisza przypomnienia tego terminu (PW-23, decyzja właściciela 8.10.2026)', () => {
  function world4(): T {
    const t = world();
    put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
    put(t, 'events', 'grill', { id: 'grill', group_id: 'gf', title: 'Grill', start_date: '2026-10-08', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null });
    // Basen Tymka — dotyczy mnie przez dziecko (D58).
    put(t, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen Tymka', start_date: '2026-10-08', start_time: '16:00:00', end_time: null, rrule: null, audience: 'members', deleted_at: null });
    put(t, 'event_participants', 'pb', { id: 'pb', event_id: 'basen', member_id: 'tymek', deleted_at: null });
    // Zadanie wystąpienia grilla z własną godziną.
    put(t, 'tasks', 'kielbasa', { id: 'kielbasa', group_id: 'gf', list_id: 'l', parent_id: null, title: 'kiełbasa', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-08', due_time: '15:00', event_id: 'grill', occurrence_date: '2026-10-08', completed_at: null, deleted_at: null, rollover: true });
    return t;
  }
  const answer = (t: T, id: string, eventId: string, member: string, a: string, extra: Row = {}) =>
    put(t, 'event_rsvps', id, { id, group_id: 'gf', event_id: eventId, occurrence_date: '2026-10-08', member_id: member, answer: a, deleted_at: null, ...extra });
  const leaveFor = (id: string) => (id === 'grill' ? { at: Date.UTC(2026, 9, 8, 15, 20), body: 'Wyjdź teraz' } : null);
  const run = (t: T) => planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ leaveFor, label: { ...opts().label, leave: (x: string) => `Czas wyjść: ${x}` } }));

  it('moje „nie”: bez „Czas wyjść”, bez „30 min przed”, bez miejsca w porannym; zadanie terminu przypomina samo', () => {
    const before = run(world4());
    expect(before.filter((x) => x.id.includes('grill')).map((x) => x.id)).toEqual(['l|grill|2026-10-08|2026-10-08']);
    // 8: zaległe rachunek, paczka, rano; kwiaty; 15:00 kiełbasa (własne, wcześniej niż wyjście), 16:00 Basen Tymka, 18:00 Grill, 18:00 Tańce.
    expect(before.find((x) => x.id === 'm|2026-10-08')!.body).toBe('8/3: rachunek, paczka, rano, kwiaty i 4 więcej');
    const t = world4();
    answer(t, 'r1', 'grill', 'mf', 'no');
    const r = run(t);
    expect(r.filter((x) => x.id.includes('grill'))).toEqual([]);
    // Bez grilla; kiełbasa — już nie pod grillem — liczy się sama i przypomina sama (15:00 → 14:30).
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('7/3: rachunek, paczka, rano, kwiaty i 3 więcej');
    expect(r.find((x) => x.id === 't|kielbasa|2026-10-08')).toMatchObject({ at: Date.UTC(2026, 9, 8, 12, 30), body: '15:00 · Rodzina' });
  });

  it('zmiana zdania przywraca przypomnienia; „może”, „będę”, odpowiedź usunięta, cudza — bez zmian', () => {
    for (const [a, extra] of [['yes', {}], ['maybe', {}], ['no', { deleted_at: '2026-10-07T09:00:00Z' }]] as const) {
      const t = world4();
      answer(t, 'r1', 'grill', 'mf', a, extra);
      expect(run(t).some((x) => x.id === 'l|grill|2026-10-08|2026-10-08')).toBe(true);
    }
    const t = world4();
    answer(t, 'r2', 'grill', 'ala', 'no'); // cudza odpowiedź
    answer(t, 'r3', 'basen', 'tymek', 'maybe'); // dziecko „może” — przypomnienie zostaje
    answer(t, 'r4', 'grill', 'mf', 'no', { occurrence_date: '2026-10-15' }); // inny termin
    answer(t, 'r5', 'grill', 'mf', 'no', { group_id: 'obca' }); // spoza moich grup
    const r = run(t);
    expect(r.some((x) => x.id === 'l|grill|2026-10-08|2026-10-08')).toBe(true);
    expect(r.some((x) => x.id === 'e|basen|2026-10-08|2026-10-08')).toBe(true);
  });
});

describe('termin tylko przez dzieci, żadne nie będzie — bez przypomnień (D160, decyzja koordynatora 8.10.2026)', () => {
  function world6(): T {
    const t = world();
    const kid = (id: string, user: string | null, deleted: string | null = null) =>
      put(t, 'group_members', id, { member_id: id, group_id: 'gf', user_id: user, display_name: id, role: 'child', deleted_at: deleted });
    kid('tymek', null);
    kid('ola', 'u-ola'); // dziecko z kontem odpowiada samo — liczy się tak samo
    kid('stary', null, '2026-01-01');
    put(t, 'group_members', 'ala', { member_id: 'ala', group_id: 'gf', user_id: 'u-ala', display_name: 'Ala', role: 'member', deleted_at: null });
    put(t, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen', start_date: '2026-10-08', start_time: '16:00:00', end_time: null, rrule: 'FREQ=WEEKLY', audience: 'members', responsible_member_id: null, deleted_at: null });
    for (const m of ['tymek', 'ola', 'stary', 'ala']) put(t, 'event_participants', `p-${m}`, { id: `p-${m}`, event_id: 'basen', member_id: m, deleted_at: null });
    return t;
  }
  const no = (t: T, member: string, date = '2026-10-08', extra: Row = {}) =>
    put(t, 'event_rsvps', `r-${member}-${date}`, { id: `r-${member}-${date}`, group_id: 'gf', event_id: 'basen', occurrence_date: date, member_id: member, answer: 'no', deleted_at: null, ...extra });
  const leaveFor = (id: string, occ: string) => (id === 'basen' ? { at: toMs({ ...TODAY, d: Number(occ.slice(8)), hh: 15, mm: 20 }), body: 'Wyjdź teraz' } : null);
  const run = (t: T) => planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ days: 2, leaveFor, label: { ...opts().label, leave: (x: string) => `Czas wyjść: ${x}` } }));
  const basen = (t: T) => run(t).filter((x) => x.id.includes('basen')).map((x) => x.id);

  it('każde dziecko „nie będzie”: bez „Czas wyjść” i bez „N min przed”; dorosły uczestnik obok nie zmienia', () => {
    expect(basen(world6())).toEqual(['l|basen|2026-10-08|2026-10-08']);
    const t = world6();
    no(t, 'tymek');
    expect(basen(t)).toEqual(['l|basen|2026-10-08|2026-10-08']); // Ola jeszcze nie odpowiedziała
    no(t, 'ola');
    expect(basen(t)).toEqual([]);
  });

  it('bez wyciszenia: jestem uczestnikiem, odpowiadam za termin, „nie” usunięte albo na inny dzień, dorosły (ja) jako dziecko', () => {
    const both = (t: T) => (no(t, 'tymek'), no(t, 'ola'), t);
    const me = both(world6());
    put(me, 'event_participants', 'p-me', { id: 'p-me', event_id: 'basen', member_id: 'mf', deleted_at: null });
    expect(basen(me)).toHaveLength(1);
    const resp = both(world6());
    put(resp, 'event_overrides', 'o', { id: 'o', event_id: 'basen', occurrence_date: '2026-10-08', cancelled: false, responsible_member_id: 'mf', deleted_at: null });
    expect(basen(resp)).toHaveLength(1);
    const gone = world6();
    no(gone, 'tymek');
    no(gone, 'ola', '2026-10-08', { deleted_at: '2026-10-07T09:00:00Z' });
    expect(basen(gone)).toHaveLength(1);
    const other = world6();
    no(other, 'tymek', '2026-10-15');
    no(other, 'ola', '2026-10-15');
    expect(basen(other)).toHaveLength(1);
  });

  it('osoba odpowiedzialna usunięta z grupy (D132) nie blokuje wyciszenia; wydarzenie całej grupy i nieznane — bez zmian', () => {
    const t = world6();
    t.events!.basen = { ...t.events!.basen!, responsible_member_id: 'stary' };
    no(t, 'tymek');
    no(t, 'ola');
    expect(basen(t)).toEqual([]);
    const all = world6();
    all.events!.basen = { ...all.events!.basen!, audience: 'group' };
    no(all, 'tymek');
    no(all, 'ola');
    expect(basen(all)).toHaveLength(1);
    const unknown = world6();
    put(unknown, 'event_rsvps', 'x', { id: 'x', group_id: 'gf', event_id: 'nieznane', occurrence_date: '2026-10-08', member_id: 'tymek', answer: 'no', deleted_at: null });
    expect(basen(unknown)).toHaveLength(1);
  });

  it('bez dziecka wśród uczestników i w obcej grupie — bez wyciszenia', () => {
    const t = world6();
    for (const m of ['tymek', 'ola']) t.event_participants![`p-${m}`] = { ...t.event_participants![`p-${m}`]!, deleted_at: '2026-10-01' };
    // Bez dzieci wydarzenie mnie nie dotyczy (D58) — tu tylko pilnujemy, że „nie” Ali nic nie wycisza.
    no(t, 'ala');
    expect(run(t).some((x) => x.id.includes('basen'))).toBe(false);
    const foreign = world6();
    foreign.events!.basen = { ...foreign.events!.basen!, group_id: 'obca' };
    no(foreign, 'tymek');
    no(foreign, 'ola');
    expect(basen(foreign)).toEqual([]);
  });

  it('dziecko na moim koncie (rola child) — reguła dla dorosłych', () => {
    const t = world6();
    t.group_members!.mf = { ...t.group_members!.mf!, role: 'child' };
    put(t, 'event_participants', 'p-me', { id: 'p-me', event_id: 'basen', member_id: 'mf', deleted_at: null });
    no(t, 'tymek');
    no(t, 'ola');
    expect(basen(t)).toHaveLength(1);
  });
});

describe('„Czas wyjść” już minął, a wydarzenie jeszcze nie — od razu „spóźniony” (PW-24, decyzja właściciela 8.10.2026)', () => {
  const label = { ...opts().label, leave: (x: string) => `Czas wyjść: ${x}`, late: (min: number) => `spóźnienie ${min} min`, subtasks: (xs: string[]) => `do zrobienia: ${xs.join(', ')}` };
  // Teraz 10:00 (8:00 UTC); wydarzenie „dzis” 11:00, wyjście wyliczone na 9:45 (już minęło).
  function world5(): T {
    const t = world();
    put(t, 'events', 'dzis', { id: 'dzis', group_id: 'gf', title: 'Dentysta', start_date: '2026-10-07', start_time: '11:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null });
    put(t, 'tasks', 'karta', { id: 'karta', group_id: 'gf', list_id: 'l', parent_id: null, title: 'karta', assignee_member_id: 'mf', deadline_mode: 'event', event_id: 'dzis', occurrence_date: '2026-10-07', due_date: null, due_time: null, completed_at: null, deleted_at: null, rollover: true });
    return t;
  }
  it('od razu, z liczbą minut spóźnienia; bez „N min przed”; zadania terminu w treści', () => {
    const leaveFor = (id: string) => (id === 'dzis' ? { at: NOW - 15 * 60_000 - 1, body: 'Wyjdź teraz' } : null);
    const r = planReminders(world5(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ label, leaveFor }));
    expect(r.filter((x) => x.id.includes('dzis'))).toEqual([{ id: 'l|dzis|2026-10-07|2026-10-07|late', at: NOW, now: true, title: 'Czas wyjść: Dentysta', body: 'spóźnienie 16 min · do zrobienia: karta', target: { screen: 'event', id: 'dzis', date: '2026-10-07' } }]);
    expect(r[0]!.id).toBe('l|dzis|2026-10-07|2026-10-07|late');
  });
  it('wyjście dokładnie teraz — „spóźnienie” co najmniej 1 min; wydarzenie już trwa — nic; bez tekstu spóźnienia — jak dotąd', () => {
    const at = (ms: number) => (id: string) => (id === 'dzis' ? { at: ms, body: 'Wyjdź teraz' } : null);
    const now = planReminders(world5(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ label, leaveFor: at(NOW) }));
    expect(now.find((x) => x.id.startsWith('l|dzis'))!.body).toBe('spóźnienie 1 min · do zrobienia: karta');
    const started = planReminders(world5(), ME, TODAY, toMs({ ...TODAY, hh: 11, mm: 5 }), { leadMin: 30, morning: 'off' }, opts({ label, leaveFor: at(NOW) }));
    expect(started.some((x) => x.id.includes('dzis'))).toBe(false);
    const quiet = planReminders(world5(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ label: { ...label, late: undefined }, leaveFor: at(NOW - 60_000) }));
    expect(quiet.some((x) => x.id.includes('dzis'))).toBe(false);
  });
});

describe('zadanie dziecka bez konta przypomina dorosłym (decyzja właściciela z 8.10.2026, PW-1)', () => {
  function family(): T {
    const t = world();
    put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
    const task = (id: string, extra: Row) => put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'l', parent_id: null, title: id, assignee_member_id: 'tymek', deadline_mode: 'own', due_date: '2026-10-08', due_time: null, completed_at: null, deleted_at: null, rollover: true, ...extra });
    task('plecak', { due_time: '20:00' });
    task('zeszyt', { due_date: '2026-10-05' });
    return t;
  }
  const who = (p: { name: string; me: boolean }) => (p.me ? 'dla Ciebie' : `dla: ${p.name}`);

  it('przypomnienie z imieniem dziecka (jak „dla: …” w wierszu, D119); poranne liczy także zaległe dziecka', () => {
    const r = planReminders(family(), ME, TODAY, NOW, { leadMin: 30, morning: '08:00' }, opts({ label: { ...opts().label, who } }));
    expect(r.find((x) => x.id === 't|plecak|2026-10-08')).toMatchObject({ title: 'plecak', body: '20:00 · Rodzina · dla: Tymek' });
    // Moje zadanie bez dopisku (jak dotąd).
    expect(r.find((x) => x.id === 't|paczka|2026-10-07')!.body).toBe('17:30 · Rodzina');
    // Jutro z zaległymi (M-88): rachunek, zeszyt (dziecka), paczka, rano; kwiaty, 18:00 Tańce, 20:00 plecak.
    expect(r.find((x) => x.id === 'm|2026-10-08')!.body).toBe('7/4: rachunek, zeszyt, paczka, rano i 3 więcej');
    const early = planReminders(family(), ME, TODAY, toMs({ ...TODAY, hh: 6, mm: 0 }), { leadMin: 0, morning: '07:00' }, opts({ days: 1 }));
    expect(early.map((x) => [x.id, x.body])).toEqual([['m|2026-10-07', '4/2: rachunek, zeszyt, 09:00 rano, 17:30 paczka']]);
    // Bez etykiety (starsze wywołania) — treść jak dotąd.
    expect(planReminders(family(), ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts()).find((x) => x.id === 't|plecak|2026-10-08')!.body).toBe('20:00 · Rodzina');
  });
});

describe('start_date („widoczne od”) a przypomnienia na kolejne dni (audyt 2: T-23)', () => {
  it('zadanie widoczne od jutra z terminem jutro 17:00 ma przypomnienie zaplanowane już dziś', () => {
    const t = world();
    put(t, 'tasks', 'basen', { ...t.tasks!.paczka!, id: 'basen', title: 'basen', due_date: '2026-10-08', due_time: '17:00', start_date: '2026-10-08' });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 30, morning: 'off' }, opts({ days: 2 }));
    expect(r.map((x) => x.id)).toEqual(['t|paczka|2026-10-07', 't|basen|2026-10-08', 'e|ev|2026-10-08|2026-10-08']);
  });
});

describe('audyt 3 (N-27): następne zadania powtarzanego, którego jeszcze nie ma, też przypomina', () => {
  it('„Leki 8:00, codziennie, tylko tego dnia” niezrobione dziś — przypomnienie jutro i pojutrze, zanim ktoś otworzy aplikację', () => {
    const t = world();
    put(t, 'tasks', 'leki', { ...t.tasks!.paczka!, id: 'leki', title: 'Leki', due_date: '2026-10-07', due_time: '08:00', rollover: false, repeat: 'FREQ=DAILY' });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 5, morning: 'off' }, opts()).filter((x) => x.title === 'Leki');
    const first = nextId('leki');
    expect(r.map((x) => [x.id, new Date(x.at).toISOString(), x.target])).toEqual([
      [`t|${first}|2026-10-08`, '2026-10-08T05:55:00.000Z', { screen: 'task', id: first }],
      [`t|${nextId(first)}|2026-10-09`, '2026-10-09T05:55:00.000Z', { screen: 'task', id: nextId(first) }],
    ]);
    // Dane same w sobie bez zmian (kopie są tylko w planie).
    expect(t.tasks![first]).toBeUndefined();
  });

  it('odhaczone przez dziecko na starszej wersji (bez następnego) — następne przypomina od razu', () => {
    const t = world();
    put(t, 'tasks', 'lozko', { ...t.tasks!.paczka!, id: 'lozko', title: 'Łóżko', due_date: '2026-10-07', due_time: '19:00', repeat: 'FREQ=DAILY', completed_at: '2026-10-07T06:00:00Z' });
    const r = planReminders(t, ME, TODAY, NOW, { leadMin: 10, morning: 'off' }, opts()).filter((x) => x.title === 'Łóżko');
    expect(r.map((x) => x.id)).toEqual([`t|${nextId('lozko')}|2026-10-08`]);
  });
});
