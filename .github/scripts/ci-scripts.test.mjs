/**
 * Testy skryptów CI i kontraktów workflow (audyt 2: M-47 testy mutacyjne, M-155 filtr db.yml, M-79 E2E).
 * Uruchamia je ci.yml (zadanie check): `node --test ".github/scripts/*.test.mjs"` (po `npm ci`: minimatch, yaml,
 * mutation-testing-metrics).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';

import { ROOT } from './mutation-files.mjs';
import { PARAMS } from './mutation-plan.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const workflow = (name) => parse(read(`.github/workflows/${name}`));
const steps = (job) => job.steps ?? [];

describe('zależności skryptów CI zadeklarowane w package.json (audyt 3, N-240)', () => {
  it('każdy pakiet importowany w .github/scripts i scripts jest w dependencies albo devDependencies (nie tylko przechodnio)', () => {
    const pkg = JSON.parse(read('package.json'));
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const sources = ['.github/scripts', 'scripts', 'scripts/e2e'].flatMap((d) =>
      readdirSync(join(ROOT, d)).filter((f) => /\.m?js$/.test(f)).map((f) => `${d}/${f}`),
    );
    sources.push('stryker.shard.config.mjs', 'stryker.plan.config.mjs');
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

  it('nightly.yml: części testów mutacyjnych z planu, limit czasu z przewidywania, próg na całości (M-47, 11.10.2026)', () => {
    const { jobs } = workflow('nightly.yml');
    const plan = jobs['mutation-plan'];
    assert.deepEqual(plan.permissions, { contents: 'read', actions: 'read' });
    const planRun = steps(plan).map((s) => s.run ?? '').join('\n');
    assert.match(planRun, /mutation-prev-timings\.sh "\$BRANCH" reports\/previous/);
    assert.match(planRun, /mutation-plan\.mjs --timings reports\/previous\/timings\.json/);
    assert.equal(plan.outputs.matrix, '${{ steps.plan.outputs.matrix }}');
    assert.equal(jobs.mutation.needs, 'mutation-plan');
    assert.equal(jobs.mutation.strategy.matrix, '${{ fromJSON(needs.mutation-plan.outputs.matrix) }}');
    assert.equal(jobs.mutation.strategy['fail-fast'], false);
    assert.equal(jobs.mutation['timeout-minutes'], '${{ matrix.jobMin }}');
    const part = steps(jobs.mutation).find((s) => /stryker run/.test(s.run ?? ''));
    assert.deepEqual(part.env, { MUTATE: '${{ matrix.mutate }}', STEP_MIN: '${{ matrix.stepMin }}' });
    const limit = /timeout --kill-after=(\d+)m "\$\{STEP_MIN\}m" npx stryker run stryker\.shard\.config\.mjs --mutate "\$MUTATE"/.exec(part.run);
    assert.ok(limit, 'stryker w części pod `timeout` z limitem z planu');
    // jobMin = stepMin + jobSetupMin (mutation-plan.mjs): zapas na kroki poza Strykerem musi objąć --kill-after.
    assert.ok(Number(limit[1]) < PARAMS.jobSetupMin);
    const upload = steps(jobs.mutation).find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(upload.if, 'always()');
    assert.match(upload.with.path, /timings\.jsonl/);
    assert.deepEqual(jobs['mutation-score'].needs, ['mutation-plan', 'mutation']);
    assert.equal(jobs['mutation-score'].if, "${{ always() && needs.mutation-plan.result == 'success' }}");
    assert.match(steps(jobs['mutation-score']).map((s) => s.run ?? '').join('\n'), /mutation-merge\.mjs --plan reports\/plan\/plan\.json --timings-out reports\/timings\/timings\.json reports\/parts\/\*/);
    assert.ok(steps(jobs['mutation-score']).some((s) => s.with?.name === 'mutation-timings' && s.if === 'always()'));
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
