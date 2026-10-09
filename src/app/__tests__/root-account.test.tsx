/**
 * Korzeń aplikacji a koniec sesji (audyt 2, paczka P9): sprzątanie zgłoszone przez moduły (onSignOut, D172), usunięcie
 * pliku bazy po usunięciu konta (M-64), zaległe wyrejestrowanie tokenu po wylogowaniu bez sieci. Nawigacja podmieniona
 * na sondę, która sięga do usług tak jak ekrany.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { memoryDb } from '../../data/__tests__/sqlite';
import { config } from '../../config';
import type { AppServices } from '../context';
import { type RootDeps, Root, type Session } from '../Root';
import { fakeAccount } from './harness';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
const mockSeen: { services: AppServices | null } = { services: null };
jest.mock('../navigation', () => ({
  AppNavigation: () => {
    /* eslint-disable @typescript-eslint/no-require-imports -- fabryka jest.mock nie widzi importów modułu */
    const { useServices } = require('../context') as typeof import('../context');
    const { Text } = require('react-native') as typeof import('react-native');
    /* eslint-enable @typescript-eslint/no-require-imports */
    mockSeen.services = useServices();
    return <Text>sonda</Text>;
  },
}));

const ME = 'u-1';
function makeDeps(account = fakeAccount()) {
  // Kilku słuchaczy naraz (jak onAuthStateChange): korzeń i silnik synchronizacji (M-9).
  const listeners = new Set<(s: Session | null) => void>();
  const dbs = new Map<string, ReturnType<typeof memoryDb>>();
  const removeDb = jest.fn();
  const deps: RootDeps = {
    session: { current: async () => null, onChange: (fn) => (listeners.add(fn), () => void listeners.delete(fn)) },
    account,
    calendar: { add: async () => 'saved' },
    transport: { push: async () => ({ last_seq: 0, results: [] }), pull: async () => ({ groups: [], scopes: [] }), fetchScope: async () => [] },
    openDb: (u) => dbs.get(u) ?? (dbs.set(u, memoryDb()), dbs.get(u)!),
    removeDb,
    newId: () => 'id',
    subscribe: () => () => {},
    links: { onUrl: () => () => {} },
    setTimer: () => () => {},
  };
  return { deps, dbs, removeDb, account, emit: (s: Session | null) => listeners.forEach((fn) => fn(s)), signIn: (s: Session | null) => act(() => listeners.forEach((fn) => fn(s))) };
}

let appState: ((s: string) => void)[] = [];
beforeEach(() => {
  mockSeen.services = null;
  appState = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => (appState.push(fn as (s: string) => void), { remove: () => {} }) as never);
});
afterEach(() => jest.restoreAllMocks());

describe('koniec sesji na tym telefonie', () => {
  it('wylogowanie: najpierw sprzątanie modułów (także z błędem), potem wylogowanie; wyrejestrowane nie biegnie', async () => {
    const t = makeDeps();
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByText('sonda');
    const order: string[] = [];
    const off = mockSeen.services!.onSignOut!(async () => void order.push('kalendarz'));
    mockSeen.services!.onSignOut!(async () => Promise.reject(new Error('x')));
    const gone = jest.fn(async () => {});
    mockSeen.services!.onSignOut!(gone)();
    t.account.signOut.mockImplementation(async () => void order.push('signOut'));
    await act(() => mockSeen.services!.account.signOut());
    expect(order).toEqual(['kalendarz', 'signOut']);
    expect(gone).not.toHaveBeenCalled();
    off();
    // Wylogowanie zostawia bazę konta (D172 b).
    await t.signIn(null);
    expect(t.removeDb).not.toHaveBeenCalled();
  });

  it('usunięcie konta (M-64): po udanym usunięciu na serwerze sprzątanie, a po końcu sesji plik bazy konta znika', async () => {
    const t = makeDeps();
    t.account.deleteAccount.mockImplementation(async (o) => {
      await o?.beforeSignOut?.();
      t.emit(null);
    });
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByText('sonda');
    const hook = jest.fn(async () => {});
    mockSeen.services!.onSignOut!(hook);
    await act(() => mockSeen.services!.account.deleteAccount({ deleteEntries: true }));
    expect(hook).toHaveBeenCalled();
    expect(t.account.deleteAccount).toHaveBeenCalledWith(expect.objectContaining({ deleteEntries: true }));
    await screen.findByTestId('screen-sign-in');
    expect(t.removeDb).toHaveBeenCalledWith(ME);
    // Audyt 3, N-72: potwierdzenie na ekranie logowania — jednorazowe (po kolejnym zalogowaniu i wylogowaniu już nie).
    expect(screen.getByText('Konto zostało usunięte.')).toBeTruthy();
    await t.signIn({ userId: 'u-2', displayName: 'Ola' });
    await t.signIn(null);
    await screen.findByTestId('screen-sign-in');
    expect(screen.queryByText('Konto zostało usunięte.')).toBeNull();
  });

  it('nieudane usunięcie konta nic nie sprząta; bez removeDb w zależnościach — bez błędu', async () => {
    const t = makeDeps();
    t.account.deleteAccount.mockRejectedValue(new Error('offline'));
    await render(<Root deps={{ ...t.deps, removeDb: undefined }} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByText('sonda');
    await expect(mockSeen.services!.account.deleteAccount()).rejects.toThrow('offline');
    await t.signIn(null);
    expect(t.removeDb).not.toHaveBeenCalled();
  });

  it('zaległe wyrejestrowanie tokenu: przy starcie, przy zmianie konta, po powrocie do aplikacji i co minutę', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const t = makeDeps();
      t.account.finishSignOut.mockRejectedValueOnce(new Error('x'));
      await render(<Root deps={t.deps} fontsLoaded />);
      await act(async () => {});
      const start = t.account.finishSignOut.mock.calls.length;
      expect(start).toBeGreaterThan(0);
      await t.signIn({ userId: ME, displayName: 'Ala' });
      expect(t.account.finishSignOut).toHaveBeenCalledTimes(start + 1);
      const before = t.account.finishSignOut.mock.calls.length;
      await act(() => appState.forEach((h) => h('active')));
      await act(() => appState.forEach((h) => h('background')));
      expect(t.account.finishSignOut.mock.calls.length).toBeGreaterThan(before);
      const now = t.account.finishSignOut.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(config.account.SIGNOUT_RETRY_MS);
      });
      await waitFor(() => expect(t.account.finishSignOut.mock.calls.length).toBe(now + 1));
    } finally {
      jest.useRealTimers();
    }
  });
});
