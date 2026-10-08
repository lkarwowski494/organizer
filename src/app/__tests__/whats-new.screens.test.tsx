/** Karta „Co nowego” (D84): raz po aktualizacji, nie dla nowej osoby, „Wyślij uwagę” otwiera formularz. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import * as Application from 'expo-application';

import { WHATS_NEW_SEEN } from '../../features/today/WhatsNew';
import { whatsNewEntries } from '../../i18n/whats-new.pl';
import { RootStack } from '../navigation';
import { setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});
const app = Application as { nativeBuildVersion: string | null };
const newest = whatsNewEntries[0]!;

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}

async function open(prefs: ReturnType<typeof memoryPrefs>, build = newest.fromBuild) {
  app.nativeBuildVersion = String(build);
  await setup({ prefs }).renderApp(<RootStack />);
  await flush();
  await flush();
}

afterEach(() => {
  app.nativeBuildVersion = '13';
});

describe('co nowego', () => {
  it('po aktualizacji: punkty najnowszego wpisu; „OK” zamyka i zapamiętuje build', async () => {
    const prefs = memoryPrefs({ welcomeSeen: '1', [WHATS_NEW_SEEN]: String(newest.fromBuild - 1) });
    await open(prefs);
    expect(await screen.findByTestId('whats-new')).toBeTruthy();
    for (const t of newest.items) expect(screen.getByText(`• ${t}`)).toBeTruthy();
    await press(screen.getByTestId('whats-new-ok'));
    expect(screen.queryByTestId('whats-new')).toBeNull();
    expect(prefs.m.get(WHATS_NEW_SEEN)).toBe(String(newest.fromBuild));
  });

  it('„Wyślij uwagę” otwiera formularz uwag', async () => {
    await open(memoryPrefs({ welcomeSeen: '1' }));
    await press(await screen.findByTestId('whats-new-feedback'));
    expect(await screen.findByTestId('feedback-text')).toBeTruthy();
  });

  it('nowa osoba: bez karty, build zapamiętany; obejrzane: bez karty; bez prefs nic', async () => {
    const fresh = memoryPrefs();
    await open(fresh);
    expect(screen.queryByTestId('whats-new')).toBeNull();
    expect(fresh.m.get(WHATS_NEW_SEEN)).toBe(String(newest.fromBuild));
    await open(memoryPrefs({ welcomeSeen: '1', [WHATS_NEW_SEEN]: String(newest.fromBuild) }));
    expect(screen.queryByTestId('whats-new')).toBeNull();
    app.nativeBuildVersion = String(newest.fromBuild);
    await setup().renderApp(<RootStack />);
    await flush();
    expect(screen.queryByTestId('whats-new')).toBeNull();
  });

  it('błąd odczytu ustawień — bez karty', async () => {
    const prefs = memoryPrefs();
    prefs.get.mockRejectedValue(new Error('keychain'));
    await open(prefs);
    expect(screen.queryByTestId('whats-new')).toBeNull();
  });
});
