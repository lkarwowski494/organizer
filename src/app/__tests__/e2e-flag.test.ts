/**
 * Kontrakt bezpieczeństwa trybu E2E (D143): flagę EXPO_PUBLIC_E2E=1 (atrapy zamiast Supabase, src/app/e2e.ts) ustawia
 * wyłącznie e2e.yml dla buildu symulatora. Build do TestFlight (ios-release.yml + fastlane) ani żadna konfiguracja,
 * którą Expo czyta przy budowaniu (app.json, eas.json, pliki .env*), nie może jej włączyć. Przy okazji pilnuje zasad
 * workflow z CLAUDE.md: bez pull_request_target, akcje przypięte do pełnego SHA, domyślnie `contents: read`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Treść bez komentarzy YAML/Ruby/shell (`#` na początku albo po spacji) — komentarze mogą wymieniać zakazane słowa. */
const code = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
const workflows = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
const FLAG = 'EXPO_PUBLIC_E2E';

describe('flaga EXPO_PUBLIC_E2E (D143)', () => {
  it('ustawia ją tylko e2e.yml — jeden raz, w kroku buildu symulatora', () => {
    expect(workflows).toContain('e2e.yml');
    const mentions = workflows.filter((f) => code(readFileSync(join(WORKFLOWS, f), 'utf8')).includes(FLAG));
    expect(mentions).toEqual(['e2e.yml']);
    const e2e = code(read('.github/workflows/e2e.yml'));
    expect(e2e.match(new RegExp(`${FLAG}:\\s*'1'`, 'g'))).toHaveLength(1);
    expect(e2e).toMatch(new RegExp(`- name: build symulatora[^\\n]*\\n\\s+env:\\n\\s+${FLAG}: '1'\\n\\s+run: scripts/e2e/build-ios\\.sh`));
  });

  it('build wydania (ios-release.yml, fastlane) nie ustawia flagi i nie korzysta ze skryptów E2E', () => {
    const release = read('.github/workflows/ios-release.yml');
    const fastfile = read('fastlane/Fastfile');
    for (const s of [release, fastfile]) {
      expect(s).not.toContain(FLAG);
      expect(s).not.toMatch(/scripts\/e2e|\.maestro|e2e:/);
    }
    // Wydanie buduje się w konfiguracji Release przez fastlane (podpis App Store), nie skryptem symulatora.
    expect(fastfile).toMatch(/configuration: "Release", export_method: "app-store"/);
  });

  it('konfiguracja czytana przez Expo przy budowaniu nie włącza flagi (app.json, eas.json, package.json, .env*)', () => {
    const files = ['app.json', 'eas.json', 'package.json', 'babel.config.js', ...readdirSync(ROOT).filter((f) => f.startsWith('.env'))];
    for (const f of files.filter((x) => existsSync(join(ROOT, x)))) expect([f, read(f).includes(FLAG)]).toEqual([f, false]);
  });

  it('kod aplikacji czyta flagę tylko w src/app/wiring.ts, porównaniem wprost (podmienianym przez Expo na stałą)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx|js)$/.test(e.name) && read(p).includes(`process.env.${FLAG}`)) hits.push(p);
      }
    };
    walk('src');
    if (read('App.tsx').includes(`process.env.${FLAG}`)) hits.push('App.tsx');
    expect(hits).toEqual(['src/app/wiring.ts']);
    expect(read('src/app/wiring.ts')).toContain(`process.env.${FLAG} === '1'`);
  });
});

describe('zasady workflow (CLAUDE.md, Bezpieczeństwo)', () => {
  it.each(workflows)('%s: bez pull_request_target, akcje przypięte do SHA, domyślnie contents: read', (f) => {
    const s = code(readFileSync(join(WORKFLOWS, f), 'utf8'));
    expect(s).not.toContain('pull_request_target');
    const uses = [...s.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    expect(s).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('e2e.yml: bez sekretów i środowisk; artefakty bez aplikacji, 7 dni', () => {
    const s = code(read('.github/workflows/e2e.yml'));
    expect(s).not.toMatch(/secrets\.|environment:/);
    expect(s).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {2}schedule:\n.*\n {2}workflow_dispatch:\n/m);
    expect(s).toMatch(/retention-days: 7/);
    expect(s).toMatch(/path: e2e-artifacts\/\n/);
    // Do katalogu artefaktów trafiają zrzuty, raport, logi — nigdy .app (run-flows.sh instaluje ją wprost z ios/build).
    expect(read('scripts/e2e/run-flows.sh')).not.toMatch(/cp[^\n]*\.app/);
  });
});
