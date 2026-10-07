/** Wygląd (D69): Jak w iPhonie / Jasny / Ciemny, zapamiętany na telefonie. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as RN from 'react-native';

import { type AppearanceStore, ThemeProvider, useAppearance, useTheme } from '../../ui/theme';

function Probe() {
  const { scheme } = useTheme();
  const { appearance, setAppearance } = useAppearance();
  return (
    <>
      <Text testID="scheme">{`${scheme}/${appearance}`}</Text>
      <Text testID="dark" onPress={() => setAppearance('dark')}>ciemny</Text>
      <Text testID="system" onPress={() => setAppearance('system')}>system</Text>
    </>
  );
}

describe('wygląd aplikacji', () => {
  it('wczytuje zapisany wybór, zapisuje nowy, „jak w iPhonie” idzie za systemem', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const save = jest.fn(async () => {});
    const store: AppearanceStore = { load: async () => 'light', save };
    await render(
      <ThemeProvider store={store}>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('scheme').props.children).toBe('light/light');
    await fireEvent.press(screen.getByTestId('dark'));
    expect(screen.getByTestId('scheme').props.children).toBe('dark/dark');
    expect(save).toHaveBeenCalledWith('dark');
    await fireEvent.press(screen.getByTestId('system'));
    expect(screen.getByTestId('scheme').props.children).toBe('light/system');
  });

  it('nieznana wartość i błąd zapisu/odczytu nie psują aplikacji; bez magazynu — domyślnie system', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const r = await render(
      <ThemeProvider store={{ load: async () => 'fioletowy', save: async () => Promise.reject(new Error('x')) }}>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('scheme').props.children).toBe('dark/system');
    await fireEvent.press(screen.getByTestId('dark'));
    expect(screen.getByTestId('scheme').props.children).toBe('dark/dark');
    await r.unmount();
    await render(
      <ThemeProvider store={{ load: async () => Promise.reject(new Error('x')), save: async () => {} }}>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('scheme').props.children).toBe('dark/system');
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getAllByTestId('scheme').at(-1)!.props.children).toBe('dark/system');
  });
});
