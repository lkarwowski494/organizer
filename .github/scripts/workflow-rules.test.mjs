/**
 * Zasady bezpieczeństwa workflow z CLAUDE.md („Bezpieczeństwo”) sprawdzane na każdym pliku .github/workflows/*.yml
 * (audyt 3, N-258; wcześniej pilnowane tylko przeglądem): wyzwalacze bez pull_request_target i workflow_run, akcje
 * przypięte do pełnego SHA, token domyślnie tylko do odczytu, checkout bez zapisanych poświadczeń, bez danych
 * z zewnątrz wklejanych w skrypt, artefakty tylko tam, gdzie są dozwolone, sekrety tylko w zadaniach ze środowiskiem,
 * narzędzia pobierane z sumą SHA-256. Uruchamia je ci.yml: `node --test ".github/scripts/*.test.mjs"`.
 * Źródło zasad o wyzwalaczach i wstrzyknięciach: GitHub, „Security hardening for GitHub Actions”
 * (https://docs.github.com/en/actions/reference/security/secure-use): „Pinning an action to a full-length commit SHA is
 * currently the only way to use an action as an immutable release”; „For inline scripts, the preferred approach to handling
 * untrusted input is to set the value of the expression to an intermediate environment variable”.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { ROOT } from './mutation-shards.mjs';

const DIR = join(ROOT, '.github/workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const raw = (f) => readFileSync(join(DIR, f), 'utf8');
const wf = (f) => parse(raw(f));
const jobsOf = (f) => Object.entries(wf(f).jobs ?? {});
const stepsOf = (job) => job.steps ?? [];

/** Wyzwalacze dozwolone: forki dostają przy pull_request token tylko do odczytu i żadnych sekretów. */
const TRIGGERS = new Set(['push', 'pull_request', 'schedule', 'workflow_dispatch']);
/** Gdzie wolno publikować artefakty (CLAUDE.md: brak artefaktów z buildów wydania iOS; D170: E2E tylko zrzuty i log). */
const ARTIFACTS = { 'e2e.yml': ['ios'], 'nightly.yml': ['mutation'] };
/** Środowiska z regułą gałęzi (ustawienia GitHub): zadanie → środowisko. Sekrety tylko w tych zadaniach. */
const ENVIRONMENTS = {
  'ios-release.yml': { testflight: 'ios-release' },
  'match-bootstrap.yml': { signing: 'ios-release' },
  'nightly.yml': { 'free-limits': 'monitor' },
  'pages.yml': { deploy: 'github-pages' },
  'supabase-deploy.yml': { deploy: 'supabase-prod' },
};
/**
 * Wyjątki od „w zadaniach wyłącznie read albo none”: zadanie → zakresy z zapisem. Wdrożenie GitHub Pages
 * (decyzja właściciela 9.10.2026, polityka prywatności): „The job that executes the deployment must at minimum have the
 * following permissions: pages: write, id-token: write” (https://github.com/actions/deploy-pages). Tylko zadanie deploy,
 * bez checkoutu i bez sekretów, w środowisku github-pages.
 */
const WRITE_SCOPES = { 'pages.yml': { deploy: { pages: 'write', 'id-token': 'write' } } };
/** Wyrażenia z danymi spoza repozytorium, których nie wolno wklejać w `run:` (tylko przez env). */
const UNTRUSTED = /\$\{\{[^}]*\b(inputs\.|github\.event\.|github\.head_ref)/;

describe('zasady bezpieczeństwa workflow (CLAUDE.md, audyt 3 N-258)', () => {
  it('są pliki workflow do sprawdzenia', () => {
    assert.ok(files.length >= 7, files.join(', '));
  });

  for (const f of files) {
    describe(f, () => {
      it('wyzwalacze: tylko push, pull_request, schedule, workflow_dispatch (nigdy pull_request_target ani workflow_run)', () => {
        const on = wf(f).on;
        const names = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
        for (const n of names) assert.ok(TRIGGERS.has(n), `${f}: wyzwalacz ${n}`);
        assert.doesNotMatch(raw(f), /^\s*(pull_request_target|workflow_run)\s*:/m);
      });

      it('uprawnienia tokenu: domyślnie tylko contents: read, w zadaniach wyłącznie read albo none', () => {
        assert.deepEqual(wf(f).permissions, { contents: 'read' });
        for (const [name, job] of jobsOf(f)) {
          if (job.permissions === undefined) continue;
          assert.equal(typeof job.permissions, 'object', `${f}/${name}: permissions jako napis (read-all/write-all)`);
          for (const [scope, level] of Object.entries(job.permissions)) {
            const allowed = ['read', 'none', ...(WRITE_SCOPES[f]?.[name]?.[scope] ? [WRITE_SCOPES[f][name][scope]] : [])];
            assert.ok(allowed.includes(level), `${f}/${name}: ${scope}: ${level}`);
          }
        }
      });

      it('akcje: lokalne albo przypięte do pełnego SHA z komentarzem wersji', () => {
        for (const [name, job] of jobsOf(f)) {
          const uses = [job.uses, ...stepsOf(job).map((s) => s.uses)].filter(Boolean);
          for (const u of uses) {
            if (u.startsWith('./')) continue;
            assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}/${name}: ${u}`);
          }
        }
        for (const line of raw(f).split('\n').filter((l) => /^\s*(-\s+)?uses:\s/.test(l) && !/uses:\s+\.\//.test(l))) {
          assert.match(line, /@[0-9a-f]{40} # v\d+(\.\d+)*$/, `${f}: brak komentarza wersji: ${line.trim()}`);
        }
      });

      it('checkout bez zapisanego tokenu (persist-credentials: false)', () => {
        for (const [name, job] of jobsOf(f)) {
          for (const s of stepsOf(job).filter((x) => x.uses?.startsWith('actions/checkout@'))) {
            assert.equal(s.with?.['persist-credentials'], false, `${f}/${name}`);
          }
        }
      });

      it('skrypty run: bez danych z zewnątrz w ${{ }} (inputs, github.event, head_ref — tylko przez env)', () => {
        for (const [name, job] of jobsOf(f)) {
          for (const s of stepsOf(job)) if (s.run) assert.doesNotMatch(s.run, UNTRUSTED, `${f}/${name}: ${s.name ?? s.run.split('\n')[0]}`);
        }
      });

      it('artefakty tylko w dozwolonych zadaniach', () => {
        for (const [name, job] of jobsOf(f)) {
          const uploads = stepsOf(job).filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
          if (uploads.length) assert.ok(ARTIFACTS[f]?.includes(name), `${f}/${name}: upload-artifact`);
        }
      });

      it('środowiska i sekrety: sekret tylko w zadaniu ze środowiskiem (reguła gałęzi), środowiska tylko te z listy', () => {
        for (const [name, job] of jobsOf(f)) {
          assert.equal(job.environment, ENVIRONMENTS[f]?.[name], `${f}/${name}: środowisko`);
          const secrets = [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).filter((s) => s !== 'GITHUB_TOKEN');
          if (secrets.length) assert.ok(job.environment, `${f}/${name}: sekrety ${secrets.join(', ')} bez środowiska`);
        }
      });

      it('narzędzia: bez `curl … | sh` i bez gitleaks-action (pobierał gitleaks bez sumy SHA-256)', () => {
        assert.doesNotMatch(raw(f), /curl[^\n|]*\|\s*(ba|z)?sh\b/);
        assert.doesNotMatch(raw(f), /gitleaks\/gitleaks-action/);
        const runs = jobsOf(f).flatMap(([, job]) => stepsOf(job).map((s) => s.run ?? '')).join('\n');
        assert.doesNotMatch(runs, /\bnpx\b[^\n]*\bsupabase\b/, 'Supabase CLI z instalatora z sumą, nie z npx');
      });
    });
  }
});

describe('wdrożenie GitHub Pages (pages.yml)', () => {
  it('zadanie z zapisem: tylko akcja deploy-pages, bez checkoutu, skryptów i sekretów', () => {
    const deploy = wf('pages.yml').jobs.deploy;
    assert.deepEqual(stepsOf(deploy).map((s) => s.uses?.split('@')[0]), ['actions/deploy-pages']);
    assert.doesNotMatch(JSON.stringify(deploy), /secrets\./);
  });
  it('publikuje katalog site/ po sprawdzeniu, że strona polityki jest aktualna', () => {
    const steps = stepsOf(wf('pages.yml').jobs.build);
    const check = steps.findIndex((s) => /privacy-html\.cjs --write\ngit diff --exit-code site\/privacy\/index\.html/.test(s.run ?? ''));
    const upload = steps.findIndex((s) => s.uses?.startsWith('actions/upload-pages-artifact@'));
    assert.ok(check >= 0 && upload > check);
    assert.equal(steps[upload].with.path, 'site');
  });
});

describe('instalatory narzędzi z sumą SHA-256 (N-255, N-258)', () => {
  for (const [script, version] of [
    ['install-gitleaks.sh', /GITLEAKS_VERSION="\d+\.\d+\.\d+"/],
    ['install-supabase-cli.sh', /SUPABASE_CLI_VERSION="\d+\.\d+\.\d+"/],
    ['install-actionlint.sh', /ACTIONLINT_VERSION="\d+\.\d+\.\d+"/],
  ]) {
    it(`${script}: przypięta wersja, suma 64 znaki hex, sprawdzenie przed rozpakowaniem`, () => {
      const s = readFileSync(join(ROOT, '.github/scripts', script), 'utf8');
      assert.match(s, version);
      assert.match(s, /_SHA256="[0-9a-f]{64}"/);
      const check = s.indexOf('sha256sum -c -');
      assert.ok(check > 0 && check < s.indexOf('tar -xzf'), 'suma sprawdzana przed rozpakowaniem');
      assert.match(s, /^set -euo pipefail$/m);
    });
  }

  it('workflows-lint w ci.yml: actionlint z instalatora, bez `go install` (toolchain Go z sieci bez naszej sumy)', () => {
    const steps = stepsOf(wf('ci.yml').jobs['workflows-lint']);
    const install = steps.findIndex((s) => s.run === '.github/scripts/install-actionlint.sh');
    const lint = steps.findIndex((s) => s.run === 'actionlint');
    assert.ok(install >= 0 && lint > install);
    for (const f of readdirSync(join(ROOT, '.github/workflows'))) assert.doesNotMatch(readFileSync(join(ROOT, '.github/workflows', f), 'utf8'), /\bgo install\b/, f);
  });

  it('skan sekretów w ci.yml i nightly.yml: gitleaks z instalatora, potem skrypt zakresu ze scaleniami', () => {
    for (const [f, job, call] of [
      ['ci.yml', 'secrets-scan', /^\.github\/scripts\/gitleaks-range\.sh "\$BEFORE" "\$AFTER"$/],
      ['nightly.yml', 'secrets-full-history', /^\.github\/scripts\/gitleaks-range\.sh --all$/],
    ]) {
      const steps = stepsOf(wf(f).jobs[job]);
      const install = steps.findIndex((s) => s.run === '.github/scripts/install-gitleaks.sh');
      const scan = steps.findIndex((s) => call.test(s.run ?? ''));
      assert.ok(install >= 0 && scan > install, `${f}/${job}`);
      assert.equal(steps.find((s) => s.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0, `${f}: pełna historia`);
    }
    assert.match(readFileSync(join(ROOT, '.github/scripts/gitleaks-range.sh'), 'utf8'), /--log-opts="-m \$range"/);
  });

  it('Supabase CLI w db.yml i supabase-deploy.yml z instalatora, przed każdym krokiem z sekretem', () => {
    for (const [f, job] of [['db.yml', 'supabase'], ['supabase-deploy.yml', 'deploy']]) {
      const steps = stepsOf(wf(f).jobs[job]);
      const install = steps.findIndex((s) => s.run === '.github/scripts/install-supabase-cli.sh');
      assert.ok(install >= 0, `${f}/${job}`);
      const firstSecret = steps.findIndex((s) => JSON.stringify(s).includes('secrets.'));
      assert.ok(firstSecret === -1 || install < firstSecret, `${f}/${job}: instalacja po kroku z sekretem`);
      assert.ok(!steps.some((s) => s.uses?.startsWith('actions/setup-node@')) || f === 'db.yml', `${f}/${job}: bez npm w zadaniu z sekretami`);
    }
  });
});
