// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*', 'ios/*', 'android/*', '.expo/*'],
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
    // W testach domeny dozwolone są moduły Node (np. node:crypto jako źródło losowości).
    files: ['src/domain/**/__tests__/**'],
    rules: { 'import/no-nodejs-modules': 'off' },
  },
]);
