/**
 * Audyt 3, N-1 (część telefonowa): wiersz z datą spoza zakresu z serwera nie trafia do stanu telefonu — widoki
 * (parseIsoDate, expandEvents) padały na nim przy każdym starcie u całej grupy.
 */
import { config } from '../../config';
import { ENTITIES, initialState, onFetchScope, onPullResponse, pullRequest, type ClientState, type PulledRow } from '../sync-engine/client';
import { badField, CHECKED_FIELDS } from '../sync-engine/row-check';
import { expandEvents } from '../views/events';

const ev = (v: number, set: Record<string, unknown> = {}): PulledRow => ({
  e: 'events',
  v,
  row: { id: 'e1', group_id: 'g1', title: 'Basen', start_date: '2026-10-07', start_time: '18:00:00', end_time: null, rrule: null, version: v, deleted_at: null, ...set },
});
const group = (rows: PulledRow[], over: Partial<{ cursor: number; has_more: boolean; resync: boolean }> = {}) => ({ group_id: 'g1', cursor: 9, has_more: false, resync: false, rows, ...over });
const start = (): ClientState => ({ ...initialState('c'), entities: [...ENTITIES], cursors: { g1: 1 } });

describe('badField: zakres dat, godzin i chwil = ograniczenia *_range serwera', () => {
  it.each([
    ['infinity'],
    ['-infinity'],
    ['0044-03-15 BC'],
    ['5000000-01-01'],
    ['1899-12-31'],
    ['2200-01-01'],
    ['2026-10-7'],
    [20261007],
  ])('data %p — odrzucona', (v) => {
    expect(badField('events', { start_date: v })).toBe('events.start_date');
  });

  it('granice zakresu, brak wartości i encje bez dat — w porządku', () => {
    expect(badField('events', { start_date: config.dates.MIN, start_time: '00:00:00', end_time: '23:59:59.5' })).toBeNull();
    expect(badField('tasks', { due_date: config.dates.MAX, due_time: null, completed_at: `${config.dates.MAX}T23:59:59Z` })).toBeNull();
    expect(badField('tasks', {})).toBeNull();
    expect(badField('groups', { start_date: 'infinity' })).toBeNull();
  });

  it('godzina 24:00 i zła chwila — odrzucone; pierwsze złe pole w nazwie', () => {
    expect(badField('events', { start_time: '24:00:00' })).toBe('events.start_time');
    expect(badField('events', { start_time: '7:00' })).toBe('events.start_time');
    expect(badField('tasks', { completed_at: 'infinity' })).toBe('tasks.completed_at');
    expect(badField('tasks', { completed_at: '1899-12-31T23:59:59Z' })).toBe('tasks.completed_at');
    expect(badField('shopping_trips', { done_at: '2200-01-01T00:00:00Z' })).toBe('shopping_trips.done_at');
    expect(badField('shopping_trips', { done_at: 5 })).toBe('shopping_trips.done_at');
    expect(badField('group_members', { week_a: '0001-01-01' })).toBe('group_members.week_a');
  });

  it('każde sprawdzane pole należy do encji, którą telefon zapisuje', () => {
    for (const e of Object.keys(CHECKED_FIELDS)) expect(ENTITIES).toContain(e);
  });
});

describe('pobranie z wierszem spoza zakresu', () => {
  it('wiersz pominięty, jego poprzednia wersja znika, pole zgłoszone; widok wydarzeń działa', () => {
    const who: PulledRow[] = [
      { e: 'groups', v: 1, row: { id: 'g1', name: 'Rodzina', kind: 'shared', version: 1, deleted_at: null } },
      { e: 'group_members', v: 1, row: { member_id: 'm1', group_id: 'g1', user_id: 'u1', display_name: 'Ala', role: 'owner', version: 1, deleted_at: null } },
    ];
    let s = onPullResponse(start(), { groups: [group([...who, ev(2)])], scopes: [] }, pullRequest(start())).state;
    expect(expandEvents(s.base, 'u1', { y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 31 })).toHaveLength(1);
    const out = onPullResponse(s, { groups: [group([ev(3, { start_date: 'infinity' }), ev(3, { id: 'e2', start_time: '24:00:00' })])], scopes: [] }, pullRequest(s));
    s = out.state;
    expect(s.base.events).toEqual({});
    expect(out.invalid).toEqual(['events.start_date', 'events.start_time']);
    expect(expandEvents(s.base, 'u1', { y: 2026, m: 10, d: 1 }, { y: 2026, m: 10, d: 31 })).toEqual([]);
    // Poprawiony wiersz (wyższa wersja) wraca.
    const fixed = onPullResponse(s, { groups: [group([ev(4)])], scopes: [] }, pullRequest(s));
    expect(fixed.state.base.events?.e1).toMatchObject({ version: 4 });
    expect(fixed.invalid).toEqual([]);
  });

  it('grupa pobierana w całości (porcje odkładane): zły wiersz nie trafia do porcji ani do stanu po podmianie', () => {
    const s0 = onPullResponse(start(), { groups: [group([ev(2)])], scopes: [] }, pullRequest(start())).state;
    const req = pullRequest(s0);
    let s = onPullResponse(s0, { groups: [group([ev(5, { start_date: '5000000-01-01' })], { resync: true, has_more: true })], scopes: [] }, req).state;
    expect(s.staged.g1?.events ?? {}).toEqual({});
    s = onPullResponse(s, { groups: [group([], { has_more: false })], scopes: [] }, pullRequest(s)).state;
    expect(s.base.events ?? {}).toEqual({});
  });

  it('sync_fetch_scope: zły wiersz pominięty, reszta wchodzi', () => {
    const s = onFetchScope(start(), [ev(2, { start_date: '-infinity' }), ev(2, { id: 'e2' })], 'l1');
    expect(Object.keys(s.base.events ?? {})).toEqual(['e2']);
  });
});
