/** „Jak masz na imię?” (D100): pytanie przy starcie konta bez imienia, potem wprowadzenie; zmiana w Ustawieniach. */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { config } from '../../config';
import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}

// W próbce moje członkostwa nazywają się „Łukasz”; jedno ustawiamy na początek adresu, jedno na „Tata”.
function base() {
  const b = sampleBase();
  put(b, 'group_members', 'mf', { ...b.group_members!.mf!, display_name: 'lukasz.k' });
  put(b, 'group_members', 'mk', { ...b.group_members!.mk!, display_name: 'Tata' });
  return b;
}

async function open(prefs = memoryPrefs(), session = { displayName: 'lukasz.k', needsName: true, emailName: 'lukasz.k' }) {
  const s = setup({ base: base(), prefs, session });
  await s.renderApp(<RootStack />);
  await flush();
  return { ...s, prefs };
}

describe('moje imię (D100)', () => {
  it('konto bez imienia: pytanie przy starcie; zapis zmienia profil i członkostwa z dawnym imieniem; potem wprowadzenie', async () => {
    const { account, store, prefs } = await open();
    expect(await screen.findByText('Jak masz na imię?')).toBeTruthy();
    expect(screen.getByTestId('name-field').props.value).toBe('');
    await press(screen.getByTestId('name-save'));
    expect(screen.getByText('Wpisz imię.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('name-field'), 'x'.repeat(config.profile.NAME_MAX_LENGTH + 1));
    expect(screen.queryByText('Wpisz imię.')).toBeNull();
    await press(screen.getByTestId('name-save'));
    expect(screen.getByText(`Imię może mieć najwyżej ${config.profile.NAME_MAX_LENGTH} znaków.`)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('name-field'), ' Łukasz ');
    await press(screen.getByTestId('name-save'));
    await flush();
    expect(account.setMyName).toHaveBeenCalledWith('Łukasz');
    expect(store.dispatched).toEqual([{ kind: 'patch', entity: 'group_members', id: 'mf', set: { display_name: 'Łukasz' } }]);
    expect(prefs.m.get('nameAsked')).toBe('1');
    expect(await screen.findByTestId('screen-welcome')).toBeTruthy();
  });

  it('błąd serwera — komunikat, nic nie zmienione; „Nie teraz” zapamiętane, bez wprowadzenia, gdy już było', async () => {
    const { account, store, prefs } = await open(memoryPrefs({ welcomeSeen: '1' }));
    account.setMyName.mockRejectedValueOnce(new Error('offline'));
    await fireEvent.changeText(await screen.findByTestId('name-field'), 'Łukasz');
    await press(screen.getByTestId('name-save'));
    await flush();
    expect(screen.getByText(/wymaga internetu/)).toBeTruthy();
    expect(store.dispatched).toEqual([]);
    await press(screen.getByTestId('name-later'));
    await flush();
    expect(prefs.m.get('nameAsked')).toBe('1');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
  });

  it('już zapytany albo konto z imieniem — bez pytania', async () => {
    await open(memoryPrefs({ welcomeSeen: '1', nameAsked: '1' }));
    expect(screen.queryByTestId('screen-name')).toBeNull();
    await open(memoryPrefs({ welcomeSeen: '1' }), { displayName: 'Łukasz', needsName: false, emailName: 'lukasz.k' });
    expect(screen.queryByTestId('screen-name')).toBeNull();
  });

  it('Ustawienia: „Twoje imię” z obecnym imieniem; zmiana poprawia członkostwa ze starym imieniem i „Ja”; anuluj', async () => {
    const prefs = memoryPrefs({ welcomeSeen: '1' });
    const s = setup({ base: base(), prefs });
    put(s.store.getSnapshot().state.base, 'group_members', 'mf', { ...base().group_members!.mf!, display_name: 'Ja' });
    await s.renderApp(<RootStack />);
    await flush();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('open-name'));
    expect(screen.getByText('Twoje imię', { exact: true })).toBeTruthy();
    expect(screen.getByTestId('name-field').props.value).toBe('Łukasz');
    await press(screen.getByTestId('name-later'));
    expect(await screen.findByTestId('screen-settings')).toBeTruthy();
    await press(screen.getByTestId('open-name'));
    await fireEvent.changeText(await screen.findByTestId('name-field'), 'Łukasz K.');
    await press(screen.getByTestId('name-save'));
    await flush();
    expect(s.account.setMyName).toHaveBeenCalledWith('Łukasz K.');
    // „Łukasz” (dawne imię) i „Ja” — zmienione; „Tata” zostaje.
    expect(s.store.dispatched.map((o) => (o as { id: string }).id).sort()).toEqual(['mf', 'u-me']);
    expect(prefs.m.get('nameAsked')).toBeUndefined();
    expect(await screen.findByTestId('screen-settings')).toBeTruthy();
  });
});
