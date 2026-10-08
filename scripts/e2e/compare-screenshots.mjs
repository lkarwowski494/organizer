#!/usr/bin/env node
/**
 * Porównanie zrzutów ekranu E2E (D143) z wzorcami w .maestro/baselines/ — piksel po pikselu (pixelmatch,
 * https://github.com/mapbox/pixelmatch: próg koloru `threshold` w przestrzeni YIQ, wygładzanie krawędzi pomijane).
 *
 * Wynik dla każdego wzorca: ok | diff (różnica ponad --max-ratio pikseli; zapisuje obraz różnic) | size (inny rozmiar,
 * np. inny symulator) | missing (brak zrzutu). Zrzut bez wzorca: new (nie jest błędem). Bez żadnych wzorców —
 * tylko komunikat, kod 0 (pierwszy przebieg; przyjęcie wzorców: scripts/e2e/accept-baselines.sh, docs/testing.md).
 * Raport: <out>/report.json, tabela Markdown na stdout i w $GITHUB_STEP_SUMMARY (podsumowanie przebiegu Actions).
 *
 * Użycie: node scripts/e2e/compare-screenshots.mjs --baselines .maestro/baselines --actual <zrzuty> --out <katalog>
 *         [--threshold 0.1] [--max-ratio 0.001] [--fail]
 * Kod wyjścia 1 tylko z --fail i przy co najmniej jednym diff/size/missing (nocny przebieg); bez --fail — informacja.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function parseArgs(argv) {
  const opts = { threshold: 0.1, maxRatio: 0.001, fail: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Brak wartości dla ${a}`);
      return v;
    };
    if (a === '--baselines') opts.baselines = next();
    else if (a === '--actual') opts.actual = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--threshold') opts.threshold = Number(next());
    else if (a === '--max-ratio') opts.maxRatio = Number(next());
    else if (a === '--fail') opts.fail = true;
    else throw new Error(`Nieznany argument: ${a}`);
  }
  if (!opts.baselines || !opts.actual || !opts.out) throw new Error('Wymagane: --baselines, --actual, --out');
  if (!(opts.threshold >= 0 && opts.threshold <= 1) || !(opts.maxRatio >= 0 && opts.maxRatio <= 1)) throw new Error('--threshold i --max-ratio: liczby 0–1');
  return opts;
}

const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort() : []);

function compare(opts) {
  mkdirSync(opts.out, { recursive: true });
  const baselines = pngs(opts.baselines);
  const actual = pngs(opts.actual);
  const results = [];
  for (const name of baselines) {
    if (!actual.includes(name)) {
      results.push({ name, status: 'missing' });
      continue;
    }
    const want = PNG.sync.read(readFileSync(join(opts.baselines, name)));
    const got = PNG.sync.read(readFileSync(join(opts.actual, name)));
    if (want.width !== got.width || want.height !== got.height) {
      results.push({ name, status: 'size', detail: `${want.width}×${want.height} → ${got.width}×${got.height}` });
      continue;
    }
    const diff = new PNG({ width: want.width, height: want.height });
    const pixels = pixelmatch(want.data, got.data, diff.data, want.width, want.height, { threshold: opts.threshold });
    const ratio = pixels / (want.width * want.height);
    const status = ratio > opts.maxRatio ? 'diff' : 'ok';
    if (status === 'diff') writeFileSync(join(opts.out, name.replace(/\.png$/i, '.diff.png')), PNG.sync.write(diff));
    results.push({ name, status, pixels, ratio });
  }
  for (const name of actual) if (!baselines.includes(name)) results.push({ name, status: 'new' });
  return { baselines: baselines.length, results, failed: results.filter((r) => r.status === 'diff' || r.status === 'size' || r.status === 'missing').length };
}

function markdown(report, opts) {
  if (report.baselines === 0) {
    return `### Zrzuty ekranu E2E\n\nBrak wzorców w \`${opts.baselines}\` — ten przebieg tylko zapisuje zrzuty (${report.results.length}). Przyjęcie wzorców: \`scripts/e2e/accept-baselines.sh\` (docs/testing.md).\n`;
  }
  const rows = report.results.map((r) => {
    const info = r.status === 'size' ? r.detail : r.ratio !== undefined ? `${r.pixels} px (${(r.ratio * 100).toFixed(3)}%)` : '';
    return `| ${r.name} | ${r.status} | ${info} |`;
  });
  const head = report.failed ? `**${report.failed} do sprawdzenia** (obrazy różnic: \`*.diff.png\` w artefakcie)` : 'Wszystkie zrzuty zgodne z wzorcami';
  return `### Zrzuty ekranu E2E\n\n${head}; próg ${(opts.maxRatio * 100).toFixed(2)}% pikseli.\n\n| Zrzut | Wynik | Różnica |\n|---|---|---|\n${rows.join('\n')}\n`;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const report = compare(opts);
  writeFileSync(join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = markdown(report, opts);
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.exitCode = opts.fail && report.failed > 0 ? 1 : 0;
} catch (e) {
  process.stderr.write(`compare-screenshots: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
