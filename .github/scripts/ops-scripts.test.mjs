/**
 * Testy skryptów utrzymania i kontraktów workflow z audytu 2 (paczka P15): strażnik darmowych limitów (D185, M-78),
 * log buildu E2E bez wierszy `export` (D170), skan sekretów całego zakresu pusha, macierz zrzutów E2E (PWD-38 B)
 * i audyt dostępności na symulatorze (D186, M-153). Uruchamia je ci.yml: `node --test ".github/scripts/*.test.mjs"`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { evaluate, main, measure, projectRef, report } from './free-limits.mjs';
import { ROOT } from './mutation-shards.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const workflow = (name) => parse(read(`.github/workflows/${name}`));

const limits = { supabaseDbBytesWarn: 1000, edgeFunctionInvocationsPerMonthWarn: 300, actionsCacheBytesWarn: 5000 };
const TOKEN = 'token-testowy-nie-do-wypisania';

/** Atrapa fetch: odpowiedzi po ścieżce, zapis wywołań (adres, nagłówki, treść). */
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    const a = answers[path];
    if (a === undefined) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof a === 'number') return { ok: false, status: a, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => a };
  };
  return { fn, calls };
}

const REF = 'rkokujgrziaaxabtxnlo';
const answers = (db, n, cache) => ({
  [`/v1/projects/${REF}/database/query/read-only`]: db,
  [`/v1/projects/${REF}/analytics/endpoints/logs`]: n,
  '/repos/o/r/actions/cache/usage': cache,
});

describe('strażnik darmowych limitów (D185, M-78)', () => {
  it('identyfikator projektu z adresu z config; inny adres to błąd', () => {
    assert.equal(projectRef(`https://${REF}.supabase.co`), REF);
    assert.throws(() => projectRef('https://example.com'), /Nieoczekiwany adres/);
  });

  it('pomiary: rozmiar bazy (zapytanie tylko do odczytu = podtrzymanie), wywołania z 24 h × 30, pamięć Actions', async () => {
    const f = fakeFetch(answers([{ bytes: 700 }], { result: [{ n: 4 }] }, { active_caches_size_in_bytes: 100 }));
    const now = Date.UTC(2026, 9, 9, 3, 0);
    const m = await measure({ fetchFn: f.fn, token: TOKEN, ref: REF, now, github: { token: 'gh', repository: 'o/r' } });
    assert.deepEqual(m, [
      { name: 'dbBytes', value: 700 },
      { name: 'functionInvocationsPerMonth', value: 120 },
      { name: 'actionsCacheBytes', value: 100 },
    ]);
    const [db, logs, cache] = f.calls;
    assert.equal(db.init.method, 'POST');
    assert.equal(db.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.match(JSON.parse(db.init.body).query, /pg_database_size/);
    const q = new URL(logs.url).searchParams;
    assert.match(q.get('sql'), /source_name = 'function_edge_logs'/);
    assert.equal(Date.parse(q.get('iso_timestamp_end')) - Date.parse(q.get('iso_timestamp_start')), 24 * 3600 * 1000, 'okno ≤ 24 h (opis endpointu)');
    assert.equal(cache.init.headers.Authorization, 'Bearer gh');
  });

  it('błąd jednego pomiaru nie ukrywa pozostałych; bez GITHUB_TOKEN nie ma pomiaru Actions', async () => {
    const f = fakeFetch(answers(500, { error: 'zła składnia' }, undefined));
    const m = await measure({ fetchFn: f.fn, token: TOKEN, ref: REF, now: 0, github: {} });
    assert.deepEqual(m.map((x) => [x.name, x.error]), [
      ['dbBytes', `HTTP 500 dla /v1/projects/${REF}/database/query/read-only`],
      ['functionInvocationsPerMonth', 'błąd API: zła składnia'],
    ]);
    const odd = await measure({ fetchFn: fakeFetch(answers({ x: 1 }, { result: [{}] }, {})).fn, token: TOKEN, ref: REF, now: 0, github: { token: 'g', repository: 'o/r' } });
    assert.deepEqual(odd.map((x) => x.error), ['nieoczekiwany kształt odpowiedzi', 'brak liczby „n” w odpowiedzi', 'brak active_caches_size_in_bytes']);
  });

  it('ocena: poniżej progu ok, od progu ostrzeżenie, nieudany pomiar błąd', () => {
    const r = evaluate([{ name: 'dbBytes', value: 999 }, { name: 'functionInvocationsPerMonth', value: 300 }, { name: 'actionsCacheBytes', error: 'x' }], limits);
    assert.deepEqual(r.map((x) => x.status), ['ok', 'warn', 'error']);
    assert.match(report(r), /\| Rozmiar bazy Supabase \| ok \|/);
    assert.match(report(r), /egress/);
  });

  it('bez sekretu: komunikat i kod 0, bez żadnego zapytania', async () => {
    const f = fakeFetch({});
    const out = [];
    assert.equal(await main({ env: {}, fetchFn: f.fn, log: (s) => out.push(s) }), 0);
    assert.equal(f.calls.length, 0);
    assert.match(out.join('\n'), /::notice::Brak sekretu SUPABASE_MONITOR_TOKEN/);
  });

  it('progi z config.limits; przekroczenie albo błąd → kod 1; tokenu nie ma w wyjściu', async () => {
    const loadConfig = async () => ({ config: { SUPABASE_URL: `https://${REF}.supabase.co`, limits } });
    const run = async (db) => {
      const out = [];
      const code = await main({ env: { SUPABASE_MONITOR_TOKEN: TOKEN }, fetchFn: fakeFetch(answers(db, { result: [{ n: 1 }] })).fn, log: (s) => out.push(s), loadConfig, now: 0 });
      return { code, out: out.join('\n') };
    };
    const ok = await run([{ bytes: 10 }]);
    assert.equal(ok.code, 0);
    const warn = await run([{ bytes: 1000 }]);
    assert.equal(warn.code, 1);
    assert.match(warn.out, /::error::Rozmiar bazy Supabase: .*przekroczony próg/);
    const err = await run(503);
    assert.equal(err.code, 1);
    for (const o of [ok.out, warn.out, err.out]) assert.ok(!o.includes(TOKEN));
  });

  it('prawdziwe progi: src/config (jedno źródło prawdy) zawiera progi, których używa skrypt', async () => {
    const { config } = await import('../../src/config/index.ts');
    const r = evaluate([{ name: 'dbBytes', value: 0 }, { name: 'functionInvocationsPerMonth', value: 0 }, { name: 'actionsCacheBytes', value: 0 }], config.limits);
    assert.ok(r.every((x) => x.status === 'ok' && x.warn > 0));
    assert.equal(projectRef(config.SUPABASE_URL).length, 20);
  });

  it('nightly.yml: zadanie bez sekretów na poziomie zadania, sekret tylko w kroku pomiaru; docs/limits.md opisuje sekret', () => {
    const job = workflow('nightly.yml').jobs['free-limits'];
    assert.ok(job, 'brak zadania free-limits');
    assert.ok(!JSON.stringify(job.env ?? {}).includes('secrets.'));
    const withSecret = job.steps.filter((s) => JSON.stringify(s).includes('secrets.'));
    assert.equal(withSecret.length, 1);
    assert.deepEqual(Object.keys(withSecret[0].env).filter((k) => String(withSecret[0].env[k]).includes('secrets.')), ['SUPABASE_MONITOR_TOKEN']);
    assert.match(withSecret[0].run, /free-limits\.mjs/);
    assert.equal(job.permissions.contents, 'read');
    assert.match(read('docs/limits.md'), /SUPABASE_MONITOR_TOKEN/);
  });
});

describe('log buildu E2E bez wierszy export (D170)', () => {
  it('nieudany build: błędy i koniec logu bez zmiennych środowiska', () => {
    const bin = mkdtempSync(join(tmpdir(), 'e2e-bin-'));
    const tool = (name, body) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    tool('npx', 'exit 0');
    tool('xcodebuild', "echo '    export SECRET_LIKE=wartosc'; echo 'export X=1'; echo 'error: coś nie tak'; echo '** BUILD FAILED **'; exit 65");
    const work = mkdtempSync(join(tmpdir(), 'e2e-root-'));
    spawnSync('mkdir', ['-p', join(work, 'scripts/e2e')]);
    writeFileSync(join(work, 'scripts/e2e/build-ios.sh'), read('scripts/e2e/build-ios.sh'));
    const r = spawnSync('bash', [join(work, 'scripts/e2e/build-ios.sh'), 'UDID'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /error: coś nie tak/);
    assert.ok(!/export /.test(r.stdout + r.stderr), r.stdout);
  });
});

describe('skan sekretów całego zakresu pusha', () => {
  it('ci.yml: po gitleaks-action test skryptu i skan zakresu przed..po (push) albo bazy..głowy (PR)', () => {
    const steps = workflow('ci.yml').jobs['secrets-scan'].steps;
    const names = steps.map((s) => s.uses?.split('@')[0] ?? s.run);
    const action = names.indexOf('gitleaks/gitleaks-action');
    const test = names.indexOf('.github/scripts/test-gitleaks-range.sh');
    const scan = steps.findIndex((s) => s.run?.startsWith('.github/scripts/gitleaks-range.sh'));
    assert.ok(action >= 0 && test > action && scan > test, names.join(' | '));
    assert.match(steps[scan].env.BEFORE, /github\.event\.before/);
    assert.match(steps[scan].env.BEFORE, /pull_request\.base\.sha/);
    assert.equal(steps[0].with['fetch-depth'], 0, 'pełna historia');
  });
});

describe('warianty zrzutów E2E (PWD-38 B) i audyt dostępności na symulatorze (D186)', () => {
  const list = (which) => spawnSync('bash', [join(ROOT, 'scripts/e2e/run-matrix.sh'), '--list', which], { encoding: 'utf8' }).stdout.trim().split('\n');

  it('8 wariantów: 2 telefony × 2 tryby kolorów × 2 rozmiary tekstu; bazowy to pierwszy', () => {
    const all = list('all');
    assert.equal(new Set(all).size, 8);
    for (const phone of ['iphone-17e', 'iphone-17-pro-max']) for (const a of ['light', 'dark']) for (const s of ['default', 'ax5']) assert.ok(all.includes(`${phone}-${a}-${s}`));
    assert.deepEqual(list('base'), [all[0]]);
    assert.equal(all[0], 'iphone-17e-light-default');
    assert.match(read('scripts/e2e/boot-simulator.sh'), /E2E_DEVICE:-iPhone 17e/);
    assert.match(read('package.json'), /--baselines \.maestro\/baselines\/iphone-17e-light-default /);
  });

  it('e2e:accept kopiuje każdy wariant do .maestro/baselines/<wariant>/ z opisem symulatora', () => {
    const art = mkdtempSync(join(tmpdir(), 'e2e-art-'));
    const root = mkdtempSync(join(tmpdir(), 'e2e-repo-'));
    spawnSync('mkdir', ['-p', join(root, 'scripts/e2e'), join(art, 'screenshots/iphone-17e-dark-ax5'), join(art, 'screenshots/obcy'), join(art, 'devices')]);
    for (const f of ['accept-baselines.sh', 'run-matrix.sh']) writeFileSync(join(root, 'scripts/e2e', f), read(`scripts/e2e/${f}`));
    writeFileSync(join(art, 'screenshots/iphone-17e-dark-ax5/01-today.png'), 'png');
    writeFileSync(join(art, 'screenshots/obcy/01-today.png'), 'png');
    writeFileSync(join(art, 'devices/iphone-17e-dark-ax5.txt'), 'iPhone 17e (26.5)');
    const r = spawnSync('bash', [join(root, 'scripts/e2e/accept-baselines.sh'), join(art, 'screenshots')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(root, '.maestro/baselines/iphone-17e-dark-ax5/01-today.png'), 'utf8'), 'png');
    assert.equal(readFileSync(join(root, '.maestro/baselines/iphone-17e-dark-ax5/device.txt'), 'utf8'), 'iPhone 17e (26.5)');
    assert.equal(spawnSync('test', ['-e', join(root, '.maestro/baselines/obcy')]).status, 1, 'katalog spoza listy wariantów pominięty');
    const empty = spawnSync('bash', [join(root, 'scripts/e2e/accept-baselines.sh'), mkdtempSync(join(tmpdir(), 'e2e-empty-'))], { encoding: 'utf8' });
    assert.equal(empty.status, 1);
  });

  it('e2e.yml: warianty bazowy przy push/PR i wszystkie nocą; porównanie i audyt oblewają tylko nocą i ręcznie; standardowy runner', () => {
    const { jobs } = workflow('e2e.yml');
    assert.equal(jobs.ios['runs-on'], 'macos-26');
    assert.ok(jobs.ios['timeout-minutes'] <= 150);
    assert.equal(jobs.ios.env.E2E_VARIANTS, "${{ (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && 'all' || 'base' }}");
    assert.equal(jobs.ios.env.E2E_STRICT, "${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}");
    assert.equal(jobs.ios.env.E2E_DEVICE, 'iPhone 17e');
    const run = jobs.ios.steps.map((s) => s.run ?? '').join('\n');
    assert.match(run, /run-matrix\.sh "\$E2E_APP" "\$E2E_OUT" "\$E2E_VARIANTS"/);
    assert.match(run, /compare-screenshots\.mjs --name "\$v" --baselines "\.maestro\/baselines\/\$v"/);
    assert.match(run, /a11y-audit\.sh "\$udid" "\$E2E_OUT\/a11y" "\$\{args\[@\]\}"/);
    assert.ok(!JSON.stringify(jobs.ios).includes('secrets.'));
  });

  it('audyt XCUITest: każdy test kończy się performAccessibilityAudit na nazwanym ekranie; ekrany z danych demo', () => {
    const swift = read('e2e/a11y/AccessibilityAuditTests.swift');
    const tests = [...swift.matchAll(/func (test\w+)\(\) throws \{([\s\S]*?)\n  \}/g)];
    assert.ok(tests.length >= 12, `testów: ${tests.length}`);
    for (const [, name, body] of tests) assert.match(body, /try audit\("screen-[\w-]+"\)/, name);
    assert.match(swift, /try app\.performAccessibilityAudit\(\)/);
    assert.match(swift, /XCUIApplication\(bundleIdentifier: "io\.github\.lkarwowski494\.organizer"\)/);
    const appJson = JSON.parse(read('app.json'));
    assert.equal(appJson.expo.ios.bundleIdentifier, 'io.github.lkarwowski494.organizer');
    // Identyfikatory danych demo z src/app/e2e.ts (E2E_IDS: dom 21, zakupy 22, Rodzina 10, basen 30).
    for (const id of ['000000000021', '000000000022', '000000000010', '000000000030']) assert.ok(swift.includes(`0199a000-0000-7000-8000-${id}`));
    const audit = read('scripts/e2e/a11y-audit.sh');
    assert.match(audit, /grep -v -E '\^\[\[:space:\]\]\*export '/);
  });
});

describe('próg pokrycia funkcji Edge (M-51)', async () => {
  const { BRANCH_MIN, parseLcov, problems } = await import('../../scripts/deno-coverage-check.mjs');
  const rec = (file, lf, lh, fnf, fnh, brf, brh) => `SF:${file}\nLF:${lf}\nLH:${lh}\nFNF:${fnf}\nFNH:${fnh}\nBRF:${brf}\nBRH:${brh}\nend_of_record\n`;

  it('linie i funkcje 100%, gałęzie od progu; testy i pliki spoza funkcji pomijane; pusty raport to błąd', () => {
    const lcov = [
      rec('/r/supabase/functions/a/handler.ts', 10, 10, 2, 2, 100, BRANCH_MIN),
      rec('/r/supabase/functions/b/handler.ts', 10, 9, 2, 1, 100, BRANCH_MIN - 1),
      rec('/r/supabase/functions/a/handler_test.ts', 10, 0, 1, 0, 0, 0),
      rec('/r/inne.ts', 1, 0, 0, 0, 0, 0),
      rec('/r/supabase/functions/c/pusty.ts', 0, 0, 0, 0, 0, 0),
    ].join('');
    assert.equal(parseLcov(lcov).length, 5);
    assert.deepEqual(problems(parseLcov(lcov)), [
      'supabase/functions/b/handler.ts: linie 90.0% (< 100%)',
      'supabase/functions/b/handler.ts: funkcje 50.0% (< 100%)',
      `supabase/functions/b/handler.ts: gałęzie ${(BRANCH_MIN - 1).toFixed(1)}% (< ${BRANCH_MIN}%)`,
    ]);
    assert.deepEqual(problems([]), ['brak plików supabase/functions w raporcie']);
  });

  it('package.json: check:functions liczy pokrycie i sprawdza próg', () => {
    const { scripts } = JSON.parse(read('package.json'));
    assert.match(scripts['check:functions'], /deno test --no-prompt --clean --coverage=coverage\/deno supabase\/functions && deno coverage coverage\/deno --lcov --output=coverage\/deno\.lcov && node scripts\/deno-coverage-check\.mjs coverage\/deno\.lcov/);
  });
});
