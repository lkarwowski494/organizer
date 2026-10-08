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
  it('audyt 2 (S-8): zmiana wiersza utworzonego w tej samej paczce — bez odwrotności (usunięcie wystarczy, bez null w polach)', () => {
    expect(
      inverseOps(t, [
        { kind: 'create', entity: 'event_overrides', id: 'o3', group_id: 'g', set: { cancelled: true } },
        { kind: 'patch', entity: 'event_overrides', id: 'o3', set: { cancelled: true } },
        // Utworzenie istniejącego wiersza (powtórzenie) nie zwalnia jego zmiany z odwrotności.
        { kind: 'create', entity: 'event_overrides', id: 'o1', group_id: 'g', set: { cancelled: true } },
        { kind: 'patch', entity: 'event_overrides', id: 'o1', set: { cancelled: true } },
      ]),
    ).toEqual([
      { kind: 'patch', entity: 'event_overrides', id: 'o1', set: { cancelled: false } },
      { kind: 'delete', entity: 'event_overrides', id: 'o1' },
      { kind: 'delete', entity: 'event_overrides', id: 'o3' },
    ]);
  });
  it('audyt 2 (M-59): pole, którego wiersz utworzony na telefonie jeszcze nie ma — wartość domyślna serwera, nie null', () => {
    // Wyjątek terminu utworzony przy edycji „tylko ten termin” (bez cancelled), odwołany przed pobraniem.
    const local = { event_overrides: { o4: { id: 'o4', group_id: 'g', event_id: 'e1', occurrence_date: '2026-10-09', deleted_at: null } }, tasks: { t: { id: 't', title: 'x', deleted_at: null } } };
    expect(inverseOps(local, [{ kind: 'patch', entity: 'event_overrides', id: 'o4', set: { cancelled: true } }])).toEqual([{ kind: 'patch', entity: 'event_overrides', id: 'o4', set: { cancelled: false } }]);
    expect(inverseOps(local, [{ kind: 'patch', entity: 'tasks', id: 't', set: { rollover: false, deadline_mode: 'own', note: 'n' } }])).toEqual([
      { kind: 'patch', entity: 'tasks', id: 't', set: { rollover: true, deadline_mode: 'none', note: null } },
    ]);
    // Encja bez kolumn z wartością domyślną: null.
    expect(inverseOps(local, [{ kind: 'patch', entity: 'activity', id: 'a', set: { x: 1 } }])).toEqual([{ kind: 'patch', entity: 'activity', id: 'a', set: { x: null } }]);
  });
  it('polecenie serwera — bez cofnięcia', () => {
    expect(inverseOps(t, [{ kind: 'cmd', cmd: 'move_task', args: {} }])).toBeNull();
  });
});
