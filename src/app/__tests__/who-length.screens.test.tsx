/** Kto i jak długo w wierszach (D119, D120) oraz „Wyczyść dane na telefonie” (D121). */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

function base() {
  const b = sampleBase();
  const ev = { group_id: 'gf', note: null, start_date: '2026-10-07', rrule: null, audience: 'group', deleted_at: null, version: 1 };
  put(b, 'events', 'ev1', { ...ev, id: 'ev1', title: 'Basen', start_time: '17:00:00', end_time: '18:30:00', responsible_member_id: 'ala' });
  put(b, 'events', 'ev2', { ...ev, id: 'ev2', title: 'Zebranie', start_time: '19:00:00', end_time: '19:45:00', responsible_member_id: 'mf' });
  put(b, 'events', 'ev3', { ...ev, id: 'ev3', title: 'Imieniny', start_time: null, end_time: null, responsible_member_id: null });
  return b;
}

describe('kto i jak długo (D119, D120)', () => {
  it('Moje sprawy: „dla: Ty” przy moim zadaniu, „odpowiada: Ty” i długość przy wydarzeniu', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(within(screen.getByTestId('today-t-paczka')).getByText(/dla: Ty/)).toBeTruthy();
    expect(within(screen.getByTestId('today-t-korki')).queryByText(/dla:/)).toBeNull(); // nikt nieprzypisany
    expect(screen.queryByTestId('today-event-ev1-2026-10-07')).toBeNull(); // odpowiada Ala, nie dotyczy mnie
    expect(screen.getByLabelText(/^Zebranie, 19:00–19:45, 45 min, Rodzina/)).toBeTruthy();
    const zebranie = screen.getByTestId('today-event-ev2-2026-10-07');
    expect(within(zebranie).getByText(/45 min/)).toBeTruthy();
    expect(within(zebranie).getByText(/odpowiada: Ty/)).toBeTruthy();
    expect(screen.getByLabelText(/^Imieniny, cały dzień, Rodzina/)).toBeTruthy();
    expect(within(screen.getByTestId('today-event-ev3-2026-10-07')).queryByText(/odpowiada|min/)).toBeNull();
  });

  it('Kalendarz: cudze zadanie „dla: Ala”, wydarzenie z długością; szczegóły z długością', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    expect(within(await screen.findByTestId('cal-t-ala')).getByText(/dla: Ala/)).toBeTruthy();
    expect(within(screen.getByTestId('cal-t-paczka')).getByText(/dla: Ty/)).toBeTruthy();
    const basen = screen.getByTestId('cal-event-ev1-2026-10-07');
    expect(within(basen).getByText(/1 h 30 min/)).toBeTruthy();
    expect(within(basen).getByText(/odpowiada: Ala/)).toBeTruthy();
    expect(within(screen.getByTestId('cal-event-ev3-2026-10-07')).queryByText(/odpowiada/)).toBeNull();
    await press(basen);
    expect(await screen.findByText('Środa, 7 października · 17:00–18:30 · 1 h 30 min')).toBeTruthy();
  });
});

describe('wyczyść dane na telefonie (D121)', () => {
  it('potwierdzenie z ostrzeżeniem o niewysłanych zmianach; anuluj; wyczyść', async () => {
    const resetLocal = jest.fn();
    const s = setup({ resetLocal });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Ustawienia'));
    const box = await screen.findByTestId('reset-local');
    await act(async () => s.store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-books', set: { title: 'Oddać książki' } }));
    expect(within(box).getByText(/Na serwerze nic nie znika/)).toBeTruthy();
    await press(screen.getByTestId('reset-start'));
    expect(screen.getByText('Uwaga: 1 zmiana nie została jeszcze wysłana na serwer i przepadnie.')).toBeTruthy();
    await press(within(screen.getByTestId('reset-local')).getByText('Anuluj'));
    expect(screen.queryByTestId('reset-confirm')).toBeNull();
    await press(screen.getByTestId('reset-start'));
    await press(screen.getByTestId('reset-confirm'));
    expect(resetLocal).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('bez niewysłanych zmian — bez ostrzeżenia; bez usługi — bez sekcji', async () => {
    const s = setup({ resetLocal: jest.fn() });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('reset-start'));
    expect(screen.getByTestId('reset-confirm')).toBeTruthy();
    expect(screen.queryByText(/Uwaga:/)).toBeNull();
    screen.unmount();
    const s2 = setup();
    await s2.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Ustawienia'));
    await screen.findByTestId('sign-out');
    expect(screen.queryByTestId('reset-local')).toBeNull();
  });
});
