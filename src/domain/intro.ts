/**
 * Animacja przy starcie „Splątane i się rozplatają” (ADR-0045) — klatka w chwili t jako czysta funkcja. Liczby:
 * src/config/intro.ts, geometria ikony: src/config/brand-icon.ts; rysunek: src/ui/Intro.tsx.
 *
 * Model jednej wstążki (postęp po krzywej e: 0 = nieład z ekranu startowego, 1 = miejsce na ikonie):
 *  - widoczny kawałek ścieżki [a, a + v] w długości łuku: a = from·P·(1−e), v = length·P + (P − length·P)·e — kawałek
 *    wydłuża się do pełnej ścieżki P; rysowany kreską strokeDasharray [v, przerwa] i strokeDashoffset, przerwa 2P (dłuższa
 *    niż ścieżka, więc widać dokładnie jeden kawałek, bez kropki z zaokrąglonych końców poprzedniej kreski);
 *  - przesunięcie, obrót i skala wokół środka ikony maleją do tożsamości: (dx, dy)·(1−e), rotate·(1−e), 1 + (scale−1)(1−e).
 *    Kolejność jak w transform React Native [translateX, translateY, rotate, scale] wokół środka widoku:
 *    p' = c + t + R(θ)·s·(p − c) (https://reactnative.dev/docs/transforms; SVG: translate · rotate · scale).
 *
 * `ribbonPose` i `easeInOutCubic` są workletami ('worklet'): src/ui/Intro.tsx liczy nimi klatki w wątku UI
 * (react-native-reanimated useAnimatedProps), a testy i ekran startowy — tymi samymi funkcjami w JS.
 */
import { brandIcon, type Pt, pathD } from '../config/brand-icon';
import { intro, type Tangle } from '../config/intro';
import { pathLength } from './bezier';

/** Koniec ruchu = ostatnia klatka (ikona); potem zniknięcie, gdy dane są gotowe. */
export const INTRO_MOVE_MS = intro.TOTAL_MS - intro.FADE_MS;

/** Długości łuku ścieżek wstążek (jednostki viewBox), w kolejności brandIcon.ribbons. */
export const ribbonLengths: readonly number[] = brandIcon.ribbons.map((r) => pathLength(r.path));

/** Wygaszenie ruchu: ta sama krzywa co Easing.inOut(Easing.cubic) (React Native i Reanimated — test porównuje). */
export function easeInOutCubic(q: number): number {
  'worklet';
  return q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
}

/** Postęp liniowy wstążki nr i (0…1) w chwili t ms od startu ruchu. */
export function ribbonProgress(i: number, t: number): number {
  return Math.min(1, Math.max(0, (t - i * intro.STAGGER_MS) / intro.RIBBON_MS));
}

export type Pose = {
  translateX: number;
  translateY: number;
  /** Stopnie. */
  rotate: number;
  scale: number;
  dashArray: [number, number];
  dashOffset: number;
};

/** Położenie i widoczny kawałek wstążki o długości `total` przy postępie liniowym q (0…1). */
export function ribbonPose(tg: Tangle, total: number, q: number): Pose {
  'worklet';
  const e = easeInOutCubic(q);
  const f = 1 - e;
  const start = tg.from * total * f;
  const visible = tg.length * total + (total - tg.length * total) * e;
  const gap = 2 * total;
  return {
    translateX: tg.dx * f + 0, // + 0: bez „−0” przy ujemnym przesunięciu na końcu ruchu
    translateY: tg.dy * f + 0,
    rotate: tg.rotate * f + 0,
    scale: 1 + (tg.scale - 1) * f,
    dashArray: [visible, gap],
    // Kreska zaczyna się w punkcie −offset wzorca; offset dodatni (wzorzec − start), bez ujemnego przesunięcia fazy.
    dashOffset: visible + gap - start,
  };
}

/** Klatka w chwili t ms: pozy wstążek i krycie nakładki (1 → 0 w czasie zniknięcia). */
export function introFrame(t: number): { poses: Pose[]; opacity: number } {
  const poses = intro.tangles.map((tg, i) => ribbonPose(tg, ribbonLengths[i]!, ribbonProgress(i, t)));
  const opacity = t <= INTRO_MOVE_MS ? 1 : Math.max(0, 1 - (t - INTRO_MOVE_MS) / intro.FADE_MS);
  return { poses, opacity };
}

/** Punkt p (jednostki viewBox) po przekształceniu pozy wokół środka ikony. */
export function posePoint(pose: Pose, p: Pt): Pt {
  const c = brandIcon.VIEWBOX / 2;
  const th = (pose.rotate * Math.PI) / 180;
  const x = (p[0] - c) * pose.scale;
  const y = (p[1] - c) * pose.scale;
  return [c + pose.translateX + x * Math.cos(th) - y * Math.sin(th), c + pose.translateY + x * Math.sin(th) + y * Math.cos(th)];
}

/** Czy pokazać animację: tylko gdy system odpowiedział, że „Ogranicz ruch” jest wyłączone; null = brak odpowiedzi. */
export const INTRO_MODES = ['animate', 'none'] as const;
export type IntroMode = (typeof INTRO_MODES)[number];
export const introMode = (reduceMotion: boolean | null): IntroMode => (reduceMotion === false ? 'animate' : 'none');

/**
 * Zimny start: animacja raz na proces JS. Powrót z tła nie montuje korzenia od nowa, a gdyby (np. ponowne zamontowanie)
 * — flaga już zużyta. Proces uruchomiony w tle (system budzi aplikację cichym powiadomieniem, AppState 'background')
 * zużywa flagę bez animacji — nikt jej nie widzi. Przy zwykłym starcie iOS stan to 'inactive' albo 'active'
 * (https://reactnative.dev/docs/appstate).
 */
export function coldStartGate(): (appState: string | null | undefined) => boolean {
  let used = false;
  return (appState) => {
    if (used) return false;
    used = true;
    return appState !== 'background';
  };
}

const n = (v: number) => String(Math.round(v * 1e4) / 1e4);

/**
 * Klatka w chwili t jako plik SVG (kwadrat viewBox ikony, przezroczyste tło — tło motywu daje app.json, kolory wstążek są
 * te same w obu motywach): ekran startowy iOS to klatka 0 (assets/brand/splash.svg → scripts/brand/splash.mjs →
 * assets/splash.png). Atrybuty jak w src/ui/Intro.tsx.
 */
export function introSvg(t = 0): string {
  const { poses } = introFrame(t);
  const c = brandIcon.VIEWBOX / 2;
  const paths = brandIcon.ribbons.map((r, i) => {
    const p = poses[i]!;
    const transform = `translate(${n(c + p.translateX)} ${n(c + p.translateY)}) rotate(${n(p.rotate)}) scale(${n(p.scale)}) translate(${-c} ${-c})`;
    return `  <path d="${pathD(r.path)}" stroke="${r.color}" stroke-width="${brandIcon.STROKE_WIDTH}" fill="none" stroke-linecap="${brandIcon.LINECAP}" stroke-dasharray="${n(p.dashArray[0])} ${n(p.dashArray[1])}" stroke-dashoffset="${n(p.dashOffset)}" transform="${transform}"/>`;
  });
  const size = brandIcon.VIEWBOX;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 ${size} ${size}">`,
    `  <!-- Ekran startowy iOS (tło jasne i ciemne z app.json): klatka ${n(t)} ms animacji „Splątane i się rozplatają” (ADR-0045). Plik generowany: src/domain/intro.ts introSvg. -->`,
    ...paths,
    '</svg>',
    '',
  ].join('\n');
}
