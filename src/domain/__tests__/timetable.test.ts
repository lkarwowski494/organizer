import { splitId } from '../event-split';
import { parseIsoDate } from '../format';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { occurrenceResolver } from '../views/event-rows';
import { expandEvents } from '../views/events';
import { type Lesson, memberTimetable, swapWeeks, timetableOps } from '../views/timetable';

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
let seq = 0;
/** Operacje jak na telefonie (applyOp — także polecenie split_event). */
const run2 = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `op${seq}` } as Op);
  return t;
};
const lessonsOn = (t: T, from: string, to: string) => expandEvents(t, ME, parseIsoDate(from), parseIsoDate(to)).map((o) => `${o.date} ${o.title} ${o.startTime!.slice(0, 5)}`);
const endsOn = (t: T, from: string, to: string) => expandEvents(t, ME, parseIsoDate(from), parseIsoDate(to)).map((o) => o.endTime!.slice(0, 5));
const les = (t: T, id: string, over: Row, who = 'kuba') => {
  put(t, 'events', id, { id, group_id: 'gf', title: id, start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, ...over });
  put(t, 'event_participants', `p-${id}`, { id: `p-${id}`, group_id: 'gf', event_id: id, member_id: who, deleted_at: null });
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
    expect(memberTimetable(u, 'gf', 'kuba', today)).toEqual({ lessons: [], until: '', series: [], thisWeek: 'A', weekA: null });
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

  it('zapis: zmienione serie od jutra poleceniem „to i następne”, usunięta nierozpoczęta do kosza; cofnięcie przywraca', () => {
    const t = apply(base(), (run([L({}), L({ day: 2 }), L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' }), L({ day: 1, title: 'Plastyka', start: '10:00', end: '11:30', week: 'B' })]) as { ops: NewOp[] }).ops);
    const p = memberTimetable(t, 'gf', 'kuba', today);
    const [mat, basen, plast] = ['Matematyka', 'Basen', 'Plastyka'].map((x) => Object.values(t.events!).find((e) => e.title === x)!.id as string);
    // Zmienione godziny końca (bez zmian seria zostałaby nietknięta — audyt 2, E-5).
    const lessons = p.lessons.filter((l) => l.title !== 'Plastyka').map((l) => ({ ...l, end: l.title === 'Basen' ? '11:45' : '08:50' }));
    const r = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons, thisWeek: 'A', today, until: null, newId, edit: { tables: t, userId: ME, series: p.series } });
    if ('error' in r) throw new Error(r.error);
    // Matematyka pn. i śr. — od jutra (pt. 9.10) najbliższa pn. 12.10; Basen w tygodniu A — wt. 20.10; kotwica tygodnia A.
    expect(r.ops).toEqual([
      expect.objectContaining({ kind: 'cmd', cmd: 'split_event', args: expect.objectContaining({ event_id: mat, date: '2026-10-09', set: expect.objectContaining({ start_date: '2026-10-12', end_time: '08:50', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }) }) }),
      expect.objectContaining({ kind: 'cmd', cmd: 'split_event', args: expect.objectContaining({ event_id: basen, set: expect.objectContaining({ start_date: '2026-10-20', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU' }) }) }),
      { kind: 'delete', entity: 'events', id: plast },
      { kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-10-05' } },
    ]);
    expect(r.series).toBe(2);
    run2(t, r.ops);
    // Minione (pn. 5.10, wt. 6.10, śr. 7.10) jak były; od jutra nowe godziny końca.
    expect(endsOn(t, '2026-10-05', '2026-10-07')).toEqual(['08:45', '11:30', '08:45']);
    expect(lessonsOn(t, '2026-10-12', '2026-10-21')).toEqual(['2026-10-12 Matematyka 08:00', '2026-10-14 Matematyka 08:00', '2026-10-19 Matematyka 08:00', '2026-10-20 Basen 10:00', '2026-10-21 Matematyka 08:00']);
    expect(endsOn(t, '2026-10-12', '2026-10-21')).toEqual(['08:50', '08:50', '08:50', '11:45', '08:50']);
    run2(t, r.undo(t));
    // Stary plan wraca, z Plastyką (tydzień B) w pn. 12.10.
    expect(endsOn(t, '2026-10-12', '2026-10-21')).toEqual(['08:45', '11:30', '08:45', '08:45', '11:30', '08:45']);
    expect(t.events![plast!]!.deleted_at).toBeNull();
    expect(t.group_members!.kuba!.week_a).toBeNull();
    // Pusty plan przy edycji kończy plan (bez nowych serii).
    const end = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: [], thisWeek: 'A', today, until: null, newId, edit: { tables: t, userId: ME, series: p.series } });
    expect(end).toMatchObject({ series: 0 });
    expect((end as { ops: NewOp[] }).ops.every((o) => o.kind !== 'create')).toBe(true);
  });
});

describe('zapis planu bez zmian niczego nie rusza (audyt 2: E-5, E-27)', () => {
  const plan = () => apply(base(), (run([L({}), L({ day: 2 }), L({ day: 1, title: 'Basen', start: '10:00', end: '11:30', week: 'A' })]) as { ops: NewOp[] }).ops);
  const save = (t: T, lessons: Lesson[], extra: Partial<Parameters<typeof timetableOps>[0]> = {}) => {
    const p = memberTimetable(t, 'gf', 'kuba', today);
    return timetableOps({ groupId: 'gf', memberId: 'kuba', lessons, thisWeek: p.thisWeek, today, until: p.until || null, newId, edit: { tables: t, userId: ME, series: p.series }, weekA: '2026-10-05', ...extra });
  };

  it('ten sam plan: zero operacji (odwołane lekcje i zadania na terminach zostają)', () => {
    const t = plan();
    const r = save(t, memberTimetable(t, 'gf', 'kuba', today).lessons);
    expect(r).toMatchObject({ ops: [], series: 2 });
    expect((r as { undo: (t: T) => NewOp[] }).undo(t)).toEqual([]);
  });

  it('zmiana jednej serii: tylko ona przechodzi do nowej od jutra', () => {
    const t = plan();
    const lessons = memberTimetable(t, 'gf', 'kuba', today).lessons.map((l) => (l.title === 'Basen' ? { ...l, start: '10:15' } : l));
    const r = save(t, lessons);
    if ('error' in r) throw new Error(r.error);
    const basen = Object.values(t.events!).find((e) => e.title === 'Basen')!.id as string;
    expect(r.ops).toEqual([expect.objectContaining({ kind: 'cmd', args: expect.objectContaining({ event_id: basen, date: '2026-10-09' }) })]);
  });

  it('różne daty końca serii: bez zmiany pola „do dnia” każda zostaje ze swoją', () => {
    const t = plan();
    const [mat, basen] = ['Matematyka', 'Basen'].map((x) => Object.values(t.events!).find((e) => e.title === x)!);
    put(t, 'events', mat!.id as string, { ...mat!, rrule: `${mat!.rrule};UNTIL=20270625` });
    put(t, 'events', basen!.id as string, { ...basen!, rrule: `${basen!.rrule};UNTIL=20270130` });
    const p = memberTimetable(t, 'gf', 'kuba', today);
    expect(p.until).toBe('');
    expect(save(t, p.lessons, { until: null, keepUntil: true })).toMatchObject({ ops: [], series: 2 });
    // Wpisana nowa data końca dotyczy wszystkich serii.
    const r = save(t, p.lessons, { until: '2027-06-30', keepUntil: false });
    if ('error' in r) throw new Error(r.error);
    expect(r.ops.map((o) => (o as unknown as { args: { set: { rrule: string } } }).args.set.rrule)).toEqual(['FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270630', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20270630']);
  });
});

describe('tydzień A zapisany przy osobie (D171, audyt 2 M-15)', () => {
  const basen = () => {
    const t = base();
    les(t, 'basen', { title: 'Basen', start_date: '2026-10-05', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' });
    return t;
  };

  it('szkoła nazywa ten tydzień B: przełącznik zamienia litery, lekcje zostają w swoich dniach (E-4)', () => {
    const t = basen();
    const p = memberTimetable(t, 'gf', 'kuba', today);
    expect([p.thisWeek, p.weekA, p.lessons[0]!.week]).toEqual(['A', null, 'A']);
    const r = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: swapWeeks(p.lessons), thisWeek: 'B', today, until: null, newId, edit: { tables: t, userId: ME, series: p.series }, weekA: p.weekA });
    if ('error' in r) throw new Error(r.error);
    expect(r.ops).toEqual([{ kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-09-28' } }]);
    run2(t, r.ops);
    expect(lessonsOn(t, '2026-10-12', '2026-10-25')).toEqual(['2026-10-19 Basen 08:00']);
    // Litery stałe: w tym tygodniu B, za tydzień A — ta sama seria to zawsze B.
    expect(memberTimetable(t, 'gf', 'kuba', today)).toMatchObject({ thisWeek: 'B', weekA: '2026-09-28', lessons: [{ week: 'B' }] });
    expect(memberTimetable(t, 'gf', 'kuba', { y: 2026, m: 10, d: 15 })).toMatchObject({ thisWeek: 'A', lessons: [{ week: 'B' }] });
    expect(r.undo(t)).toEqual([{ kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: null } }]);
  });

  it('kotwica zgodna z przełącznikiem — bez zapisu; niezgodna — nowa; bez lekcji A/B — bez kotwicy; zła wartość = brak', () => {
    const t = basen();
    const p = memberTimetable(t, 'gf', 'kuba', today);
    const save = (thisWeek: 'A' | 'B', weekA: string | null, lessons = p.lessons) => (timetableOps({ groupId: 'gf', memberId: 'kuba', lessons, thisWeek, today, until: null, newId, edit: { tables: t, userId: ME, series: p.series }, weekA }) as { ops: NewOp[] }).ops;
    // 21.09 to też tydzień A, jeśli 5.10 jest A (dwa tygodnie różnicy, przez granicę miesiąca).
    expect(save('A', '2026-09-21')).toEqual([]);
    expect(save('B', '2026-09-21', swapWeeks(p.lessons))).toEqual([{ kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-09-28' } }]);
    // Tylko „co tydzień”: kotwica niepotrzebna.
    expect(timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: [L({})], thisWeek: 'A', today, until: null, newId })).toMatchObject({ ops: [expect.objectContaining({ kind: 'create' }), expect.anything()] });
    expect((timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: [L({})], thisWeek: 'A', today, until: null, newId }) as { ops: NewOp[] }).ops.some((o) => o.kind !== 'cmd' && o.entity === 'group_members')).toBe(false);
    put(t, 'group_members', 'kuba', { ...t.group_members!.kuba!, week_a: 'zle' });
    expect(memberTimetable(t, 'gf', 'kuba', today).weekA).toBeNull();
    // Rok z 53 tygodniami ISO (2026): kotwica z grudnia 2026 i styczeń 2027 — parzystość z różnicy dni.
    put(t, 'group_members', 'kuba', { ...t.group_members!.kuba!, week_a: '2026-12-28' });
    expect(memberTimetable(t, 'gf', 'kuba', { y: 2027, m: 1, d: 6 }).thisWeek).toBe('B');
  });

  it('swapWeeks: A↔B, „co tydzień” bez zmian', () => {
    expect(swapWeeks([L({}), L({ week: 'A' }), L({ week: 'B' })]).map((l) => l.week)).toEqual(['both', 'B', 'A']);
  });

  it('nowy plan: lekcje A/B zapisują kotwicę od razu', () => {
    const r = run([L({ week: 'B' })], 'B');
    expect((r as { ops: NewOp[] }).ops.at(-1)).toEqual({ kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-09-28' } });
  });
});

describe('zmiana planu zachowuje odwołania i zadania (audyt 2, M-14)', () => {
  const task = (t: T, id: string, over: Row) =>
    put(t, 'tasks', id, { id, group_id: 'gf', list_id: 'lf', parent_id: null, title: id, deadline_mode: 'event', due_date: null, due_time: null, start_date: null, series_id: null, completed_at: null, deleted_at: null, ...over });
  const cancelled = (t: T, id: string, event: string, date: string, over: Row = {}) =>
    put(t, 'event_overrides', id, { id, group_id: 'gf', event_id: event, occurrence_date: date, cancelled: true, start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, deleted_at: null, ...over });
  const save = (t: T, change: (l: Lesson) => Lesson | null, extra: Partial<Parameters<typeof timetableOps>[0]> = {}) => {
    const p = memberTimetable(t, 'gf', 'kuba', today);
    const lessons = p.lessons.map(change).filter((l): l is Lesson => l !== null);
    const r = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons, thisWeek: p.thisWeek, today, until: p.until || null, keepUntil: true, newId, edit: { tables: t, userId: ME, series: p.series }, weekA: p.weekA, ...extra });
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('zmieniona godzina: odwołanie i zadania od jutra w nowej serii, dzisiejsza lekcja jak była; cofnięcie', () => {
    const t = base();
    les(t, 'mat', { title: 'Matematyka', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    cancelled(t, 'wolne', 'mat', '2026-11-12');
    task(t, 'zeszyt', { event_id: 'mat', occurrence_date: '2026-10-08' });
    task(t, 'cyrkiel', { event_id: 'mat', occurrence_date: '2026-10-15' });
    const r = save(t, (l) => ({ ...l, start: '09:00', end: '09:45' }));
    expect(r.ops).toEqual([
      {
        kind: 'cmd',
        cmd: 'split_event',
        args: expect.objectContaining({ event_id: 'mat', date: '2026-10-09', set: expect.objectContaining({ start_date: '2026-10-15', start_time: '09:00', rrule: 'FREQ=WEEKLY;BYDAY=TH' }), drop_overrides: [], tasks: [] }),
      },
    ]);
    run2(t, r.ops);
    const nid = splitId('mat', '2026-10-09');
    expect(lessonsOn(t, '2026-10-08', '2026-10-15')).toEqual(['2026-10-08 Matematyka 08:00', '2026-10-15 Matematyka 09:00']);
    expect(lessonsOn(t, '2026-11-12', '2026-11-12')).toEqual([]);
    const due = occurrenceResolver(t);
    expect(due('mat', '2026-10-08')).toMatchObject({ date: '2026-10-08' });
    expect(t.tasks!.cyrkiel!.event_id).toBe(nid);
    expect(due(nid, '2026-10-15')).toMatchObject({ date: '2026-10-15' });
    // Ponowne otwarcie tego samego dnia: tylko nowa seria (stara kończy się dziś).
    expect(memberTimetable(t, 'gf', 'kuba', today).series.map((x) => x.id)).toEqual([nid]);
    run2(t, r.undo(t));
    expect(lessonsOn(t, '2026-10-08', '2026-10-22')).toEqual(['2026-10-08 Matematyka 08:00', '2026-10-15 Matematyka 08:00', '2026-10-22 Matematyka 08:00']);
    expect(lessonsOn(t, '2026-11-12', '2026-11-12')).toEqual([]);
  });

  it('zmieniony dzień: zadanie na najbliższy nowy termin, kopia stałego zadania i zmiana terminu do kosza; cofnięcie je przywraca', () => {
    const t = base();
    les(t, 'mat', { title: 'Matematyka', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    cancelled(t, 'pozniej', 'mat', '2026-10-22', { cancelled: false, start_time: '10:00:00', end_time: '10:45:00' });
    cancelled(t, 'wolne', 'mat', '2026-11-12');
    task(t, 'cyrkiel', { event_id: 'mat', occurrence_date: '2026-10-15' });
    task(t, 'kopia', { event_id: 'mat', occurrence_date: '2026-10-22', series_id: 'def' });
    const r = save(t, (l) => ({ ...l, day: 4 }));
    const nid = splitId('mat', '2026-10-09');
    expect(r.ops).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({ set: expect.objectContaining({ start_date: '2026-10-09', rrule: 'FREQ=WEEKLY;BYDAY=FR' }), drop_overrides: ['pozniej', 'wolne'], tasks: [{ id: 'cyrkiel', action: 'relink', date: '2026-10-16' }, { id: 'kopia', action: 'delete' }] }),
      }),
    ]);
    run2(t, r.ops);
    expect(t.tasks!.cyrkiel).toMatchObject({ event_id: nid, occurrence_date: '2026-10-16' });
    // Po zapisie telefon dołożył kopie stałych zadań nowej serii; cofnięcie je usuwa (inne zadania zostają).
    task(t, 'nowa-kopia', { event_id: nid, occurrence_date: '2026-10-23', series_id: 'def' });
    task(t, 'stara-kopia', { event_id: nid, occurrence_date: '2026-10-29', series_id: 'def' });
    task(t, 'wczesniej', { event_id: nid, occurrence_date: '2026-10-02', series_id: 'def' });
    task(t, 'zwykle', { event_id: nid, occurrence_date: '2026-10-30' });
    task(t, 'inna', { event_id: 'mat', occurrence_date: '2026-10-30', series_id: 'def' });
    task(t, 'usunieta', { event_id: nid, occurrence_date: '2026-10-30', series_id: 'def', deleted_at: 'x' });
    const back = r.undo(t);
    expect(back.filter((o) => o.kind !== 'cmd' && o.entity === 'tasks')).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'cyrkiel', set: { event_id: nid, occurrence_date: '2026-10-15' } },
      { kind: 'restore', entity: 'tasks', id: 'kopia' },
      { kind: 'delete', entity: 'tasks', id: 'nowa-kopia' },
    ]);
    run2(t, back);
    expect(lessonsOn(t, '2026-10-15', '2026-10-23')).toEqual(['2026-10-15 Matematyka 08:00', '2026-10-22 Matematyka 10:00']);
    expect(lessonsOn(t, '2026-11-12', '2026-11-12')).toEqual([]);
    expect(occurrenceResolver(t)(nid, '2026-10-15')).toMatchObject({ date: '2026-10-15' });
  });

  it('skutki do podglądu ze wszystkich zmienionych serii; wybór „Odepnij” trafia do polecenia (jak „to i następne”)', () => {
    const t = base();
    les(t, 'mat', { title: 'Matematyka', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    les(t, 'nowa', { title: 'Chemia', start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    cancelled(t, 'wolne', 'mat', '2026-11-12');
    cancelled(t, 'chem-wolne', 'nowa', '2026-10-19');
    task(t, 'cyrkiel', { event_id: 'mat', occurrence_date: '2026-10-15' });
    task(t, 'zostaje', { event_id: 'nowa', occurrence_date: '2026-10-12' });
    const r = save(t, (l) => (l.title === 'Matematyka' ? { ...l, day: 4 } : { ...l, start: '09:00', end: '09:45' }), { lost: 'unlink' });
    expect(r.effects.lost.map((x) => [x.task.id, x.nearest])).toEqual([['cyrkiel', '2026-10-16']]);
    expect(r.effects.kept.map((x) => x.id)).toEqual(['zostaje']);
    expect(r.effects.overridesLost).toBe(1);
    expect(r.effects.preview).toEqual(['2026-10-09', '2026-10-12', '2026-10-16']);
    expect(r.ops).toContainEqual(expect.objectContaining({ args: expect.objectContaining({ tasks: [{ id: 'cyrkiel', action: 'unlink' }] }) }));
    run2(t, r.ops);
    expect(t.tasks!.cyrkiel).toMatchObject({ event_id: null, occurrence_date: null, deadline_mode: 'none' });
    run2(t, r.undo(t));
    expect(t.tasks!.cyrkiel).toMatchObject({ event_id: splitId('mat', '2026-10-09'), occurrence_date: '2026-10-15', deadline_mode: 'event' });
    // Bez zmienionych serii — bez skutków (ekran zapisuje bez podglądu).
    const none = save(t, (l) => l);
    expect(none.effects).toEqual({ preview: [], kept: [], lost: [], overridesLost: 0 });
  });

  it('seria, która jeszcze się nie zaczęła: zmiana w miejscu (zadania i wyjątki jak przy „wszystkie”); cofnięcie', () => {
    const t = base();
    les(t, 'nowa', { title: 'Chemia', start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    cancelled(t, 'wolne', 'nowa', '2026-10-19');
    task(t, 'odczynnik', { event_id: 'nowa', occurrence_date: '2026-10-12' });
    task(t, 'daleko', { event_id: 'nowa', occurrence_date: '2026-10-26', deadline_mode: 'event' });
    task(t, 'kopia', { event_id: 'nowa', occurrence_date: '2026-10-12', series_id: 'def' });
    const r = save(t, (l) => ({ ...l, day: 1 }), { until: '2026-10-20', keepUntil: false });
    expect(r.ops).toEqual([
      { kind: 'patch', entity: 'events', id: 'nowa', set: { title: 'Chemia', start_date: '2026-10-13', start_time: '08:00', end_time: '08:45', rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020' } },
      { kind: 'delete', entity: 'event_overrides', id: 'wolne' },
      { kind: 'patch', entity: 'tasks', id: 'daleko', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } },
      { kind: 'delete', entity: 'tasks', id: 'kopia' },
      { kind: 'patch', entity: 'tasks', id: 'odczynnik', set: { event_id: 'nowa', occurrence_date: '2026-10-13' } },
    ]);
    run2(t, r.ops);
    task(t, 'nowa-kopia', { event_id: 'nowa', occurrence_date: '2026-10-20', series_id: 'def' });
    run2(t, r.undo(t));
    expect(t.events!.nowa).toMatchObject({ start_date: '2026-10-12', start_time: '08:00:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(t.tasks!.daleko).toMatchObject({ event_id: 'nowa', occurrence_date: '2026-10-26', deadline_mode: 'event' });
    expect(t.tasks!.odczynnik).toMatchObject({ occurrence_date: '2026-10-12' });
    expect([t.tasks!.kopia!.deleted_at, t.tasks!['nowa-kopia']!.deleted_at, t.event_overrides!.wolne!.deleted_at]).toEqual([null, expect.stringMatching(/^pending:\d+$/), null]);
  });

  it('para: ta sama nazwa albo te same dni i godziny; nowa lekcja bez pary — nowa seria', () => {
    const t = base();
    les(t, 'mat', { title: 'Matematyka', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    les(t, 'fiz', { title: 'Fizyka', start_date: '2026-10-01', start_time: '10:00:00', end_time: '10:45:00', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    const r = save(t, (l) => (l.title === 'Fizyka' ? { ...l, title: 'Fizyka z astronomią' } : { ...l, day: 0, start: '12:00', end: '12:45', title: 'Plastyka' }));
    expect(r.ops.map((o) => (o.kind === 'cmd' ? `split ${String(o.args.event_id)}` : `${o.kind} ${o.entity}`))).toEqual(['split fiz', 'patch events', 'create events', 'create event_participants']);
    expect(r.ops[1]).toEqual({ kind: 'patch', entity: 'events', id: 'mat', set: { rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261008' } });
    expect(r.undo(t)).toContainEqual({ kind: 'patch', entity: 'events', id: 'mat', set: { rrule: 'FREQ=WEEKLY;BYDAY=TH' } });
  });

  it('kilka par: wygrywa najbardziej podobna (nazwa, potem godziny i dni)', () => {
    const t = base();
    les(t, 'pn', { title: 'Matematyka', start_date: '2026-10-05' });
    les(t, 'wt', { title: 'Matematyka', start_date: '2026-10-06', start_time: '10:00:00', end_time: '10:45:00', rrule: 'FREQ=WEEKLY;BYDAY=TU' });
    const r = save(t, (l) => (l.day === 1 ? { ...l, end: '10:50' } : null));
    expect(r.ops.map((o) => (o.kind === 'cmd' ? `split ${String(o.args.event_id)}` : `${o.kind} ${o.id}`))).toEqual(['split wt', 'patch pn']);
  });

  it('COUNT w starej serii: cofnięcie z datą ostatniego terminu; seria bez terminów od jutra — cofnięcie usuwa nową', () => {
    const t = base();
    les(t, 'mat', { title: 'Matematyka', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=4' });
    les(t, 'stara', { title: 'Stara', start_date: '2026-09-03', rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2' });
    const r = save(t, (l) => ({ ...l, start: '09:00', end: '09:45' }));
    const back = r.undo(t);
    expect(back).toContainEqual({ kind: 'patch', entity: 'events', id: splitId('mat', '2026-10-09'), set: expect.objectContaining({ start_date: '2026-10-15', rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261022' }) });
    expect(back).toContainEqual({ kind: 'delete', entity: 'events', id: splitId('stara', '2026-10-09') });
  });

  it('memberTimetable: seria kończąca się dziś nie należy już do planu', () => {
    const t = base();
    les(t, 'dzis', { rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261008' });
    expect(memberTimetable(t, 'gf', 'kuba', today).series).toEqual([]);
  });
});

describe('lekcja z rodzeństwem (audyt 2, E-26)', () => {
  const twins = (over: Row = {}) => {
    const t = base();
    put(t, 'group_members', 'zosia', { member_id: 'zosia', group_id: 'gf', user_id: null, display_name: 'Zosia', role: 'child', deleted_at: null });
    put(t, 'group_members', 'byla', { member_id: 'byla', group_id: 'gf', user_id: null, display_name: 'Była', role: 'child', deleted_at: 'x' });
    les(t, 'basen', { title: 'Basen', start_date: '2026-10-01', rrule: 'FREQ=WEEKLY;BYDAY=TH', ...over });
    put(t, 'event_participants', 'p-zosia', { id: 'p-zosia', group_id: 'gf', event_id: 'basen', member_id: 'zosia', deleted_at: null });
    put(t, 'event_participants', 'p-byla', { id: 'p-byla', group_id: 'gf', event_id: 'basen', member_id: 'byla', deleted_at: null });
    return t;
  };
  const save = (t: T, lessons: (ls: Lesson[]) => Lesson[]) => {
    const p = memberTimetable(t, 'gf', 'kuba', today);
    const r = timetableOps({ groupId: 'gf', memberId: 'kuba', lessons: lessons(p.lessons), thisWeek: 'A', today, until: null, newId, edit: { tables: t, userId: ME, series: p.series } });
    if ('error' in r) throw new Error(r.error);
    return r;
  };
  const who = (t: T, event: string) => Object.values(t.event_participants!).filter((p) => p.event_id === event && p.deleted_at == null).map((p) => p.member_id);

  it('zmiana tylko dla tej osoby: seria trwa dla rodzeństwa, ta osoba dostaje nową; cofnięcie', () => {
    const t = twins();
    expect(memberTimetable(t, 'gf', 'kuba', today).series[0]!.others).toEqual(['zosia']);
    const r = save(t, (ls) => ls.map((l) => ({ ...l, start: '09:00', end: '09:45' })));
    run2(t, r.ops);
    const sib = splitId('basen', '2026-10-09');
    expect(t.events![sib]).toMatchObject({ start_date: '2026-10-15', start_time: '08:00:00', rrule: 'FREQ=WEEKLY;BYDAY=TH' });
    expect(who(t, sib)).toEqual(['zosia']);
    expect(lessonsOn(t, '2026-10-15', '2026-10-15')).toEqual(['2026-10-15 Basen 08:00', '2026-10-15 Basen 09:00']);
    run2(t, r.undo(t));
    expect(who(t, sib).sort()).toEqual(['kuba', 'zosia']);
    expect(lessonsOn(t, '2026-10-15', '2026-10-15')).toEqual(['2026-10-15 Basen 08:00']);
  });

  it('usunięcie z planu tej osoby; nierozpoczęta albo bez terminów od jutra — tylko jej udział', () => {
    const t = twins({ rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=10' });
    const r = save(t, () => []);
    expect(r.ops).toEqual([expect.objectContaining({ kind: 'cmd', args: expect.objectContaining({ set: expect.objectContaining({ rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261203' }) }) })]);
    const later = twins({ start_date: '2026-10-15' });
    const q = save(later, () => []);
    expect(q.ops).toEqual([{ kind: 'delete', entity: 'event_participants', id: 'p-basen' }]);
    expect(q.undo(later)).toEqual([{ kind: 'restore', entity: 'event_participants', id: 'p-basen' }]);
    const done = twins({ start_date: '2026-09-03', rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2' });
    expect(save(done, () => []).ops).toEqual([{ kind: 'delete', entity: 'event_participants', id: 'p-basen' }]);
  });
});
