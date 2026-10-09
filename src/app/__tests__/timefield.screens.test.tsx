/** Wybór godziny kafelkami (D125): godzina, minuty, wpisanie ręczne, „Bez godziny”; bez klawiatury. */
import { fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

describe('pole godziny (D125)', () => {
  it('pusta: „Wybierz godzinę”; godzina, potem minuty zwijają panel; zmiana godziny zostawia minuty; „Bez godziny” w polu opcjonalnym', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    expect(screen.getByLabelText('Początek').props.accessibilityValue).toEqual({ text: 'Wybierz godzinę' });
    await press(screen.getByTestId('routine-start'));
    expect(screen.getByTestId('routine-start-panel')).toBeTruthy();
    expect(screen.getByTestId('routine-start').props.accessibilityValue.text).toMatch(/, rozwinięte$/);
    // Minuty przed godziną: południe jako domyślna godzina.
    await press(screen.getByLabelText('Minuty 15'));
    expect(screen.getByLabelText('Początek').props.accessibilityValue).toEqual({ text: '12:15' });
    expect(screen.queryByTestId('routine-start-panel')).toBeNull();
    await press(screen.getByTestId('routine-start'));
    await press(screen.getByLabelText('Godzina 07'));
    expect(screen.getByLabelText('Początek').props.accessibilityValue).toEqual({ text: '07:15, rozwinięte' });
    expect(screen.getByLabelText('Godzina 07').props.accessibilityState).toMatchObject({ selected: true });
    await press(screen.getByTestId('routine-start-m-30'));
    expect(screen.getByLabelText('Początek').props.accessibilityValue).toEqual({ text: '07:30' });
    // Pole wymagane — bez „Bez godziny”.
    await press(screen.getByTestId('routine-start'));
    expect(screen.queryByTestId('routine-start-clear')).toBeNull();
    await press(screen.getByTestId('routine-start'));
    // Opcjonalne: godzina, potem „Bez godziny”.
    await press(screen.getByTestId('routine-end'));
    expect(screen.queryByTestId('routine-end-clear')).toBeNull();
    await press(screen.getByTestId('routine-end-h-08'));
    expect(screen.getByLabelText('Koniec (opcjonalnie)').props.accessibilityValue).toEqual({ text: '08:00, rozwinięte' });
    await press(screen.getByTestId('routine-end-clear'));
    expect(screen.getByLabelText('Koniec (opcjonalnie)').props.accessibilityValue).toEqual({ text: 'Wybierz godzinę' });
    expect(screen.queryByTestId('routine-end-panel')).toBeNull();
    // Inna minuta ręcznie.
    await press(screen.getByTestId('routine-end'));
    await fireEvent.changeText(screen.getByTestId('routine-end-manual'), '08:07');
    expect(screen.getByLabelText('Koniec (opcjonalnie)').props.accessibilityValue).toEqual({ text: '08:07, rozwinięte' });
    expect(screen.getByTestId('routine-end-manual').props.keyboardType).toBe('numbers-and-punctuation');
  });
});
