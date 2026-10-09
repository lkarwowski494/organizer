/** Pierwsze kroki (D79): wprowadzenie raz na telefonie, wybór startu, powrót z Ustawień. */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}

/** Tylko grupa osobista — nowe konto (z grupą wspólną wyboru startu nie ma, PWD-20 A). */
function alone() {
  const base = sampleBase();
  delete base.groups!.gf;
  delete base.groups!.gk;
  return base;
}

async function open(prefs = memoryPrefs(), base = alone()) {
  const s = setup({ prefs, base });
  await s.renderApp(<RootStack />);
  await flush();
  return { ...s, prefs };
}

describe('pierwsze kroki', () => {
  it('trzy ekrany, potem start: grupa rodzinna z podpowiedzianą nazwą; zapamiętane', async () => {
    const { prefs } = await open();
    expect(await screen.findByTestId('screen-welcome')).toBeTruthy();
    expect(screen.getByText('Wszystko, co na Tobie, w jednym miejscu')).toBeTruthy();
    expect(screen.getByLabelText('Krok 1 z 4')).toBeTruthy();
    await press(screen.getByTestId('welcome-next'));
    expect(screen.getByText('Grupy: rodzina, znajomi, klasa')).toBeTruthy();
    await press(screen.getByTestId('welcome-next'));
    expect(screen.getByText('Pisz po ludzku')).toBeTruthy();
    await press(screen.getByTestId('welcome-next'));
    expect(screen.getByText('Od czego zaczynasz?')).toBeTruthy();
    await press(screen.getByTestId('welcome-family'));
    expect(prefs.set).toHaveBeenCalledWith('welcomeSeen', '1');
    expect((await screen.findByTestId('group-name')).props.value).toBe('Rodzina');
  });

  it('„Pomiń” prowadzi do startu; „Mam kod” otwiera dołączanie; „Na razie sam(a)” wraca do Dziś', async () => {
    await open();
    await press(await screen.findByTestId('welcome-skip'));
    await press(screen.getByTestId('welcome-code'));
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
    await open();
    await press((await screen.findAllByTestId('welcome-skip')).at(-1)!);
    await press(screen.getAllByTestId('welcome-alone').at(-1)!);
    expect(screen.queryByTestId('screen-welcome-start')).toBeNull();
  });

  it('PWD-20 A (M-289): z grupą wspólną — bez wyboru startu: „Zaczynamy” na ostatnim ekranie, „Pomiń” kończy', async () => {
    const { prefs } = await open(memoryPrefs(), sampleBase());
    expect(await screen.findByLabelText('Krok 1 z 3')).toBeTruthy();
    await press(screen.getByTestId('welcome-next'));
    await press(screen.getByTestId('welcome-next'));
    expect(screen.queryByTestId('welcome-next')).toBeNull();
    await press(screen.getByTestId('welcome-done'));
    expect(prefs.set).toHaveBeenCalledWith('welcomeSeen', '1');
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
    expect(screen.queryByTestId('screen-welcome-start')).toBeNull();
    await open(memoryPrefs(), sampleBase());
    await press((await screen.findAllByTestId('welcome-skip')).at(-1)!);
    expect(screen.queryByTestId('screen-welcome-start')).toBeNull();
  });

  it('obejrzane — nie pokazuje się; z Ustawień można wrócić; bez prefs nic', async () => {
    await open(memoryPrefs({ welcomeSeen: '1' }));
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('welcome-again'));
    expect(await screen.findByTestId('screen-welcome')).toBeTruthy();
  });

  it('błąd odczytu ustawień — bez wprowadzenia, aplikacja działa', async () => {
    await open({ get: jest.fn(async () => Promise.reject(new Error('keychain'))), set: jest.fn(async () => {}) } as never);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
  });
});
