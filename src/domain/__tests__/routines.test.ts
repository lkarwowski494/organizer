import type { NewOp, Row } from '../sync-engine/client';
import { routineOps, routineStreak, taskStreak } from '../views/routines';
import { copyId, fillOps } from '../views/series-tasks';
import { nextId } from '../views/task-repeat';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
const today = { y: 2026, m: 10, d: 8 }; // czwartek

function base(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'group_members', 'kuba', { member_id: 'kuba', group_id: 'gf', user_id: null, display_name: 'Kuba', role: 'child', deleted_at: null });
  return t;
}
const apply = (t: T, ops: NewOp[]) => {
  for (const o of ops) {
    if (o.kind === 'create') put(t, o.entity, o.id, { id: o.id, member_id: o.id, group_id: o.group_id, deleted_at: null, version: 1, completed_at: null, ...o.set });
    if (o.kind === 'patch') Object.assign(t[o.entity]![o.id]!, o.set);
  }
  return t;
};
let n = 0;
const newId = () => `id${++n}`;
const make = (o: Partial<Parameters<typeof routineOps>[0]> = {}) =>
  routineOps({ tables: base(), userId: ME, groupId: 'gf', title: 'Poranek Kuby', days: [0, 1, 2, 3, 4], start: '07:00', end: '07:30', participantIds: ['kuba'], steps: ['Zęby', ' ', 'Ubranie', 'Plecak'], today, newId, ...o });

describe('rutyny (D113)', () => {
  it('wydarzenie cykliczne z osobą, kroki jako stałe zadania serii na ogólnej liście; co dzień = DAILY', () => {
    const r = make();
    if ('error' in r) throw new Error(r.error);
    const t = apply(base(), r.ops);
    expect(t.events![r.eventId]).toMatchObject({ title: 'Poranek Kuby', start_date: '2026-10-08', start_time: '07:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', audience: 'members' });
    expect(Object.values(t.event_task_series!).map((s) => s.title)).toEqual(['Zęby', 'Ubranie', 'Plecak']);
    expect(Object.values(t.lists!).map((l) => l.name)).toEqual(['Zadania']);
    // Telefon dokłada kroki na wystąpienia.
    const fill = fillOps(t, ME, today);
    expect(fill.filter((o) => o.kind === 'create').length).toBeGreaterThan(0);
    const daily = make({ days: [0, 1, 2, 3, 4, 5, 6] });
    if ('error' in daily) throw new Error(daily.error);
    expect(daily.ops[0]).toMatchObject({ set: { rrule: 'FREQ=DAILY' } });
  });

  it('błędy: nazwa, godzina, dni, brak kroków', () => {
    expect(make({ title: ' ' })).toEqual({ error: 'title' });
    expect(make({ start: '7' })).toEqual({ error: 'time' });
    expect(make({ days: [] })).toEqual({ error: 'days' });
    expect(make({ steps: ['', ' '] })).toEqual({ error: 'steps' });
  });

  it('seria rutyny: wystąpienia z rzędu ze wszystkimi krokami; dziś niezrobione nie przerywa', () => {
    const r = make({ steps: ['Zęby', 'Plecak'], today: { y: 2026, m: 10, d: 1 } });
    if ('error' in r) throw new Error(r.error);
    const t = apply(base(), r.ops);
    const defs = Object.keys(t.event_task_series!);
    const done = (date: string, which = defs) => {
      for (const s of defs) put(t, 'tasks', copyId(s, date), { id: copyId(s, date), group_id: 'gf', event_id: r.eventId, occurrence_date: date, series_id: s, completed_at: which.includes(s) ? `${date}T08:00:00Z` : null, deleted_at: null });
    };
    done('2026-10-01'); // czw
    done('2026-10-02', [defs[0]!]); // pt — tylko jeden krok
    done('2026-10-05'); // pon
    done('2026-10-06');
    done('2026-10-07');
    done('2026-10-08', []); // dziś niezrobione
    expect(routineStreak(t, r.eventId, today)).toBe(3);
    done('2026-10-08');
    expect(routineStreak(t, r.eventId, today)).toBe(4);
    // Audyt 8.10.2026: odwołany termin (bez kroków) nie przerywa serii; usunięte odwołanie — znów przerywa.
    for (const s of defs) delete t.tasks![copyId(s, '2026-10-06')];
    put(t, 'event_overrides', 'o6', { id: 'o6', event_id: r.eventId, group_id: 'gf', occurrence_date: '2026-10-06', cancelled: true, deleted_at: null });
    expect(routineStreak(t, r.eventId, today)).toBe(3);
    put(t, 'event_overrides', 'o6', { id: 'o6', event_id: r.eventId, group_id: 'gf', occurrence_date: '2026-10-06', cancelled: true, deleted_at: 'x' });
    expect(routineStreak(t, r.eventId, today)).toBe(2);
    put(t, 'event_overrides', 'o7', { id: 'o7', event_id: r.eventId, group_id: 'gf', occurrence_date: '2026-10-07', cancelled: false, deleted_at: null });
    put(t, 'event_overrides', 'oX', { id: 'oX', event_id: 'inne', group_id: 'gf', occurrence_date: '2026-10-06', cancelled: true, deleted_at: null });
    expect(routineStreak(t, 'brak', today)).toBe(0);
    put(t, 'events', 'old', { ...t.events![r.eventId]!, id: 'old', deleted_at: 'x' });
    expect(routineStreak(t, 'old', today)).toBe(0);
  });

  it('seria zadania powtarzanego: odhaczone w terminie z rzędu; spóźnione przerywa', () => {
    const t = base();
    const task = (id: string, due: string, done: string | null) => put(t, 'tasks', id, { id, group_id: 'gf', title: 'Bieganie', due_date: due, deadline_mode: 'own', repeat: 'FREQ=DAILY', completed_at: done, deleted_at: null });
    const a = 'a';
    const b = nextId(a);
    const c = nextId(b);
    const d = nextId(c);
    const e = nextId(d);
    task(a, '2026-10-04', '2026-10-05T10:00:00Z'); // spóźnione
    task(b, '2026-10-05', '2026-10-05T18:00:00Z');
    task(c, '2026-10-06', '2026-10-06T07:00:00Z');
    task(d, '2026-10-07', '2026-10-07T21:00:00Z');
    task(e, '2026-10-08', null);
    const local = (iso: string) => iso.slice(0, 10);
    expect(taskStreak(t, e, local)).toBe(3);
    expect(taskStreak(t, d, local)).toBe(3);
    expect(taskStreak(t, a, local)).toBe(0);
    expect(taskStreak(t, 'brak', local)).toBe(0);
    expect(taskStreak({}, 'brak', local)).toBe(0);
    put(t, 'tasks', 'solo', { id: 'solo', group_id: 'gf', title: 'x', due_date: '2026-10-08', completed_at: null, deleted_at: null });
    expect(taskStreak(t, 'solo', local)).toBe(0);
  });
});
