// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

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
]);
