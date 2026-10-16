// Sprawdza kompletnosc tlumaczen miedzy strings.pl.ts a strings.en.ts (Zadanie R2, Apps4Brew Studio)
// Uruchom: node scripts/check-i18n.mjs (kod wyjscia 1 = braki)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const plPath = join(root, 'src/i18n/strings.pl.ts');
const enPath = join(root, 'src/i18n/strings.en.ts');

if (!existsSync(enPath)) {
  console.error('BLAD: Brak pliku src/i18n/strings.en.ts!');
  process.exit(1);
}

const extractKeys = (path) => {
  const src = readFileSync(path, 'utf8');
  const keys = new Map();
  // Szuka kluczy w formacie 'klucz.id': ...
  for (const m of src.matchAll(/^\s*'([^']+)'\s*:\s*(\([^)]*\)\s*=>|['"`]|(?:\n\s*['"`]))/gm)) {
    const key = m[1];
    const isFn = m[2].startsWith('(');
    keys.set(key, { isFn });
  }
  return keys;
};

const plKeys = extractKeys(plPath);
const enKeys = extractKeys(enPath);

const missingInEn = [...plKeys.keys()].filter((k) => !enKeys.has(k));
const missingInPl = [...enKeys.keys()].filter((k) => !plKeys.has(k));
const typeMismatch = [...plKeys.keys()].filter((k) => enKeys.has(k) && plKeys.get(k).isFn !== enKeys.get(k).isFn);

// Sprawdzenie pustych ciągów w słowniku EN ('' lub "" lub ``)
const enSrc = readFileSync(enPath, 'utf8');
const emptyStrings = [...enSrc.matchAll(/^\s*'([^']+)'\s*:\s*(?:''|""|``),?$/gm)].map((m) => m[1]);

// Sprawdzenie nieprzetłumaczonych polskich znaków w słowniku EN
const polishChars = [...enSrc.matchAll(/^\s*'([^']+)'\s*:\s*.*[ąćęłńóśźż].*$/gmi)].map((m) => m[1]);

console.log(`i18n: ${plKeys.size} kluczy w słowniku PL, ${enKeys.size} w słowniku EN`);

let hasError = false;

if (missingInEn.length) {
  console.error(`BRAK w słowniku EN (${missingInEn.length}):\n` + missingInEn.map((k) => `  '${k}'`).join('\n'));
  hasError = true;
}

if (missingInPl.length) {
  console.error(`Nadmiarowe w słowniku EN (${missingInPl.length}):\n` + missingInPl.map((k) => `  '${k}'`).join('\n'));
  hasError = true;
}

if (typeMismatch.length) {
  console.error(`Niezgodność typu (funkcja vs string) (${typeMismatch.length}):\n` + typeMismatch.map((k) => `  '${k}'`).join('\n'));
  hasError = true;
}

if (emptyStrings.length) {
  console.error(`Puste ciągi znaków w słowniku EN (${emptyStrings.length}):\n` + emptyStrings.map((k) => `  '${k}'`).join('\n'));
  hasError = true;
}

if (polishChars.length) {
  console.error(`Wykryto polskie znaki w słowniku EN (${polishChars.length}):\n` + polishChars.map((k) => `  '${k}'`).join('\n'));
  hasError = true;
}

if (!hasError) {
  console.log('OK: Slowniki PL i EN sa w 100% symetryczne, bez braków i pustych tekstów.');
  process.exit(0);
} else {
  process.exit(1);
}
