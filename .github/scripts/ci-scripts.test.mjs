/**
 * Testy skryptów CI i kontraktów workflow (audyt 2: M-47 testy mutacyjne, M-155 filtr db.yml, M-79 E2E).
 * Uruchamia je ci.yml (zadanie check): `node --test ".github/scripts/*.test.mjs"` (po `npm ci`: minimatch, yaml,
 * mutation-testing-metrics).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';

import { coverageProblems, mergeReports, metricsOf } from './mutation-merge.mjs';
import { mutateFiles, ROOT, shard } from './mutation-shards.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const workflow = (name) => parse(read(`.github/workflows/${name}`));
const steps = (job) => job.steps ?? [];
const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(ROOT, '.github/scripts', script), ...args], { encoding: 'utf8', ...opts });

describe('podział testów mutacyjnych na części (M-47)', () => {
  const files = mutateFiles();

  it('pliki z `mutate` takie jak przy niezależnym odczycie wzorców (bez minimatch)', () => {
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

  it('części są rozłączne, razem dają wszystkie pliki i różnią się liczbą plików najwyżej o 1', () => {
    for (const total of [1, 2, 3, 8, 13]) {
      const parts = Array.from({ length: total }, (_, i) => shard(files, i, total));
      assert.deepEqual(parts.flat().sort(), files);
      const counts = parts.map((p) => p.length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${total} części: ${counts}`);
    }
  });

  it('pliki od największego rozdawane wężykiem', () => {
    const size = { a: 4, b: 3, c: 2, d: 1, e: 0 };
    const sizeOf = (f) => size[f];
    assert.deepEqual(shard(['e', 'd', 'c', 'b', 'a'], 0, 2, sizeOf), ['a', 'd', 'e']);
    assert.deepEqual(shard(['e', 'd', 'c', 'b', 'a'], 1, 2, sizeOf), ['b', 'c']);
  });

  it('wiersz poleceń: --all, część po przecinku, złe argumenty i pusta część', () => {
    assert.equal(node('mutation-shards.mjs', ['--all']).stdout, `${files.join('\n')}\n`);
    assert.deepEqual(node('mutation-shards.mjs', ['1', '8']).stdout.split(','), shard(files, 1, 8));
    assert.equal(node('mutation-shards.mjs', ['8', '8']).status, 2);
    assert.equal(node('mutation-shards.mjs', ['x', '8']).status, 2);
    const empty = node('mutation-shards.mjs', [String(files.length), String(files.length + 1)]);
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /pusta/);
  });

  it('konfiguracja części: ustawienia ze stryker.config.json, bez progu, z raportem JSON', async () => {
    const base = JSON.parse(read('stryker.config.json'));
    const { default: part } = await import(join(ROOT, 'stryker.shard.config.mjs'));
    assert.equal(part.thresholds.break, null);
    assert.equal(typeof base.thresholds.break, 'number');
    assert.ok(part.reporters.includes('json'));
    for (const key of ['mutate', 'coverageAnalysis', 'concurrency', 'testRunner', 'jest']) assert.deepEqual(part[key], base[key], key);
    assert.equal(part.$schema, undefined);
  });
});

const mutant = (id, status) => ({ id: String(id), mutatorName: 'ConditionalExpression', status, location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } });
const file = (statuses) => ({ language: 'typescript', source: 'x', mutants: statuses.map((s, i) => mutant(i + 1, s)) });
const report = (files) => ({ schemaVersion: '1.0', thresholds: { high: 95, low: 90, break: 90 }, files, testFiles: { 't.test.ts': { tests: [{ id: '1', name: 't' }] } } });
const times = (n, s) => Array.from({ length: n }, () => s);

describe('wynik testów mutacyjnych z części (M-47)', () => {
  it('wynik całości jak wzór Strykera: (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)', () => {
    const a = report({ 'src/a.ts': file(['Killed', 'Killed', 'Survived', 'RuntimeError']) });
    const b = report({ 'src/b.ts': file(['Timeout', 'NoCoverage', 'Killed', 'Ignored', 'CompileError']) });
    const merged = mergeReports([a, b]);
    assert.deepEqual(Object.keys(merged.files).sort(), ['src/a.ts', 'src/b.ts']);
    assert.equal(merged.testFiles, undefined);
    assert.deepEqual(merged.files['src/b.ts'].mutants.map((m) => m.id), ['2-1', '2-2', '2-3', '2-4', '2-5']);
    const m = metricsOf(merged);
    assert.ok(Math.abs(m.mutationScore - (100 * (3 + 1)) / (3 + 1 + 1 + 1)) < 1e-9, String(m.mutationScore));
    assert.equal(m.totalValid, 6);
  });

  it('ten sam plik w dwóch częściach to błąd', () => {
    assert.throws(() => mergeReports([report({ 'src/a.ts': file(['Killed']) }), report({ 'src/a.ts': file(['Killed']) })]), /dwóch części/);
  });

  it('wykrywa plik bez części, w dwóch częściach, spoza mutate i raport spoza listy części', () => {
    const r = (names) => report(Object.fromEntries(names.map((n) => [n, file(['Killed'])])));
    assert.deepEqual(coverageProblems(['a', 'b'], [['a'], ['b']], [r(['a']), r(['b'])]), []);
    assert.equal(coverageProblems(['a', 'b'], [['a'], []], [r(['a']), r([])]).length, 1);
    assert.match(coverageProblems(['a'], [['a'], ['a']], [r(['a']), r([])]).join(), /w częściach 1 i 2/);
    assert.match(coverageProblems(['a'], [['a', 'z']], [r(['a'])]).join(), /z: spoza wzorców mutate/);
    assert.match(coverageProblems(['a', 'b'], [['a'], ['b']], [r(['a', 'b']), r(['b'])]).join(), /nie było go na jej liście/);
  });

  describe('wiersz poleceń na prawdziwej liście plików i progu ze stryker.config.json', () => {
    const files = mutateFiles();
    const threshold = JSON.parse(read('stryker.config.json')).thresholds.break;
    const run = (detected, undetected, { drop = 0 } = {}) => {
      const dir = mkdtempSync(join(tmpdir(), 'mutation-merge-'));
      const halves = [files.slice(0, Math.ceil(files.length / 2)), files.slice(Math.ceil(files.length / 2))];
      halves.forEach((names, i) => {
        const listed = i === 1 && drop ? names.slice(drop) : names;
        const statuses = (j) => (i === 0 && j === 0 ? [...times(detected, 'Killed'), ...times(undetected, 'Survived')] : []);
        mkdirSync(join(dir, `part-${i + 1}`));
        writeFileSync(join(dir, `part-${i + 1}`, 'files.txt'), `${listed.join(',')}\n`);
        writeFileSync(join(dir, `part-${i + 1}`, 'mutation.json'), JSON.stringify(report(Object.fromEntries(listed.map((n, j) => [n, file(statuses(j))])))));
      });
      return node('mutation-merge.mjs', [join(dir, 'part-1'), join(dir, 'part-2')], { env: { ...process.env, GITHUB_STEP_SUMMARY: join(dir, 'summary.md') } });
    };

    it('wynik równy progowi przechodzi (jak w Strykerze: błąd dopiero poniżej progu)', () => {
      const ok = run(threshold, 100 - threshold);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, new RegExp(`Wynik \\*\\*${threshold},00%\\*\\*`));
    });

    it('wynik poniżej progu oblewa przebieg', () => {
      const low = run(threshold - 1, 101 - threshold);
      assert.equal(low.status, 1);
      assert.match(low.stdout, /poniżej progu/);
    });

    it('brak ważnych mutantów albo plik bez części oblewa przebieg', () => {
      assert.equal(run(0, 0).status, 1);
      const missing = run(threshold, 100 - threshold, { drop: 1 });
      assert.equal(missing.status, 1);
      assert.match(missing.stdout, /nie ma go w żadnej części/);
    });
  });
});

describe('zależności skryptów CI zadeklarowane w package.json (audyt 3, N-240)', () => {
  it('każdy pakiet importowany w .github/scripts i scripts jest w dependencies albo devDependencies (nie tylko przechodnio)', () => {
    const pkg = JSON.parse(read('package.json'));
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const sources = ['.github/scripts', 'scripts', 'scripts/e2e'].flatMap((d) =>
      readdirSync(join(ROOT, d)).filter((f) => /\.m?js$/.test(f)).map((f) => `${d}/${f}`),
    );
    sources.push('stryker.shard.config.mjs');
    const used = new Map();
    for (const f of sources) {
      for (const m of read(f).matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s*['"]([^'".][^'"]*)['"]|import\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith('node:')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        used.set(name, f);
      }
    }
    assert.ok(used.has('minimatch') && used.has('mutation-testing-metrics') && used.has('yaml'), [...used.keys()].join());
    for (const [name, f] of used) assert.ok(declared.has(name), `${f}: ${name} spoza package.json`);
  });
});

describe('kontrakty workflow (audyt 2)', () => {
  it('db.yml rusza przy zmianie wszystkiego, co importują testy tests/db, co noc i ręcznie (M-155)', () => {
    const seen = new Set();
    const visit = (path) => {
      if (seen.has(path)) return;
      seen.add(path);
      for (const m of readFileSync(path, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        const base = resolve(dirname(path), m[1] ?? m[2]);
        const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((p) => existsSync(p) && statSync(p).isFile());
        assert.ok(target, `${relative(ROOT, path)}: nie znaleziono ${m[1] ?? m[2]}`);
        visit(target);
      }
    };
    for (const f of readdirSync(join(ROOT, 'tests/db')).filter((x) => x.endsWith('.test.ts'))) visit(join(ROOT, 'tests/db', f));
    const imported = [...seen].map((p) => relative(ROOT, p));
    assert.ok(imported.some((p) => p.startsWith('src/domain/sync-engine/')), 'testy tests/db importują silnik synchronizacji');
    const { on } = workflow('db.yml');
    assert.deepEqual(on.pull_request.paths, on.push.paths);
    // Zależności npm, z których korzystają tests/db (pg, fast-check, jest) — audyt 3, N-241.
    for (const p of [...imported, 'package.json', 'package-lock.json', '.github/workflows/db.yml']) {
      assert.ok(on.push.paths.some((glob) => minimatch(p, glob, { dot: true })), `${p} poza filtrem paths w db.yml`);
    }
    assert.ok(on.schedule?.length > 0 && 'workflow_dispatch' in on);
  });

  it('nightly.yml: części testów mutacyjnych kończą się błędem przed limitem czasu, próg na całości (M-47)', () => {
    const { jobs } = workflow('nightly.yml');
    assert.ok(jobs.mutation.strategy.matrix.part.length > 1);
    const run = steps(jobs.mutation).map((s) => s.run ?? '').join('\n');
    assert.match(run, /mutation-shards\.mjs "\$\{\{ strategy\.job-index \}\}" "\$\{\{ strategy\.job-total \}\}"/);
    const limit = /timeout --kill-after=(\d+)m (\d+)m npx stryker run stryker\.shard\.config\.mjs --mutate "\$files"/.exec(run);
    assert.ok(limit, 'stryker w części pod `timeout`');
    assert.ok(Number(limit[1]) + Number(limit[2]) < jobs.mutation['timeout-minutes']);
    assert.equal(jobs['mutation-score'].needs, 'mutation');
    assert.match(steps(jobs['mutation-score']).map((s) => s.run ?? '').join('\n'), /mutation-merge\.mjs reports\/parts\/\*/);
  });

  it('e2e.yml: maszyna macOS nie dla PR z forka; artefakt bez pełnego logu xcodebuild i logów Maestro (M-79, PW-48 A)', () => {
    const { jobs } = workflow('e2e.yml');
    assert.equal(jobs.ios.if, "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository");
    assert.doesNotMatch(jobs.ios.env.E2E_OUT, /e2e-artifacts/);
    const run = steps(jobs.ios).map((s) => s.run ?? '').join('\n');
    assert.doesNotMatch(run, /cp [^\n]*e2e-xcodebuild\.log/);
    assert.match(run, /tail -n \d+ ios\/build\/e2e-xcodebuild\.log \| grep -v -E '\^\[\[:space:\]\]\*export '/);
    const upload = steps(jobs.ios).find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(upload.with.path, 'e2e-artifacts/');
  });
});

describe('licencje: ścieżki pakietów z mapy źródeł (audyt 3, N-78; CI po `npm ci`)', async () => {
  const { jsEntries, packageDir } = await import(join(ROOT, 'scripts/licenses/gen-licenses.mjs'));
  // Projekt jak w CI: node_modules w katalogu projektu, pakiet zagnieżdżony (expo/node_modules/@expo/cli).
  const project = mkdtempSync(join(tmpdir(), 'licenses-fixture-'));
  const nested = join(project, 'node_modules/expo/node_modules/@expo/cli');
  mkdirSync(join(nested, 'build'), { recursive: true });
  writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: '@expo/cli', version: '9.9.9', license: 'MIT' }));
  writeFileSync(join(nested, 'LICENSE'), 'The MIT License\r\nCopyright (c) Ala\r\n');
  const expected = [{ name: '@expo/cli', version: '9.9.9', license: 'MIT', kind: 'js', text: 'The MIT License\nCopyright (c) Ala' }];

  it('ścieżka względem projektu z wiodącym „/” (tak zapisuje Metro w CI) wskazuje katalog w projekcie, nie w katalogu głównym dysku', () => {
    assert.deepEqual(packageDir('/node_modules/expo/node_modules/@expo/cli/build/metro-require/require.js', project), { name: '@expo/cli', dir: nested });
    assert.deepEqual(jsEntries(['/node_modules/expo/node_modules/@expo/cli/build/a.js', '/index.ts', '\0polyfill:x'], project), expected);
  });

  it('ścieżka bezwzględna (node_modules poza projektem, np. dowiązanie) daje ten sam wpis', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'licenses-other-root-'));
    assert.deepEqual(jsEntries([join(nested, 'build/a.js')], elsewhere), expected);
  });

  it('pakiet, którego nie ma ani w projekcie, ani pod ścieżką bezwzględną: błąd z nazwą pakietu, nie ENOENT z „/node_modules”', () => {
    assert.throws(() => packageDir('/node_modules/brak-pakietu/index.js', project), /nie znaleziono package\.json pakietu brak-pakietu/);
  });
});
