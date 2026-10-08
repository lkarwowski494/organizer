/**
 * Część nocnych testów mutacyjnych (nightly.yml; audyt 2, M-47): ustawienia ze stryker.config.json (jedno źródło
 * prawdy), pliki części podaje `--mutate` (.github/scripts/mutation-shards.mjs). Bez progu w części: próg
 * thresholds.break dotyczy wyniku całości, więc liczy go .github/scripts/mutation-merge.mjs z raportów JSON
 * wszystkich części (ta sama funkcja wyniku co w Strykerze). Raport części: reports/mutation/mutation.json.
 * Lokalnie wszystko naraz nadal: `npm run test:mutation` (stryker.config.json, z progiem).
 */
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));
delete base.$schema;

export default {
  ...base,
  thresholds: { ...base.thresholds, break: null },
  reporters: ['clear-text', 'progress', 'json'],
};
