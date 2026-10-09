#!/usr/bin/env node
// Licencje bibliotek i krojów w aplikacji (audyt 3, N-78; decyzja Q22 A): lista na ekranie Ustawienia → Licencje
// powstaje z tego, co naprawdę trafia do telefonu — z mapy źródeł paczki JS (`expo export --platform ios
// --source-maps`) i z listy bibliotek natywnych (scripts/licenses/native.json). Teksty licencji z plików w paczkach npm.
// Warunki licencji: MIT „The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.” (react-native, https://github.com/facebook/react-native/blob/main/LICENSE);
// SIL OFL 1.1 pkt 2: „…provided that each copy contains the above copyright notice and this license.” (LICENSE_FONT
// w @expo-google-fonts/*, https://openfontlicense.org).
//
//   node scripts/licenses/gen-licenses.mjs --write   # buduje paczkę i zapisuje src/licenses/third-party.json
//   node scripts/licenses/gen-licenses.mjs --check   # to samo, ale tylko porównuje (CI: npm run check:licenses)
//   --map <plik .map>                               # zamiast budowania: gotowa mapa źródeł
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'src/licenses/third-party.json');
const NM = join(root, 'node_modules');

/** Licencje dozwolone w paczce aplikacji (CLAUDE.md: bez GPL/AGPL/LGPL i bez nieznanej). */
export const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BSL-1.0', 'OFL-1.1', 'MIT AND OFL-1.1', 'blessing']);

/**
 * Pakiety bez własnego pliku licencji: @react-native/* pochodzą z repozytorium react-native i mają w package.json
 * „MIT” — ta sama licencja i ten sam właściciel praw co plik LICENSE paczki react-native (to samo repozytorium,
 * katalog packages/: https://github.com/facebook/react-native/tree/main/packages).
 */
const FALLBACK = [[/^@react-native\//, 'react-native']];

const LICENSE_FILE = /^(licen[cs]e|copying)([-_.](md|txt|mit|font))?$/i;

function packageDir(source) {
  const i = source.lastIndexOf('node_modules/');
  if (i < 0) return null;
  const rest = source.slice(i + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: source.slice(0, i) + 'node_modules/' + name };
}

function licenseText(dir) {
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  return files.map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n');
}

function spdx(pkg) {
  const l = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((x) => x.type).join(' OR ') : undefined);
  return typeof l === 'string' ? l : l?.type;
}

/** Wpisy pakietów JS z listy ścieżek mapy źródeł. */
export function jsEntries(sources) {
  const dirs = new Map();
  for (const s of sources) {
    const p = packageDir(s);
    if (p) dirs.set(p.dir, p.name);
  }
  const out = new Map();
  for (const [dir, name] of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    let text = licenseText(dir);
    if (!text) {
      const fb = FALLBACK.find(([re]) => re.test(name));
      if (fb) text = licenseText(join(NM, fb[1]));
    }
    const license = spdx(pkg);
    if (!text) throw new Error(`${name}@${pkg.version}: brak pliku licencji`);
    if (!ALLOWED.has(license)) throw new Error(`${name}@${pkg.version}: licencja ${license} spoza dozwolonych`);
    const kind = /LICENSE_FONT/.test(readdirSync(dir).join(' ')) ? 'font' : 'js';
    out.set(`${name}@${pkg.version}`, { name, version: pkg.version, license, kind, text });
  }
  return [...out.values()];
}

/** Wpisy bibliotek natywnych (native.json): wersja z pliku w node_modules, tekst z native/*.txt albo z nagłówka. */
export function nativeEntries() {
  const spec = JSON.parse(readFileSync(join(root, 'scripts/licenses/native.json'), 'utf8'));
  return spec.libraries.map((l) => {
    const m = new RegExp(l.version.regex).exec(readFileSync(join(NM, l.version.file), 'utf8'));
    if (!m) throw new Error(`${l.name}: nie znaleziono wersji w ${l.version.file}`);
    if (!ALLOWED.has(l.license)) throw new Error(`${l.name}: licencja ${l.license} spoza dozwolonych`);
    const text = l.fromHeader
      ? // SQLite: domena publiczna — „błogosławieństwo” z początku nagłówka zamiast licencji (https://www.sqlite.org/copyright.html).
        readFileSync(join(NM, l.fromHeader), 'utf8').split('\n').slice(0, 10).map((x) => x.replace(/^\*\*\s?/, '').replace(/^\/\*$/, '')).join('\n').trim()
      : readFileSync(join(root, 'scripts/licenses/native', l.file), 'utf8').replace(/\r\n/g, '\n').trim();
    return { name: l.name, version: m[1], license: l.license, kind: 'native', text };
  });
}

/** Plik dla aplikacji: teksty bez powtórzeń (klucz = skrót treści), pakiety posortowane po nazwie. */
export function build(sources) {
  const entries = [...jsEntries(sources), ...nativeEntries()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  const texts = {};
  const packages = entries.map(({ text, ...e }) => {
    const key = createHash('sha256').update(text).digest('hex').slice(0, 12);
    texts[key] = text;
    return { ...e, text: key };
  });
  return JSON.stringify({ packages, texts: Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b))) }, null, 1) + '\n';
}

function bundleSources() {
  const out = mkdtempSync(join(tmpdir(), 'organizer-licenses-'));
  try {
    execFileSync('npx', ['expo', 'export', '--platform', 'ios', '--source-maps', '--output-dir', out], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
    const dir = join(out, '_expo/static/js/ios');
    const map = readdirSync(dir).find((f) => f.endsWith('.map'));
    return JSON.parse(readFileSync(join(dir, map), 'utf8')).sources;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--map');
  const sources = i > 0 ? JSON.parse(readFileSync(process.argv[i + 1], 'utf8')).sources : bundleSources();
  const next = build(sources);
  if (process.argv.includes('--write')) {
    writeFileSync(OUT, next);
    console.log(`Zapisano ${OUT}: ${JSON.parse(next).packages.length} pozycji.`);
  } else {
    const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (now !== next) {
      console.error('src/licenses/third-party.json nie zgadza się z paczką aplikacji — uruchom: node scripts/licenses/gen-licenses.mjs --write');
      process.exit(1);
    }
    console.log('Licencje zgodne z paczką aplikacji.');
  }
}
