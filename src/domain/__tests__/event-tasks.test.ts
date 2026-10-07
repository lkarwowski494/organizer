import { parseIsoDate } from '../format';
import { parseRule } from '../rrule';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { todayView } from '../views';
import { occurrenceResolver } from '../views/event-rows';
import { affectedByCancel, attachedTasks, attachOps, createEventTask, nextOccurrence, relinkOps, seriesEditEffects, seriesTaskOps, upcomingInGroup } from '../views/event-tasks';
import { cancelEvent, createEvent, editEvent, eventDetail, type EventFields } from '../views/events';
import { asTask } from '../views/model';

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ł', role: 'admin', deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0', deleted_at: null });
  return t;
}
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `o${seq}` } as Op);
  return t;
};
const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};
const fields = (over: Partial<EventFields> = {}): EventFields => ({ title: 'Tańce', date: '2026-10-05', startTime: '18:00', endTime: null, rule: parseRule('FREQ=WEEKLY;BYDAY=MO'), until: null, audience: 'group', participantIds: [], ...over });

/** Seria w poniedziałki + zadania na 12.10 (dwa) i 19.10. */
function dances() {
  const t = world();
  const newId = ids();
  const e = createEvent('gf', fields(), newId);
  run(t, e.ops);
  run(t, [
    createEventTask({ id: 'strój', groupId: 'gf', listId: 'lf', eventId: e.id, occurrenceDate: '2026-10-12', title: 'Spakować strój' }),
    createEventTask({ id: 'buty', groupId: 'gf', listId: 'lf', eventId: e.id, occurrenceDate: '2026-10-12', title: 'Buty' }),
    createEventTask({ id: 'opłata', groupId: 'gf', listId: 'lf', eventId: e.id, occurrenceDate: '2026-10-19', title: 'Opłata' }),
  ]);
  return { t, id: e.id, newId, d: () => eventDetail(t, ME, e.id)! };
}
const due = (t: T, id: string) => todayView(t, ME, parseIsoDate('2026-10-12')).today.concat(todayView(t, ME, parseIsoDate('2026-10-12')).tomorrow).find((x) => x.id === id)?.due ?? null;

describe('termin z wystąpienia (D13)', () => {
  it('resolver: data po przeniesieniu i godzina z wyjątku; odwołane, nieistniejące i usunięta seria = brak', () => {
    const { t, id, newId, d } = dances();
    const occ = () => occurrenceResolver(t);
    expect(occ()(id, '2026-10-12')).toEqual({ date: '2026-10-12', time: '18:00' });
    expect(occ()(id, '2026-10-13')).toBeNull(); // wtorek: nie ma takiego wystąpienia
    expect(occ()('nie-ma', '2026-10-12')).toBeNull();
    run(t, editEvent(d(), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00' }), newId));
    expect(occ()(id, '2026-10-12')).toEqual({ date: '2026-10-13', time: '17:00' });
    run(t, editEvent(d(), '2026-10-12', 'this', fields({ date: '2026-10-12', startTime: null }), newId));
    expect(occ()(id, '2026-10-12')).toEqual({ date: '2026-10-12', time: '18:00' }); // pusta godzina w wyjątku = bez zmiany
    run(t, cancelEvent(d(), '2026-10-19', 'this', newId));
    expect(occ()(id, '2026-10-19')).toBeNull();
    run(t, [{ kind: 'delete', entity: 'events', id }]);
    expect(occ()(id, '2026-10-12')).toBeNull();
  });

  it('zadanie idzie za przeniesionym spotkaniem w Dotyczy mnie', () => {
    const { t, newId, d } = dances();
    expect(due(t, 'strój')).toEqual({ date: '2026-10-12', time: '18:00' });
    run(t, editEvent(d(), '2026-10-12', 'this', fields({ date: '2026-10-13', startTime: '17:00' }), newId));
    expect(due(t, 'strój')).toEqual({ date: '2026-10-13', time: '17:00' });
  });

  it('operacje: nowe zadanie, podpięcie istniejącego (termin jak spotkanie)', () => {
    expect(createEventTask({ id: 'x', groupId: 'g', listId: 'l', eventId: 'e', occurrenceDate: '2026-10-12', title: 'T' })).toEqual({
      kind: 'create',
      entity: 'tasks',
      id: 'x',
      group_id: 'g',
      set: { list_id: 'l', parent_id: null, title: 'T', sort_key: 'a0', deadline_mode: 'event', due_date: null, due_time: null, event_id: 'e', occurrence_date: '2026-10-12' },
    });
    expect(attachOps({ id: 'x' }, 'e', '2026-10-12')).toEqual([{ kind: 'patch', entity: 'tasks', id: 'x', set: { event_id: 'e', occurrence_date: '2026-10-12', deadline_mode: 'event', due_date: null, due_time: null } }]);
  });
});

describe('odwołanie i usunięcie (D14)', () => {
  it('zadania zakresu: to wystąpienie, to i następne, wszystkie; zrobione i usunięte pomijane', () => {
    const { t, id, d } = dances();
    run(t, [{ kind: 'patch', entity: 'tasks', id: 'buty', set: { completed_at: '2026-10-07T08:00:00Z' } }]);
    put(t, 'tasks', 'del', { ...t.tasks!.opłata!, id: 'del', deleted_at: 'x' });
    expect(attachedTasks(t, id).map((x) => x.id)).toEqual(['opłata', 'strój']);
    expect(attachedTasks(t, id, '2026-10-12').map((x) => x.id)).toEqual(['strój']);
    put(t, 'tasks', 'strój2', { ...t.tasks!.strój!, id: 'strój2' });
    expect(attachedTasks(t, id, '2026-10-12').map((x) => x.id)).toEqual(['strój', 'strój2']);
    delete t.tasks!.strój2;
    expect(affectedByCancel(t, d(), '2026-10-12', 'this').map((x) => x.id)).toEqual(['strój']);
    expect(affectedByCancel(t, d(), '2026-10-19', 'following').map((x) => x.id)).toEqual(['opłata']);
    expect(affectedByCancel(t, d(), '2026-10-05', 'following').map((x) => x.id)).toEqual(['opłata', 'strój']);
    expect(affectedByCancel(t, d(), '2026-10-19', 'all').map((x) => x.id)).toEqual(['opłata', 'strój']);
    // Jednorazowe: zawsze wszystkie.
    const newId = ids();
    const one = createEvent('gf', fields({ rule: null, date: '2026-10-08' }), () => `one-${newId()}`);
    run(t, [...one.ops, createEventTask({ id: 'k', groupId: 'gf', listId: 'lf', eventId: one.id, occurrenceDate: '2026-10-08', title: 'K' })]);
    expect(affectedByCancel(t, eventDetail(t, ME, one.id)!, '2026-10-08', 'this').map((x) => x.id)).toEqual(['k']);
  });

  it('kolejne wystąpienie (pomija odwołane), spotkania grupy do wyboru', () => {
    const { t, id, newId, d } = dances();
    expect(nextOccurrence(t, ME, id, '2026-10-12')).toBe('2026-10-19');
    run(t, cancelEvent(d(), '2026-10-19', 'this', newId));
    expect(nextOccurrence(t, ME, id, '2026-10-12')).toBe('2026-10-26');
    run(t, cancelEvent(d(), '2026-10-26', 'following', newId));
    expect(nextOccurrence(t, ME, id, '2026-10-12')).toBeNull();
    const list = upcomingInGroup(t, ME, 'gf', '2026-10-05', { eventId: id, occurrenceDate: '2026-10-05' });
    expect(list.map((o) => o.occurrenceDate)).toEqual(['2026-10-12']);
    expect(upcomingInGroup(t, ME, 'gk', '2026-10-05')).toEqual([]);
  });

  it('przepięcie: na wystąpienie, odpięcie (termin jak spotkanie → bez terminu, własny zostaje), usunięcie', () => {
    const { t } = dances();
    const strój = asTask(t.tasks!.strój!);
    const own = { ...strój, id: 'own', deadline_mode: 'own' as const, due_date: '2026-10-10' };
    expect(relinkOps([strój], { kind: 'occurrence', eventId: 'e2', occurrenceDate: '2026-10-19' })).toEqual([{ kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: 'e2', occurrence_date: '2026-10-19' } }]);
    expect(relinkOps([strój, own], { kind: 'unlink' })).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } },
      { kind: 'patch', entity: 'tasks', id: 'own', set: { event_id: null, occurrence_date: null } },
    ]);
    expect(relinkOps([strój], { kind: 'delete' })).toEqual([{ kind: 'delete', entity: 'tasks', id: 'strój' }]);
  });
});

describe('zmiana serii: podgląd skutków i przepięcie', () => {
  it('„to i następne” z tym samym dniem: zadania od tego dnia przechodzą do nowej serii, wcześniejsze zostają', () => {
    const { t, id, newId, d } = dances();
    const ops = editEvent(d(), '2026-10-19', 'following', fields({ startTime: '17:00' }), newId);
    const fx = seriesEditEffects(t, d(), '2026-10-19', 'following', ops);
    const created = ops[1] as { id: string };
    expect(fx.preview).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(fx.kept.map((x) => x.id)).toEqual(['opłata']);
    expect(fx.lost).toEqual([]);
    const taskOps = seriesTaskOps(t, d(), ops, fx, 'nearest');
    expect(taskOps).toEqual([{ kind: 'patch', entity: 'tasks', id: 'opłata', set: { event_id: created.id, occurrence_date: '2026-10-19' } }]);
    run(t, [...ops, ...taskOps]);
    expect(occurrenceResolver(t)(created.id, '2026-10-19')).toEqual({ date: '2026-10-19', time: '17:00' });
    expect(t.tasks!.strój!.event_id).toBe(id);
  });

  it('„wszystkie” z innym dniem: zadania tracą wystąpienie → najbliższe nowe albo odpięcie', () => {
    const { t, id, newId, d } = dances();
    const ops = editEvent(d(), '2026-10-12', 'all', fields({ rule: parseRule('FREQ=WEEKLY;BYDAY=TU') }), newId);
    const fx = seriesEditEffects(t, d(), '2026-10-12', 'all', ops);
    expect(fx.preview).toEqual(['2026-10-13', '2026-10-20', '2026-10-27']);
    expect(fx.kept).toEqual([]);
    expect(fx.lost.map((x) => [x.task.id, x.nearest])).toEqual([
      ['buty', '2026-10-13'],
      ['opłata', '2026-10-20'],
      ['strój', '2026-10-13'],
    ]);
    expect(seriesTaskOps(t, d(), ops, fx, 'nearest')).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'buty', set: { event_id: id, occurrence_date: '2026-10-13' } },
      { kind: 'patch', entity: 'tasks', id: 'opłata', set: { event_id: id, occurrence_date: '2026-10-20' } },
      { kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: id, occurrence_date: '2026-10-13' } },
    ]);
    expect(seriesTaskOps(t, d(), ops, fx, 'unlink').map((o) => ('set' in o ? o.set : null))).toEqual([
      { event_id: null, occurrence_date: null, deadline_mode: 'none' },
      { event_id: null, occurrence_date: null, deadline_mode: 'none' },
      { event_id: null, occurrence_date: null, deadline_mode: 'none' },
    ]);
  });

  it('seria kończy się przed zadaniem: brak najbliższego → odpięcie nawet przy „najbliższe”', () => {
    const { t, newId, d } = dances();
    const ops = editEvent(d(), '2026-10-05', 'all', fields({ until: '2026-10-12' }), newId);
    const fx = seriesEditEffects(t, d(), '2026-10-05', 'all', ops);
    expect(fx.kept.map((x) => x.id)).toEqual(['buty', 'strój']);
    expect(fx.lost.map((x) => [x.task.id, x.nearest])).toEqual([['opłata', null]]);
    expect(seriesTaskOps(t, d(), ops, fx, 'nearest')).toEqual([{ kind: 'patch', entity: 'tasks', id: 'opłata', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } }]);
  });

  it('bez operacji na serii (np. pusta lista) — seria bez zmian', () => {
    const { t, d } = dances();
    expect(seriesEditEffects(t, d(), '2026-10-12', 'all', []).kept.map((x) => x.id)).toEqual(['buty', 'opłata', 'strój']);
  });
});
