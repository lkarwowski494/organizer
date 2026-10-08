import type { NewOp, Row } from '../sync-engine/client';
import { expandEvents } from '../views/events';
import { type Lesson, memberTimetable, timetableOps } from '../views/timetable';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
const today = { y: 2026, m: 10, d: 8 }; // czwartek; tydzień 5–11 października

function base(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
  return t;
}
const apply = (t: T, ops: NewOp[]) => {
  for (const o of ops) if (o.kind === 'create') put(t, o.entity, o.id, { id: o.id, group_id: o.group_id, deleted_at: null, version: 1, ...o.set });
  return t;
};
const L = (o: Partial<Lesson>): Lesson => ({ day: 0, title: 'Matematyka', start: '08:00', end: '08:45', week: 'both', ...o });
let n = 0;
const newId = () => `id${++n}`;
const run = (lessons: Lesson[], thisWeek: 'A' | 'B' = 'A', until: string | null = null) => timetableOps({ groupId: 'gf', memberId: 'kuba', lessons, thisWeek, today, until, newId });

describe('plan lekcji z tygodniami A/B (D112)', () => {
  it('co tydzień, tylko A i tylko B; ta sama lekcja w kilka dni = jedna seria; dziecko uczestnikiem', () => {
    const r = run([L({}), L({ day: 2 }), L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' }), L({ day: 1, title: 'Plastyka', start: '10:00', end: '11:30', week: 'B' })]);
    if ('error' in r) throw new Error(r.error);
    expect(r.series).toBe(3);
    const t = apply(base(), r.ops);
    const occ = expandEvents(t, ME, { y: 2026, m: 10, d: 5 }, { y: 2026, m: 10, d: 18 }).map((o) => `${o.date} ${o.title}`).sort();
    expect(occ).toEqual([
      '2026-10-05 Matematyka', '2026-10-06 Basen', '2026-10-07 Matematyka',
      '2026-10-12 Matematyka', '2026-10-13 Plastyka', '2026-10-14 Matematyka',
    ]);
    const ev = Object.values(t.events!).find((e) => e.title === 'Basen')!;
    expect(ev).toMatchObject({ start_date: '2026-10-06', start_time: '10:00', end_time: '11:30', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', audience: 'members', kind: 'lesson' });
    expect(Object.values(t.event_participants!).every((p) => p.member_id === 'kuba')).toBe(true);
  });

  it('bieżący tydzień to B: lekcja A od przyszłego tygodnia; „do dnia” kończy serię', () => {
    const r = run([L({ week: 'A', day: 4 })], 'B', '2027-06-25');
    if ('error' in r) throw new Error(r.error);
    expect(r.ops[0]).toMatchObject({ set: { start_date: '2026-10-16', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270625' } });
  });

  it('puste wiersze pomijane; nic — błąd; zły wiersz — numer wiersza', () => {
    expect(run([L({ title: ' ', start: '', end: '' })])).toEqual({ error: 'empty', index: -1 });
    expect(run([L({ title: '', start: '', end: '' }), L({ title: '' })])).toEqual({ error: 'title', index: 1 });
    expect(run([L({ end: '07:00' })])).toEqual({ error: 'endBeforeStart', index: 0 });
    expect(run([L({ start: '8' })])).toEqual({ error: 'time', index: 0 });
  });
});

describe('edycja planu (D128)', () => {
  const lesson = (t: T, id: string, over: Row, who = 'kuba') => {
    put(t, 'events', id, { id, group_id: 'gf', title: id, start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, ...over });
    put(t, 'event_participants', `p-${id}`, { id: `p-${id}`, event_id: id, member_id: who, deleted_at: null });
  };

  it('obecny plan: trwające serie lekcji tej osoby; A/B z tygodnia początku; wspólna data końca', () => {
    const t = apply(base(), (run([L({}), L({ day: 2 }), L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' }), L({ day: 1, title: 'Plastyka', start: '10:00', end: '11:30', week: 'B' })]) as { ops: NewOp[] }).ops);
    const p = memberTimetable(t, 'gf', 'kuba', today);
    expect(p.lessons).toEqual([
      L({}),
      L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' }),
      L({ day: 1, title: 'Plastyka', start: '10:00', end: '11:30', week: 'B' }),
      L({ day: 2 }),
    ]);
    expect(p.series).toHaveLength(3);
    expect(p.until).toBe('');
    // Pominięte: zakończona, cudza, zwykłe wydarzenie, usunięta, inna grupa, jednorazowa, nie co tydzień, zła reguła.
    const u = base();
    lesson(u, 'stara', { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261007' });
    lesson(u, 'ali', {}, 'ala');
    lesson(u, 'zwykle', { kind: 'event' });
    lesson(u, 'kosz', { deleted_at: 'x' });
    lesson(u, 'inna', { group_id: 'gx' });
    lesson(u, 'raz', { rrule: null });
    lesson(u, 'dzien', { rrule: 'FREQ=DAILY' });
    lesson(u, 'zla', { rrule: 'FREQ=NIE' });
    put(u, 'event_participants', 'p-out', { id: 'p-out', event_id: 'zwykle', member_id: 'kuba', deleted_at: 'x' });
    expect(memberTimetable(u, 'gf', 'kuba', today)).toEqual({ lessons: [], until: '', series: [] });
    // Co 2 tygodnie: początek tydzień temu — B; dwa tygodnie temu — A; za tydzień — B. Bez BYDAY — dzień początku.
    lesson(u, 'b', { start_date: '2026-09-29', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20270625' });
    lesson(u, 'a', { start_date: '2026-09-21', rrule: 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20270625' });
    lesson(u, 'z', { start_date: '2026-10-16', start_time: null, end_time: null, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270625' });
    const q = memberTimetable(u, 'gf', 'kuba', today);
    expect(q.lessons.map((l) => [l.title, l.day, l.week, l.start])).toEqual([['a', 0, 'A', '08:00'], ['b', 1, 'B', '08:00'], ['z', 4, 'B', '']]);
    expect(q.until).toBe('2027-06-25');
    lesson(u, 'bez', {});
    expect(memberTimetable(u, 'gf', 'kuba', today).until).toBe('');
  });

  it('zapis: stare serie kończą się wczoraj (nierozpoczęte do kosza), nowe od pierwszego dnia od dziś; cofnięcie przywraca', () => {
    const t = apply(base(), (run([L({}), L({ day: 2 }), L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' }), L({ day: 1, title: 'Plastyka', start: '10:00', end: '11:30', week: 'B' })]) as { ops: NewOp[] }).ops);
    const p = memberTimetable(t, 'gf', 'kuba', today);
    const [mat, basen, plast] = ['Matematyka', 'Basen', 'Plastyka'].map((x) => Object.values(t.events!).find((e) => e.title === x)!.id as string);
    const r = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: p.lessons.filter((l) => l.title !== 'Plastyka'), thisWeek: 'A', today, until: null, newId, existing: p.series });
    if ('error' in r) throw new Error(r.error);
    expect(r.ops.slice(0, 3)).toEqual([
      { kind: 'patch', entity: 'events', id: mat, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261007' } },
      { kind: 'patch', entity: 'events', id: basen, set: { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261007' } },
      { kind: 'delete', entity: 'events', id: plast },
    ]);
    const created = r.ops.filter((o): o is Extract<NewOp, { kind: 'create' }> => o.kind === 'create' && o.entity === 'events');
    // Matematyka pn. i śr. — najbliższa od czwartku 8.10 to pn. 12.10; Basen w tygodniu A — wt. 20.10.
    expect(created.map((o) => [o.set.title, o.set.start_date, o.set.rrule, o.set.kind])).toEqual([
      ['Matematyka', '2026-10-12', 'FREQ=WEEKLY;BYDAY=MO,WE', 'lesson'],
      ['Basen', '2026-10-20', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'lesson'],
    ]);
    expect(r.undo).toEqual([
      ...created.map((o) => ({ kind: 'delete', entity: 'events', id: o.id })),
      { kind: 'patch', entity: 'events', id: mat, set: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' } },
      { kind: 'patch', entity: 'events', id: basen, set: { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU' } },
      { kind: 'restore', entity: 'events', id: plast },
    ]);
    // Pusty plan przy edycji kończy plan (bez nowych serii).
    const end = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: [], thisWeek: 'A', today, until: null, newId, existing: p.series });
    expect(end).toMatchObject({ series: 0 });
    expect((end as { ops: NewOp[] }).ops.every((o) => o.kind !== 'create')).toBe(true);
  });
});

