/**
 * Korzeń aplikacji na atrapach: sesja, link z e-maila, baza (better-sqlite3), serwer (transport w pamięci),
 * sygnały Realtime i powrót na pierwszy plan — bez telefonu i bez sieci.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { memoryDb } from '../../data/__tests__/sqlite';
import { migrate } from '../../data/db/migrations';
import { writeState } from '../../data/store';
import { initialState, mutate, type PullResponse, type PushResponse } from '../../domain/sync-engine/client';
import { AUTH_REDIRECT } from '../../sync/supabase';
import { type SyncTransport, TransportError } from '../../sync/transport';
import { type RootDeps, Root, type Session } from '../Root';
import { fakeAccount } from './harness';

// Oficjalna atrapa (react-native-safe-area-context/jest/mock): bez niej SafeAreaProvider czeka na wymiary ekranu z natywnej strony.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const ME = 'u-1';
const personal = {
  e: 'groups' as const,
  v: 1,
  row: { id: ME, name: 'Osobiste', kind: 'personal', version: 1, created_at: '2026-01-01', deleted_at: null },
};
const member = { e: 'group_members' as const, v: 2, row: { member_id: ME, group_id: ME, user_id: ME, display_name: 'Ala', role: 'owner', version: 2, deleted_at: null } };

function makeDeps(over: Partial<RootDeps> = {}) {
  // Kilku słuchaczy naraz (jak onAuthStateChange): korzeń i silnik synchronizacji (M-9).
  const sessionListeners = new Set<(s: Session | null) => void>();
  let urlListener: (u: string) => void = () => {};
  let pokes: ((topic: string, v: number | null) => void) | null = null;
  const topics: string[][] = [];
  const pushes: unknown[] = [];
  let pulls = 0;
  let clock = Date.UTC(2026, 9, 7, 8, 0);
  const dbs = new Map<string, ReturnType<typeof memoryDb>>();
  // Serwer w pamięci: tworzenia z kolejki dostają kolejne wersje grupy i wracają przy pobraniu.
  const server: { e: 'lists' | 'tasks'; v: number; row: Record<string, unknown> }[] = [];
  let version = 2;
  const transport: SyncTransport = {
    push: async (req) => {
      pushes.push(req);
      for (const op of req.ops) {
        if (op.kind === 'create' && (op.entity === 'lists' || op.entity === 'tasks')) {
          version++;
          server.push({ e: op.entity, v: version, row: { ...op.set, id: op.id, group_id: op.group_id, deleted_at: null, version } });
        }
      }
      return { last_seq: req.ops.at(-1)!.seq, results: req.ops.map((o) => ({ seq: o.seq, status: 'ok' as const })) } satisfies PushResponse;
    },
    pull: async (req) => {
      pulls++;
      const since = req.cursors[ME]?.v ?? 0;
      const rows = [personal, member, ...server].filter((r) => r.v > since);
      return { groups: [{ group_id: ME, cursor: Math.max(since, ...rows.map((r) => r.v)), has_more: false, resync: false, rows }], scopes: [] } satisfies PullResponse;
    },
    fetchScope: async () => [],
  };
  let n = 0;
  const deps: RootDeps = {
    session: {
      current: jest.fn(async () => null as Session | null),
      onChange: (fn) => (sessionListeners.add(fn), () => void sessionListeners.delete(fn)),
      setFromLink: jest.fn(async () => {}),
    },
    account: fakeAccount(),
    calendar: { add: jest.fn(async () => 'saved' as const) },
    transport,
    openDb: (u) => dbs.get(u) ?? (dbs.set(u, memoryDb()), dbs.get(u)!),
    newId: () => `0199a3b4-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    subscribe: (t, fn) => {
      topics.push(t);
      pokes = fn;
      return () => (pokes = null);
    },
    links: { initial: async () => null, onUrl: (fn) => ((urlListener = fn), () => (urlListener = () => {})) },
    nowMs: () => clock,
    // Czas symulowany: timer „mija” od razu, a zegar przesuwa się o jego długość.
    setTimer: (fn, ms) => {
      const t = setTimeout(() => {
        clock += ms;
        fn();
      }, 0);
      return () => clearTimeout(t);
    },
    ...over,
  };
  return {
    deps,
    dbs,
    topics,
    pushes,
    pulls: () => pulls,
    signIn: (s: Session | null) => act(() => sessionListeners.forEach((fn) => fn(s))),
    openUrl: (u: string) => act(() => urlListener(u)),
    poke: (topic: string, v: number | null) => act(() => pokes?.(topic, v)),
  };
}

let appStateHandlers: ((s: string) => void)[] = [];
beforeEach(() => {
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
    appStateHandlers.push(fn as (s: string) => void);
    return { remove: () => {} } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

describe('wylogowanie a przypomnienia (audyt 2, N-4)', () => {
  it('po wylogowaniu i przy zmianie konta zaplanowane przypomnienia poprzedniego konta znikają', async () => {
    const replaceReminders = jest.fn(async () => {});
    const push = { status: async () => 'denied' as const, request: async () => false, token: async () => null, onToken: () => () => {}, onOpen: () => () => {}, env: async () => 'sandbox' as const, dismissed: async () => true, dismiss: async () => {}, replaceReminders, reminderSettings: async () => null, saveReminderSettings: async () => {} };
    const t = makeDeps({ push });
    await render(<Root deps={t.deps} fontsLoaded />);
    // Start bez sesji: przypomnienia z poprzedniego uruchomienia (np. sprzed wylogowania) też idą precz.
    await waitFor(() => expect(replaceReminders).toHaveBeenCalledWith([]));
    replaceReminders.mockClear();
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(replaceReminders).not.toHaveBeenCalledWith([]);
    await t.signIn({ userId: 'u-2', displayName: 'Ola' });
    expect(replaceReminders).toHaveBeenCalledWith([]);
    replaceReminders.mockClear();
    await t.signIn(null);
    expect(replaceReminders).toHaveBeenCalledWith([]);
  });
});

describe('korzeń aplikacji', () => {
  it('ładowanie, potem logowanie; po zalogowaniu pobranie, „Moje sprawy” i kanały Realtime', async () => {
    const t = makeDeps();
    const r = await render(<Root deps={t.deps} fontsLoaded={false} />);
    expect(screen.getByText('Wczytywanie…')).toBeTruthy();
    await r.rerender(<Root deps={t.deps} fontsLoaded />);
    expect(await screen.findByTestId('screen-sign-in')).toBeTruthy();
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(0));
    await waitFor(() => expect(t.topics.at(-1)).toEqual([`user:${ME}`, `group:${ME}`]));
    expect(await screen.findByText('Osobiste')).toBeTruthy();
  });

  it('szybkie dodawanie trafia do bazy i na serwer; poke z nową wersją pobiera, ze starą — nie', async () => {
    const t = makeDeps({ session: { current: async () => ({ userId: ME, displayName: 'Ala' }), onChange: () => () => {}, setFromLink: async () => {} } });
    await render(<Root deps={t.deps} fontsLoaded />);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    await screen.findByText('Osobiste');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'mleko jutro');
    await fireEvent.press(screen.getByLabelText('Dodaj'));
    await fireEvent.press(screen.getByLabelText('Następny dzień'));
    expect(await screen.findByText('mleko')).toBeTruthy();
    await waitFor(() => expect(t.pushes.length).toBeGreaterThan(0));
    const rows = t.dbs.get(ME)!.all<{ data: string }>('select data from tasks');
    expect(rows.map((r) => JSON.parse(r.data).title)).toEqual(['mleko']);
    await waitFor(() => expect(t.topics.at(-1)).toContain(`group:${ME}`));
    const before = t.pulls();
    await t.poke(`group:${ME}`, 1); // wersja ≤ kursor (2): nic nowego
    await t.poke(`group:${ME}`, 9);
    await waitFor(() => expect(t.pulls()).toBe(before + 1));
    await t.poke(`user:${ME}`, null); // zmiana dostępu: zawsze pobierz
    await waitFor(() => expect(t.pulls()).toBe(before + 2));
  });

  it('„Wyczyść dane na telefonie” (D121): pusta baza, pobranie od zera, dane z serwera wracają', async () => {
    const t = makeDeps({ session: { current: async () => ({ userId: ME, displayName: 'Ala' }), onChange: () => () => {}, setFromLink: async () => {} } });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText('Osobiste');
    const db = t.dbs.get(ME)!;
    db.run("insert into tasks (key, group_id, data) values ('stary', ?, ?)", [ME, JSON.stringify({ id: 'stary', title: 'Stary wpis' })]);
    const before = t.pulls();
    await fireEvent.press(screen.getByLabelText('Ustawienia'));
    await fireEvent.press(await screen.findByTestId('settings-account'));
    await fireEvent.press(await screen.findByTestId('reset-start'));
    await fireEvent.press(screen.getByTestId('reset-confirm'));
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(before));
    expect(await screen.findByText('Osobiste')).toBeTruthy();
    expect(db.all<{ key: string }>('select key from tasks')).toEqual([]);
    expect(db.all<{ key: string }>('select key from groups').map((r) => r.key)).toEqual([ME]);
  });

  it('powrót na pierwszy plan pobiera; wylogowanie wraca do ekranu logowania i zatrzymuje pętlę', async () => {
    const t = makeDeps();
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByTestId('screen-today');
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(0));
    const before = t.pulls();
    await act(() => appStateHandlers.forEach((h) => h('background')));
    await act(() => appStateHandlers.forEach((h) => h('active')));
    await waitFor(() => expect(t.pulls()).toBe(before + 1));
    await t.signIn(null);
    expect(await screen.findByTestId('screen-sign-in')).toBeTruthy();
  });

  it('link z e-maila: tokeny do sesji; błąd z linku i błąd ustawienia sesji pokazane', async () => {
    const setFromLink = jest.fn(async () => {});
    const t = makeDeps({
      links: { initial: async () => `${AUTH_REDIRECT}#access_token=a&refresh_token=r`, onUrl: (fn) => ((urlFn = fn), () => {}) },
      session: { current: async () => null, onChange: () => () => {}, setFromLink },
    });
    let urlFn: (u: string) => void = () => {};
    await render(<Root deps={t.deps} fontsLoaded />);
    await waitFor(() => expect(setFromLink).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' }));
    await act(() => urlFn(`${AUTH_REDIRECT}#error=access_denied&error_description=Link+wygas%C5%82`));
    expect(await screen.findByText('Link wygasł')).toBeTruthy();
    setFromLink.mockRejectedValueOnce(new Error('x'));
    await act(() => urlFn(`${AUTH_REDIRECT}#access_token=b&refresh_token=c`));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
    await act(() => urlFn('io.github.lkarwowski494.organizer://invite/x'));
    expect(setFromLink).toHaveBeenCalledTimes(2);
  });

  it('domyślny zegar i timer (bez wstrzykniętych) też działają', async () => {
    const t = makeDeps({ nowMs: undefined, setTimer: undefined });
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(0));
  });
});

describe('odporność synchronizacji (audyt 2, P2)', () => {
  const signedIn = (over: Partial<RootDeps['session']> = {}) => ({ current: async () => ({ userId: ME, displayName: 'Ala' }) as Session, onChange: () => () => {}, setFromLink: async () => {}, ...over });

  it('M-8: baza z kopii iCloud (inny identyfikator niż w pęku kluczy) — nowy identyfikator, kolejka z kopii pod starym', async () => {
    const saved = new Map<string, string>();
    const t = makeDeps({ session: signedIn(), deviceClientId: { load: (u) => saved.get(u) ?? null, save: (u, id) => void saved.set(u, id) } });
    // Kopia: baza z identyfikatorem „stary” i niewysłaną zmianą.
    const db = memoryDb();
    t.dbs.set(ME, db);
    migrate(db);
    const s0 = initialState('stary');
    writeState(db, s0, mutate(s0, { kind: 'create', entity: 'lists', id: 'l1', group_id: ME, set: { kind: 'tasks', name: 'Dom' } }, () => 'op-a'), 1);
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-today');
    const id = saved.get(ME)!;
    expect(id).not.toBe('stary');
    expect(db.all<{ value: string }>("select value from sync_state where key = 'client_id'")[0]!.value).toBe(id);
    await waitFor(() => expect(t.pushes.length).toBeGreaterThan(0));
    expect(t.pushes[0]).toMatchObject({ client_id: 'stary', ops: [{ seq: 1 }] });
  });

  it('M-10: NetInfo — „Offline” we wskaźniku, a po powrocie sieci od razu pobranie', async () => {
    let net: (online: boolean) => void = () => {};
    const t = makeDeps({ session: signedIn(), network: { subscribe: (fn) => ((net = fn), () => {}) } });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText('Osobiste');
    await act(() => net(false));
    expect(await screen.findByText('Offline')).toBeTruthy();
    const before = t.pulls();
    await act(() => net(true));
    await waitFor(() => expect(t.pulls()).toBe(before + 1));
  });

  it('M-10: bez połączenia (nieudane żądanie, np. captive portal) czyszczenie danych jest zablokowane', async () => {
    // Ponowienia po błędzie nie nadchodzą (timer stoi) — stan „błąd sieci” zostaje.
    const t = makeDeps({ session: signedIn(), setTimer: () => () => {} });
    t.deps.transport = { ...t.deps.transport, pull: async () => Promise.reject(new TypeError('Network request failed')) };
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-today');
    await fireEvent.press(screen.getByLabelText('Ustawienia'));
    await fireEvent.press(await screen.findByTestId('settings-account'));
    await fireEvent.press(await screen.findByTestId('reset-start'));
    expect(screen.getByText(/Najpierw połącz się z internetem/)).toBeTruthy();
    expect(screen.getByTestId('reset-confirm').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('M-9: po 401 jedna prośba o odświeżenie tokenu; nowy token tego konta wznawia synchronizację', async () => {
    let listener: (s: Session | null) => void = () => {};
    const refresh = jest.fn(async () => {});
    const signOutLocal = jest.fn(async () => {});
    const t = makeDeps({ session: signedIn({ onChange: (fn) => ((listener = fn), () => {}), refresh, signOutLocal }) });
    const real = t.deps.transport;
    let expired = true;
    t.deps.transport = { ...real, pull: (r, l) => (expired ? Promise.reject(new TransportError('auth', 'jwt expired')) : real.pull(r, l)) };
    await render(<Root deps={t.deps} fontsLoaded />);
    expect(await screen.findByText('Zaloguj się ponownie')).toBeTruthy();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Odświeżenie innego konta (zmiana osoby) nie zdejmuje stanu; tego samego — tak.
    expired = false;
    await act(() => listener({ userId: 'u-2', displayName: 'Ola' }));
    expect(screen.getByText('Zaloguj się ponownie')).toBeTruthy();
    await act(() => listener({ userId: ME, displayName: 'Ala' }));
    expect(await screen.findByText('Osobiste')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Zaloguj się ponownie')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('M-9: sesja, której nie da się odświeżyć — w Ustawieniach „Zaloguj się ponownie” bez czyszczenia danych', async () => {
    const refresh = jest.fn(async () => Promise.reject(new Error('refresh_token_not_found')));
    const signOutLocal = jest.fn(async () => {});
    const t = makeDeps({ session: signedIn({ refresh, signOutLocal }) });
    t.deps.transport = { ...t.deps.transport, pull: () => Promise.reject(new TransportError('auth', 'jwt expired')) };
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-today');
    await fireEvent.press(screen.getByLabelText('Ustawienia'));
    expect(await screen.findByText(/Sesja wygasła/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-in-again'));
    expect(signOutLocal).toHaveBeenCalledTimes(1);
    // Powrót do aplikacji: kolejna próba i kolejna prośba o odświeżenie (nie w kółko w tle).
    await act(() => appStateHandlers.forEach((h) => h('active')));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('M-177: baza z nowszej wersji — wyjaśnienie zamiast awarii; „Wyczyść i pobierz od nowa” otwiera aplikację', async () => {
    const t = makeDeps({ session: signedIn() });
    const db = memoryDb();
    db.exec('pragma user_version = 999');
    t.dbs.set(ME, db);
    await render(<Root deps={t.deps} fontsLoaded />);
    expect(await screen.findByTestId('screen-newer-data')).toBeTruthy();
    expect(screen.getByText(/zapisała nowsza wersja aplikacji/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('newer-reset'));
    expect(await screen.findByText('Osobiste')).toBeTruthy();
  });

  it('inny błąd otwarcia bazy nie jest ukrywany', async () => {
    const t = makeDeps({ session: signedIn(), openDb: () => { throw new Error('dysk'); } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Root deps={t.deps} fontsLoaded />)).rejects.toThrow('dysk');
  });
});
