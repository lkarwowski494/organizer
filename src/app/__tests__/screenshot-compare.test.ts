/**
 * Porównanie zrzutów E2E (scripts/e2e/compare-screenshots.mjs, D143) jako czarna skrzynka: prawdziwe pliki PNG,
 * prawdziwy proces Node — tak jak w e2e.yml.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PNG } from 'pngjs';

const SCRIPT = join(__dirname, '../../../scripts/e2e/compare-screenshots.mjs');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e2e-shots-'));
  for (const d of ['base', 'actual', 'out']) mkdirSync(join(dir, d));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Obraz w×h w jednym kolorze; `paint` zmienia wybrane piksele. */
function png(path: string, w: number, h: number, paint: (x: number, y: number) => [number, number, number] = () => [240, 240, 240]) {
  const img = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = paint(x, y);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  writeFileSync(path, PNG.sync.write(img));
}

function run(...extra: string[]): { code: number; stdout: string; report: { baselines: number; failed: number; results: { name: string; status: string; pixels?: number }[] } | null } {
  const args = [SCRIPT, '--baselines', join(dir, 'base'), '--actual', join(dir, 'actual'), '--out', join(dir, 'out'), ...extra];
  const env = { ...process.env, GITHUB_STEP_SUMMARY: join(dir, 'summary.md') };
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { status: number; stdout: string };
    code = err.status;
    stdout = err.stdout;
  }
  const file = join(dir, 'out', 'report.json');
  return { code, stdout, report: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

describe('compare-screenshots (D143)', () => {
  it('bez wzorców: tylko komunikat i kod 0, nawet z --fail', () => {
    png(join(dir, 'actual', '01-today.png'), 10, 10);
    const r = run('--fail');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Brak wzorców');
    expect(r.report!.results).toEqual([{ name: '01-today.png', status: 'new' }]);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain('accept-baselines.sh');
  });

  it('zgodne, drobna różnica w progu, różnica ponad próg (obraz różnic), inny rozmiar, brak zrzutu, nowy', () => {
    const sizes: [string, number, number][] = [['01-a.png', 100, 100], ['02-b.png', 100, 100], ['03-c.png', 100, 100], ['04-d.png', 100, 100], ['05-e.png', 100, 100]];
    for (const [n, w, h] of sizes) png(join(dir, 'base', n), w, h);
    png(join(dir, 'actual', '01-a.png'), 100, 100);
    png(join(dir, 'actual', '02-b.png'), 100, 100, (x, y) => (x >= 40 && x < 44 && y >= 40 && y < 44 ? [0, 0, 0] : [240, 240, 240])); // 16 px = 0,16%
    png(join(dir, 'actual', '03-c.png'), 100, 100, (x, y) => (x < 20 && y < 20 ? [200, 0, 0] : [240, 240, 240])); // 4%
    png(join(dir, 'actual', '04-d.png'), 120, 100);
    png(join(dir, 'actual', '06-f.png'), 10, 10);
    const r = run();
    expect(r.code).toBe(0); // bez --fail tylko informacja (push, PR)
    expect(r.report!.results.map((x) => [x.name, x.status])).toEqual([
      ['01-a.png', 'ok'],
      ['02-b.png', 'diff'],
      ['03-c.png', 'diff'],
      ['04-d.png', 'size'],
      ['05-e.png', 'missing'],
      ['06-f.png', 'new'],
    ]);
    expect(r.report!.results[0]!.pixels).toBe(0);
    expect(r.report!.results[2]!.pixels).toBe(400);
    expect(existsSync(join(dir, 'out', '03-c.diff.png'))).toBe(true);
    expect(existsSync(join(dir, 'out', '01-a.diff.png'))).toBe(false);
    expect(r.stdout).toContain('| 04-d.png | size | 100×100 → 120×100 |');
    // Większy próg (1%) dopuszcza 16 px; --fail zwraca błąd przy pozostałych.
    const loose = run('--max-ratio', '0.01', '--fail');
    expect(loose.report!.results.find((x) => x.name === '02-b.png')!.status).toBe('ok');
    expect(loose.report!.failed).toBe(3);
    expect(loose.code).toBe(1);
  });

  it('wszystko zgodne z --fail: kod 0', () => {
    png(join(dir, 'base', '01-a.png'), 20, 20);
    png(join(dir, 'actual', '01-a.png'), 20, 20);
    const r = run('--fail');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Wszystkie zrzuty zgodne z wzorcami');
  });

  it('złe argumenty: kod 2', () => {
    expect(run('--threshold', '7').code).toBe(2);
    expect(run('--nieznany').code).toBe(2);
    expect(run('--out').code).toBe(2);
  });
});
