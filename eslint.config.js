// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const jestPlugin = require('eslint-plugin-jest');
const testingLibrary = require('eslint-plugin-testing-library');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions działa w Deno — sprawdza je `npm run check:functions` (deno check + deno lint).
    ignores: ['dist/*', 'coverage/*', '.stryker-tmp/*', 'reports/*', 'ios/*', 'android/*', '.expo/*', 'supabase/functions/**'],
  },
  {
    // Granica modułów: domena to czysty TypeScript — bez Reacta, React Native, Expo i warstw aplikacji.
    // Dzięki temu cała logika jest testowalna w Node i niezależna od interfejsu.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react/*', 'expo', 'expo-*', '@expo/*', '@react-navigation/*'],
              message: 'src/domain nie może zależeć od Reacta ani Expo — wstrzyknij zależność z zewnątrz.',
            },
            {
              group: ['**/features/**', '**/sync/**', '**/i18n/**'],
              message: 'src/domain nie może importować warstw aplikacji.',
            },
          ],
        },
      ],
    },
  },
  {
    // Audyt 2 (M-152, PWD-23 A): rozmiary tekstu i glifów tylko z ról w src/config/theme.ts (sizes) — ta sama rola ma
    // wszędzie ten sam rozmiar. Liczba wpisana ręcznie w `fontSize` jest błędem.
    files: ['src/**/*.tsx', 'App.tsx'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='fontSize'] > Literal",
          message: 'Rozmiar tekstu z motywu (size.BODY, size.META, …) — nie liczba wpisana ręcznie (src/config/theme.ts sizes).',
        },
      ],
    },
  },
  {
    // W testach domeny dozwolone są moduły Node (np. node:crypto jako źródło losowości).
    files: ['src/domain/**/__tests__/**'],
    rules: { 'import/no-nodejs-modules': 'off' },
  },
  {
    // Linter testów (audyt 2, M-196): zapomniane it.only / describe.skip, expect bez asercji albo w warunku, zła
    // składnia expect — zalecany zestaw eslint-plugin-jest (https://github.com/jest-community/eslint-plugin-jest).
    // Testy bazy pomija tylko bramka tests/db/db-gate.ts (dbDescribe), nie pojedyncze pliki.
    files: ['src/**/__tests__/**', 'tests/**', '**/*.test.ts', '**/*.test.tsx'],
    plugins: { jest: jestPlugin },
    rules: {
      ...Object.fromEntries(Object.keys(jestPlugin.configs['flat/recommended'].rules).map((r) => [r, 'error'])),
      // Własności fast-check sprawdzają wynik przez fc.assert (właściwość zwraca prawdę albo rzuca).
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert', 'expectOps', 'expectFocusOn'] }],
    },
  },
  {
    // Testy ekranów (RNTL): zalecany zestaw eslint-plugin-testing-library dla Reacta, bez dwóch reguł niezgodnych
    // z RNTL 14 — tam fireEvent zwraca obietnicę (await jest potrzebny: no-await-sync-events), a puste
    // `await act(async () => {})` czeka na efekty (no-unnecessary-act); bez reguły nazewnictwa wyniku render.
    files: ['src/**/*.test.tsx', 'src/app/__tests__/**'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      ...Object.fromEntries(Object.keys(testingLibrary.configs['flat/react'].rules).map((r) => [r, 'error'])),
      'testing-library/no-await-sync-events': 'off',
      'testing-library/no-unnecessary-act': 'off',
      'testing-library/render-result-naming-convention': 'off',
    },
  },
  {
    // M-156: operacje z ekranu sprawdzamy w całości (harness.expectOps: toEqual od poprzedniego sprawdzenia, nic po teście),
    // nie częściowym toMatchObject na jednej operacji.
    files: ['src/app/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='toMatchObject'] > MemberExpression.callee > CallExpression.object[callee.name='expect']:has(MemberExpression[property.name='dispatched'])",
          message: 'Operacje sprawdzaj przez expectOps(store, [...]) z harness.tsx (dokładnie i wszystkie — audyt 2, M-156).',
        },
      ],
    },
  },
]);
