import type { NewOp, Row } from '../sync-engine/client';
import { expandEvents } from '../views/events';
import { type Lesson, timetableOps } from '../views/timetable';

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
    expect(ev).toMatchObject({ start_date: '2026-10-06', start_time: '10:00', end_time: '11:30', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', audience: 'members' });
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
