#!/usr/bin/env node
/**
 * Podział nocnych testów mutacyjnych na części według danych (nightly.yml, zadanie mutation-plan). Zastępuje stałe
 * 8 części z podziałem plików według rozmiaru (audyt 2, M-47): 11.10.2026 przy 18 863 mutantach (3 021 statycznych)
 * cztery z ośmiu części przekroczyły 110 min, a sam słownik działów zakupów (999 mutantów statycznych) to kilka godzin.
 *
 * Kroki (każdy z danych bieżącego commitu albo poprzedniego przebiegu, bez stałej liczby części):
 *  1. Plan Strykera dla wszystkich plików z `mutate` (stryker.plan.config.mjs, reporter „plan”): które mutanty są
 *     statyczne, szacowany czas testów każdego mutanta (netTime z czasów testów przebiegu wstępnego) i jego położenie.
 *  2. Testy powiązane z każdym plikiem (`jest --listTests --findRelatedTests`, tak jak Stryker z enableFindRelatedTests
 *     uruchamia testy przy mutancie) — mutant statyczny przeładowuje i uruchamia wszystkie testy powiązane ze swoim
 *     plikiem (@stryker-mutator/core 10, mutants/mutant-test-planner.js: „Static … run all tests”).
 *  3. Koszt mutanta = model (czas testów + narzut uruchomienia) × współczynnik z pomiaru poprzedniego przebiegu
 *     (timings.json z artefaktu mutation-timings: zmierzony czas / model, osobno dla mutantów statycznych i pozostałych,
 *     dla pliku albo — przy małej próbie — dla całości). Bez pomiaru współczynnik 1.
 *  4. Jednostki podziału: plik, a plik droższy niż połowa docelowej części — grupy „korzeni” (mutant, który nie leży
 *     w żadnym innym mutancie, razem ze wszystkimi mutantami w nim). Zakres `plik:w:k-w:k` obejmuje mutant tylko wtedy,
 *     gdy cały leży w zakresie (@stryker-mutator/instrumenter 10, transformers/babel-transformer.js shouldMutate →
 *     util/syntax-helpers.js locationIncluded), więc cięcie tylko między korzeniami nie gubi żadnego mutanta.
 *  5. Liczba części = najmniejsza, przy której każda część mieści się w docelowym czasie (pakowanie LPT: najdroższa
 *     jednostka do najmniej obciążonej części), a limit czasu kroku = SAFETY × przewidywany czas części.
 *
 * Wynik: reports/mutation/plan.json (części, przewidywania i oczekiwane klucze mutantów — mutation-merge.mjs sprawdza
 * nimi, że części objęły każdy mutant dokładnie raz) i macierz dla GitHub Actions w $GITHUB_OUTPUT (`matrix`).
 *
 * Użycie: node .github/scripts/mutation-plan.mjs [--timings <timings.json>] [--raw <plan-raw.json>]
 *   bez --raw uruchamia Strykera (ok. 3 min); --raw — gotowy plan (np. lokalnie po `npx stryker run stryker.plan.config.mjs`).
 */
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { mutateFiles, ROOT } from './mutation-files.mjs';
import { mutantKey } from './stryker-reporters.mjs';

const MIN = 60_000;

/**
 * Parametry podziału. Limity GitHub (sprawdzone 11.10.2026, https://docs.github.com/en/actions/reference/limits):
 * „Each job in a workflow can run for up to 6 hours of execution time”; „A job matrix can generate a maximum of 256 jobs
 * per workflow run”; plan Free: 20 zadań naraz na standardowych maszynach (część ponad to czeka w kolejce, czas kolejki
 * nie liczy się do limitu zadania).
 */
export const PARAMS = {
  /** Limit zadania GitHub (min). */
  jobLimitMin: 360,
  /** Kroki zadania części poza Strykerem: maszyna, checkout, setup-node, npm ci, wysłanie artefaktu (pomiar 11.10.2026: ~1 min) z zapasem. */
  jobSetupMin: 10,
  /** Najwięcej części w jednej macierzy (limit GitHub). */
  maxParts: 256,
  /**
   * Docelowy przewidywany czas części (min). Wybór projektowy: przy danych z 11.10.2026 (ok. 23 h pracy maszyn) daje
   * ok. 16 części, czyli mniej niż 20 zadań naraz w planie Free — cała noc kończy się w czasie jednej części — a limit
   * kroku (SAFETY × przewidywanie) zostaje daleko od 6 h. Krótsze części to więcej narzutu (npm ci, przebieg wstępny
   * w każdej) i kolejka ponad 20 zadań.
   */
  targetMin: 90,
  /**
   * Limit kroku = SAFETY × przewidywany czas. 11.10.2026 model bez pomiaru (czas testów + narzut) dopasowany do
   * czterech ukończonych części mylił się w innych do ok. 1,6× (część 1: przewidziane ~100 min, po 108 min 88% mutantów);
   * pomiar z poprzedniego przebiegu zmniejsza błąd, ale dane i testy zmieniają się z dnia na dzień.
   */
  safety: 2,
  /** Najkrótszy limit kroku (min): przebieg wstępny i wahania maszyny przy bardzo małej części. */
  minStepMin: 20,
  /**
   * Narzut jednego uruchomienia testów przy mutancie (ms pracy procesu): start Jest, wczytanie powiązanych plików testów
   * (testy spoza filtra też są wczytywane, a kod w `describe` wykonywany), przeładowanie przy mutancie statycznym.
   * Dopasowanie do czterech ukończonych części z 11.10.2026: ~5,5 s na mutanta przy współczynniku ~0,6 przy czasie testów
   * (model z pełnym czasem testów jest więc ostrożny). Pomiar z poprzedniego przebiegu i tak go koryguje.
   */
  runOverheadMs: 5_500,
  /** Przebieg wstępny części: ~1,7 × czas powiązanych testów (11.10.2026: net 36 s → 61 s) plus instrumentacja i piaskownica. */
  dryRunFactor: 1.7,
  dryRunFixedMs: 60_000,
  /** Współczynnik pomiaru dla pliku tylko przy co najmniej tylu minutach pracy w modelu; mniej — współczynnik całości (szum). */
  minCalibrationMin: 5,
};

/** Klucz mutanta z planu (położenie w układzie schematu raportu, jak w mutation.json). */
export const keyOf = (m) => mutantKey(m.file, m.loc, m.mutatorName, m.replacement);

const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
const strictlyBefore = (a, b) => a.line < b.line || (a.line === b.line && a.column < b.column);
/** `inner` leży w całości w `outer` (jak locationIncluded w instrumenterze Strykera). */
export const within = (inner, outer) => before(outer.start, inner.start) && before(inner.end, outer.end);

/**
 * Korzenie mutantów jednego pliku: mutant, który nie leży w żadnym innym, z mutantami, które w nim leżą. Węzły składni
 * są rozłączne albo zagnieżdżone, więc po sortowaniu (początek rosnąco, koniec malejąco) mutant należy do bieżącego
 * korzenia albo zaczyna nowy. Wynik w kolejności w pliku.
 */
export function rootsOf(mutants) {
  const sorted = [...mutants].sort(
    (a, b) =>
      a.loc.start.line - b.loc.start.line ||
      a.loc.start.column - b.loc.start.column ||
      b.loc.end.line - a.loc.end.line ||
      b.loc.end.column - a.loc.end.column,
  );
  const roots = [];
  for (const m of sorted) {
    const last = roots[roots.length - 1];
    if (last && within(m.loc, last.loc)) last.mutants.push(m);
    else {
      if (last && strictlyBefore(m.loc.start, last.loc.end)) {
        throw new Error(`${m.file}: mutant ${keyOf(m)} częściowo nachodzi na ${keyOf(last.mutants[0])} — nie da się ciąć zakresami`);
      }
      roots.push({ loc: m.loc, mutants: [m] });
    }
  }
  return roots;
}

/** Zakres dla `--mutate` z położenia w układzie schematu: wiersze od 1, kolumny od 0 (core 10, fs/project-reader.js). */
export const rangeOf = (file, start, end) => `${file}:${start.line}:${start.column - 1}-${end.line}:${end.column - 1}`;

/** Czas powiązanych testów (ms) dla każdego pliku: suma czasów testów z przebiegu wstępnego w plikach powiązanych. */
export function relatedMs(tests, related) {
  const byTestFile = new Map();
  for (const t of tests) if (t.file) byTestFile.set(t.file, (byTestFile.get(t.file) ?? 0) + t.ms);
  return Object.fromEntries(Object.entries(related).map(([file, list]) => [file, list.reduce((s, f) => s + (byTestFile.get(f) ?? 0), 0)]));
}

/** Model kosztu mutanta (ms pracy jednego procesu testów) — bez kalibracji. */
export function modelMs(m, related, params = PARAMS) {
  if (!m.run) return 0;
  return (m.static ? (related[m.file] ?? 0) : m.netTime) + params.runOverheadMs;
}

const kindOf = (m) => (m.static ? 'static' : 'runtime');

/**
 * Współczynniki z pomiaru poprzedniego przebiegu (timings.json z mutation-merge.mjs): zmierzony / model, dla pliku
 * i rodzaju mutantów, gdy próba w modelu ma co najmniej minCalibrationMin; inaczej dla całości tego rodzaju; bez danych 1.
 */
export function calibration(timings, params = PARAMS) {
  const valid = (x) => x && Number.isFinite(x.measured) && Number.isFinite(x.model) && x.measured >= 0 && x.model > 0;
  const global = {};
  for (const kind of ['runtime', 'static']) {
    let measured = 0;
    let model = 0;
    for (const f of Object.values(timings?.files ?? {})) {
      if (valid(f[kind])) {
        measured += f[kind].measured;
        model += f[kind].model;
      }
    }
    global[kind] = model > 0 ? measured / model : 1;
  }
  return (file, kind) => {
    const x = timings?.files?.[file]?.[kind];
    return valid(x) && x.model >= params.minCalibrationMin * MIN ? x.measured / x.model : global[kind];
  };
}

/** Jednostki podziału: plik albo (plik droższy niż połowa docelowej części) kolejne grupy korzeni o podobnym koszcie. */
export function unitsOf(byFile, costOf, params = PARAMS, concurrency = 4) {
  const half = (params.targetMin * MIN * concurrency) / 2;
  const units = [];
  for (const [file, mutants] of Object.entries(byFile)) {
    const total = mutants.reduce((s, m) => s + costOf(m), 0);
    if (total <= half) {
      units.push({ file, patterns: [file], cost: total, mutants: mutants.length });
      continue;
    }
    const roots = rootsOf(mutants).map((r) => ({ ...r, cost: r.mutants.reduce((s, m) => s + costOf(m), 0) }));
    const groups = Math.ceil(total / half);
    const per = total / groups;
    let cur = null;
    for (const r of roots) {
      if (cur && cur.cost + r.cost > per && cur.cost > 0) {
        units.push(cur);
        cur = null;
      }
      if (!cur) cur = { file, start: r.loc.start, end: r.loc.end, cost: 0, mutants: 0 };
      cur.end = r.loc.end;
      cur.cost += r.cost;
      cur.mutants += r.mutants.length;
    }
    units.push(cur);
    for (const u of units) if (u.file === file && !u.patterns) u.patterns = [rangeOf(file, u.start, u.end)];
  }
  return units.map(({ start, end, ...u }) => u);
}

/** Przebieg wstępny części (ms): powiązane testy wszystkich plików części, jeden proces. */
export function dryRunMs(files, related, testMs, params = PARAMS) {
  const tests = new Set(files.flatMap((f) => related[f] ?? []));
  return params.dryRunFixedMs + params.dryRunFactor * [...tests].reduce((s, t) => s + (testMs.get(t) ?? 0), 0);
}

/**
 * Części: jednostka dłuższa niż targetMin (nie da się jej już podzielić) dostaje własną część; pozostałe jednostki —
 * najmniejsza liczba części, przy której każda przewidywana część (praca / concurrency + przebieg wstępny) mieści się
 * w targetMin (pakowanie LPT). Błąd, gdy część po pomnożeniu przez SAFETY nie mieści się w limicie kroku albo potrzeba
 * więcej niż maxParts części.
 */
export function pack(units, { related, testMs, concurrency }, params = PARAMS) {
  const maxStepMin = params.jobLimitMin - params.jobSetupMin;
  const wallMin = (part) => (part.cost / concurrency + dryRunMs(part.files, related, testMs, params)) / MIN;
  const alone = (u) => wallMin({ cost: u.cost, files: [u.file] });
  for (const u of units) {
    if (alone(u) * params.safety > maxStepMin) {
      throw new Error(`${u.patterns.join(',')}: przewidywane ${alone(u).toFixed(0)} min × ${params.safety} > ${maxStepMin} min limitu kroku, a jednostki nie da się podzielić`);
    }
  }
  const single = (u) => ({ units: [u], files: [u.file], cost: u.cost });
  const big = units.filter((u) => alone(u) > params.targetMin).map(single);
  const rest = units.filter((u) => alone(u) <= params.targetMin).sort((a, b) => b.cost - a.cost || a.patterns[0].localeCompare(b.patterns[0]));
  const restMin = rest.reduce((s, u) => s + u.cost, 0) / concurrency / MIN;
  let packed = [];
  for (let n = Math.max(rest.length ? 1 : 0, Math.ceil(restMin / params.targetMin)); ; n++) {
    if (big.length + n > params.maxParts) throw new Error(`potrzeba więcej niż ${params.maxParts} części (limit macierzy GitHub)`);
    packed = Array.from({ length: n }, () => ({ units: [], files: [], cost: 0 }));
    for (const u of rest) {
      const p = packed.reduce((best, x) => (x.cost < best.cost ? x : best));
      p.units.push(u);
      if (!p.files.includes(u.file)) p.files.push(u.file);
      p.cost += u.cost;
    }
    // Przy n = liczbie jednostek każda ma własną część (alone ≤ targetMin), więc pętla kończy się najpóźniej wtedy.
    if (packed.every((p) => p.units.length && wallMin(p) <= params.targetMin)) break;
  }
  return [...big, ...packed].map((p, i) => {
    const predicted = wallMin(p);
    const stepMin = Math.max(params.minStepMin, Math.ceil(predicted * params.safety));
    return {
      part: i + 1,
      mutate: p.units.flatMap((u) => u.patterns).sort().join(','),
      files: [...p.files].sort(),
      mutants: p.units.reduce((s, u) => s + u.mutants, 0),
      predictedMin: Math.round(predicted * 10) / 10,
      stepMin,
      jobMin: stepMin + params.jobSetupMin,
    };
  });
}

/** Cały plan z surowego planu Strykera, powiązanych testów i pomiaru poprzedniego przebiegu. */
export function makePlan(raw, related, timings, params = PARAMS) {
  const concurrency = raw.concurrency;
  const rel = relatedMs(raw.tests, related);
  const ratio = calibration(timings, params);
  const testMs = new Map();
  for (const t of raw.tests) if (t.file) testMs.set(t.file, (testMs.get(t.file) ?? 0) + t.ms);
  const model = new Map();
  const cost = new Map();
  for (const m of raw.mutants) {
    const k = keyOf(m);
    if (model.has(k)) throw new Error(`mutant dwa razy w planie: ${k}`);
    const ms = modelMs(m, rel, params);
    model.set(k, ms);
    cost.set(k, ms * ratio(m.file, kindOf(m)));
  }
  const byFile = {};
  for (const m of raw.mutants) (byFile[m.file] ??= []).push(m);
  const units = unitsOf(byFile, (m) => cost.get(keyOf(m)), params, concurrency);
  const parts = pack(units, { related, testMs, concurrency }, params);
  const expected = raw.mutants.map((m) => ({ key: keyOf(m), file: m.file, kind: kindOf(m), model: Math.round(model.get(keyOf(m))) }));
  return {
    concurrency,
    calibrated: Boolean(timings),
    predictedTotalMin: Math.round(units.reduce((s, u) => s + u.cost, 0) / concurrency / MIN),
    parts,
    expected,
  };
}

export function summary(plan) {
  const lines = [
    `### Plan testów mutacyjnych: ${plan.parts.length} części`,
    '',
    `${plan.expected.length} mutantów (statycznych: ${plan.expected.filter((e) => e.kind === 'static').length}); ` +
      `przewidywana praca ${plan.predictedTotalMin} min maszyny; ${plan.calibrated ? 'model skalibrowany pomiarem poprzedniego przebiegu' : 'bez pomiaru poprzedniego przebiegu (sam model)'}.`,
    '',
    '| Część | Mutanty | Przewidywane (min) | Limit kroku (min) | Pliki |',
    '|---|---|---|---|---|',
    ...plan.parts.map((p) => `| ${p.part} | ${p.mutants} | ${p.predictedMin} | ${p.stepMin} | ${p.files.length} |`),
    '',
  ];
  return lines.join('\n');
}

const run = promisify(execFile);

/** Testy powiązane z każdym plikiem: tak jak jest-runner Strykera przy mutancie (--findRelatedTests <plik>). */
async function relatedTests(files, parallel = 4) {
  const jest = join(ROOT, 'node_modules/.bin/jest');
  const out = {};
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const { stdout } = await run(jest, ['-c', 'jest.mutation.config.js', '--listTests', '--json', '--findRelatedTests', file], { cwd: ROOT, maxBuffer: 1 << 26 });
      out[file] = JSON.parse(stdout).map((p) => relative(ROOT, p).split('\\').join('/')).sort();
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return out;
}

/** Pomiar z poprzedniego przebiegu albo null, gdy go nie ma lub jest nieczytelny (podział i tak zadziała na modelu). */
export function readTimings(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const t = JSON.parse(readFileSync(path, 'utf8'));
    return t && typeof t.files === 'object' ? t : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const out = join(ROOT, 'reports/mutation');
  mkdirSync(out, { recursive: true });
  let rawPath = opt('--raw');
  if (!rawPath) {
    rawPath = join(out, 'plan-raw.json');
    rmSync(rawPath, { force: true });
    execFileSync(join(ROOT, 'node_modules/.bin/stryker'), ['run', 'stryker.plan.config.mjs'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, MUTATION_PLAN_OUT: rawPath } });
    rmSync(join(ROOT, '.stryker-tmp'), { recursive: true, force: true });
  }
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const files = [...new Set(raw.mutants.map((m) => m.file))].sort();
  const allowed = new Set(mutateFiles());
  const outside = files.filter((f) => !allowed.has(f));
  if (outside.length) throw new Error(`plan obejmuje pliki spoza mutate: ${outside.join(', ')}`);
  const timings = readTimings(opt('--timings'));
  const plan = makePlan(raw, await relatedTests(files), timings);
  writeFileSync(join(out, 'plan.json'), JSON.stringify(plan));
  const md = summary(plan);
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  const matrix = { include: plan.parts.map(({ part, mutate, stepMin, jobMin }) => ({ part, mutate, stepMin, jobMin })) };
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
}
