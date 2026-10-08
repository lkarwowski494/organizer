#!/usr/bin/env node
/**
 * Podział nocnych testów mutacyjnych na części (audyt 2, M-47; nightly.yml). Przy 8537 mutantach w 64 plikach jeden
 * runner potrzebowałby kilku godzin, a limit zadania GitHub Actions to 6 h — części działają równolegle.
 *
 * Pliki wyznacza tak jak Stryker (@stryker-mutator/core 10: fs/project-reader.js resolveFileDescriptions
 * i filterMutatePattern, config/file-matcher.js): wzorce `mutate` ze stryker.config.json po kolei, „!” wyklucza,
 * minimatch na ścieżkach bezwzględnych z { dot: false }. Kandydaci to pliki śledzone przez git (w CI jest ich tyle
 * samo co na dysku). Pliki rozdawane „wężykiem” od największego (0, 1, …, n-1, n-1, …, 0), więc każda część dostaje
 * podobną ilość kodu.
 *
 * Użycie: node .github/scripts/mutation-shards.mjs <indeks od 0> <liczba części>   → pliki części, po przecinku
 *         node .github/scripts/mutation-shards.mjs --all                         → wszystkie pliki, po jednym w wierszu
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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

/** Część `index` (od 0) z `total`: pliki od największego, rozdawane wężykiem. */
export function shard(files, index, total, sizeOf = (file) => statSync(join(ROOT, file)).size) {
  const bySize = [...files].sort((a, b) => sizeOf(b) - sizeOf(a) || a.localeCompare(b));
  return bySize
    .filter((_, i) => {
      const lap = Math.floor(i / total);
      const pos = i % total;
      return (lap % 2 === 0 ? pos : total - 1 - pos) === index;
    })
    .sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, second] = process.argv.slice(2);
  const files = mutateFiles();
  if (first === '--all') {
    process.stdout.write(`${files.join('\n')}\n`);
  } else {
    const index = Number(first);
    const total = Number(second);
    if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
      process.stderr.write('Użycie: mutation-shards.mjs <indeks od 0> <liczba części> | --all\n');
      process.exit(2);
    }
    const part = shard(files, index, total);
    if (part.length === 0) {
      process.stderr.write(`Część ${index + 1} z ${total} jest pusta: ${files.length} plików na ${total} części\n`);
      process.exit(1);
    }
    process.stdout.write(part.join(','));
  }
}
