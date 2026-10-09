/**
 * Licencje w aplikacji (audyt 3, N-78; decyzja Q22 A; CLAUDE.md „Treści cudze i nazwy innych firm”): biblioteki i kroje
 * z paczki są wymienione na ekranie Ustawienia → Licencje z pełnym tekstem licencji. Lista `src/licenses/third-party.json`
 * powstaje skryptem scripts/licenses/gen-licenses.mjs z mapy źródeł prawdziwej paczki iOS; zgodność z paczką sprawdza
 * `npm run check:licenses` (CI). Ten test pilnuje tego, co da się sprawdzić bez budowania: wersje i licencje zgodne
 * z node_modules, każda zależność aplikacji, każdy import z kodu i każdy krój na liście, biblioteki natywne kompletne,
 * bez licencji GPL/AGPL/LGPL i nieznanych.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import licenses from '../../licenses/third-party.json';

const root = join(__dirname, '../../..');
const nm = join(root, 'node_modules');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const pkgJson = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
const native = JSON.parse(read('scripts/licenses/native.json')) as { libraries: { name: string; podspec?: string; license: string; version: { file: string; regex: string } }[] };
const listed = new Map(licenses.packages.map((p) => [p.name, p]));

/** Zależności z package.json, które nie trafiają do aplikacji (narzędzia budowania), z powodem. */
const BUILD_ONLY: Record<string, string> = {
  'babel-preset-expo': 'preset Babel — przekształca kod przy budowaniu',
  'eslint-config-expo': 'reguły ESLint — tylko sprawdzanie kodu',
};
const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BSL-1.0', 'OFL-1.1', 'MIT AND OFL-1.1', 'blessing']);

/** Wszystkie zainstalowane kopie pakietu (także zagnieżdżone, np. expo/node_modules/expo-asset). */
function installed(name: string): { version: string; license?: string }[] {
  const dirs = [join(nm, name), ...readdirSync(nm).flatMap((d) => (d.startsWith('@') ? readdirSync(join(nm, d)).map((s) => join(nm, d, s)) : [join(nm, d)])).map((d) => join(d, 'node_modules', name))];
  return dirs.filter((d) => existsSync(join(d, 'package.json'))).map((d) => JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')));
}

function codeFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(join(root, p)).isDirectory()) return f === '__tests__' ? [] : codeFiles(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}
const bare = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

describe('licencje bibliotek w aplikacji (N-78)', () => {
  it('każdy wpis: tekst licencji, licencja dozwolona (bez GPL/AGPL/LGPL i nieznanych)', () => {
    expect(licenses.packages.length).toBeGreaterThan(50);
    for (const p of licenses.packages) {
      const text = (licenses.texts as Record<string, string>)[p.text];
      expect(text && text.length > 100 ? p.name : `brak tekstu: ${p.name}`).toBe(p.name);
      expect(ALLOWED.has(p.license) ? p.license : `${p.name}: ${p.license}`).toBe(p.license);
    }
  });

  it('pakiety JS: wersja i licencja jak w node_modules (po aktualizacji zależności trzeba wygenerować listę)', () => {
    for (const p of licenses.packages.filter((x) => x.kind !== 'native')) {
      const copies = installed(p.name);
      expect(copies.some((c) => c.version === p.version && c.license === p.license) ? p.name : `${p.name}@${p.version} (${p.license}) ≠ ${copies.map((c) => `${c.version} ${c.license}`).join(', ')}`).toBe(p.name);
    }
  });

  it('każda zależność aplikacji z package.json jest na liście (poza narzędziami budowania)', () => {
    for (const name of Object.keys(BUILD_ONLY)) expect(pkgJson.dependencies[name]).toBeDefined();
    const missing = Object.keys(pkgJson.dependencies).filter((d) => !(d in BUILD_ONLY) && !listed.has(d));
    expect(missing).toEqual([]);
  });

  it('każdy import paczki w kodzie aplikacji jest na liście', () => {
    const files = ['App.tsx', 'index.ts', ...codeFiles('src'), ...codeFiles('modules')];
    const specs = new Set(files.flatMap((f) => [...read(f).matchAll(/^\s*(?:import\s+|(?:import|export)\b[^;'`=]*?\sfrom\s+)'([^'.][^']*)';|\brequire\('([^'.][^']*)'\)/gm)].map((m) => bare((m[1] ?? m[2])!))));
    expect(specs.size).toBeGreaterThan(15);
    const missing = [...specs].filter((s) => !s.startsWith('node:') && !listed.has(s));
    expect(missing).toEqual([]);
  });

  it('kroje z App.tsx: na liście z licencją SIL OFL 1.1', () => {
    const fonts = [...read('App.tsx').matchAll(/from '(@expo-google-fonts\/[^/']+)/g)].map((m) => m[1]!);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) {
      const p = listed.get(f)!;
      expect(p.kind).toBe('font');
      expect((licenses.texts as Record<string, string>)[p.text]).toContain('SIL Open Font License, Version 1.1');
    }
  });

  it('biblioteki natywne: każdy podspek react-native/third-party-podspecs jest w native.json, wersje jak w node_modules', () => {
    const podspecs = readdirSync(join(nm, 'react-native/third-party-podspecs'))
      .filter((f) => f.endsWith('.podspec'))
      .map((f) => f.replace(/\.podspec$/, ''))
      // Zbiorczy prekompilowany pakiet tych samych bibliotek (folly, glog, double-conversion, boost, fmt, fast_float).
      .filter((n) => n !== 'ReactNativeDependencies');
    expect(podspecs.filter((n) => !native.libraries.some((l) => l.podspec === n))).toEqual([]);
    for (const l of native.libraries) {
      const version = new RegExp(l.version.regex).exec(readFileSync(join(nm, l.version.file), 'utf8'))?.[1];
      expect(listed.get(l.name)).toMatchObject({ kind: 'native', version, license: l.license });
    }
  });
});
