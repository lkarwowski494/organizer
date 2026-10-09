import { wakeGroups } from '../reminder-wake';
import type { Op, PushResponse, Row } from '../sync-engine/client';

const H = '2026-10-21';
type T = { [e: string]: { [id: string]: Row } };
const ok = (...seqs: number[]): PushResponse => ({ last_seq: Math.max(0, ...seqs), results: seqs.map((seq) => ({ seq, status: 'ok' as const })) });
let n = 0;
const patch = (entity: string, id: string, set: Row = {}): Op => ({ seq: ++n, op_id: `o${n}`, kind: 'patch', entity: entity as never, id, set });

describe('ciche powiadomienia: które grupy obudzić (D159)', () => {
  const before: T = {
    tasks: {
      blisko: { id: 'blisko', group_id: 'g1', due_date: '2026-10-08' },
      daleko: { id: 'daleko', group_id: 'g2', due_date: '2026-12-01' },
      bez: { id: 'bez', group_id: 'g3', due_date: null },
    },
    events: {
      seria: { id: 'seria', group_id: 'g4', start_date: '2026-01-01', rrule: 'FREQ=WEEKLY' },
      jednorazowe: { id: 'jednorazowe', group_id: 'g5', start_date: '2027-01-01', rrule: null },
    },
    event_overrides: { o: { id: 'o', group_id: 'g6', occurrence_date: '2027-01-01', start_date: '2026-10-10' }, od: { id: 'od', group_id: 'g6', occurrence_date: '2027-01-01', start_date: null } },
    event_rsvps: { r: { id: 'r', group_id: 'g7', occurrence_date: '2026-10-09' } },
    groups: { g8: { id: 'g8', name: 'Rodzina' } },
    lists: { z: { id: 'z', group_id: 'g9', due_date: '2026-11-30' } },
    list_items: { i: { id: 'i', group_id: 'g1' } },
  };

  it('zmiany spraw z terminem w oknie, bez terminu i serii budzą grupę; poza oknem — nie', () => {
    const ops = [patch('tasks', 'blisko'), patch('tasks', 'daleko'), patch('tasks', 'bez'), patch('events', 'seria'), patch('events', 'jednorazowe'), patch('event_overrides', 'o'), patch('event_overrides', 'od'), patch('event_rsvps', 'r'), patch('groups', 'g8'), patch('lists', 'z')];
    const res = ok(...ops.map((o) => o.seq));
    expect(wakeGroups(ops, res, before, before, H)).toEqual(['g1', 'g3', 'g4', 'g6', 'g7', 'g8']);
  });

  it('termin przeniesiony z daleka do okna (albo odwrotnie) — budzi', () => {
    const op = patch('tasks', 'daleko', { due_date: '2026-10-09' });
    const after: T = { ...before, tasks: { ...before.tasks, daleko: { ...before.tasks!.daleko!, due_date: '2026-10-09' } } };
    expect(wakeGroups([op], ok(op.seq), before, after, H)).toEqual(['g2']);
    expect(wakeGroups([op], ok(op.seq), after, before, H)).toEqual(['g2']);
  });

  it('tylko przyjęte przez serwer; pozycje zakupów, nieznany wiersz i stałe zakupy pomijane', () => {
    const a = patch('tasks', 'blisko');
    const b = patch('list_items', 'i');
    const c = patch('tasks', 'nieznane');
    const staple: Op = { seq: ++n, op_id: 'x', kind: 'cmd', cmd: 'staple_add', args: { list_id: 'z', name: 'mleko' } };
    const res: PushResponse = { last_seq: staple.seq, results: [{ seq: a.seq, status: 'rejected', code: 'x' }, { seq: b.seq, status: 'ok' }, { seq: c.seq, status: 'ok' }, { seq: staple.seq, status: 'ok' }] };
    expect(wakeGroups([a, b, c, staple], res, before, before, H)).toEqual([]);
    expect(wakeGroups([a], { last_seq: a.seq, results: [{ seq: a.seq, status: 'duplicate' }] }, before, before, H)).toEqual([]);
  });

  it('utworzenie — grupa z operacji; usunięcie — z wiersza; polecenia — z grupy, wydarzenia, listy albo zadania', () => {
    const create: Op = { seq: ++n, op_id: 'c', kind: 'create', entity: 'tasks', id: 'nowe', group_id: 'g10', set: { due_date: null } };
    const del: Op = { seq: ++n, op_id: 'd', kind: 'delete', entity: 'tasks', id: 'blisko' };
    const cmd = (args: Row): Op => ({ seq: ++n, op_id: `c${n}`, kind: 'cmd', cmd: 'split_event', args });
    const c1 = cmd({ group_id: 'g11' });
    const c2 = cmd({ event_id: 'seria' });
    const c3 = cmd({ list_id: 'z' });
    const c4 = cmd({ task_id: 'bez' });
    const c5 = cmd({ event_id: 'brak' });
    const ops = [create, del, c1, c2, c3, c4, c5];
    expect(wakeGroups(ops, ok(...ops.map((o) => o.seq)), before, before, H)).toEqual(['g1', 'g10', 'g11', 'g3', 'g4', 'g9']);
  });

  it('wiersz bez grupy — pomijany', () => {
    const op = patch('tasks', 'sierota');
    expect(wakeGroups([op], ok(op.seq), { tasks: { sierota: { id: 'sierota' } } }, {}, H)).toEqual([]);
  });
});
