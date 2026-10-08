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
    const firstCli = deploy.findIndex((s) => /\$CLI/.test(s.run ?? ''));
    assert.ok(!usesSecrets(deploy[firstCli]), 'pierwsze uruchomienie CLI (pobranie paczki) bez sekretów');
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

});
