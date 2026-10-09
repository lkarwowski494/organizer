/**
 * Przełącznik buildu (D143): EXPO_PUBLIC_E2E=1 → atrapy z src/app/e2e.ts, inaczej Supabase. Sesja demo tylko na
 * symulatorze (ApplicationReleaseType.SIMULATOR). Zmienną ustawiamy przed załadowaniem modułu, jak build Expo.
 */
import * as Application from 'expo-application';

jest.mock('expo-sqlite', () => ({ openDatabaseSync: jest.fn(() => ({ execSync: jest.fn(), runSync: jest.fn(), getAllSync: jest.fn(() => []), withTransactionSync: (f: () => void) => f(), closeSync: jest.fn() })), deleteDatabaseSync: jest.fn() }));
jest.mock('expo-application', () => ({
  ...jest.requireActual('expo-application'),
  getIosApplicationReleaseTypeAsync: jest.fn(),
}));

// Biblioteka podaje własną atrapę do Jest (moduł natywny); zdarzenie sieci wywołujemy ręcznie.
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js')); // eslint-disable-line @typescript-eslint/no-require-imports
jest.mock('expo-secure-store', () => {
  const kv = new Map<string, string>();
  return {
    ...jest.requireActual('expo-secure-store'),
    getItem: jest.fn((k: string) => kv.get(k) ?? null),
    setItem: jest.fn((k: string, v: string) => void kv.set(k, v)),
    getItemAsync: jest.fn(async () => null),
    deleteItemAsync: jest.fn(async (k: string) => void kv.delete(k)),
  };
});

const ORIGINAL = { ...process.env };

/**
 * Świeży moduł (jak nowy build) z daną zmienną i rodzajem instalacji. Preset Expo w Jest odczytuje EXPO_PUBLIC_*
 * przy ładowaniu modułu, więc każdy wariant ładuje wiring.ts od nowa (jest.isolateModules wymaga require — import()
 * w tym środowisku Jest nie działa bez --experimental-vm-modules).
 */
function load(env: { [k: string]: string | undefined }, release: Application.ApplicationReleaseType) {
  process.env = { ...ORIGINAL, ...env };
  let mod!: typeof import('../wiring');
  let sqlite!: { openDatabaseSync: jest.Mock; deleteDatabaseSync: jest.Mock };
  let secure!: { setItem: jest.Mock; AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: unknown };
  let netinfo!: { addEventListener: jest.Mock };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- uzasadnienie wyżej */
    (require('expo-application').getIosApplicationReleaseTypeAsync as jest.Mock).mockResolvedValue(release);
    mod = require('../wiring');
    sqlite = require('expo-sqlite');
    secure = require('expo-secure-store');
    netinfo = require('@react-native-community/netinfo');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return { ...mod, sqlite, secure, netinfo };
}

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('appDeps (D143)', () => {
  it('z EXPO_PUBLIC_E2E=1 na symulatorze: osoba demo, baza w pamięci, bez Supabase', async () => {
    const w = load({ EXPO_PUBLIC_E2E: '1', EXPO_PUBLIC_SUPABASE_KEY: undefined }, Application.ApplicationReleaseType.SIMULATOR);
    const deps = w.appDeps();
    expect(await deps.session.current()).toMatchObject({ displayName: 'Łukasz' });
    deps.openDb('u');
    expect(w.sqlite.openDatabaseSync).toHaveBeenLastCalledWith(':memory:');
    expect(deps.newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('z flagą, ale poza symulatorem (np. TestFlight): brak sesji', async () => {
    const deps = (load({ EXPO_PUBLIC_E2E: '1' }, Application.ApplicationReleaseType.APP_STORE)).appDeps();
    expect(await deps.session.current()).toBeNull();
  });

  it.each([undefined, '0', 'true', ''])('EXPO_PUBLIC_E2E=%p: prawdziwe zależności (Supabase)', async (flag) => {
    const deps = (load({ EXPO_PUBLIC_E2E: flag, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_test' }, Application.ApplicationReleaseType.SIMULATOR)).appDeps();
    expect(deps.nowMs).toBeUndefined(); // prawdziwy zegar
    expect(deps.calendar.sync).toBeDefined(); // kalendarz iPhone'a (atrapa E2E go nie ma)
    expect(await deps.session.current()).toBeNull(); // bez zapisanej sesji w pęku kluczy
  });

  it('prawdziwe zależności: identyfikator instalacji w pęku kluczy „tylko to urządzenie” (M-8), sieć z NetInfo (M-10)', () => {
    const w = load({ EXPO_PUBLIC_E2E: undefined, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_test' }, Application.ApplicationReleaseType.SIMULATOR);
    const deps = w.appDeps();
    const { secure, netinfo } = w;
    expect(deps.deviceClientId!.load('u1')).toBeNull();
    deps.deviceClientId!.save('u1', 'c1');
    expect(deps.deviceClientId!.load('u1')).toBe('c1');
    expect(secure.setItem).toHaveBeenCalledWith('clientId.u1', 'c1', { keychainAccessible: secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    const seen: boolean[] = [];
    deps.network!.subscribe((online) => seen.push(online));
    const listener = netinfo.addEventListener.mock.calls.at(-1)![0] as (s: { isConnected: boolean | null }) => void;
    listener({ isConnected: false });
    listener({ isConnected: true });
    listener({ isConnected: null }); // stan nieznany = sieć (o braku powie nieudane żądanie)
    expect(seen).toEqual([false, true, true]);
    expect(typeof deps.session.refresh).toBe('function');
    expect(typeof deps.session.signOutLocal).toBe('function');
  });

  it('usunięcie konta (M-64): baza konta zamknięta i plik usunięty, identyfikator instalacji z pęku kluczy też (N-77); błąd usuwania cichy', async () => {
    const w = load({ EXPO_PUBLIC_E2E: undefined, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_test' }, Application.ApplicationReleaseType.SIMULATOR);
    const deps = w.appDeps();
    deps.openDb('u-1');
    const db = w.sqlite.openDatabaseSync.mock.results.at(-1)!.value as { closeSync: jest.Mock };
    deps.deviceClientId!.save('u-1', 'c-1');
    deps.removeDb!('u-1');
    expect(db.closeSync).toHaveBeenCalled();
    // Audyt 3 (N-77): identyfikator instalacji usuniętego konta znika też z pęku kluczy (polityka: „usuwamy dane techniczne”).
    await Promise.resolve();
    expect(deps.deviceClientId!.load('u-1')).toBeNull();
    expect(w.sqlite.deleteDatabaseSync).toHaveBeenCalledWith('organizer-u-1.db');
    w.sqlite.deleteDatabaseSync.mockImplementationOnce(() => {
      throw new Error('DeleteDatabaseException');
    });
    expect(() => deps.removeDb!('u-2')).not.toThrow();
    expect(deps.legacyPrefs).toBeDefined();
  });
});
