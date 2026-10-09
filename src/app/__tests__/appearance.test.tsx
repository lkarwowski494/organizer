/** Wygląd (D69): Jak w iPhonie / Jasny / Ciemny, zapamiętany na telefonie. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as RN from 'react-native';

import { highContrast, palettes } from '../../config/theme';
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

/** Audyt 2: pasek stanu i okna systemowe (M-139), „Pogrubiony tekst” (M-266), „Zwiększ kontrast” (M-148, D197). */
describe('motyw a ustawienia iOS', () => {
  function Fonts() {
    const { font, c, increasedContrast } = useTheme();
    return <Text testID="probe">{`${font.text400}|${font.display700}|${c.border}|${String(increasedContrast)}`}</Text>;
  }
  type Listener = (v: boolean) => void;
  const listeners = new Map<string, Listener>();
  beforeEach(() => {
    listeners.clear();
    jest.spyOn(RN.AccessibilityInfo, 'addEventListener').mockImplementation(((e: string, l: Listener) => {
      listeners.set(e, l);
      return { remove: () => listeners.delete(e) };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('„Pogrubiony tekst” bierze grubszy krój, „Zwiększ kontrast” — wyraźniejsze obwódki; oba śledzą zmiany', async () => {
    jest.spyOn(RN.AccessibilityInfo, 'isBoldTextEnabled').mockResolvedValue(true);
    jest.spyOn(RN.AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);
    const r = await render(
      <ThemeProvider scheme="light">
        <Fonts />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children).toBe(`AtkinsonHyperlegibleNext_600SemiBold|BricolageGrotesque_800ExtraBold|${palettes.light.border}|false`);
    await act(async () => listeners.get('boldTextChanged')!(false));
    await act(async () => listeners.get('darkerSystemColorsChanged')!(true));
    expect(screen.getByTestId('probe').props.children).toBe(`AtkinsonHyperlegibleNext_400Regular|BricolageGrotesque_700Bold|${highContrast.light.border}|true`);
    await r.unmount();
    expect(listeners.size).toBe(0);
  });

  it('wybór w aplikacji obowiązuje okna systemowe i pasek stanu (M-139)', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const set = jest.spyOn(RN.Appearance, 'setColorScheme');
    const bar = jest.spyOn(RN.StatusBar, 'setBarStyle').mockImplementation(() => {});
    await render(
      <ThemeProvider store={{ load: async () => 'dark', save: async () => {} }}>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(set).toHaveBeenLastCalledWith('dark');
    expect(bar).toHaveBeenLastCalledWith('light-content', true);
    await fireEvent.press(screen.getByTestId('system'));
    expect(set).toHaveBeenLastCalledWith('unspecified');
    expect(bar).toHaveBeenLastCalledWith('dark-content', true);
  });

  it('błąd odczytu ustawienia — zwykły motyw', async () => {
    jest.spyOn(RN.AccessibilityInfo, 'isBoldTextEnabled').mockRejectedValue(new Error('x'));
    await render(
      <ThemeProvider scheme="dark">
        <Fonts />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children).toBe(`AtkinsonHyperlegibleNext_400Regular|BricolageGrotesque_700Bold|${palettes.dark.border}|false`);
  });
});
