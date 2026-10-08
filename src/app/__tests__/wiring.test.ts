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
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- uzasadnienie wyżej */
    (require('expo-application').getIosApplicationReleaseTypeAsync as jest.Mock).mockResolvedValue(release);
    mod = require('../wiring');
    sqlite = require('expo-sqlite');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return { ...mod, sqlite };
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

  it('usunięcie konta (M-64): baza konta zamknięta i plik usunięty; błąd usuwania cichy', async () => {
    const w = load({ EXPO_PUBLIC_E2E: undefined, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_test' }, Application.ApplicationReleaseType.SIMULATOR);
    const deps = w.appDeps();
    deps.openDb('u-1');
    const db = w.sqlite.openDatabaseSync.mock.results.at(-1)!.value as { closeSync: jest.Mock };
    deps.removeDb!('u-1');
    expect(db.closeSync).toHaveBeenCalled();
    expect(w.sqlite.deleteDatabaseSync).toHaveBeenCalledWith('organizer-u-1.db');
    w.sqlite.deleteDatabaseSync.mockImplementationOnce(() => {
      throw new Error('DeleteDatabaseException');
    });
    expect(() => deps.removeDb!('u-2')).not.toThrow();
    expect(deps.legacyPrefs).toBeDefined();
  });
});
