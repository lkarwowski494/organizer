/**
 * Reportery Strykera do podziału nocnych testów mutacyjnych według danych (nightly.yml, mutation-plan.mjs).
 *
 * „plan” — zadanie mutation-plan: po przebiegu wstępnym (dry run) Stryker wylicza plan mutantów
 * (@stryker-mutator/core 10, mutants/mutant-test-planner.js: makePlan → reporter.onMutationTestingPlanReady). Reporter
 * zapisuje go razem z czasami testów z przebiegu wstępnego (onDryRunCompleted) i kończy proces, zanim zacznie się
 * testowanie mutantów. Opcji „tylko plan” Stryker nie ma: `--dryRunOnly` kończy przed makePlan
 * (process/4-mutation-test-executor.js), a bez planu nie wiadomo, które mutanty są statyczne.
 *
 * „timing” — każda część: po każdym przetestowanym mutancie dopisuje wiersz JSON z czasem pracy, który na niego
 * przypada. Stryker nie podaje czasu mutanta (schemat mutation-testing-report-schema go nie ma), więc liczymy go z odstępu
 * od poprzedniego wyniku pomnożonego przez liczbę procesów testów (`concurrency`): przy N procesach pracujących
 * naraz wynik przychodzi średnio co (czas mutanta / N). Wiersz dopisywany od razu, więc po przerwaniu części
 * (timeout) zostają pomiary mutantów, które zdążyły się wykonać.
 *
 * Położenie mutanta w obu plikach w układzie schematu raportu (wiersze i kolumny od 1, jak w mutation.json) — klucz
 * mutanta to plik, położenie, mutator i zamiana (mutantKey).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { commonTokens, declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';

/** Klucz mutanta niezależny od numeracji części (Stryker numeruje mutanty w każdym przebiegu od nowa). */
export const mutantKey = (file, loc, mutatorName, replacement) =>
  `${file}@${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}|${mutatorName}|${replacement}`;

/** Położenie wewnętrzne Strykera (od 0) → schemat raportu (od 1); utils/object-utils.js toSchemaPosition. */
const toSchema = (loc) => ({
  start: { line: loc.start.line + 1, column: loc.start.column + 1 },
  end: { line: loc.end.line + 1, column: loc.end.column + 1 },
});

const rel = (file) => relative(process.cwd(), file).split('\\').join('/');

class PlanReporter {
  static inject = [commonTokens.options];
  constructor(options) {
    this.out = process.env.MUTATION_PLAN_OUT ?? 'reports/mutation/plan-raw.json';
    this.concurrency = options.concurrency;
    this.tests = [];
    this.timing = null;
    this.exit = () => process.exit(0);
  }
  onDryRunCompleted({ result, timing }) {
    this.timing = timing;
    this.tests = result.tests.map((t) => ({ file: t.fileName ? rel(t.fileName) : null, ms: t.timeSpentMs }));
  }
  onMutationTestingPlanReady({ mutantPlans }) {
    const mutants = mutantPlans.map(({ plan, mutant, netTime }) => ({
      file: rel(mutant.fileName),
      loc: toSchema(mutant.location),
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      static: Boolean(mutant.static),
      run: plan === 'Run',
      netTime: netTime ?? 0,
    }));
    mkdirSync(dirname(this.out), { recursive: true });
    writeFileSync(this.out, JSON.stringify({ concurrency: this.concurrency, timing: this.timing, tests: this.tests, mutants }));
    process.stderr.write(`Plan: ${mutants.length} mutantów → ${this.out}\n`);
    // Koniec przed testowaniem mutantów (patrz opis pliku); procesy testów kończą się po zerwaniu kanału IPC.
    this.exit();
  }
}

class TimingReporter {
  static inject = [commonTokens.options];
  constructor(options) {
    this.out = process.env.MUTATION_TIMINGS_OUT ?? 'reports/mutation/timings.jsonl';
    this.concurrency = options.concurrency;
    this.last = null;
    mkdirSync(dirname(this.out), { recursive: true });
    writeFileSync(this.out, '');
  }
  onMutationTestingPlanReady() {
    this.last = Date.now();
  }
  onMutantTested(result) {
    const now = Date.now();
    const gap = this.last === null ? 0 : now - this.last;
    this.last = now;
    const row = {
      key: mutantKey(rel(result.fileName), result.location, result.mutatorName, result.replacement),
      file: rel(result.fileName),
      static: Boolean(result.static),
      status: result.status,
      ms: gap * this.concurrency,
    };
    appendFileSync(this.out, `${JSON.stringify(row)}\n`);
  }
}

export const strykerPlugins = [
  declareClassPlugin(PluginKind.Reporter, 'plan', PlanReporter),
  declareClassPlugin(PluginKind.Reporter, 'timing', TimingReporter),
];
