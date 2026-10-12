/**
 * Testy nocnych testów mutacyjnych w częściach (audyt 2, M-47; podział według danych od 11.10.2026): pliki z `mutate`,
 * plan części (mutation-plan.mjs), reportery Strykera (stryker-reporters.mjs), scalanie wyniku i pomiar
 * (mutation-merge.mjs). Uruchamia je ci.yml: `node --test ".github/scripts/*.test.mjs"`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Instrumenter } from '@stryker-mutator/instrumenter';

import { coverageProblems, mergeReports, metricsOf, parseRows, timingsOf } from './mutation-merge.mjs';
import { mutateFiles, ROOT } from './mutation-files.mjs';
import { calibration, dryRunMs, keyOf, makePlan, modelMs, pack, PARAMS, rangeOf, readTimings, relatedMs, rootsOf, unitsOf, within } from './mutation-plan.mjs';
import { mutantKey, strykerPlugins } from './stryker-reporters.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(ROOT, '.github/scripts', script), ...args], { encoding: 'utf8', ...opts });
const MIN = 60_000;

describe('pliki z `mutate` (stryker.config.json)', () => {
  const files = mutateFiles();

  it('takie jak przy niezależnym odczycie wzorców (bez minimatch)', () => {
    const { mutate } = JSON.parse(read('stryker.config.json'));
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
    const chosen = new Set();
    for (const pattern of mutate) {
      const include = /^([\w./-]+)\/\*\*\/\*(\.\w+)$/.exec(pattern); // katalog/**/*.roz
      const exclude = /^!\*\*\/([\w.-]+)\/\*\*$/.exec(pattern); // !**/katalog/**
      assert.ok(include || exclude, `wzorzec spoza obsługiwanej postaci (rozszerz test): ${pattern}`);
      for (const f of tracked) {
        if (include && f.startsWith(`${include[1]}/`) && f.endsWith(include[2])) chosen.add(f);
        if (exclude && f.split('/').slice(0, -1).includes(exclude[1])) chosen.delete(f);
      }
    }
    assert.deepEqual(files, [...chosen].sort());
    assert.ok(files.length > 0);
  });

  it('wiersz poleceń: --all, inne argumenty to błąd', () => {
    assert.equal(node('mutation-files.mjs', ['--all']).stdout, `${files.join('\n')}\n`);
    assert.equal(node('mutation-files.mjs', ['1', '8']).status, 2);
  });

  it('konfiguracje części i planu: ustawienia ze stryker.config.json, bez progu, reportery z pliku wtyczek', async () => {
    const base = JSON.parse(read('stryker.config.json'));
    const { default: part } = await import(join(ROOT, 'stryker.shard.config.mjs'));
    const { default: plan } = await import(join(ROOT, 'stryker.plan.config.mjs'));
    assert.equal(typeof base.thresholds.break, 'number');
    for (const c of [part, plan]) {
      assert.equal(c.thresholds.break, null);
      for (const key of ['mutate', 'coverageAnalysis', 'concurrency', 'testRunner', 'jest']) assert.deepEqual(c[key], base[key], key);
      assert.equal(c.$schema, undefined);
      assert.deepEqual(c.appendPlugins, ['./.github/scripts/stryker-reporters.mjs']);
    }
    assert.ok(part.reporters.includes('json') && part.reporters.includes('timing'));
    assert.deepEqual(plan.reporters, ['plan']);
  });

  it('testy mutacyjne bez budżetu czasu widoków (mierzy czas procesora, a kod z mutantami jest wolniejszy)', () => {
    const cfg = require_('jest.mutation.config.js');
    assert.equal(cfg.projects.length, 1);
    assert.ok(cfg.projects[0].testPathIgnorePatterns.some((p) => p.endsWith('src/domain/__tests__/perf-budget.test.ts')));
    assert.ok(cfg.projects[0].testPathIgnorePatterns.includes('/node_modules/'));
    // Stałe ziarno fast-check: wynik mutanta nie zależy od losowania (ADR 0047, przebieg 38208658558).
    assert.ok(cfg.projects[0].setupFilesAfterEnv.includes('<rootDir>/jest.mutation-setup.js'));
    assert.match(read('jest.mutation-setup.js'), /fc\.configureGlobal\(\{ seed: \d+ \}\)/);
  });
});

function require_(path) {
  const mod = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(join(ROOT, path))})))`], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(mod.stdout);
}

/** Mutant planu w układzie schematu (wiersze i kolumny od 1). */
const pm = (file, sl, sc, el, ec, extra = {}) => ({
  file,
  loc: { start: { line: sl, column: sc }, end: { line: el, column: ec } },
  mutatorName: extra.mutatorName ?? 'BlockStatement',
  replacement: extra.replacement ?? `{}${sl}.${sc}`,
  static: extra.static ?? false,
  run: extra.run ?? true,
  netTime: extra.netTime ?? 1000,
});

describe('plan części: korzenie i zakresy', () => {
  it('within: zawieranie z równymi granicami jak locationIncluded Strykera', () => {
    const outer = { start: { line: 2, column: 5 }, end: { line: 4, column: 1 } };
    assert.ok(within(outer, outer));
    assert.ok(within({ start: { line: 2, column: 5 }, end: { line: 2, column: 9 } }, outer));
    assert.ok(!within({ start: { line: 2, column: 4 }, end: { line: 2, column: 9 } }, outer));
    assert.ok(!within({ start: { line: 3, column: 1 }, end: { line: 4, column: 2 } }, outer));
  });

  it('korzenie: mutanty zagnieżdżone razem z najszerszym, rozłączne osobno, kolejność w pliku', () => {
    const a = pm('f', 1, 1, 5, 2);
    const a1 = pm('f', 2, 3, 2, 9);
    const a2 = pm('f', 5, 1, 5, 2); // kończy się razem z a
    const b = pm('f', 7, 1, 7, 4);
    const b2 = pm('f', 7, 1, 7, 4, { mutatorName: 'StringLiteral' }); // to samo położenie
    const c = pm('f', 7, 4, 8, 1); // zaczyna się tam, gdzie kończy b
    const roots = rootsOf([c, a2, b, a1, b2, a]);
    assert.deepEqual(roots.map((r) => r.mutants.length), [3, 2, 1]);
    assert.equal(roots[0].mutants[0], a);
    assert.deepEqual(roots.map((r) => r.loc.start.line), [1, 7, 7]);
  });

  it('mutanty częściowo nachodzące na siebie to błąd (nie da się ich rozdzielić zakresami)', () => {
    assert.throws(() => rootsOf([pm('f', 1, 1, 3, 1), pm('f', 2, 1, 4, 1)]), /częściowo nachodzi/);
  });

  it('zakres dla --mutate: wiersze od 1, kolumny od 0 (położenie schematu ma kolumny od 1)', () => {
    assert.equal(rangeOf('src/a.ts', { line: 3, column: 5 }, { line: 9, column: 2 }), 'src/a.ts:3:4-9:1');
  });

  it('grupy korzeni pliku z prawdziwym instrumenterem Strykera: każdy mutant w dokładnie jednym zakresie', async () => {
    const logger = { debug() {}, info() {}, warn() {}, error() {}, isDebugEnabled: () => false, isTraceEnabled: () => false, isInfoEnabled: () => false };
    const instrumenter = new Instrumenter(logger);
    const name = join(ROOT, 'src/domain/rrule.ts');
    const content = read('src/domain/rrule.ts');
    const options = { plugins: null, excludedMutations: [], ignorers: [], noHeader: true };
    const toSchema = (l) => ({ start: { line: l.start.line + 1, column: l.start.column + 1 }, end: { line: l.end.line + 1, column: l.end.column + 1 } });
    const keyOfApi = (m) => mutantKey('src/domain/rrule.ts', toSchema(m.location), m.mutatorName, m.replacement);
    const all = (await instrumenter.instrument([{ name, mutate: true, content }], options)).mutants;
    const mutants = all.map((m) => ({ file: 'src/domain/rrule.ts', loc: toSchema(m.location), mutatorName: m.mutatorName, replacement: m.replacement, static: false, run: true, netTime: 0 }));
    // Bardzo mały cel, żeby plik podzielił się na wiele grup korzeni.
    const units = unitsOf({ 'src/domain/rrule.ts': mutants }, () => 1, { ...PARAMS, targetMin: (8 * 2) / (MIN * 4) }, 4);
    assert.ok(units.length >= 4, String(units.length));
    const seen = new Map();
    for (const u of units) {
      assert.equal(u.patterns.length, 1);
      // Zakres tak jak czyta go Stryker 10 (fs/project-reader.js MUTATION_RANGE_REGEX: wiersz − 1, kolumna bez zmian).
      const [, , sl, sc, el, ec] = /^(.*?):(\d+):(\d+)-(\d+):(\d+)$/.exec(u.patterns[0]);
      const range = [{ start: { line: Number(sl) - 1, column: Number(sc) }, end: { line: Number(el) - 1, column: Number(ec) } }];
      const got = (await instrumenter.instrument([{ name, mutate: range, content }], options)).mutants;
      assert.equal(got.length, u.mutants);
      for (const m of got) seen.set(keyOfApi(m), (seen.get(keyOfApi(m)) ?? 0) + 1);
    }
    assert.equal(seen.size, all.length);
    assert.ok([...seen.values()].every((n) => n === 1));
  });
});

describe('plan części: koszt i kalibracja', () => {
  it('czas powiązanych testów pliku: suma czasów testów z plików powiązanych', () => {
    const tests = [{ file: 't1', ms: 10 }, { file: 't1', ms: 5 }, { file: 't2', ms: 7 }, { file: null, ms: 100 }];
    assert.deepEqual(relatedMs(tests, { a: ['t1', 't2'], b: ['t2', 't3'], c: [] }), { a: 22, b: 7, c: 0 });
  });

  it('model: statyczny — wszystkie powiązane testy, pozostały — testy pokrywające; plus narzut; bez uruchomienia 0', () => {
    const p = { ...PARAMS, runOverheadMs: 100 };
    assert.equal(modelMs(pm('a', 1, 1, 1, 2, { static: true, netTime: 5 }), { a: 900 }, p), 1000);
    assert.equal(modelMs(pm('a', 1, 1, 1, 2, { netTime: 50 }), { a: 900 }, p), 150);
    assert.equal(modelMs(pm('a', 1, 1, 1, 2, { run: false }), { a: 900 }, p), 0);
  });

  it('kalibracja: współczynnik pliku przy dużej próbie, całości przy małej, 1 bez pomiaru', () => {
    const big = PARAMS.minCalibrationMin * MIN;
    const timings = {
      files: {
        a: { runtime: { measured: 3 * big, model: big }, static: { measured: 10, model: 10 } },
        b: { runtime: { measured: 10, model: 20 } },
        c: { runtime: { measured: -1, model: 5 }, static: { measured: 1, model: 0 } },
      },
    };
    const r = calibration(timings);
    assert.equal(r('a', 'runtime'), 3);
    assert.equal(r('b', 'runtime'), (3 * big + 10) / (big + 20));
    assert.equal(r('a', 'static'), 1);
    assert.equal(r('z', 'static'), 1);
    assert.equal(calibration(null)('a', 'runtime'), 1);
  });

  it('pomiar z poprzedniego przebiegu: brak pliku albo zła postać → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'timings-'));
    writeFileSync(join(dir, 'bad.json'), '{');
    writeFileSync(join(dir, 'empty.json'), '{"x":1}');
    writeFileSync(join(dir, 'ok.json'), '{"files":{}}');
    assert.equal(readTimings(undefined), null);
    assert.equal(readTimings(join(dir, 'nie-ma.json')), null);
    assert.equal(readTimings(join(dir, 'bad.json')), null);
    assert.equal(readTimings(join(dir, 'empty.json')), null);
    assert.deepEqual(readTimings(join(dir, 'ok.json')), { files: {} });
  });
});

describe('plan części: jednostki i pakowanie', () => {
  const p = { ...PARAMS, targetMin: 10, safety: 2, jobLimitMin: 100, jobSetupMin: 10, minStepMin: 5, dryRunFixedMs: 0, dryRunFactor: 0, maxParts: 50 };
  const ctx = { related: {}, testMs: new Map(), concurrency: 1 };

  it('plik do połowy celu w całości, droższy — grupy korzeni o podobnym koszcie', () => {
    const small = [pm('s', 1, 1, 1, 2), pm('s', 2, 1, 2, 2)];
    const big = Array.from({ length: 12 }, (_, i) => pm('b', i + 1, 1, i + 1, 9));
    const units = unitsOf({ s: small, b: big }, () => MIN, p, 1);
    assert.deepEqual(units.find((u) => u.file === 's'), { file: 's', patterns: ['s'], cost: 2 * MIN, mutants: 2 });
    const parts = units.filter((u) => u.file === 'b');
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.map((u) => u.mutants), [4, 4, 4]);
    assert.deepEqual(parts.map((u) => u.patterns[0]), ['b:1:0-4:8', 'b:5:0-8:8', 'b:9:0-12:8']);
  });

  it('najmniejsza liczba części mieszczących się w celu; limit kroku = SAFETY × przewidywanie', () => {
    const units = [7, 6, 5, 4, 3].map((m, i) => ({ file: `f${i}`, patterns: [`f${i}`], cost: m * MIN, mutants: m }));
    const parts = pack(units, ctx, p);
    assert.equal(parts.length, 3); // 25 min pracy, cel 10 min; LPT: 7 | 6+3 | 5+4
    assert.ok(parts.every((x) => x.predictedMin <= 10));
    assert.deepEqual(parts.map((x) => x.mutate).sort(), ['f0', 'f1,f4', 'f2,f3']);
    for (const x of parts) {
      assert.equal(x.stepMin, Math.max(p.minStepMin, Math.ceil(2 * x.predictedMin)));
      assert.equal(x.jobMin, x.stepMin + p.jobSetupMin);
    }
  });

  it('jednostka dłuższa niż cel dostaje własną część, a reszta mieści się w jej czasie', () => {
    const units = [{ file: 'big', patterns: ['big'], cost: 30 * MIN, mutants: 1 }, ...[3, 3, 3].map((m, i) => ({ file: `f${i}`, patterns: [`f${i}`], cost: m * MIN, mutants: 1 }))];
    const parts = pack(units, ctx, p);
    assert.equal(parts.length, 2);
    assert.equal(parts.find((x) => x.mutate === 'big').stepMin, 60);
  });

  it('przebieg wstępny: powiązane testy plików części liczone raz', () => {
    const related = { a: ['t1', 't2'], b: ['t2'] };
    const testMs = new Map([['t1', 10], ['t2', 20]]);
    assert.equal(dryRunMs(['a', 'b'], related, testMs, { ...PARAMS, dryRunFixedMs: 5, dryRunFactor: 2 }), 5 + 2 * 30);
  });

  it('błąd, gdy jednostka nie zmieści się w limicie kroku albo potrzeba więcej części niż pozwala macierz', () => {
    assert.throws(() => pack([{ file: 'x', patterns: ['x:1:0-9:1'], cost: 46 * MIN, mutants: 1 }], ctx, p), /x:1:0-9:1: przewidywane 46 min × 2 > 90 min/);
    const many = Array.from({ length: 4 }, (_, i) => ({ file: `f${i}`, patterns: [`f${i}`], cost: 10 * MIN, mutants: 1 }));
    assert.throws(() => pack(many, ctx, { ...p, maxParts: 3 }), /więcej niż 3 części/);
  });

  it('cały plan: klucze mutantów, model w oczekiwanych, kalibracja zmienia koszt, nie zbiór mutantów', () => {
    const raw = {
      concurrency: 2,
      tests: [{ file: 't', ms: 60_000 }],
      mutants: [pm('a', 1, 1, 1, 5, { static: true }), pm('a', 2, 1, 2, 5, { netTime: 30_000 }), pm('b', 1, 1, 1, 3, { netTime: 0 })],
    };
    const related = { a: ['t'], b: ['t'] };
    const plain = makePlan(raw, related, null);
    assert.equal(plain.calibrated, false);
    assert.deepEqual(plain.expected.map((e) => e.kind), ['static', 'runtime', 'runtime']);
    assert.deepEqual(plain.expected.map((e) => e.model), [60_000 + PARAMS.runOverheadMs, 30_000 + PARAMS.runOverheadMs, PARAMS.runOverheadMs]);
    assert.deepEqual(plain.expected.map((e) => e.key), raw.mutants.map(keyOf));
    assert.equal(plain.parts.length, 1);
    const slow = makePlan(raw, related, { files: { a: { static: { measured: 100 * MIN, model: 10 * MIN } } } });
    assert.equal(slow.calibrated, true);
    assert.ok(slow.predictedTotalMin > plain.predictedTotalMin);
    assert.deepEqual(slow.expected, plain.expected);
    assert.throws(() => makePlan({ ...raw, mutants: [raw.mutants[0], raw.mutants[0]] }, related, null), /dwa razy/);
  });
});

describe('reportery Strykera (plan i pomiar czasu)', () => {
  const plugin = (name) => strykerPlugins.find((x) => x.name === name).injectableClass;
  const loc0 = { start: { line: 0, column: 4 }, end: { line: 2, column: 1 } };

  it('plan: położenie w układzie schematu, mutanty statyczne, czasy testów; koniec procesu po zapisie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-'));
    process.env.MUTATION_PLAN_OUT = join(dir, 'raw.json');
    try {
      const r = new (plugin('plan'))({ concurrency: 3 });
      let exited = 0;
      r.exit = () => (exited += 1);
      r.onDryRunCompleted({ result: { tests: [{ fileName: join(process.cwd(), 'src/x.test.ts'), timeSpentMs: 12 }, { timeSpentMs: 1 }] }, timing: { net: 1, overhead: 2 } });
      r.onMutationTestingPlanReady({
        mutantPlans: [
          { plan: 'Run', netTime: 40, mutant: { fileName: join(process.cwd(), 'src/x.ts'), location: loc0, mutatorName: 'M', replacement: 'r', static: true } },
          { plan: 'EarlyResult', mutant: { fileName: join(process.cwd(), 'src/x.ts'), location: loc0, mutatorName: 'N', replacement: 's' } },
        ],
      });
      assert.equal(exited, 1);
      const raw = JSON.parse(readFileSync(join(dir, 'raw.json'), 'utf8'));
      assert.equal(raw.concurrency, 3);
      assert.deepEqual(raw.tests, [{ file: 'src/x.test.ts', ms: 12 }, { file: null, ms: 1 }]);
      assert.deepEqual(raw.mutants[0], { file: 'src/x.ts', loc: { start: { line: 1, column: 5 }, end: { line: 3, column: 2 } }, mutatorName: 'M', replacement: 'r', static: true, run: true, netTime: 40 });
      assert.deepEqual([raw.mutants[1].run, raw.mutants[1].static, raw.mutants[1].netTime], [false, false, 0]);
    } finally {
      delete process.env.MUTATION_PLAN_OUT;
    }
  });

  it('pomiar: odstęp od poprzedniego wyniku × concurrency, wiersz dopisywany od razu', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'timing-'));
    process.env.MUTATION_TIMINGS_OUT = join(dir, 't.jsonl');
    try {
      const r = new (plugin('timing'))({ concurrency: 4 });
      const result = { fileName: join(process.cwd(), 'src/x.ts'), location: { start: { line: 1, column: 5 }, end: { line: 3, column: 2 } }, mutatorName: 'M', replacement: 'r', static: true, status: 'Killed' };
      r.onMutationTestingPlanReady();
      await new Promise((res) => setTimeout(res, 30));
      r.onMutantTested(result);
      const rows = parseRows(readFileSync(join(dir, 't.jsonl'), 'utf8'));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].key, 'src/x.ts@1:5-3:2|M|r');
      assert.equal(rows[0].static, true);
      assert.ok(rows[0].ms >= 4 * 25 && rows[0].ms % 4 === 0, String(rows[0].ms));
    } finally {
      delete process.env.MUTATION_TIMINGS_OUT;
    }
  });
});

const mutant = (id, status, line = id) => ({ id: String(id), mutatorName: 'ConditionalExpression', replacement: 'true', status, location: { start: { line, column: 1 }, end: { line, column: 2 } } });
const file = (statuses, from = 1) => ({ language: 'typescript', source: 'x', mutants: statuses.map((s, i) => mutant(i + from, s)) });
const report = (files) => ({ schemaVersion: '1.0', thresholds: { high: 95, low: 90, break: 90 }, files, testFiles: { 't.test.ts': { tests: [{ id: '1', name: 't' }] } } });
const keysOf = (name, n, from = 1) => Array.from({ length: n }, (_, i) => mutantKey(name, mutant(i + from).location, 'ConditionalExpression', 'true'));

describe('wynik testów mutacyjnych z części (M-47)', () => {
  it('wynik całości jak wzór Strykera: (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)', () => {
    const a = report({ 'src/a.ts': file(['Killed', 'Killed', 'Survived', 'RuntimeError']) });
    const b = report({ 'src/b.ts': file(['Timeout', 'NoCoverage', 'Killed', 'Ignored', 'CompileError']) });
    const merged = mergeReports([a, null, b]);
    assert.deepEqual(Object.keys(merged.files).sort(), ['src/a.ts', 'src/b.ts']);
    assert.equal(merged.testFiles, undefined);
    assert.deepEqual(merged.files['src/b.ts'].mutants.map((m) => m.id), ['3-1', '3-2', '3-3', '3-4', '3-5']);
    const m = metricsOf(merged);
    assert.ok(Math.abs(m.mutationScore - (100 * (3 + 1)) / (3 + 1 + 1 + 1)) < 1e-9, String(m.mutationScore));
    assert.equal(m.totalValid, 6);
  });

  it('plik podzielony między części: mutanty obu części w jednym pliku raportu', () => {
    const merged = mergeReports([report({ 'src/a.ts': file(['Killed']) }), report({ 'src/a.ts': file(['Survived'], 2) })]);
    assert.deepEqual(merged.files['src/a.ts'].mutants.map((m) => m.id), ['1-1', '2-2']);
  });

  it('zgodność z planem: brak raportu, plik spoza mutate, mutant bez wyniku, dwa razy i spoza planu', () => {
    const allowed = new Set(['src/a.ts', 'src/b.ts']);
    const expected = [...keysOf('src/a.ts', 2), ...keysOf('src/b.ts', 1)];
    const ok = [report({ 'src/a.ts': file(['Killed']) }), report({ 'src/a.ts': file(['Killed'], 2), 'src/b.ts': file(['Killed']) })];
    assert.deepEqual(coverageProblems(expected, allowed, ok), []);
    assert.match(coverageProblems(expected, allowed, [ok[0], null], ['część 1', 'część 7']).join(), /część 7: brak raportu/);
    assert.match(coverageProblems(expected, allowed, [ok[0], null]).join(), /mutanty z planu bez wyniku: 2 \(np\. src\/a\.ts@2:1-2:2/);
    assert.match(coverageProblems(expected, allowed, [...ok, ok[0]]).join(), /mutanty w kilku częściach: 1/);
    assert.match(coverageProblems(expected, allowed, [...ok, report({ 'src/z.ts': file(['Killed']) })]).join(), /src\/z\.ts: spoza wzorców mutate.*mutanty spoza planu: 1/);
  });

  it('pomiar: suma zmierzonego czasu i modelu dla pliku i rodzaju; wiersze spoza planu i urwane pominięte', () => {
    const expected = [
      { key: 'k1', file: 'a', kind: 'static', model: 100 },
      { key: 'k2', file: 'a', kind: 'runtime', model: 10 },
      { key: 'k3', file: 'a', kind: 'runtime', model: 20 },
    ];
    const rows = parseRows('{"key":"k1","ms":300}\n{"key":"k2","ms":5}\n{"key":"k3","ms":15}\n{"key":"zz","ms":1}\n{"key":"k2","ms":-1}\n{"key":"k3","m');
    assert.equal(rows.length, 5);
    assert.deepEqual(timingsOf(expected, rows), { version: 1, files: { a: { static: { measured: 300, model: 100, n: 1 }, runtime: { measured: 20, model: 30, n: 2 } } } });
  });

  describe('wiersz poleceń na prawdziwej liście plików i progu ze stryker.config.json', () => {
    const files = mutateFiles();
    const threshold = JSON.parse(read('stryker.config.json')).thresholds.break;
    const run = (detected, undetected, { dropPart = false } = {}) => {
      const dir = mkdtempSync(join(tmpdir(), 'mutation-merge-'));
      const n = detected + undetected;
      const statuses = [...Array(detected).fill('Killed'), ...Array(undetected).fill('Survived')];
      const half = Math.ceil(n / 2);
      const expected = keysOf(files[0], n).map((key) => ({ key, file: files[0], kind: 'runtime', model: 10 }));
      writeFileSync(join(dir, 'plan.json'), JSON.stringify({ parts: [{ part: 1 }, { part: 2 }], expected }));
      [statuses.slice(0, half), statuses.slice(half)].forEach((list, i) => {
        if (dropPart && i === 1) return;
        const d = join(dir, `mutation-part-${i + 1}`);
        mkdirSync(d);
        writeFileSync(join(d, 'mutation.json'), JSON.stringify(report(list.length ? { [files[0]]: file(list, i === 0 ? 1 : half + 1) } : {})));
        writeFileSync(join(d, 'timings.jsonl'), `${expected.slice(i * half, i * half + list.length).map((e) => JSON.stringify({ key: e.key, ms: 30 })).join('\n')}\n`);
      });
      const parts = [1, 2].map((i) => join(dir, `mutation-part-${i}`));
      const res = node('mutation-merge.mjs', ['--plan', join(dir, 'plan.json'), '--timings-out', join(dir, 'timings.json'), ...parts], { env: { ...process.env, GITHUB_STEP_SUMMARY: join(dir, 'summary.md') } });
      return { ...res, dir };
    };

    it('wynik równy progowi przechodzi (jak w Strykerze: błąd dopiero poniżej progu); pomiar zapisany', () => {
      const ok = run(threshold, 100 - threshold);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, new RegExp(`Wynik \\*\\*${threshold},00%\\*\\*`));
      const t = JSON.parse(readFileSync(join(ok.dir, 'timings.json'), 'utf8'));
      assert.deepEqual(t.files[files[0]].runtime, { measured: 3000, model: 1000, n: 100 });
      assert.match(readFileSync(join(ok.dir, 'summary.md'), 'utf8'), /2 części/);
    });

    it('wynik poniżej progu oblewa przebieg', () => {
      const low = run(threshold - 1, 101 - threshold);
      assert.equal(low.status, 1);
      assert.match(low.stdout, /poniżej progu/);
    });

    it('brak ważnych mutantów, brak części albo brak planu oblewa przebieg; pomiar i tak zapisany', () => {
      assert.equal(run(0, 0).status, 1);
      const missing = run(threshold, 100 - threshold, { dropPart: true });
      assert.equal(missing.status, 1);
      assert.match(missing.stdout, /część 2: brak raportu/);
      assert.equal(JSON.parse(readFileSync(join(missing.dir, 'timings.json'), 'utf8')).files[files[0]].runtime.n, 50);
      assert.equal(node('mutation-merge.mjs', []).status, 2);
    });
  });
});
