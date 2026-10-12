/**
 * Plan nocnych testów mutacyjnych (nightly.yml, zadanie mutation-plan; .github/scripts/mutation-plan.mjs): te same
 * ustawienia co stryker.config.json i wszystkie pliki z `mutate`, ale tylko przebieg wstępny i plan mutantów — reporter
 * „plan” (.github/scripts/stryker-reporters.mjs) zapisuje reports/mutation/plan-raw.json i kończy proces przed
 * testowaniem mutantów.
 */
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));
delete base.$schema;

export default {
  ...base,
  thresholds: { ...base.thresholds, break: null },
  reporters: ['plan'],
  appendPlugins: ['./.github/scripts/stryker-reporters.mjs'],
};
