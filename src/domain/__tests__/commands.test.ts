import { inverseOps } from '../views/commands';

describe('operacje odwrotne do „Cofnij” (audyt 8.10.2026)', () => {
  const t = { events: { e1: { id: 'e1', rrule: 'FREQ=WEEKLY', title: 'Basen' } }, event_overrides: { o1: { id: 'o1', cancelled: false } } };
  it('od końca: utworzenie → usunięcie, usunięcie ↔ przywrócenie, zmiana → poprzednie wartości (brak = null)', () => {
    expect(
      inverseOps(t, [
        { kind: 'patch', entity: 'events', id: 'e1', set: { rrule: 'FREQ=WEEKLY;UNTIL=20261013', note: 'x' } },
        { kind: 'patch', entity: 'event_overrides', id: 'o1', set: { cancelled: true } },
        { kind: 'create', entity: 'event_overrides', id: 'o2', group_id: 'g', set: { cancelled: true } },
        { kind: 'delete', entity: 'tasks', id: 't1' },
        { kind: 'restore', entity: 'tasks', id: 't2' },
        { kind: 'patch', entity: 'tasks', id: 'nowe', set: { title: 'a' } },
      ]),
    ).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'nowe', set: { title: null } },
      { kind: 'delete', entity: 'tasks', id: 't2' },
      { kind: 'restore', entity: 'tasks', id: 't1' },
      { kind: 'delete', entity: 'event_overrides', id: 'o2' },
      { kind: 'patch', entity: 'event_overrides', id: 'o1', set: { cancelled: false } },
      { kind: 'patch', entity: 'events', id: 'e1', set: { rrule: 'FREQ=WEEKLY', note: null } },
    ]);
  });
  it('polecenie serwera — bez cofnięcia', () => {
    expect(inverseOps(t, [{ kind: 'cmd', cmd: 'move_task', args: {} }])).toBeNull();
  });
});
