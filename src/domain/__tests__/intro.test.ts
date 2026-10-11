import * as fc from 'fast-check';

import { brandIcon, pathD } from '../../config/brand-icon';
import { intro, type Tangle } from '../../config/intro';
import { pathLength, pointAtLength } from '../bezier';
import { coldStartGate, easeInOutCubic, INTRO_MODES, INTRO_MOVE_MS, introFrame, introMode, introSvg, posePoint, ribbonLengths, ribbonPose, ribbonProgress } from '../intro';
import corpus from './fixtures/intro.json';

const N = brandIcon.ribbons.length;

describe('animacja przy starcie: czasy (ADR-0045)', () => {
  it('ok. 1 s razem ze zniknięciem; ostatnia wstążka na miejscu dokładnie z końcem ruchu; kolejność niebieska → pomarańczowa → terakota', () => {
    expect(intro.TOTAL_MS).toBeGreaterThanOrEqual(800);
    expect(intro.TOTAL_MS).toBeLessThanOrEqual(1100);
    expect(INTRO_MOVE_MS).toBe(intro.TOTAL_MS - intro.FADE_MS);
    expect((N - 1) * intro.STAGGER_MS + intro.RIBBON_MS).toBe(INTRO_MOVE_MS);
    expect(brandIcon.ribbons.map((r) => r.key)).toEqual(['blue', 'orange', 'terracotta']);
    expect(intro.tangles).toHaveLength(N);
    expect(intro.REDUCE_MOTION_WAIT_MS).toBeLessThanOrEqual(500);
    expect(intro.HOLD_MAX_MS).toBeGreaterThan(intro.TOTAL_MS);
  });

  it('postęp wstążki: 0 przed jej startem, liniowo w czasie lotu, 1 po końcu; każda startuje STAGGER_MS po poprzedniej', () => {
    expect(ribbonProgress(0, -10)).toBe(0);
    expect(ribbonProgress(0, 0)).toBe(0);
    expect(ribbonProgress(0, intro.RIBBON_MS / 2)).toBe(0.5);
    expect(ribbonProgress(0, intro.RIBBON_MS)).toBe(1);
    expect(ribbonProgress(0, intro.RIBBON_MS + 1)).toBe(1);
    expect(ribbonProgress(1, intro.STAGGER_MS)).toBe(0);
    expect(ribbonProgress(1, intro.STAGGER_MS + intro.RIBBON_MS / 4)).toBe(0.25);
    expect(ribbonProgress(2, 2 * intro.STAGGER_MS + intro.RIBBON_MS)).toBe(1);
  });

  it('wygaszenie: easeInOutCubic = wzór Easing.inOut(Easing.cubic) (korpus Python) — 0, ½ i 1 na miejscu, rosnące', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBe(0.0625);
    expect(easeInOutCubic(0.75)).toBe(0.9375);
    for (const f of corpus.frames) f.ribbons.forEach((r) => expect(easeInOutCubic(r.q)).toBeCloseTo(r.eased, 9));
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => expect(easeInOutCubic(Math.min(a, b))).toBeLessThanOrEqual(easeInOutCubic(Math.max(a, b)))));
  });

  it('opacity: 1 do końca ruchu, potem liniowo do 0 w FADE_MS', () => {
    expect(introFrame(0).opacity).toBe(1);
    expect(introFrame(INTRO_MOVE_MS).opacity).toBe(1);
    expect(introFrame(INTRO_MOVE_MS + intro.FADE_MS / 2).opacity).toBe(0.5);
    expect(introFrame(intro.TOTAL_MS).opacity).toBe(0);
    expect(introFrame(intro.TOTAL_MS + 500).opacity).toBe(0);
  });
});

describe('klatki = niezależna implementacja (scripts/gen-intro-corpus.py: łamana, macierze SVG, Easing z React Native)', () => {
  it.each(corpus.frames.map((f) => [f.t, f]))('t = %s ms', (t, f) => {
    const frame = introFrame(t as number);
    expect(frame.opacity).toBeCloseTo(f.opacity, 9);
    brandIcon.ribbons.forEach((r, i) => {
      const pose = frame.poses[i]!;
      const row = f.ribbons[i]!;
      const total = ribbonLengths[i]!;
      expect(ribbonProgress(i, t as number)).toBeCloseTo(row.q, 9);
      // Widoczny kawałek [start, start + visible] z kreski: dash = visible, kreska zaczyna się w (wzorzec − offset).
      expect(pose.dashArray[0]).toBeCloseTo(row.visible, 5);
      expect(pose.dashArray[0] + pose.dashArray[1] - pose.dashOffset).toBeCloseTo(row.start, 5);
      [row.start, row.start + row.visible / 2, row.start + row.visible].forEach((s, j) => {
        const [x, y] = posePoint(pose, pointAtLength(r.path, Math.min(s, total)));
        expect(x).toBeCloseTo(row.points[j]![0]!, 3);
        expect(y).toBeCloseTo(row.points[j]![1]!, 3);
      });
    });
  });

  it('korpus obejmuje chwilę przed startem, całą animację i czas po zniknięciu', () => {
    const ts = corpus.frames.map((f) => f.t);
    expect(Math.min(...ts)).toBeLessThan(0);
    expect(Math.max(...ts)).toBeGreaterThan(intro.TOTAL_MS);
    expect(corpus.viewBox).toBe(brandIcon.VIEWBOX);
    expect(corpus.strokeWidth).toBe(brandIcon.STROKE_WIDTH);
  });
});

describe('nieład w porządek', () => {
  it('pierwsza klatka: krótkie kawałki (nie kropki), przesunięte i obrócone; ostatnia = ikona (pełne ścieżki bez przekształcenia)', () => {
    const first = introFrame(0).poses;
    first.forEach((p, i) => {
      const tg = intro.tangles[i]!;
      expect(p.dashArray[0]).toBeCloseTo(tg.length * ribbonLengths[i]!, 10);
      expect(p.dashArray[0]).toBeGreaterThanOrEqual(brandIcon.STROKE_WIDTH); // kawałek, nie kropka
      expect(tg.length).toBeLessThan(1);
      expect(Math.hypot(p.translateX, p.translateY) + Math.abs(p.rotate)).toBeGreaterThan(30);
    });
    for (const t of [INTRO_MOVE_MS, intro.TOTAL_MS, intro.TOTAL_MS * 3]) {
      introFrame(t).poses.forEach((p, i) => {
        expect(p).toEqual({ translateX: 0, translateY: 0, rotate: 0, scale: 1, dashArray: [ribbonLengths[i], 2 * ribbonLengths[i]!], dashOffset: 3 * ribbonLengths[i]! });
      });
    }
  });

  it('w każdej chwili każda wstążka mieści się w kwadracie ikony (z połową grubości) — ekran startowy niczego nie ucina', () => {
    for (let t = 0; t <= intro.TOTAL_MS; t += 25) {
      introFrame(t).poses.forEach((p, i) => {
        const r = brandIcon.ribbons[i]!;
        const start = p.dashArray[0] + p.dashArray[1] - p.dashOffset;
        for (let k = 0; k <= 16; k++) {
          const [x, y] = posePoint(p, pointAtLength(r.path, start + (p.dashArray[0] * k) / 16));
          const half = (brandIcon.STROKE_WIDTH * p.scale) / 2;
          expect(Math.min(x, y) - half).toBeGreaterThanOrEqual(0);
          expect(Math.max(x, y) + half).toBeLessThanOrEqual(brandIcon.VIEWBOX);
        }
      });
    }
  });

  it('kawałki splątane: na pierwszej klatce każde dwa kawałki się przecinają (odległość osi < grubość)', () => {
    const pts = introFrame(0).poses.map((p, i) => {
      const r = brandIcon.ribbons[i]!;
      const start = p.dashArray[0] + p.dashArray[1] - p.dashOffset;
      return Array.from({ length: 21 }, (_, k) => posePoint(p, pointAtLength(r.path, start + (p.dashArray[0] * k) / 20)));
    });
    for (let a = 0; a < N; a++)
      for (let b = a + 1; b < N; b++) {
        const d = Math.min(...pts[a]!.flatMap((p) => pts[b]!.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
        expect(d).toBeLessThan(brandIcon.STROKE_WIDTH);
      }
  });

  it('ruch bez cofania: kawałek tylko się wydłuża, przesunięcie i obrót tylko maleją (bez pętli)', () => {
    let prev = introFrame(0).poses;
    for (let t = 5; t <= intro.TOTAL_MS; t += 5) {
      const cur = introFrame(t).poses;
      cur.forEach((p, i) => {
        const q = prev[i]!;
        expect(p.dashArray[0]).toBeGreaterThanOrEqual(q.dashArray[0] - 1e-9);
        expect(Math.abs(p.rotate)).toBeLessThanOrEqual(Math.abs(q.rotate) + 1e-9);
        expect(Math.hypot(p.translateX, p.translateY)).toBeLessThanOrEqual(Math.hypot(q.translateX, q.translateY) + 1e-9);
      });
      prev = cur;
    }
  });

  it('ribbonPose na dowolnym układzie: skala i przesunięcie maleją do tożsamości po krzywej, kreska od from do pełnej długości', () => {
    const tg: Tangle = { from: 0.5, length: 0.2, dx: 10, dy: -20, rotate: 90, scale: 0.5 };
    expect(ribbonPose(tg, 100, 0)).toEqual({ translateX: 10, translateY: -20, rotate: 90, scale: 0.5, dashArray: [20, 200], dashOffset: 170 });
    expect(ribbonPose(tg, 100, 0.5)).toEqual({ translateX: 5, translateY: -10, rotate: 45, scale: 0.75, dashArray: [60, 200], dashOffset: 235 });
    expect(ribbonPose(tg, 100, 1)).toEqual({ translateX: 0, translateY: 0, rotate: 0, scale: 1, dashArray: [100, 200], dashOffset: 300 });
    expect(ribbonPose(tg, 100, 0.25).scale).toBeCloseTo(1 - 0.5 * (1 - 0.0625), 12);
  });

  it('posePoint: obrót o 90° wokół środka ikony, skala i przesunięcie', () => {
    const id = { translateX: 0, translateY: 0, rotate: 0, scale: 1, dashArray: [1, 1] as [number, number], dashOffset: 0 };
    expect(posePoint(id, [10, 20])).toEqual([10, 20]);
    const c = brandIcon.VIEWBOX / 2;
    const [x, y] = posePoint({ ...id, rotate: 90 }, [c + 10, c]);
    expect([x, y]).toEqual([expect.closeTo(c, 10), expect.closeTo(c + 10, 10)]); // zgodnie z ruchem wskazówek zegara (oś y w dół)
    expect(posePoint({ ...id, scale: 2, translateX: 3, translateY: -4 }, [c + 10, c + 5])).toEqual([c + 23, c + 6]);
  });
});

describe('ekran startowy = pierwsza klatka (SVG)', () => {
  it('introSvg: trzy ścieżki ikony w kolejności i kolorach ikony, z kreską i przekształceniem klatki 0', () => {
    const svg = introSvg();
    expect(svg).toContain(`viewBox="0 0 ${brandIcon.VIEWBOX} ${brandIcon.VIEWBOX}"`);
    expect(svg).toContain('klatka 0 ms');
    const paths = [...svg.matchAll(/<path ([^>]*)\/>/g)].map((m) => Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));
    expect(paths).toHaveLength(N);
    const first = introFrame(0).poses;
    paths.forEach((p, i) => {
      const r = brandIcon.ribbons[i]!;
      const pose = first[i]!;
      expect(p).toEqual({
        d: pathD(r.path),
        stroke: r.color,
        'stroke-width': String(brandIcon.STROKE_WIDTH),
        fill: 'none',
        'stroke-linecap': 'round',
        'stroke-dasharray': `${Math.round(pose.dashArray[0] * 1e4) / 1e4} ${Math.round(pose.dashArray[1] * 1e4) / 1e4}`,
        'stroke-dashoffset': String(Math.round(pose.dashOffset * 1e4) / 1e4),
        transform: `translate(${Math.round((130 + pose.translateX) * 1e4) / 1e4} ${Math.round((130 + pose.translateY) * 1e4) / 1e4}) rotate(${pose.rotate}) scale(${pose.scale}) translate(-130 -130)`,
      });
    });
    expect(introSvg(INTRO_MOVE_MS)).toContain(`klatka ${INTRO_MOVE_MS} ms`);
    expect(introSvg(INTRO_MOVE_MS)).toContain('rotate(0) scale(1)');
    expect(svg.endsWith('</svg>\n')).toBe(true);
  });

  it('długości ścieżek policzone raz, z geometrii ikony', () => {
    expect(ribbonLengths).toEqual(brandIcon.ribbons.map((r) => pathLength(r.path)));
  });
});

describe('kiedy animacja (zimny start, „Ogranicz ruch”)', () => {
  it('„Ogranicz ruch”: animacja tylko, gdy system odpowiedział „wyłączone”; włączone albo brak odpowiedzi = bez', () => {
    expect(introMode(false)).toBe('animate');
    expect(introMode(true)).toBe('none');
    expect(introMode(null)).toBe('none');
    expect(INTRO_MODES).toEqual(['animate', 'none']);
  });

  it('zimny start: raz na proces; powrót z tła i ponowne zamontowanie — bez; proces obudzony w tle zużywa flagę bez animacji', () => {
    const a = coldStartGate();
    expect(a('active')).toBe(true);
    expect(a('active')).toBe(false);
    expect(a('inactive')).toBe(false);
    expect(coldStartGate()('inactive')).toBe(true);
    expect(coldStartGate()(undefined)).toBe(true);
    expect(coldStartGate()(null)).toBe(true);
    const b = coldStartGate();
    expect(b('background')).toBe(false);
    expect(b('active')).toBe(false);
  });
});
