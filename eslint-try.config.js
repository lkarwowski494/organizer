const { defineConfig } = require('eslint/config');
const base = require('./eslint.config.js');
const jest = require('eslint-plugin-jest');
const tl = require('eslint-plugin-testing-library');
module.exports = defineConfig([
  ...base,
  { files: ['src/**/__tests__/**', 'tests/**', '**/*.test.ts', '**/*.test.tsx'], plugins: { jest }, rules: Object.fromEntries(Object.keys(jest.configs['flat/recommended'].rules).map(k=>[k,'error'])) },
  { files: ['src/**/*.test.tsx', 'src/app/__tests__/**'], plugins: { 'testing-library': tl }, rules: Object.fromEntries(Object.keys(tl.configs['flat/react'].rules).map(k=>[k,'error'])) },
]);
