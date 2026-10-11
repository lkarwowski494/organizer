#!/usr/bin/env node
/**
 * Wynik nocnych testów mutacyjnych ze wszystkich części (audyt 2, M-47; nightly.yml) i pomiar czasu dla następnego
 * planu. Każda część to katalog z raportem Strykera (mutation.json, schemat mutation-testing-report-schema), wzorcami
 * `--mutate` części (mutate.txt) i czasem pracy na każdy mutant (timings.jsonl, reporter „timing”). Plan
 * (plan.json z mutation-plan.mjs) podaje klucze wszystkich mutantów i ich model kosztu.
 *
 * Wynik liczy ta sama funkcja, której Stryker używa przy progu (mutation-testing-metrics: calculateMutationTestMetrics →
 * systemUnderTestMetrics.metrics.mutationScore; @stryker-mutator/core, reporters/mutation-test-report-helper.js,
 * determineExitCode): wykryte (Killed + Timeout) / ważne (wykryte + Survived + NoCoverage) · 100.
 * Kod 1, gdy wynik jest niższy niż thresholds.break ze stryker.config.json, gdy wyniku nie da się policzyć albo gdy
 * raporty części nie zawierają dokładnie mutantów z planu (każdy raz — plik może być podzielony między części
 * zakresami) lub zawierają plik spoza `mutate`. Podsumowanie: stdout i $GITHUB_STEP_SUMMARY.
 *
 * Pomiar (--timings-out): dla każdego pliku i rodzaju mutantów (statyczne / pozostałe) suma zmierzonego czasu i suma
 * modelu tych samych mutantów — mutation-plan.mjs liczy z nich współczynnik. Zapisywany także wtedy, gdy część
 * przekroczyła czas (są pomiary mutantów, które zdążyły się wykonać).
 *
 * Użycie: node .github/scripts/mutation-merge.mjs --plan <plan.json> [--timings-out <timings.json>] <katalog części>...
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateMutationTestMetrics } from 'mutation-testing-metrics';

import { mutateFiles, ROOT } from './mutation-files.mjs';
import { mutantKey } from './stryker-reporters.mjs';

/**
 * Scalony raport: mutanty każdego pliku ze wszystkich części (plik podzielony zakresami jest w kilku). Identyfikatory
 * testów i mutantów to numery nadawane w każdej części osobno, więc testFiles (i odwołania coveredBy/killedBy) są
 * pomijane, a identyfikator mutanta dostaje numer części. Wynik od tego nie zależy — liczą się tylko statusy mutantów.
 */
export function mergeReports(reports) {
  const files = {};
  reports.forEach((report, part) => {
    if (!report) return;
    for (const [name, file] of Object.entries(report.files)) {
      const mutants = file.mutants.map((m) => ({ ...m, id: `${part + 1}-${m.id}`, coveredBy: undefined, killedBy: undefined }));
      files[name] = files[name] ? { ...files[name], mutants: [...files[name].mutants, ...mutants] } : { ...file, mutants };
    }
  });
  const first = reports.find(Boolean);
  return { schemaVersion: first?.schemaVersion ?? '1.0', thresholds: first?.thresholds ?? { high: 80, low: 60 }, files };
}

export const metricsOf = (report) => calculateMutationTestMetrics(report).systemUnderTestMetrics.metrics;

const keyOfResult = (file, m) => mutantKey(file, m.location, m.mutatorName, m.replacement);
const sample = (list) => `${list.length} (np. ${list.slice(0, 3).join('; ')})`;

/**
 * Niezgodności raportów z planem: część bez raportu, plik spoza `mutate`, mutant z planu, którego nie ma w żadnym
 * raporcie, mutant w raportach więcej niż raz albo spoza planu.
 */
export function coverageProblems(expectedKeys, allowedFiles, reports, labels = reports.map((_, i) => `część ${i + 1}`)) {
  const problems = [];
  const seen = new Map();
  reports.forEach((report, part) => {
    if (!report) {
      problems.push(`${labels[part]}: brak raportu mutation.json (część się nie skończyła — log części)`);
      return;
    }
    for (const [name, file] of Object.entries(report.files)) {
      if (!allowedFiles.has(name)) problems.push(`${name}: spoza wzorców mutate`);
      for (const m of file.mutants) {
        const k = keyOfResult(name, m);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
  });
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((k) => !seen.has(k));
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  const extra = [...seen.keys()].filter((k) => !expected.has(k));
  if (missing.length) problems.push(`mutanty z planu bez wyniku: ${sample(missing)}`);
  if (twice.length) problems.push(`mutanty w kilku częściach: ${sample(twice)}`);
  if (extra.length) problems.push(`mutanty spoza planu: ${sample(extra)}`);
  return problems;
}

/** Pomiar dla następnego planu: plik → rodzaj → { measured, model, n } (ms pracy procesu testów). */
export function timingsOf(expected, rows) {
  const byKey = new Map(expected.map((e) => [e.key, e]));
  const files = {};
  for (const row of rows) {
    const e = byKey.get(row.key);
    if (!e || !Number.isFinite(row.ms) || row.ms < 0) continue;
    const slot = ((files[e.file] ??= {})[e.kind] ??= { measured: 0, model: 0, n: 0 });
    slot.measured += row.ms;
    slot.model += e.model;
    slot.n += 1;
  }
  return { version: 1, files };
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

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** Wiersze timings.jsonl; ostatni może być urwany, gdy część przerwał limit czasu. */
export function parseRows(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const planPath = take('--plan');
  const timingsOut = take('--timings-out');
  const dirs = args;
  if (!planPath) {
    process.stderr.write('Użycie: mutation-merge.mjs --plan <plan.json> [--timings-out <timings.json>] <katalog części>...\n');
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (timingsOut) {
    const rows = dirs.flatMap((dir) => (existsSync(join(dir, 'timings.jsonl')) ? parseRows(readFileSync(join(dir, 'timings.jsonl'), 'utf8')) : []));
    writeFileSync(timingsOut, JSON.stringify(timingsOf(plan.expected, rows)));
  }
  // Katalog części to artefakt mutation-part-<n> (nightly.yml); części bez artefaktu (np. anulowanej) liczą się jako bez raportu.
  const dirOf = new Map(dirs.map((dir) => [basename(resolve(dir)), dir]));
  const labels = plan.parts.map((p) => `część ${p.part}`);
  const reports = plan.parts.map((p) => {
    const dir = dirOf.get(`mutation-part-${p.part}`);
    return dir ? readJson(join(dir, 'mutation.json')) : null;
  });
  const threshold = JSON.parse(readFileSync(join(ROOT, 'stryker.config.json'), 'utf8')).thresholds?.break;
  const problems = coverageProblems(plan.expected.map((e) => e.key), new Set(mutateFiles()), reports, labels);
  const merged = mergeReports(reports);
  const score = metricsOf(merged).mutationScore;
  if (!Number.isFinite(score)) problems.push('wyniku nie da się policzyć (brak ważnych mutantów)');
  else if (typeof threshold === 'number' && score < threshold) {
    problems.push(`wynik ${pct(score)} poniżej progu ${threshold}% (stryker.config.json → thresholds.break)`);
  }
  const md = summary(merged, threshold, plan.parts.length) + (problems.length ? `\n**Błąd:**\n${problems.map((p) => `- ${p}`).join('\n')}\n` : '');
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.exitCode = problems.length ? 1 : 0;
}
