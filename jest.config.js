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
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/config/**/*.ts', 'src/data/**/*.ts', 'src/sync/**/*.ts', '!**/__tests__/**'],
  coverageThreshold: {
    './src/domain/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/config/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/data/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/sync/': { lines: 100, branches: 100, functions: 100, statements: 100 },
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
