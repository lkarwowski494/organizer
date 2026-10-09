/**
 * Testy bramek wdrożenia i wydania (audyt 2: M-155, M-193; decyzja właściciela 8.10.2026, PWD-40 A): skrypt
 * require-green-runs.sh na atrapie `gh` oraz kontrakty supabase-deploy.yml i ios-release.yml. Uruchamia je ci.yml
 * (zadanie check): `node --test ".github/scripts/*.test.mjs"` (po `npm ci`: yaml; do bramki także bash i jq).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = (name) => parse(readFileSync(join(ROOT, '.github/workflows', name), 'utf8'));
const steps = (job) => job.steps ?? [];
const usesSecrets = (value) => JSON.stringify(value ?? {}).includes('secrets.');

describe('bramka wdrożenia i wydania: zielony przebieg dla commitu (M-155, PWD-40)', () => {
  const SHA = 'a'.repeat(40);
  const ghStub = () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh-stub-'));
    // Atrapa `gh api … --jq <filtr>`: n-te wywołanie dla workflow zwraca <wf>.<n>.json (gdy go nie ma — ostatni
    // wcześniejszy, a bez żadnego pustą listę przebiegów); filtr stosuje prawdziwy jq.
    writeFileSync(
      join(dir, 'gh'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'filter=.; ep=""',
        'while [ $# -gt 0 ]; do case "$1" in --jq) filter="$2"; shift 2;; -X|-f) shift 2;; api) shift;; *) ep="$1"; shift;; esac; done',
        'wf="${ep#*/workflows/}"; wf="${wf%%/*}"',
        'n=$(( $(cat "$STUB/$wf.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB/$wf.count"',
        'while [ ! -f "$STUB/$wf.$n.json" ] && [ "$n" -gt 1 ]; do n=$((n - 1)); done',
        'if [ -f "$STUB/$wf.$n.json" ]; then jq "$filter" "$STUB/$wf.$n.json"; else jq -n "{workflow_runs: []} | $filter"; fi',
      ].join('\n'),
    );
    chmodSync(join(dir, 'gh'), 0o755);
    return dir;
  };
  const runOf = (over) => ({ head_sha: SHA, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', html_url: 'https://example.invalid/run', ...over });
  const gate = (responses, workflows, env = {}) => {
    const dir = ghStub();
    for (const [wf, list] of Object.entries(responses)) list.forEach((runs, i) => writeFileSync(join(dir, `${wf}.${i + 1}.json`), JSON.stringify({ workflow_runs: runs })));
    return spawnSync('bash', [join(ROOT, '.github/scripts/require-green-runs.sh'), SHA, ...workflows], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB: dir, GITHUB_REPOSITORY: 'owner/repo', WAIT_MINUTES: '0', POLL_SECONDS: '0', ...env },
    });
  };

  it('zielony przebieg na main (push, ręczny, harmonogram) przepuszcza', () => {
    for (const event of ['push', 'workflow_dispatch', 'schedule']) {
      const r = gate({ 'db.yml': [[runOf({ conclusion: 'failure' }), runOf({ event })]] }, ['db.yml']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /OK {3}db\.yml/);
    }
  });

  it('bez zielonego przebiegu na main zatrzymuje: tylko porażka, tylko PR, inna gałąź, brak przebiegu', () => {
    for (const runs of [[runOf({ conclusion: 'failure' })], [runOf({ event: 'pull_request', head_branch: 'fix' })], [runOf({ head_branch: 'fix' })], []]) {
      const r = gate({ 'db.yml': [runs] }, ['db.yml']);
      assert.equal(r.status, 1, JSON.stringify(runs));
      assert.match(r.stdout, /::error::db\.yml: brak zielonego przebiegu/);
    }
  });

  it('czeka na trwający przebieg, a po terminie zatrzymuje', () => {
    const later = gate({ 'db.yml': [[runOf({ status: 'in_progress', conclusion: null })], [runOf({})]] }, ['db.yml'], { WAIT_MINUTES: '5' });
    assert.equal(later.status, 0, later.stdout + later.stderr);
    assert.match(later.stdout, /jeszcze trwa/);
    const never = gate({ 'db.yml': [[runOf({ status: 'in_progress', conclusion: null })]] }, ['db.yml']);
    assert.equal(never.status, 1);
  });

  it('każdy z podanych workflow musi być zielony; bez listy workflow — błąd użycia', () => {
    const r = gate({ 'ci.yml': [[runOf({})]], 'db.yml': [[]] }, ['ci.yml', 'db.yml']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /OK {3}ci\.yml/);
    assert.match(r.stdout, /::error::db\.yml/);
    assert.equal(gate({}, []).status, 2);
  });
});

describe('kontrakty bramek wdrożenia i wydania', () => {
  it('supabase-deploy.yml: bramka bez sekretów, sekrety tylko w krokach, hasło nie w wierszu poleceń (M-155)', () => {
    const { jobs } = workflow('supabase-deploy.yml');
    assert.equal(jobs.gate.environment, undefined);
    assert.ok(!usesSecrets(jobs.gate));
    assert.match(steps(jobs.gate).map((s) => s.run ?? '').join('\n'), /require-green-runs\.sh "\$GITHUB_SHA" ci\.yml db\.yml/);
    assert.equal(jobs.deploy.needs, 'gate');
    assert.equal(jobs.deploy.environment, 'supabase-prod');
    assert.ok(!usesSecrets(jobs.deploy.env), 'sekrety w env zadania deploy');
    const deploy = steps(jobs.deploy);
    const install = deploy.findIndex((s) => s.run === '.github/scripts/install-supabase-cli.sh');
    assert.ok(install >= 0 && !usesSecrets(deploy[install]), 'instalacja CLI bez sekretów');
    assert.ok(deploy.slice(0, install).every((s) => !usesSecrets(s)), 'instalacja CLI przed krokami z sekretami');
    assert.equal(jobs.deploy.env.CLI, 'supabase', 'CLI z instalatora (suma SHA-256), nie z npx (N-255)');
    for (const s of deploy) {
      assert.doesNotMatch(s.run ?? '', /--password|\s-p\s/);
      if (usesSecrets(s.env)) assert.match(s.run, /\$CLI (link|db push|functions deploy)|test -n/, s.name);
    }
  });

  it('ios-release.yml: bramka na Linuksie bez sekretów: commit z main i zielony db.yml; sekrety tylko w fastlane (M-155, M-193)', () => {
    const { jobs } = workflow('ios-release.yml');
    assert.equal(jobs.gate.environment, undefined);
    assert.ok(!usesSecrets(jobs.gate));
    assert.match(jobs.gate['runs-on'], /^ubuntu-/);
    const gateRun = steps(jobs.gate).map((s) => s.run ?? '').join('\n');
    assert.match(gateRun, /commit="\$\(git rev-parse "\$GITHUB_SHA\^\{commit\}"\)"/);
    assert.match(gateRun, /git merge-base --is-ancestor "\$commit" origin\/main/);
    assert.match(gateRun, /echo "RELEASE_COMMIT=\$commit" >> "\$GITHUB_ENV"/);
    assert.match(gateRun, /require-green-runs\.sh "\$RELEASE_COMMIT" db\.yml/);
    assert.equal(steps(jobs.gate).find((s) => s.uses?.startsWith('actions/checkout@'))?.with?.['fetch-depth'], 0);
    assert.equal(jobs.testflight.needs, 'gate');
    assert.ok(!usesSecrets(jobs.testflight.env));
    assert.deepEqual(steps(jobs.testflight).filter((s) => usesSecrets(s.env)).map((s) => s.name), ['fastlane release']);
  });

  it('Fastfile: sekrety wydania usunięte z ENV po match, przed build_app (xcodebuild ich nie dostaje); klucz ASC do wysyłki zostaje (N-254)', () => {
    const step = steps(workflow('ios-release.yml').jobs.testflight).find((s) => s.name === 'fastlane release');
    const secretNames = Object.keys(step.env).filter((k) => usesSecrets(step.env[k]));
    assert.ok(secretNames.length >= 6, secretNames.join());
    // Fastfile na atrapach akcji fastlane: build_app zapisuje widziane ENV, upload_to_testflight — otrzymany klucz.
    const harness = [
      'require "json"',
      'LANES = {}',
      'CALLS = []',
      'def default_platform(*); end',
      'def platform(_); yield; end',
      'def lane(name, &b); LANES[name] = b; end',
      'def private_lane(name, &b); LANES[name] = b; end',
      'def method_missing(name, *args, **opts)',
      '  return LANES[name].call if LANES.key?(name)',
      '  CALLS << [name.to_s, name == :build_app ? ENV.to_h : opts]',
      '  name == :app_store_connect_api_key ? { key_content: opts[:key_content] } : nil',
      'end',
      'eval(File.read(ARGV[0]), binding, ARGV[0])',
      'LANES[:release].call',
      'puts JSON.generate(CALLS)',
    ].join('\n');
    const env = { PATH: process.env.PATH, BUILD_NUMBER: '7', MATCH_GIT_BASIC_AUTHORIZATION: 'naglowek-testowy' };
    for (const k of secretNames) env[k] = `wartosc-testowa-${k}`;
    const r = spawnSync('ruby', ['-e', harness, join(ROOT, 'fastlane/Fastfile')], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const calls = JSON.parse(r.stdout);
    const names = calls.map(([n]) => n);
    assert.ok(names.indexOf('match') < names.indexOf('build_app'));
    const buildEnv = calls.find(([n]) => n === 'build_app')[1];
    for (const k of [...secretNames, 'MATCH_GIT_BASIC_AUTHORIZATION']) assert.equal(buildEnv[k], undefined, `${k} w ENV build_app`);
    assert.equal(buildEnv.BUILD_NUMBER, '7');
    assert.ok(!JSON.stringify(buildEnv).includes('wartosc-testowa'));
    const upload = calls.find(([n]) => n === 'upload_to_testflight')[1];
    assert.equal(upload.api_key.key_content, env.ASC_KEY_P8, 'klucz ASC dotarł do upload_to_testflight');
  });

});
