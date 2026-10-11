/**
 * Część nocnych testów mutacyjnych (nightly.yml; audyt 2, M-47): ustawienia ze stryker.config.json (jedno źródło
 * prawdy), mutanty części podaje `--mutate` (pliki albo zakresy z planu: .github/scripts/mutation-plan.mjs). Bez progu
 * w części: próg thresholds.break dotyczy wyniku całości, więc liczy go .github/scripts/mutation-merge.mjs z raportów
 * JSON wszystkich części (ta sama funkcja wyniku co w Strykerze). Raport części: reports/mutation/mutation.json;
 * czas pracy na każdy mutant (reporter „timing”, .github/scripts/stryker-reporters.mjs): reports/mutation/timings.jsonl —
 * z niego następny plan dzieli pracę.
 * Lokalnie wszystko naraz nadal: `npm run test:mutation` (stryker.config.json, z progiem).
 */
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));
delete base.$schema;

export default {
  ...base,
  thresholds: { ...base.thresholds, break: null },
  reporters: ['clear-text', 'progress', 'json', 'timing'],
  appendPlugins: ['./.github/scripts/stryker-reporters.mjs'],
};
