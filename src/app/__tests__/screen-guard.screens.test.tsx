/**
 * Audyt 3, N-1: błąd renderowania jednego ekranu (np. wiersz, którego widok nie umie pokazać) nie wyłącza całej
 * aplikacji — „Coś poszło nie tak” tylko w tym ekranie, zakładki działają, zgłoszenie z nazwą ekranu.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { setup } from './harness';

let mockBroken = true;
jest.mock('../../features/calendar/CalendarScreen', () => {
  const real = jest.requireActual('../../features/calendar/CalendarScreen');
  return {
    ...real,
    CalendarScreen: (p: object) => {
      if (mockBroken) throw new Error('widok');
      return real.CalendarScreen(p);
    },
  };
});

it('błąd w Kalendarzu: ekran błędu tylko w tej zakładce, inne zakładki działają; „Spróbuj ponownie” po naprawie', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const s = setup();
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await fireEvent.press(screen.getByLabelText('Kalendarz'));
  expect(screen.getByTestId('screen-crash')).toBeTruthy();
  expect(s.account.reportError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'crash', screen: 'Calendar', message: 'Error: widok' }));
  await fireEvent.press(screen.getByTestId('tab-Today'));
  expect(screen.getByTestId('screen-today')).toBeTruthy();
  mockBroken = false;
  await fireEvent.press(screen.getByLabelText('Kalendarz'));
  await fireEvent.press(screen.getByLabelText('Spróbuj ponownie'));
  expect(screen.queryByTestId('screen-crash')).toBeNull();
});
