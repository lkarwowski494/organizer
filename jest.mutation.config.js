/**
 * Testy mutacyjne (Stryker, stryker.config.json): tylko projekt „domain” z jest.config.js — logika ma własne testy,
 * a testy ekranów uruchamiane przy każdym mutancie wydłużały nocny przebieg ponad limit zadania GitHub Actions
 * (audyt 2, D-1: 1113 z 5207 mutantów po 60 min).
 *
 * Bez budżetu czasu widoków (perf-budget.test.ts, config.perf): mierzy czas procesora, a kod z mutantami Strykera
 * (wszystkie mutanty wstawione naraz, przełączane zmienną) jest kilka razy wolniejszy. 11.10.2026 test oblał przebieg
 * wstępny Strykera na wszystkich plikach (Kalendarz 289 ms przy budżecie 150 ms), a w części mógłby „zabijać” mutanta
 * samym narzutem instrumentacji, czyli zawyżać wynik. Budżet pilnuje `npm run check` na kodzie bez mutantów.
 */
const base = require('./jest.config');

const PERF = '<rootDir>/src/domain/__tests__/perf-budget.test.ts';

module.exports = {
  projects: base.projects
    .filter((p) => p.displayName === 'domain')
    .map((p) => ({ ...p, testPathIgnorePatterns: [...(p.testPathIgnorePatterns ?? ['/node_modules/']), PERF] })),
};
