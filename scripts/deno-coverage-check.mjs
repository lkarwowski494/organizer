#!/usr/bin/env node
/**
 * Próg pokrycia funkcji Edge (audyt 2, M-51): plik LCOV z `deno coverage --lcov` (wynik `deno test --coverage`),
 * dla każdego pliku z kodem funkcji (supabase/functions, bez testów) linie i funkcje 100%, gałęzie co najmniej
 * BRANCH_MIN (próg zapadkowy z 9.10.2026 — podnosić, nie obniżać). Format LCOV: LF/LH (linie), FNF/FNH (funkcje),
 * BRF/BRH (gałęzie), rekord kończy end_of_record (https://github.com/linux-test-project/lcov, geninfo(1)).
 * Użycie: node scripts/deno-coverage-check.mjs <plik.lcov>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRANCH_MIN = 98;

export function parseLcov(text) {
  const files = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const [k, v] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)];
    if (k === 'SF') cur = { file: v, LF: 0, LH: 0, FNF: 0, FNH: 0, BRF: 0, BRH: 0 };
    else if (cur && k in cur && k !== 'file') cur[k] = Number(v);
    else if (line === 'end_of_record' && cur) {
      files.push(cur);
      cur = null;
    }
  }
  return files;
}

const pct = (hit, all) => (all === 0 ? 100 : (100 * hit) / all);

export function problems(files) {
  const out = [];
  const own = files.filter((f) => f.file.includes('supabase/functions/') && !/_test\.ts$/.test(f.file));
  if (own.length === 0) out.push('brak plików supabase/functions w raporcie');
  for (const f of own) {
    const name = f.file.slice(f.file.indexOf('supabase/functions/'));
    if (pct(f.LH, f.LF) < 100) out.push(`${name}: linie ${pct(f.LH, f.LF).toFixed(1)}% (< 100%)`);
    if (pct(f.FNH, f.FNF) < 100) out.push(`${name}: funkcje ${pct(f.FNH, f.FNF).toFixed(1)}% (< 100%)`);
    if (pct(f.BRH, f.BRF) < BRANCH_MIN) out.push(`${name}: gałęzie ${pct(f.BRH, f.BRF).toFixed(1)}% (< ${BRANCH_MIN}%)`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const found = problems(parseLcov(readFileSync(process.argv[2], 'utf8')));
  for (const p of found) console.error(p);
  process.exitCode = found.length ? 1 : 0;
}
