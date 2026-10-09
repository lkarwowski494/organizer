import { splitId } from '../event-split';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { seriesEditEffects, seriesEditOps } from '../views/event-tasks';
import { editEvent, eventDetail, fieldsOf } from '../views/events';
import { routineOps, routineStreak, routineUndoOps, taskStreak } from '../views/routines';
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
  put(t, 'group_members', 'tymek', { member_id: 'tymek', group_id: 'gf', user_id: null, display_name: 'Tymek', role: 'child', deleted_at: null });
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
  routineOps({ tables: base(), userId: ME, groupId: 'gf', title: 'Poranek Tymka', days: [0, 1, 2, 3, 4], start: '07:00', end: '07:30', participantIds: ['tymek'], steps: ['Zęby', ' ', 'Ubranie', 'Plecak'], today, newId, ...o });

describe('rutyny (D113)', () => {
  it('wydarzenie cykliczne z osobą, kroki jako stałe zadania serii na ogólnej liście; co dzień = DAILY', () => {
    const r = make();
    if ('error' in r) throw new Error(r.error);
    const t = apply(base(), r.ops);
    expect(t.events![r.eventId]).toMatchObject({ title: 'Poranek Tymka', start_date: '2026-10-08', start_time: '07:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', audience: 'members', kind: 'routine' });
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

  it('audyt 2 (E-10): po „to i następne” od dziś seria rutyny liczy się przez starą i nową część', () => {
    const t = base();
    put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0', deleted_at: null });
    put(t, 'events', 'rano', { id: 'rano', group_id: 'gf', title: 'Poranek', start_date: '2026-10-01', start_time: '07:00:00', end_time: null, rrule: 'FREQ=DAILY', audience: 'group', kind: 'routine', deleted_at: null });
    put(t, 'event_task_series', 's1', { id: 's1', group_id: 'gf', event_id: 'rano', list_id: 'lf', title: 'Zęby', deleted_at: null });
    for (let d = 1; d <= 7; d++) {
      const iso = `2026-10-0${d}`;
      put(t, 'tasks', copyId('s1', iso), { id: copyId('s1', iso), group_id: 'gf', list_id: 'lf', title: 'Zęby', deadline_mode: 'event', event_id: 'rano', occurrence_date: iso, series_id: 's1', completed_at: `${iso}T07:00:00Z`, deleted_at: null });
    }
    // Odwołany 4.10 w starej części nie przerywa serii także po podziale.
    for (const k of Object.keys(t.tasks!)) if (t.tasks![k]!.occurrence_date === '2026-10-04') delete t.tasks![k];
    put(t, 'event_overrides', 'o4', { id: 'o4', event_id: 'rano', group_id: 'gf', occurrence_date: '2026-10-04', cancelled: true, deleted_at: null });
    expect(routineStreak(t, 'rano', today)).toBe(6);
    const d = eventDetail(t, ME, 'rano')!;
    const ops = editEvent(d, '2026-10-08', 'following', { ...fieldsOf(d, '2026-10-08', 'following'), startTime: '07:30' });
    for (const op of seriesEditOps(d, ops, seriesEditEffects(t, d, '2026-10-08', 'following', ops), 'nearest')) applyOp(t, { ...op, seq: 1, op_id: 'x' } as Op);
    const next = splitId('rano', '2026-10-08');
    expect(t.events![next]!.split_from).toBe('rano');
    expect(routineStreak(t, next, today)).toBe(6);
    expect(routineStreak(t, 'rano', today)).toBe(6);
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

const ent = (o: NewOp) => ('entity' in o ? o.entity : null);
const oid = (o: NewOp) => ('id' in o ? o.id : null);

describe('cofnięcie nowej rutyny (audyt 2, E-3)', () => {
  it('usuwa też kopie kroków dołożone w międzyczasie i nową listę, jeśli nic w niej nie ma', () => {
    const r = make();
    if ('error' in r) throw new Error(r.error);
    const t = apply(base(), r.ops);
    apply(t, fillOps(t, ME, today));
    const copies = Object.values(t.tasks!).map((x) => x.id as string);
    expect(copies.length).toBeGreaterThan(10);
    const undo = routineUndoOps(t, r.ops);
    const listId = Object.keys(t.lists!)[0]!;
    expect(undo.filter((o) => ent(o) === 'tasks').map(oid).sort()).toEqual([...copies].sort());
    expect(undo.filter((o) => ent(o) !== 'tasks')).toEqual([
      ...Object.keys(t.event_task_series!).map((id) => ({ kind: 'delete', entity: 'event_task_series', id })),
      { kind: 'delete', entity: 'events', id: r.eventId },
      { kind: 'delete', entity: 'lists', id: listId },
    ]);
    // Lista, do której ktoś zdążył dopisać zadanie, zostaje; kopia już usunięta — pomijana.
    put(t, 'tasks', 'inne', { id: 'inne', group_id: 'gf', list_id: listId, title: 'Inne', deleted_at: null, series_id: null });
    put(t, 'tasks', copies[0]!, { ...t.tasks![copies[0]!]!, deleted_at: 'x' });
    const again = routineUndoOps(t, r.ops);
    expect(again.some((o) => ent(o) === 'lists')).toBe(false);
    expect(again.filter((o) => ent(o) === 'tasks')).toHaveLength(copies.length - 1);
  });
});

