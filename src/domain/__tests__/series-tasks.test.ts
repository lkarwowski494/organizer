import { config } from '../../config';
import { parseIsoDate } from '../format';
import { parseRule } from '../rrule';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { affectedByCancel, seriesCopiesCancelOps, seriesEditEffects, seriesTaskOps } from '../views/event-tasks';
import { cancelEvent, createEvent, editEvent, eventDetail, type EventFields } from '../views/events';
import { asSeries, copyId, createSeries, fillOps, seriesOf, stopOps } from '../views/series-tasks';

const ME = 'u-me';
const TODAY = parseIsoDate('2026-10-07'); // środa
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `o${seq}` } as Op);
  return t;
};
const SERIES = '0192f3a0-1c2b-7d4e-8f00-0123456789ab';
function world(role = 'admin') {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Ł', role, deleted_at: null });
  put(t, 'lists', 'lf', { id: 'lf', group_id: 'gf', kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0', deleted_at: null });
  let n = 0;
  const newId = () => `id${++n}`;
  const fields: EventFields = { title: 'Tańce', date: '2026-10-05', startTime: '18:00', endTime: null, rule: parseRule('FREQ=WEEKLY;BYDAY=MO'), until: null, audience: 'group', participantIds: [] };
  const e = createEvent('gf', fields, newId);
  run(t, [...e.ops, createSeries({ id: SERIES, groupId: 'gf', eventId: e.id, listId: 'lf', title: 'Spakować strój' })]);
  return { t, id: e.id, newId, fields, d: () => eventDetail(t, ME, e.id)! };
}
const idOf = (o: NewOp) => ('id' in o ? o.id : '');
const dates = (ops: NewOp[]) => ops.map((o) => (o.kind === 'create' ? String(o.set.occurrence_date) : '?'));

describe('stałe zadania serii (D65)', () => {
  it('definicja: wiersz i odczyt', () => {
    expect(createSeries({ id: 's', groupId: 'g', eventId: 'e', listId: 'l', title: 'T' })).toEqual({ kind: 'create', entity: 'event_task_series', id: 's', group_id: 'g', set: { event_id: 'e', list_id: 'l', title: 'T' } });
    expect(asSeries({ id: 's', group_id: 'g', event_id: 'e', list_id: 'l' })).toEqual({ id: 's', group_id: 'g', event_id: 'e', list_id: 'l', title: '', deleted_at: null });
    const { t, id } = world();
    put(t, 'event_task_series', 'b', { id: 'b', group_id: 'gf', event_id: id, list_id: 'lf', title: 'Spakować strój', deleted_at: null });
    put(t, 'event_task_series', 'x', { id: 'x', group_id: 'gf', event_id: id, list_id: 'lf', title: 'Usunięte', deleted_at: 'x' });
    expect(seriesOf(t, id).map((s) => s.id)).toEqual([SERIES, 'b'].sort((a, b) => a.localeCompare(b)));
  });

  it('kopie na SERIES_TASK_WEEKS tygodni od dziś, z identyfikatorem z definicji i daty; drugi raz nic', () => {
    const { t, id } = world();
    const ops = fillOps(t, ME, TODAY);
    expect(ops).toHaveLength(config.SERIES_TASK_WEEKS);
    expect(dates(ops).slice(0, 3)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    expect(ops[0]).toEqual({
      kind: 'create',
      entity: 'tasks',
      id: copyId(SERIES, '2026-10-12'),
      group_id: 'gf',
      set: { list_id: 'lf', parent_id: null, title: 'Spakować strój', sort_key: 'a0', deadline_mode: 'event', due_date: null, due_time: null, event_id: id, occurrence_date: '2026-10-12', series_id: SERIES },
    });
    expect(copyId(SERIES, '2026-10-12')).toBe('0f29d07c-136b-5da9-83fc-671a805bf162'); // Python: uuid.uuid5(uuid.uuid5(NAMESPACE_URL, …), 'seria|data')
    run(t, ops);
    expect(fillOps(t, ME, TODAY)).toEqual([]);
    // Tydzień później dochodzi jedna nowa kopia na końcu okna.
    expect(dates(fillOps(t, ME, parseIsoDate('2026-10-14')))).toEqual(['2026-12-07']);
  });

  it('usunięta kopia nie wraca; odwołane wystąpienie bez kopii; dziecko, usunięta lista i usunięta definicja — nic', () => {
    const { t, d, newId } = world();
    run(t, fillOps(t, ME, TODAY));
    run(t, [{ kind: 'delete', entity: 'tasks', id: copyId(SERIES, '2026-10-12') }]);
    expect(fillOps(t, ME, TODAY)).toEqual([]);
    run(t, cancelEvent(d(), '2026-12-07', 'this', newId));
    expect(fillOps(t, ME, parseIsoDate('2026-10-14'))).toEqual([]);
    expect(fillOps(world('child').t, ME, TODAY)).toEqual([]);
    const w = world();
    run(w.t, [{ kind: 'delete', entity: 'lists', id: 'lf' }]);
    expect(fillOps(w.t, ME, TODAY)).toEqual([]);
    const w2 = world();
    run(w2.t, [{ kind: 'delete', entity: 'event_task_series', id: SERIES }]);
    expect(fillOps(w2.t, ME, TODAY)).toEqual([]);
    expect(fillOps({}, ME, TODAY)).toEqual([]);
  });

  it('zakończenie: definicja i niezrobione kopie od dziś do kosza; zrobione i wcześniejsze zostają', () => {
    const { t } = world();
    run(t, fillOps(t, ME, parseIsoDate('2026-09-30')));
    run(t, [{ kind: 'patch', entity: 'tasks', id: copyId(SERIES, '2026-10-19'), set: { completed_at: '2026-10-07T10:00:00Z' } }]);
    const ops = stopOps(t, asSeries(t.event_task_series![SERIES]!), TODAY);
    expect(ops[0]).toEqual({ kind: 'delete', entity: 'event_task_series', id: SERIES });
    expect(ops.slice(1).map(idOf).sort()).toEqual(
      ['2026-10-12', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map((x) => copyId(SERIES, x)).sort(),
    );
  });
});

describe('kopie przy odwołaniu i zmianie serii', () => {
  it('odwołanie: o kopie nie pytamy, usuwamy je (to wystąpienie / to i następne)', () => {
    const { t, d } = world();
    run(t, fillOps(t, ME, TODAY));
    put(t, 'tasks', 'zwykłe', { ...t.tasks![copyId(SERIES, '2026-10-12')]!, id: 'zwykłe', series_id: null });
    expect(affectedByCancel(t, d(), '2026-10-12', 'this').map((x) => x.id)).toEqual(['zwykłe']);
    expect(seriesCopiesCancelOps(t, d(), '2026-10-12', 'this')).toEqual([{ kind: 'delete', entity: 'tasks', id: copyId(SERIES, '2026-10-12') }]);
    expect(seriesCopiesCancelOps(t, d(), '2026-11-23', 'following').map(idOf).sort()).toEqual([copyId(SERIES, '2026-11-23'), copyId(SERIES, '2026-11-30')].sort());
  });

  it('„to i następne”: definicja przechodzi do nowej serii; „wszystkie” z innym dniem: kopie znikających terminów usuwane', () => {
    const { t, d, newId, fields } = world();
    run(t, fillOps(t, ME, TODAY));
    const ops = editEvent(d(), '2026-10-19', 'following', { ...fields, startTime: '17:00' }, newId);
    const fx = seriesEditEffects(t, d(), '2026-10-19', 'following', ops);
    const created = idOf(ops[1]!);
    const out = seriesTaskOps(t, d(), ops, fx, 'nearest');
    expect(out).toContainEqual({ kind: 'patch', entity: 'event_task_series', id: SERIES, set: { event_id: created } });
    expect(out).toContainEqual({ kind: 'patch', entity: 'tasks', id: copyId(SERIES, '2026-10-19'), set: { event_id: created, occurrence_date: '2026-10-19' } });
    run(t, [...ops, ...out]);
    expect(fillOps(t, ME, TODAY)).toEqual([]); // kopie mają te same identyfikatory — nic nowego

    const w = world();
    run(w.t, fillOps(w.t, ME, TODAY));
    const all = editEvent(w.d(), '2026-10-12', 'all', { ...w.fields, rule: parseRule('FREQ=WEEKLY;BYDAY=TU') }, w.newId);
    const fx2 = seriesEditEffects(w.t, w.d(), '2026-10-12', 'all', all);
    const out2 = seriesTaskOps(w.t, w.d(), all, fx2, 'nearest');
    expect(out2.every((o) => o.kind === 'delete' && o.entity === 'tasks')).toBe(true);
    expect(out2).toHaveLength(config.SERIES_TASK_WEEKS);
    run(w.t, [...all, ...out2]);
    expect(dates(fillOps(w.t, ME, TODAY))[0]).toBe('2026-10-13');
  });
});
