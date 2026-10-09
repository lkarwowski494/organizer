/** Lista z przerwami (D122): „wolne …” między sprawami w widoku dnia, wydarzenia z iPhone'a według godziny. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const order = (re: RegExp) => screen.getAllByTestId(re).map((e) => e.props.testID as string);

function base() {
  const b = sampleBase();
  put(b, 'events', 'ev1', { id: 'ev1', group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-07', start_time: '19:00:00', end_time: '20:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
  return b;
}

describe('lista z przerwami (D122)', () => {
  it('Moje sprawy, dziś: przerwy od teraz (10:00) między sprawami z godziną', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    // korki 17:30, paczka 18:00, Basen 19:00–20:00; teraz 10:00.
    expect(order(/^today-(gap|event-ev1|t-korki|t-paczka)/)).toEqual(['today-gap-600-1050', 'today-t-korki', 'today-gap-1050-1080', 'today-t-paczka', 'today-gap-1080-1140', 'today-event-ev1-2026-10-07']);
    expect(screen.getByLabelText('Wolne 7 godzin 30 minut')).toBeTruthy();
    expect(within(screen.getByTestId('today-gap-1080-1140')).getByText('wolne 1 h')).toBeTruthy();
  });

  it('tydzień: bez przerw', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Tydzień'));
    expect(screen.queryAllByTestId(/^today-gap-/)).toEqual([]);
  });

  it('Kalendarz: jutro przerwy od pierwszej sprawy, wczoraj bez przerw', async () => {
    const b = base();
    put(b, 'events', 'ev2', { ...b.events!.ev1!, id: 'ev2', title: 'Zebranie', start_date: '2026-10-08', start_time: '08:00:00', end_time: '09:00:00' });
    put(b, 'events', 'ev3', { ...b.events!.ev1!, id: 'ev3', title: 'Kino', start_date: '2026-10-08', start_time: '12:00:00', end_time: '14:00:00' });
    put(b, 'events', 'ev4', { ...b.events!.ev1!, id: 'ev4', start_date: '2026-10-06', start_time: '08:00:00', end_time: '09:00:00' });
    put(b, 'events', 'ev5', { ...b.events!.ev1!, id: 'ev5', start_date: '2026-10-06', start_time: '12:00:00', end_time: '13:00:00' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText(/^Czwartek, 8 października/));
    expect(order(/^cal-(gap|event)/)).toEqual(['cal-event-ev2-2026-10-08', 'cal-gap-540-720', 'cal-event-ev3-2026-10-08']);
    await press(screen.getByLabelText(/^Wtorek, 6 października/));
    expect(screen.queryAllByTestId(/^cal-gap-/)).toEqual([]);
  });
});
