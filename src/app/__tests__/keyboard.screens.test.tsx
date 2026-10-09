/**
 * Pole z fokusem nad klawiaturą (E2E 05, audyt 2): ekrany przewijane mają automaticallyAdjustKeyboardInsets, więc iOS
 * przewija pole szybkiego dodawania na liście zakupów nad klawiaturę (bez tego „+” był pod klawiaturą).
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { setup } from './harness';

it.each([
  ['Lista zakupów', 'screen-list', 'Zakupy na weekend, Rodzina · Zakupy · 1 do kupienia'],
  ['Lista zadań', 'screen-list', 'Dom, Rodzina · Zadania · 3 otwarte'],
])('%s: przewijany ekran dopasowuje się do klawiatury', async (_name, id, row) => {
  const s = setup();
  await s.renderApp(<RootStack />);
  await fireEvent.press(await screen.findByLabelText('Listy'));
  await fireEvent.press(await screen.findByLabelText(row));
  expect((await screen.findByTestId(id)).props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(screen.getByTestId('quick-add')).toBeTruthy();
});

it('ekran „Moje sprawy” też', async () => {
  const s = setup();
  await s.renderApp(<RootStack />);
  expect((await screen.findByTestId('screen-today')).props.automaticallyAdjustKeyboardInsets).toBe(true);
});
