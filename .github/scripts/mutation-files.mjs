#!/usr/bin/env node
/**
 * Pliki do testów mutacyjnych (wzorce `mutate` ze stryker.config.json) — wspólne dla planu nocnych części
 * (mutation-plan.mjs: plan nie może objąć pliku spoza `mutate`) i scalania wyniku (mutation-merge.mjs: raport części
 * nie może zawierać pliku spoza `mutate`). Do 11.10.2026 ten skrypt dzielił też pliki na 8 części według rozmiaru;
 * podział według danych robi teraz mutation-plan.mjs.
 *
 * Pliki wyznacza tak jak Stryker (@stryker-mutator/core 10: fs/project-reader.js resolveFileDescriptions
 * i filterMutatePattern, config/file-matcher.js): wzorce `mutate` ze stryker.config.json po kolei, „!” wyklucza,
 * minimatch na ścieżkach bezwzględnych z { dot: false }. Kandydaci to pliki śledzone przez git (w CI jest ich tyle
 * samo co na dysku).
 *
 * Użycie: node .github/scripts/mutation-files.mjs --all   → wszystkie pliki, po jednym w wierszu
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Wzorce z zakresem linii („plik.ts:1-10”) zmieniają, co Stryker mutuje w pliku — podział ich nie obsługuje. */
const RANGE = /:\d+(?::\d+)?-\d+(?::\d+)?$/;

/** Pliki do mutacji (ścieżki względem korzenia repozytorium, posortowane). */
export function mutateFiles(root = ROOT, candidates = gitFiles(root)) {
  const { mutate } = JSON.parse(readFileSync(join(root, 'stryker.config.json'), 'utf8'));
  const chosen = new Set();
  for (const pattern of mutate) {
    if (RANGE.test(pattern)) throw new Error(`Wzorzec z zakresem linii nie jest obsługiwany przy podziale: ${pattern}`);
    const exclude = pattern.startsWith('!');
    const glob = resolve(root, exclude ? pattern.slice(1) : pattern);
    for (const file of candidates) {
      if (!minimatch(resolve(root, file), glob, { dot: false })) continue;
      if (exclude) chosen.delete(file);
      else chosen.add(file);
    }
  }
  return [...chosen].sort();
}

function gitFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--all') {
    process.stderr.write('Użycie: mutation-files.mjs --all\n');
    process.exit(2);
  }
  process.stdout.write(`${mutateFiles().join('\n')}\n`);
}
