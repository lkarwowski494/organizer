/**
 * Dwa projekty Jest (D27):
 *  - domain: czysta logika TypeScript w Node, bez Reacta i Expo (szybkie testy własności),
 *  - app: ekrany i integracja z Expo (preset jest-expo).
 */
module.exports = {
  projects: [
    {
      displayName: 'domain',
      testEnvironment: 'node',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/domain/**/*.test.ts', '<rootDir>/src/config/**/*.test.ts'],
    },
    {
      displayName: 'app',
      preset: 'jest-expo/ios',
      testMatch: ['<rootDir>/src/**/*.test.tsx'],
    },
  ],
};
