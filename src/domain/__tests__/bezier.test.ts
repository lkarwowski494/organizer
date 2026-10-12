import * as fc from 'fast-check';

import { brandIcon, type RibbonPath } from '../../config/brand-icon';
import { type Cubic, cubicLength, cubicPoint, cubics, gaussLegendre, pathLength, pointAtLength } from '../bezier';
import corpus from './fixtures/intro.json';

const line = (x0: number, y0: number, x1: number, y1: number): Cubic => [
  [x0, y0],
  [x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3],
  [x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3],
  [x1, y1],
];

describe('krzywe Béziera: długość łuku i punkt w odległości', () => {
  it('długości wstążek ikony = niezależna implementacja (scripts/gen-intro-corpus.py, łamana z Richardsonem)', () => {
    expect(corpus.lengths).toHaveLength(brandIcon.ribbons.length);
    brandIcon.ribbons.forEach((r, i) => expect(pathLength(r.path)).toBeCloseTo(corpus.lengths[i]!, 6));
  });

  it('kwadratura Gaussa–Legendre’a: wagi sumują się do 2, węzły symetryczne, dokładna dla wielomianów stopnia 2n−1', () => {
    for (const n of [1, 2, 5, 16]) {
      const { x, w } = gaussLegendre(n);
      expect(x).toHaveLength(n);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 12);
      const sorted = [...x].sort((a, b) => a - b);
      sorted.forEach((v, i) => expect(v).toBeCloseTo(-sorted[n - 1 - i]!, 12));
      // ∫_{-1}^{1} x^(2n−2) dx = 2/(2n−1)
      expect(x.reduce((s, v, i) => s + w[i]! * v ** (2 * n - 2), 0)).toBeCloseTo(2 / (2 * n - 1), 10);
    }
    expect(gaussLegendre(2).x.map((v) => Math.abs(v))).toEqual([1 / Math.sqrt(3), 1 / Math.sqrt(3)].map((v) => expect.closeTo(v, 14)));
    expect(gaussLegendre(1)).toEqual({ x: [expect.closeTo(0, 14)], w: [expect.closeTo(2, 14)] });
  });

  it('odcinek prosty: długość = odległość końców, punkt w połowie łuku = środek', () => {
    const c = line(0, 0, 30, 40);
    expect(cubicLength(c)).toBeCloseTo(50, 10);
    expect(cubicLength(c, 0.5)).toBeCloseTo(25, 10);
    const p: RibbonPath = { start: c[0], curves: [[c[1], c[2], c[3]]] };
    expect(pointAtLength(p, 25)).toEqual([expect.closeTo(15, 8), expect.closeTo(20, 8)]);
  });

  it('ćwierć okręgu (przybliżenie Béziera, k = 0,5523): długość ≈ πr/2 z błędem przybliżenia < 0,03%', () => {
    const k = 0.5522847498;
    const c: Cubic = [[100, 0], [100, 100 * k], [100 * k, 100], [0, 100]];
    expect(Math.abs(cubicLength(c) / ((Math.PI * 100) / 2) - 1)).toBeLessThan(3e-4);
  });

  it('punkt krzywej: końce i wzór Bernsteina', () => {
    const c: Cubic = [[0, 0], [10, 20], [30, 20], [40, 0]];
    expect(cubicPoint(c, 0)).toEqual([0, 0]);
    expect(cubicPoint(c, 1)).toEqual([40, 0]);
    expect(cubicPoint(c, 0.5)).toEqual([20, 15]);
    expect(cubicPoint(c, 0.25)).toEqual([expect.closeTo(0.421875 * 10 + 0.140625 * 30 + 0.015625 * 40, 12), expect.closeTo(0.421875 * 20 + 0.140625 * 20, 12)]);
  });

  it('ścieżka z kilku krzywych: krzywe łączą się końcami; punkt na granicy i poza zakresem', () => {
    const p = brandIcon.ribbons[0].path;
    const segs = cubics(p);
    expect(segs).toHaveLength(2);
    expect(segs[0]![0]).toEqual(p.start);
    expect(segs[1]![0]).toEqual(segs[0]![3]);
    const first = cubicLength(segs[0]!);
    expect(pointAtLength(p, first)).toEqual([expect.closeTo(160, 6), expect.closeTo(70, 6)]);
    expect(pointAtLength(p, -5)).toEqual([expect.closeTo(70, 8), expect.closeTo(160, 8)]);
    expect(pointAtLength(p, 1e6)).toEqual([expect.closeTo(190, 6), expect.closeTo(165, 6)]);
    expect(pathLength(p)).toBeCloseTo(first + cubicLength(segs[1]!), 10);
  });

  it('ścieżka bez krzywych: długość 0, punkt = start', () => {
    const p: RibbonPath = { start: [5, 7], curves: [] };
    expect(pathLength(p)).toBe(0);
    expect(pointAtLength(p, 3)).toEqual([5, 7]);
  });

  it('punkty w odległości s = niezależna implementacja (korpus: początek, środek i koniec kawałka w klatce, bez przekształcenia na końcu ruchu)', () => {
    const last = corpus.frames.at(-1)!;
    brandIcon.ribbons.forEach((r, i) => {
      const row = last.ribbons[i]!;
      const ss = [row.start, row.start + row.visible / 2, row.start + row.visible];
      ss.forEach((s, j) => {
        const [x, y] = pointAtLength(r.path, s);
        expect([x, y]).toEqual([expect.closeTo(row.points[j]![0]!, 4), expect.closeTo(row.points[j]![1]!, 4)]);
      });
    });
  });

  it('własność: odległość wzdłuż łuku ≥ odległość w linii prostej; długość rośnie z parametrem', () => {
    const p = brandIcon.ribbons[0].path;
    const total = pathLength(p);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [s, t] = [Math.min(a, b) * total, Math.max(a, b) * total];
        const [p1, p2] = [pointAtLength(p, s), pointAtLength(p, t)];
        expect(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])).toBeLessThanOrEqual(t - s + 1e-6);
        const c = cubics(p)[0]!;
        expect(cubicLength(c, Math.min(a, b))).toBeLessThanOrEqual(cubicLength(c, Math.max(a, b)) + 1e-12);
      }),
    );
  });
});
