#!/usr/bin/env node
// Audyt zależności (docs/testing.md): kończy się błędem, gdy pojawi się NOWE zgłoszenie high/critical
// spoza listy znanych w scripts/audit-baseline.json. Znane zgłoszenia siedzą głęboko w narzędziach
// Expo / React Native / Jest i znikną przy aktualizacji SDK. `--update` zapisuje bieżący stan jako bazę.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BASELINE = new URL('./audit-baseline.json', import.meta.url);
let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  raw = e.stdout; // npm audit zwraca kod ≠ 0, gdy są jakiekolwiek zgłoszenia
}
const report = JSON.parse(raw);
const advisories = new Set();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'object' && ['high', 'critical'].includes(via.severity)) advisories.add(via.url);
  }
}
const current = [...advisories].sort();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), advisories: current }, null, 2) + '\n');
  console.log(`Zapisano bazę: ${current.length} zgłoszeń high/critical.`);
  process.exit(0);
}
const known = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).advisories);
const fresh = current.filter((a) => !known.has(a));
const gone = [...known].filter((a) => !advisories.has(a));
console.log(`high/critical: ${current.length} (znane: ${current.length - fresh.length}, nowe: ${fresh.length}, ustąpiły: ${gone.length})`);
if (gone.length) console.log('Ustąpiły (można odświeżyć bazę: node scripts/audit-check.mjs --update):\n' + gone.join('\n'));
if (fresh.length) {
  console.error('NOWE zgłoszenia high/critical:\n' + fresh.join('\n'));
  process.exit(1);
}
