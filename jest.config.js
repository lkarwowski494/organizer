/**
 * Dwa projekty Jest (D27):
 *  - domain: czysta logika TypeScript w Node, bez Reacta i Expo (szybkie testy własności),
 *  - app: ekrany i integracja z Expo (preset jest-expo).
 */
module.exports = {
  // Pamięć procesów testów (audyt 2): pamięć procesu rośnie z każdym plikiem ekranów (pomiar --logHeapUsage 9.10.2026:
  // do ~1,8 GB po kilkudziesięciu plikach), co przy kilku procesach naraz kończyło się zabiciem procesu (SIGKILL)
  // i długim odśmiecaniem (testy blisko limitu czasu). Jest: „After the worker has executed a test the memory usage of
  // it is checked. If it exceeds the value specified the worker is killed and restarted”
  // (https://jestjs.io/docs/29.7/configuration#workeridlememorylimit-numberstring).
  workerIdleMemoryLimit: '800MB',
  // Progi pokrycia (decyzja właściciela 6.10.2026, docs/testing.md): logika 100% linii i gałęzi.
  // Audyt 2 (M-51): także ekrany, adaptery natywne i warstwa aplikacji — progi zapadkowe na poziomie z 9.10.2026
  // (podnosić przy każdej zmianie, nie obniżać); czysta logika w src/app i src/features (bez Reacta i modułów natywnych)
  // ma 100% jak src/domain — test kontraktowy src/config/__tests__/coverage.contract.test.ts pilnuje, że każdy taki plik
  // ma tu wpis.
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/config/**/*.ts', 'src/data/**/*.ts', 'src/sync/**/*.ts', 'src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}', '!**/__tests__/**'],
  coverageThreshold: {
    './src/domain/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/config/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/data/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/sync/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/app/account-prefs.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/app/calendar-mirror.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/app/self-check.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/app/e2e.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/features/groups/dates.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/features/groups/server-errors.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/app/': { lines: 85, branches: 74, functions: 72, statements: 82 },
    './src/features/': { lines: 97, branches: 95, functions: 94, statements: 97 },
    './src/ui/': { lines: 99, branches: 96, functions: 94, statements: 98 },
  },
  projects: [
    {
      displayName: 'domain',
      testEnvironment: 'node',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/domain/**/*.test.ts', '<rootDir>/src/config/**/*.test.ts', '<rootDir>/src/data/**/*.test.ts', '<rootDir>/src/sync/**/*.test.ts', '<rootDir>/src/app/**/*.test.ts'],
    },
    {
      // Testy na prawdziwym Postgresie (npm run test:db:diff); bez PGHOST są pomijane.
      displayName: 'db',
      testEnvironment: 'node',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/tests/db/**/*.test.ts'],
    },
    {
      displayName: 'app',
      preset: 'jest-expo/ios',
      setupFiles: ['<rootDir>/jest.app-setup.js'],
      setupFilesAfterEnv: ['<rootDir>/jest.app-after-env.js'],
      testMatch: ['<rootDir>/src/**/*.test.tsx'],
    },
  ],
};
