/**
 * Ekran startowy iOS = pierwsza klatka animacji przy starcie (ADR-0045), bez mignięcia:
 *  - assets/brand/splash.svg = introSvg(0) (UPDATE_SPLASH=1 zapisuje plik od nowa; potem node scripts/brand/splash.mjs),
 *  - assets/splash.png: wstążki w miejscach z klatki 0 (punkty kawałków po przekształceniu), przezroczyście poza nimi,
 *  - app.json: wtyczka expo-splash-screen z tym obrazem, bokiem intro.SPLASH_SIZE na środku ekranu (bez trybu
 *    pełnoekranowego), tłem jasnym i ciemnym = tła motywów (src/ui/Intro.tsx rysuje ten sam kwadrat na tym samym tle).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import { pointAtLength } from '../../domain/bezier';
import { introFrame, introSvg, posePoint } from '../../domain/intro';
import { brandIcon, splashBackground } from '../brand-icon';
import { intro } from '../intro';

const root = join(__dirname, '../../..');
const svgPath = join(root, 'assets/brand/splash.svg');
if (process.env.UPDATE_SPLASH === '1') writeFileSync(svgPath, introSvg(0));

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const plugin = (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, Record<string, unknown>] | undefined;

describe('ekran startowy iOS = klatka 0 animacji', () => {
  it('assets/brand/splash.svg = introSvg(0) (po zmianie układu: UPDATE_SPLASH=1 npx jest …, potem node scripts/brand/splash.mjs)', () => {
    expect(readFileSync(svgPath, 'utf8')).toBe(introSvg(0));
  });

  it('app.json: expo-splash-screen z obrazem klatki 0, bokiem SPLASH_SIZE na środku, tłem motywów; motyw systemu', () => {
    expect(plugin).toBeDefined();
    expect(plugin![1]).toEqual({
      image: './assets/splash.png',
      imageWidth: intro.SPLASH_SIZE,
      resizeMode: 'contain',
      backgroundColor: splashBackground('light'),
      dark: { image: './assets/splash.png', backgroundColor: splashBackground('dark') },
    });
    // Nakładka zakłada kwadrat o stałym boku na środku (więzy centerX/centerY) — tryb pełnoekranowy wymaga zmiany Intro.
    expect(JSON.stringify(app)).not.toContain('enableFullScreenImage_legacy');
    expect(app.userInterfaceStyle).toBe('automatic');
    expect(app.splash).toBeUndefined();
    expect(app.ios.splash).toBeUndefined();
  });

  it('assets/splash.png: 1024 × 1024, wstążki w miejscach z klatki 0 w swoich kolorach, przezroczyście poza nimi', () => {
    const png = PNG.sync.read(readFileSync(join(root, 'assets/splash.png')));
    expect([png.width, png.height]).toEqual([1024, 1024]);
    const s = png.width / brandIcon.VIEWBOX;
    const at = ([x, y]: readonly [number, number]) => {
      const i = (Math.round(y * s) * png.width + Math.round(x * s)) * 4;
      return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
    };
    const hex = (c: number[]) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const poses = introFrame(0).poses;
    const axis = poses.map((p, i) => {
      const r = brandIcon.ribbons[i]!;
      const start = p.dashArray[0] + p.dashArray[1] - p.dashOffset;
      return Array.from({ length: 21 }, (_, k) => posePoint(p, pointAtLength(r.path, start + (p.dashArray[0] * k) / 20)));
    });
    // Środek kawałka nie zakryty kawałkiem wyżej (rysowanym później) — kolor tej wstążki, pełne krycie.
    axis.forEach((pts, i) => {
      const visible = pts.filter((pt) => axis.slice(i + 1).every((o) => o.every((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) > brandIcon.STROKE_WIDTH / 2 + 2)));
      expect(visible.length).toBeGreaterThan(0);
      for (const pt of visible) expect(at(pt)).toEqual([...hexRgb(brandIcon.ribbons[i]!.color), 255]);
      expect(hex(at(visible[0]!))).toBe(brandIcon.ribbons[i]!.color);
    });
    // Daleko od wszystkich kawałków — przezroczyste (tło daje app.json); także miejsca wstążek na gotowej ikonie.
    const far = (pt: readonly [number, number]) => axis.every((pts) => pts.every((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) > brandIcon.STROKE_WIDTH));
    const probes: [number, number][] = [[2, 2], [258, 258], [130, 10], [10, 130], [60, 200], [200, 60], [70, 160], [190, 165], [160, 70]];
    const checked = probes.filter(far);
    expect(checked.length).toBeGreaterThan(5);
    for (const pt of checked) expect(at(pt)[3]).toBe(0);
  });
});

function hexRgb(h: string): number[] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}
