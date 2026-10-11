/**
 * Długość łuku krzywych sześciennych Béziera i punkt w danej odległości wzdłuż ścieżki (animacja przy starcie, ADR-0045:
 * wstążka przycięta kreską strokeDasharray/strokeDashoffset, które iOS liczy w długości łuku ścieżki).
 *
 * Krzywa: B(u) = (1−u)³P0 + 3(1−u)²u P1 + 3(1−u)u² P2 + u³P3, pochodna B'(u) = 3(1−u)²(P1−P0) + 6(1−u)u(P2−P1) + 3u²(P3−P2)
 * (https://en.wikipedia.org/wiki/B%C3%A9zier_curve#Cubic_B%C3%A9zier_curves). Długość = ∫|B'(u)|du — całka liczona
 * kwadraturą Gaussa–Legendre'a na równych podprzedziałach (https://en.wikipedia.org/wiki/Gauss%E2%80%93Legendre_quadrature);
 * węzły i wagi z pierwiastków wielomianu Legendre'a metodą Newtona (rekurencja Bonneta: (n+1)P(n+1) = (2n+1)xPn − nP(n−1)),
 * bez stałych wpisanych ręcznie. Wzorzec w teście: scripts/gen-intro-corpus.py (Python, łamana z ekstrapolacją Richardsona —
 * inna metoda).
 */
import type { Pt, RibbonPath } from '../config/brand-icon';

export type Cubic = readonly [Pt, Pt, Pt, Pt];

/** Węzły i wagi kwadratury Gaussa–Legendre'a rzędu n na [−1, 1]. */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    // Przybliżenie startowe i-tego pierwiastka (Tricomi), potem Newton do zbieżności w precyzji double.
    let r = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = r;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * r * p1 - (k - 1) * p0) / k];
      dp = (n * (r * p1 - p0)) / (r * r - 1);
      const next = r - p1 / dp;
      const done = Math.abs(next - r) < 1e-16;
      r = next;
      if (done) break;
    }
    x.push(r);
    w.push(2 / ((1 - r * r) * dp * dp));
  }
  return { x, w };
}

const GL = gaussLegendre(16);
/** Podprzedziały całki na jednej krzywej — zapas dokładności dla krzywych o ostrym zakręcie (błąd < 1e-9 jednostki). */
const PIECES = 8;

export function cubicPoint(c: Cubic, u: number): Pt {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const d = 3 * v * u * u;
  const e = u * u * u;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

function speed(c: Cubic, u: number): number {
  const v = 1 - u;
  const a = 3 * v * v;
  const b = 6 * v * u;
  const d = 3 * u * u;
  const dx = a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]);
  const dy = a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1]);
  return Math.hypot(dx, dy);
}

/** Długość łuku krzywej od parametru 0 do u (0 ≤ u ≤ 1). */
export function cubicLength(c: Cubic, u = 1): number {
  let sum = 0;
  for (let k = 0; k < PIECES; k++) {
    const a = (u * k) / PIECES;
    const h = u / PIECES / 2;
    for (let i = 0; i < GL.x.length; i++) sum += GL.w[i]! * h * speed(c, a + h + h * GL.x[i]!);
  }
  return sum;
}

/** Krzywe ścieżki „M start C … C …” jako odcinki Béziera. */
export function cubics(p: RibbonPath): Cubic[] {
  let from = p.start;
  return p.curves.map(([c1, c2, end]) => {
    const seg: Cubic = [from, c1, c2, end];
    from = end;
    return seg;
  });
}

export const pathLength = (p: RibbonPath): number => cubics(p).reduce((s, c) => s + cubicLength(c), 0);

/** Punkt ścieżki w odległości s wzdłuż łuku od początku (s przycinane do [0, długość]). */
export function pointAtLength(p: RibbonPath, s: number): Pt {
  const segs = cubics(p);
  let left = Math.max(0, s);
  for (const [i, c] of segs.entries()) {
    const len = cubicLength(c);
    if (left <= len || i === segs.length - 1) {
      const target = Math.min(left, len);
      // Bisekcja po parametrze: długość rośnie z u (prędkość ≥ 0), 60 kroków = precyzja double.
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        if (cubicLength(c, mid) < target) lo = mid;
        else hi = mid;
      }
      return cubicPoint(c, (lo + hi) / 2);
    }
    left -= len;
  }
  return p.start; // ścieżka bez krzywych: sam punkt startowy
}
