/**
 * Korzeń aplikacji na atrapach: sesja, linki, baza (better-sqlite3), serwer (transport w pamięci),
 * sygnały Realtime i powrót na pierwszy plan — bez telefonu i bez sieci.
 */
import { getStateFromPath } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';

import { config } from '../../config';
import { memoryDb } from '../../data/__tests__/sqlite';
import { migrate } from '../../data/db/migrations';
import { writeState } from '../../data/store';
import { initialState, mutate, type PullResponse, type PushResponse } from '../../domain/sync-engine/client';
import { type SyncTransport, TransportError } from '../../sync/transport';
import { refreshInBackground } from '../background';
import { type RootDeps, Root, type Session } from '../Root';
import { type ServerTables, serverVerdict } from '../../domain/server-rules';
import { e2eLegacyPrefs } from '../e2e';
import { linking } from '../navigation';
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
  // Serwer reguł (audyt 2, M-50): operację, której SQL by nie przyjął, ten serwer też odrzuca (src/domain/server-rules.ts).
  // Zalogowana osoba: ME (sesja z deps.session.current w większości testów), zmienia ją signIn.
  let user: string | null = ME;
  const tables = (): ServerTables => {
    const t: { [e: string]: { [k: string]: Record<string, unknown> } } = {};
    for (const r of [personal, member, ...server]) (t[r.e] ??= {})[String(r.e === 'group_members' ? r.row.member_id : r.row.id)] = r.row;
    return t;
  };
  const rejected: string[] = [];
  const transport: SyncTransport = {
    push: async (req) => {
      pushes.push(req);
      const results: PushResponse['results'] = [];
      for (const op of req.ops) {
        const code = serverVerdict(tables(), user ?? '', op);
        if (code) {
          rejected.push(code);
          results.push({ seq: op.seq, status: 'rejected', code });
          continue;
        }
        if (op.kind === 'create' && (op.entity === 'lists' || op.entity === 'tasks')) {
          version++;
          server.push({ e: op.entity, v: version, row: { ...op.set, id: op.id, group_id: op.group_id, deleted_at: null, version } });
        }
        results.push({ seq: op.seq, status: 'ok' });
      }
      return { last_seq: req.ops.at(-1)!.seq, results } satisfies PushResponse;
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
    },
    account: fakeAccount(),
    // Wprowadzenie i „Co nowego” obejrzane (jak w E2E) — nie zasłaniają ekranów.
    legacyPrefs: e2eLegacyPrefs(),
    calendar: { add: jest.fn(async () => 'saved' as const) },
    transport,
    openDb: (u) => dbs.get(u) ?? (dbs.set(u, memoryDb()), dbs.get(u)!),
    newId: () => `0199a3b4-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    subscribe: (t, fn) => {
      topics.push(t);
      pokes = fn;
      return () => (pokes = null);
    },
    links: { onUrl: (fn) => ((urlListener = fn), () => (urlListener = () => {})) },
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
    /** Kody odrzuceń serwera reguł (testy, które ich nie zapowiadają, sprawdzają pustą listę). */
    rejected,
    signIn: (s: Session | null) => act(() => ((user = s?.userId ?? null), sessionListeners.forEach((fn) => fn(s)))),
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
    const push = { status: async () => 'denied' as const, request: async () => false, token: async () => null, onToken: () => () => {}, onOpen: () => () => {}, env: async () => 'sandbox' as const, replaceReminders };
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

describe('wylogowanie a kalendarze „Organizer – …” (D172, audyt 2 M-27)', () => {
  it('wylogowanie i inne konto usuwają kalendarze lustra tego telefonu; bez zgody, bez listy i bez prefs — nic', async () => {
    const m = new Map<string, string>([['calendarMirrorOwned', '["cal-a","cal-b"]']]);
    const prefs = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) };
    const deleteCalendar = jest.fn(async (id: string) => {
      if (id === 'cal-b') throw new Error('już nie ma');
    });
    const status = jest.fn(async () => 'granted' as const);
    // cal-b: błąd usunięcia, bo kalendarza już nie ma — znika z listy (nieudane usunięcie istniejącego zostaje: calendar-mirror.test.ts).
    const hasCalendar = jest.fn(async (id: string) => id !== 'cal-b');
    const sync = { status, deleteCalendar, hasCalendar } as unknown as NonNullable<RootDeps['calendar']['sync']>;
    const t = makeDeps({ prefs, calendar: { add: jest.fn(async () => 'saved' as const), sync } });
    await render(<Root deps={t.deps} fontsLoaded />);
    // Start bez sesji (np. po wylogowaniu w poprzednim uruchomieniu) — pozostałości znikają.
    await waitFor(() => expect(deleteCalendar).toHaveBeenCalledWith('cal-a'));
    expect(deleteCalendar).toHaveBeenCalledWith('cal-b');
    await waitFor(() => expect(m.get('calendarMirrorOwned')).toBe('[]'));
    deleteCalendar.mockClear();
    await t.signIn({ userId: ME, displayName: 'Ala' });
    m.set('calendarMirrorOwned', '["cal-c"]');
    // Inne konto na tym telefonie: kalendarze poprzedniego znikają.
    await t.signIn({ userId: 'u-2', displayName: 'Ola' });
    await waitFor(() => expect(deleteCalendar).toHaveBeenCalledWith('cal-c'));
    // Bez pełnej zgody nic nie usuwamy (iOS i tak by nie pozwolił), lista zostaje.
    m.set('calendarMirrorOwned', '["cal-d"]');
    status.mockResolvedValue('writeOnly' as never);
    deleteCalendar.mockClear();
    await t.signIn(null);
    await act(async () => {});
    expect(deleteCalendar).not.toHaveBeenCalled();
    expect(m.get('calendarMirrorOwned')).toBe('["cal-d"]');
  });

  it('bez prefs albo bez kalendarza w obie strony — nic', async () => {
    const { removeMirrorCalendars } = jest.requireActual<typeof import('../calendar-mirror')>('../calendar-mirror');
    const status = jest.fn(async () => 'granted' as const);
    await removeMirrorCalendars({ add: jest.fn(), sync: { status } as never }, undefined);
    await removeMirrorCalendars({ add: jest.fn() }, { get: async () => '["x"]', set: async () => {} });
    await removeMirrorCalendars({ add: jest.fn(), sync: { status } as never }, { get: async () => null, set: async () => {} });
    expect(status).not.toHaveBeenCalled();
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
    // Dane pobrane (wskaźnik po pobraniu); chipów grup przy jednej grupie nie ma (filtr PW-38).
    expect(await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/)).toBeTruthy();
  });

  it('szybkie dodawanie trafia do bazy i na serwer; poke z nową wersją pobiera, ze starą — nie', async () => {
    const t = makeDeps({ session: { current: async () => ({ userId: ME, displayName: 'Ala' }), onChange: () => () => {} } });
    await render(<Root deps={t.deps} fontsLoaded />);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
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
    const t = makeDeps({ session: { current: async () => ({ userId: ME, displayName: 'Ala' }), onChange: () => () => {} } });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    const db = t.dbs.get(ME)!;
    db.run("insert into tasks (key, group_id, data) values ('stary', ?, ?)", [ME, JSON.stringify({ id: 'stary', title: 'Stary wpis' })]);
    const before = t.pulls();
    await fireEvent.press(screen.getByLabelText('Ustawienia'));
    await fireEvent.press(await screen.findByTestId('settings-account'));
    await fireEvent.press(await screen.findByTestId('reset-start'));
    await fireEvent.press(screen.getByTestId('reset-confirm'));
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(before));
    // Dane pobrane (wskaźnik po pobraniu); chipów grup przy jednej grupie nie ma (filtr PW-38).
    expect(await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/)).toBeTruthy();
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

  it('M-76: link z cudzymi tokenami nie loguje (logowania z linku nie ma, D177) — zostaje ekran logowania', async () => {
    const t = makeDeps();
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.openUrl('io.github.lkarwowski494.organizer://auth/callback#access_token=a&refresh_token=r');
    expect(screen.getByTestId('screen-sign-in')).toBeTruthy();
    expect(t.deps.session).not.toHaveProperty('setFromLink');
  });

  it('M-221: link zaproszenia dotknięty bez zalogowania otwiera się po zalogowaniu (raz)', async () => {
    const t = makeDeps();
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-sign-in');
    await t.openUrl('io.github.lkarwowski494.organizer://join?g=482913507&c=731064');
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
    // Wylogowanie i ponowne zalogowanie — link już nie wraca.
    await t.signIn(null);
    await screen.findByTestId('screen-sign-in');
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByTestId('screen-invite')).toBeNull();
  });

  it('N-37: każdy link (prawdziwa konfiguracja linking, bez initialState) kładzie ekran na zakładkach', () => {
    for (const path of ['task/abc', 'list/l1', 'event/e1/2026-10-09', 'join?g=482913507&c=731064', 'j/?g=1&c=2', 'invite/t']) {
      const routes = getStateFromPath(path, linking.config)?.routes.map((r) => r.name);
      expect([path, routes?.length, routes?.[0]]).toEqual([path, 2, 'Tabs']);
    }
    expect(getStateFromPath('calendar', linking.config)?.routes.map((r) => r.name)).toEqual(['Tabs']);
  });

  it('N-37: aplikacja otwarta linkiem ma pod spodem zakładki; „Wróć” prowadzi do „Moich spraw”', async () => {
    const t = makeDeps();
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-sign-in');
    await t.openUrl('io.github.lkarwowski494.organizer://join?g=482913507&c=731064');
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Wróć'));
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByTestId('screen-invite')).toBeNull();
  });

  it('D175: ustawienia konta osobno dla konta; dawne wspólne ustawienia przejmuje pierwsze konto, drugie zaczyna od zera', async () => {
    const keychain = new Map([
      ['pref.welcomeSeen', '1'],
      ['pref.whatsNewBuild', String(Number.MAX_SAFE_INTEGER)],
    ]);
    const t = makeDeps({ legacyPrefs: { get: async (k) => keychain.get(k) ?? null, remove: async (k) => void keychain.delete(k) } });
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
    expect(keychain.size).toBe(0);
    expect(t.dbs.get(ME)!.all('select key, value from sync_state where key like ?', ['local:pref.%'])).toContainEqual({ key: 'local:pref.welcomeSeen', value: '1' });
    // Drugie konto na tym telefonie: wprowadzenie od początku.
    await t.signIn(null);
    await t.signIn({ userId: 'u-2', displayName: 'Ola' });
    expect(await screen.findByTestId('screen-welcome')).toBeTruthy();
    // Powrót pierwszego konta — jego ustawienia czekają w jego bazie.
    await t.signIn(null);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
  });

  it('domyślny zegar i timer (bez wstrzykniętych) też działają', async () => {
    const t = makeDeps({ nowMs: undefined, setTimer: undefined });
    await render(<Root deps={t.deps} fontsLoaded />);
    await t.signIn({ userId: ME, displayName: 'Ala' });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    await waitFor(() => expect(t.pulls()).toBeGreaterThan(0));
  });
});

describe('przypomnienia aktualne bez otwierania aplikacji (D159)', () => {
  const session = { current: async () => ({ userId: ME, displayName: 'Ala' }), onChange: () => () => {} };
  const quickAdd = async (text: string) => {
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    await fireEvent.changeText(screen.getByTestId('quick-add'), text);
    await fireEvent.press(screen.getByLabelText('Dodaj'));
  };

  it('moja zmiana z terminem w oknie planu — prośba o ciche powiadomienia dla grupy po wysłaniu', async () => {
    const t = makeDeps({ session });
    await render(<Root deps={t.deps} fontsLoaded />);
    await quickAdd('mleko jutro');
    await waitFor(() => expect(t.deps.account.notifyGroups).toHaveBeenCalledWith({ groups: [ME], retry: false }));
  });

  it('wyjście z aplikacji wysyła prośbę od razu, bez czekania na koniec serii zmian', async () => {
    const t = makeDeps({ session });
    const instant = t.deps.setTimer!;
    // Czas symulowany jak w makeDeps, ale odstęp prośby o ciche powiadomienia nie mija sam.
    t.deps.setTimer = (fn, ms) => (ms === config.wake.DEBOUNCE_MS ? () => {} : instant(fn, ms));
    await render(<Root deps={t.deps} fontsLoaded />);
    await quickAdd('chleb jutro');
    await waitFor(() => expect(t.pushes.length).toBeGreaterThan(0));
    await act(async () => {});
    expect(t.deps.account.notifyGroups).not.toHaveBeenCalled();
    await act(() => appStateHandlers.forEach((h) => h('background')));
    await waitFor(() => expect(t.deps.account.notifyGroups).toHaveBeenCalledWith({ groups: [ME], retry: false }));
  });

  // Audyt 3, N-19: „odwołuję i chowam telefon” — serwer przyjmuje zmianę już po wyjściu, uśpiona aplikacja nie doczeka odstępu.
  it('zmiana przyjęta przez serwer już po wyjściu z aplikacji — prośba od razu', async () => {
    const t = makeDeps({ session });
    const instant = t.deps.setTimer!;
    t.deps.setTimer = (fn, ms) => (ms === config.wake.DEBOUNCE_MS ? () => {} : instant(fn, ms));
    const push = t.deps.transport.push;
    let release: () => void = () => {};
    const gate = new Promise<void>((ok) => (release = ok));
    t.deps.transport = { ...t.deps.transport, push: async (req) => (await gate, push(req)) };
    await render(<Root deps={t.deps} fontsLoaded />);
    await quickAdd('chleb jutro');
    expect(t.pushes).toHaveLength(0);
    // Atrapa RN ma tu funkcję; w aplikacji to napis ze stanem (https://reactnative.dev/docs/appstate#currentstate).
    const mock = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    try {
      await act(() => appStateHandlers.forEach((h) => h('background')));
      expect(t.deps.account.notifyGroups).not.toHaveBeenCalled();
      await act(async () => release());
      await waitFor(() => expect(t.deps.account.notifyGroups).toHaveBeenCalledWith({ groups: [ME], retry: false }));
    } finally {
      Object.defineProperty(AppState, 'currentState', mock);
    }
  });

  it('ciche powiadomienie przy działającej aplikacji: pobiera jej pętla, także w tle, potem plan przypomnień', async () => {
    const replaceReminders = jest.fn(async () => {});
    const push = { status: async () => 'granted' as const, request: async () => true, token: async () => null, onToken: () => () => {}, onOpen: () => () => {}, env: async () => 'sandbox' as const, replaceReminders };
    const t = makeDeps({ session, push });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    await act(() => appStateHandlers.forEach((h) => h('background')));
    const before = t.pulls();
    replaceReminders.mockClear();
    let result = '';
    await act(async () => {
      result = await refreshInBackground(t.deps);
    });
    expect(result).toBe('new');
    expect(t.pulls()).toBe(before + 1);
    expect(replaceReminders).toHaveBeenCalledTimes(1);
  });

  it('bez zgody na powiadomienia — samo pobranie', async () => {
    const replaceReminders = jest.fn(async () => {});
    const push = { status: async () => 'denied' as const, request: async () => false, token: async () => null, onToken: () => () => {}, onOpen: () => () => {}, env: async () => 'sandbox' as const, replaceReminders };
    const t = makeDeps({ session, push });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    const before = t.pulls();
    await act(async () => void (await refreshInBackground(t.deps)));
    expect(t.pulls()).toBe(before + 1);
    expect(replaceReminders).not.toHaveBeenCalled();
  });
});

describe('odporność synchronizacji (audyt 2, P2)', () => {
  const signedIn = (over: Partial<RootDeps['session']> = {}) => ({ current: async () => ({ userId: ME, displayName: 'Ala' }) as Session, onChange: () => () => {}, ...over });

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
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    await act(() => net(false));
    expect(await screen.findByText('Offline')).toBeTruthy();
    const before = t.pulls();
    await act(() => net(true));
    await waitFor(() => expect(t.pulls()).toBe(before + 1));
  });

  it('audyt 2 (M-37): przejście w offline i powrót ogłaszane VoiceOverem (chip zmienia się po cichu)', async () => {
    let net: (online: boolean) => void = () => {};
    const t = makeDeps({ session: signedIn(), network: { subscribe: (fn) => ((net = fn), () => {}) } });
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/);
    const say = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    say.mockClear();
    await act(() => net(false));
    await waitFor(() => expect(say).toHaveBeenCalledWith('Offline', { queue: true }));
    await act(() => net(true));
    await waitFor(() => expect(say).toHaveBeenCalledTimes(2));
    expect(say.mock.calls[1]![0]).toMatch(/^Zsynchronizowano|^Przed chwilą/);
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
    expect(await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Zaloguj się ponownie')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('M-9: sesja, której nie da się odświeżyć — w Ustawieniach „Zaloguj się ponownie” bez czyszczenia danych', async () => {
    const refresh = jest.fn(async () => Promise.reject(new Error('refresh_token_not_found')));
    const signOutLocal = jest.fn(async () => {});
    const t = makeDeps({ session: signedIn({ refresh, signOutLocal }), removeDb: jest.fn() });
    t.deps.transport = { ...t.deps.transport, pull: () => Promise.reject(new TransportError('auth', 'jwt expired')) };
    await render(<Root deps={t.deps} fontsLoaded />);
    await screen.findByTestId('screen-today');
    await fireEvent.press(screen.getByLabelText('Ustawienia'));
    expect(await screen.findByText(/Sesja wygasła/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sign-in-again'));
    expect(signOutLocal).toHaveBeenCalledTimes(1);
    // Nie „Wyloguj” (sprzątanie konta) i nie usunięcie bazy: kolejka czeka na ponowne zalogowanie.
    expect(t.deps.account.signOut).not.toHaveBeenCalled();
    expect(t.deps.removeDb).not.toHaveBeenCalled();
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
    expect(await screen.findByText(/^(Zsynchronizowano|Przed chwilą)$/)).toBeTruthy();
  });

  it('inny błąd otwarcia bazy nie jest ukrywany', async () => {
    const t = makeDeps({ session: signedIn(), openDb: () => { throw new Error('dysk'); } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Root deps={t.deps} fontsLoaded />)).rejects.toThrow('dysk');
  });
});
