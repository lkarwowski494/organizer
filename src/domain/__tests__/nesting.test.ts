import type { Row } from '../sync-engine/client';
import { nestEntries } from '../views/nesting';

type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
const task = (t: T, id: string, o: Row = {}) => put(t, 'tasks', id, { id, parent_id: null, event_id: null, occurrence_date: null, title: id, completed_at: null, deleted_at: null, ...o });
const ev = (id: string, date = '2026-10-09') => ({ kind: 'event' as const, event: { eventId: id, occurrenceDate: date } });
const tk = (t: T, id: string, kind: 'task' | 'overdue' = 'task') => ({ kind, task: { id, parent_id: (t.tasks![id]!.parent_id as string) ?? null, event_id: (t.tasks![id]!.event_id as string) ?? null, occurrence_date: (t.tasks![id]!.occurrence_date as string) ?? null } });
const view = (r: ReturnType<typeof nestEntries>) => r.map((x) => [x.entry.kind === 'event' ? x.entry.event.eventId : x.entry.task.id, x.depth, x.parent?.title ?? null, x.progress ? `${x.progress.done}/${x.progress.total}` : null]);

describe('podzadania w planie dnia (D104)', () => {
  it('zadania wystąpienia pod wydarzeniem, podzadania pod zadaniem, licznik zrobionych', () => {
    const t: T = {};
    put(t, 'events', 'basen', { id: 'basen', title: 'Basen', deleted_at: null });
    task(t, 'strój', { event_id: 'basen', occurrence_date: '2026-10-09' });
    task(t, 'karta', { event_id: 'basen', occurrence_date: '2026-10-09', completed_at: 'x' });
    task(t, 'inne', { event_id: 'basen', occurrence_date: '2026-10-16' });
    task(t, 'torba');
    task(t, 'ręcznik', { parent_id: 'torba' });
    task(t, 'klapki', { parent_id: 'ręcznik' });
    task(t, 'usunięte', { parent_id: 'torba', deleted_at: 'x' });
    task(t, 'samo');
    const entries = [tk(t, 'strój'), tk(t, 'samo'), tk(t, 'klapki'), ev('basen'), tk(t, 'ręcznik'), tk(t, 'torba', 'overdue')];
    expect(view(nestEntries(entries, t))).toEqual([
      ['samo', 0, null, null],
      ['basen', 0, null, '1/2'],
      ['strój', 1, null, null],
      ['torba', 0, null, '0/1'],
      ['ręcznik', 1, null, '0/1'],
      ['klapki', 2, null, null],
    ]);
  });

  it('rodzic spoza dnia — dopisek; rodzic usunięty albo nieznany — bez dopisku; cykl nic nie gubi', () => {
    const t: T = {};
    put(t, 'events', 'basen', { id: 'basen', title: 'Basen', deleted_at: null });
    put(t, 'events', 'stare', { id: 'stare', title: 'Stare', deleted_at: 'x' });
    task(t, 'torba', { title: 'Spakować torbę' });
    task(t, 'a', { parent_id: 'torba' });
    task(t, 'b', { event_id: 'basen', occurrence_date: '2026-10-09' });
    task(t, 'c', { event_id: 'stare', occurrence_date: '2026-10-09' });
    task(t, 'd', { parent_id: 'brak' });
    task(t, 'gone', { deleted_at: 'x' });
    task(t, 'e', { parent_id: 'gone' });
    task(t, 'f', { event_id: 'zniknęło', occurrence_date: '2026-10-09' });
    task(t, 'g', { event_id: 'basen' });
    const r = nestEntries([tk(t, 'a'), tk(t, 'b'), tk(t, 'c'), tk(t, 'd'), tk(t, 'e'), tk(t, 'f'), tk(t, 'g')], t);
    expect(view(r)).toEqual([
      ['a', 0, 'Spakować torbę', null],
      ['b', 0, 'Basen', null],
      ['c', 0, null, null],
      ['d', 0, null, null],
      ['e', 0, null, null],
      ['f', 0, null, null],
      ['g', 0, 'Basen', null],
    ]);
    expect(r.map((x) => x.parent?.kind ?? null)).toEqual(['task', 'event', null, null, null, null, 'event']);
    // Cykl: x ↔ y — oba zostają.
    task(t, 'x', { parent_id: 'y' });
    task(t, 'y', { parent_id: 'x' });
    expect(view(nestEntries([tk(t, 'x'), tk(t, 'y')], t)).map((v) => v[0])).toEqual(['x', 'y']);
    expect(nestEntries([], {})).toEqual([]);
  });
});
