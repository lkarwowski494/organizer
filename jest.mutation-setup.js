/**
 * Testy mutacyjne ze stałym ziarnem fast-check (jest.mutation.config.js, ADR 0047). Stryker porównuje każdy mutant
 * z przebiegiem wstępnym: przy losowym ziarnie ten sam mutant raz przeżywa, raz ginie, a losowy kontrprzykład w teście
 * własności oblewa przebieg wstępny całej części (12.10.2026, przebieg 38208658558, część 11: sync-sim, seed
 * -2063473931). Losowe ziarna zostają w `npm run check` — tam testy własności dalej szukają nowych kontrprzykładów.
 * „seed — Initial seed of the generator” (https://fast-check.dev/docs/core-blocks/runners/#fcassert).
 */
const fc = require('fast-check');

fc.configureGlobal({ seed: 20261012 });
