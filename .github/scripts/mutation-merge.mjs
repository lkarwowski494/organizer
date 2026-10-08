#!/usr/bin/env node
/**
 * Wynik nocnych testów mutacyjnych ze wszystkich części (audyt 2, M-47; nightly.yml). Każda część to katalog z raportem
 * Strykera (mutation.json, schemat mutation-testing-report-schema) i listą swoich plików (files.txt, po przecinku).
 *
 * Wynik liczy ta sama funkcja, której Stryker używa przy progu (mutation-testing-metrics: calculateMutationTestMetrics →
 * systemUnderTestMetrics.metrics.mutationScore; @stryker-mutator/core, reporters/mutation-test-report-helper.js,
 * determineExitCode): wykryte (Killed + Timeout) / ważne (wykryte + Survived + NoCoverage) · 100.
 * Kod 1, gdy wynik jest niższy niż thresholds.break ze stryker.config.json, gdy wyniku nie da się policzyć albo gdy
 * części nie obejmują dokładnie plików z `mutate` (żaden plik nie może wypaść z pomiaru ani być liczony dwa razy).
 * Podsumowanie: stdout i $GITHUB_STEP_SUMMARY.
 *
 * Użycie: node .github/scripts/mutation-merge.mjs <katalog części>...
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateMutationTestMetrics } from 'mutation-testing-metrics';

import { mutateFiles, ROOT } from './mutation-shards.mjs';

/**
 * Scalony raport: pliki ze wszystkich części. Identyfikatory testów i mutantów to numery nadawane w każdej części
 * osobno, więc testFiles (i odwołania coveredBy/killedBy) są pomijane, a identyfikator mutanta dostaje numer części.
 * Wynik od tego nie zależy — liczą się tylko statusy mutantów.
 */
export function mergeReports(reports) {
  const files = {};
  reports.forEach((report, part) => {
    for (const [name, file] of Object.entries(report.files)) {
      if (files[name]) throw new Error(`${name}: plik w raportach dwóch części`);
      const mutants = file.mutants.map((m) => ({ ...m, id: `${part + 1}-${m.id}`, coveredBy: undefined, killedBy: undefined }));
      files[name] = { ...file, mutants };
    }
  });
  return { schemaVersion: reports[0]?.schemaVersion ?? '1.0', thresholds: reports[0]?.thresholds ?? { high: 80, low: 60 }, files };
}

export const metricsOf = (report) => calculateMutationTestMetrics(report).systemUnderTestMetrics.metrics;

/** Pliki z `mutate`, których brakuje w listach części, które są w dwóch częściach albo spoza `mutate`. */
export function coverageProblems(expected, partLists, reports) {
  const problems = [];
  const seen = new Map();
  partLists.forEach((list, part) => {
    for (const file of list) {
      if (seen.has(file)) problems.push(`${file}: w częściach ${seen.get(file) + 1} i ${part + 1}`);
      else seen.set(file, part);
      if (!expected.includes(file)) problems.push(`${file}: spoza wzorców mutate`);
    }
    for (const file of Object.keys(reports[part].files)) {
      if (!list.includes(file)) problems.push(`${file}: w raporcie części ${part + 1}, choć nie było go na jej liście`);
    }
  });
  for (const file of expected) if (!seen.has(file)) problems.push(`${file}: nie ma go w żadnej części`);
  return problems;
}

const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(2).replace('.', ',')}%` : '—');

export function summary(merged, threshold, parts) {
  const m = metricsOf(merged);
  const areas = new Map();
  for (const name of Object.keys(merged.files)) {
    const area = name.split('/').slice(0, 2).join('/');
    areas.set(area, { ...areas.get(area), [name]: merged.files[name] });
  }
  const rows = [...areas.keys()].sort().map((area) => {
    const a = metricsOf({ ...merged, files: areas.get(area) });
    return `| ${area} | ${pct(a.mutationScore)} | ${a.totalValid} | ${a.survived} | ${a.noCoverage} |`;
  });
  const worst = Object.entries(merged.files)
    .map(([name, file]) => [name, file.mutants.filter((x) => x.status === 'Survived' || x.status === 'NoCoverage').length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([name, n]) => `| ${name} | ${n} |`);
  return [
    `### Testy mutacyjne (${parts} części)`,
    '',
    `Wynik **${pct(m.mutationScore)}** (próg ${threshold ?? '—'}%): wykryte ${m.totalDetected} z ${m.totalValid} ważnych mutantów ` +
      `(zabite ${m.killed}, przekroczony czas ${m.timeout}; przeżyły ${m.survived}, bez pokrycia ${m.noCoverage}; ` +
      `błędy ${m.runtimeErrors + m.compileErrors}, pominięte ${m.ignored}).`,
    '',
    '| Obszar | Wynik | Ważne | Przeżyły | Bez pokrycia |',
    '|---|---|---|---|---|',
    ...rows,
    ...(worst.length ? ['', 'Najwięcej niewykrytych (przeżyte mutanty z różnicą kodu: log części, reporter clear-text):', '', '| Plik | Niewykryte |', '|---|---|', ...worst] : []),
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    process.stderr.write('Użycie: mutation-merge.mjs <katalog części>...\n');
    process.exit(2);
  }
  const reports = dirs.map((dir) => JSON.parse(readFileSync(join(dir, 'mutation.json'), 'utf8')));
  const lists = dirs.map((dir) => readFileSync(join(dir, 'files.txt'), 'utf8').split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
  const threshold = JSON.parse(readFileSync(join(ROOT, 'stryker.config.json'), 'utf8')).thresholds?.break;
  const problems = coverageProblems(mutateFiles(), lists, reports);
  const merged = mergeReports(reports);
  const score = metricsOf(merged).mutationScore;
  if (!Number.isFinite(score)) problems.push('wyniku nie da się policzyć (brak ważnych mutantów)');
  else if (typeof threshold === 'number' && score < threshold) {
    problems.push(`wynik ${pct(score)} poniżej progu ${threshold}% (stryker.config.json → thresholds.break)`);
  }
  const md = summary(merged, threshold, dirs.length) + (problems.length ? `\n**Błąd:**\n${problems.map((p) => `- ${p}`).join('\n')}\n` : '');
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.exitCode = problems.length ? 1 : 0;
}
