/**
 * Animacja przy zimnym starcie „Splątane i się rozplatają” (decyzja właściciela z 10.10.2026, ADR-0045). Liczby:
 * src/config/intro.ts; klatka w chwili t: src/domain/intro.ts (czysta funkcja, ta sama w wątku UI i w testach); geometria
 * ikony: src/config/brand-icon.ts; podpięcie: src/app/Root.tsx.
 *
 * - Bez mignięcia: ekran startowy iOS (expo-splash-screen, app.json) to kwadrat intro.SPLASH_SIZE pt na środku ekranu
 *   z pierwszą klatką (assets/splash.png = introSvg(0)), na tle motywu SYSTEMU. Nakładka rysuje ten sam kwadrat w tym
 *   samym miejscu, na tym samym tle (motyw systemu z chwili startu — jak ekran startowy, nie z ustawień aplikacji), a jej
 *   pierwsza klatka to klatka 0. Ekran startowy chowamy dopiero intro.HIDE_AFTER_FRAMES klatek po zamontowaniu nakładki
 *   (już narysowanej), a ruch rusza zaraz potem.
 * - Ruch w wątku UI (react-native-reanimated: useAnimatedStyle i useAnimatedProps liczą pozę workletem ribbonPose):
 *   synchroniczne otwarcie bazy, migracje i pierwszy render nawigacji w wątku JS (Root.tsx) go nie przycinają, a dane
 *   ładują się równolegle. Animated z React Native nie umie animować właściwości SVG sterownikiem natywnym
 *   (strokeDashoffset szedłby przez wątek JS) — powód w ADR-0045.
 * - Koniec: ruch trwa INTRO_MOVE_MS; gdy dane gotowe — zniknięcie (intro.FADE_MS); gdy nie — ostatnia klatka (ikona)
 *   zostaje do końca ładowania, najdłużej intro.HOLD_MAX_MS (potem i tak znika — błąd startu nie zostawi ikony na zawsze).
 * - Tapnięcie pomija: od razu ikona, a gdy dane gotowe — od razu aplikacja.
 * - „Ogranicz ruch” (albo brak odpowiedzi systemu w intro.REDUCE_MOTION_WAIT_MS): bez animacji — ekran startowy chowany,
 *   nakładka znika od razu.
 * - VoiceOver: grafika dekoracyjna, ukryta (accessibilityElementsHidden); pominięcie tapnięciem bez elementu dostępności —
 *   animacja trwa ok. 1 s, a treść pod spodem jest w tym czasie ukryta dla VoiceOvera (Root.tsx), więc nie ma czego czytać.
 * `frame` — statyczna klatka w chwili `frame` ms (bez ruchu, bez chowania ekranu startowego): testy i podgląd klatek.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Appearance, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { brandIcon, pathD, splashBackground } from '../config/brand-icon';
import { intro } from '../config/intro';
import type { Scheme } from '../config/theme';
import { INTRO_MOVE_MS, introMode, ribbonLengths, ribbonPose, ribbonProgress } from '../domain/intro';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type IntroProps = {
  /** Dane aplikacji gotowe (albo błąd startu): po ruchu nakładka może zniknąć. */
  ready: boolean;
  onDone: () => void;
  /** Chowa ekran startowy iOS (expo-splash-screen); wywołanie wielokrotne jest bezpieczne. */
  hideSplash: () => void;
  scheme?: Scheme;
  frame?: number;
};

function Ribbon({ i, q, side }: { i: number; q: SharedValue<number>; side: number }) {
  const r = brandIcon.ribbons[i]!;
  const tg = intro.tangles[i]!;
  const total = ribbonLengths[i]!;
  const k = side / brandIcon.VIEWBOX;
  const style = useAnimatedStyle(() => {
    const p = ribbonPose(tg, total, q.value);
    return { transform: [{ translateX: p.translateX * k }, { translateY: p.translateY * k }, { rotate: `${p.rotate}deg` }, { scale: p.scale }] };
  });
  const props = useAnimatedProps(() => {
    const p = ribbonPose(tg, total, q.value);
    return { strokeDasharray: p.dashArray, strokeDashoffset: p.dashOffset };
  });
  return (
    <Animated.View testID={`intro-ribbon-${r.key}`} style={[StyleSheet.absoluteFill, style]}>
      <Svg width={side} height={side} viewBox={`0 0 ${brandIcon.VIEWBOX} ${brandIcon.VIEWBOX}`}>
        <AnimatedPath testID={`intro-path-${r.key}`} d={pathD(r.path)} stroke={r.color} strokeWidth={brandIcon.STROKE_WIDTH} strokeLinecap={brandIcon.LINECAP} fill="none" animatedProps={props} />
      </Svg>
    </Animated.View>
  );
}

export function Intro({ ready, onDone, hideSplash, scheme, frame }: IntroProps) {
  const [sch] = useState<Scheme>(() => scheme ?? (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'));
  const win = useWindowDimensions();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const W = box?.w ?? win.width;
  const H = box?.h ?? win.height;
  const side = intro.SPLASH_SIZE;
  const q0 = brandIcon.ribbons.map((_, i) => ribbonProgress(i, frame ?? 0));
  // Trzy wstążki = stała liczba hooków (kolejność wywołań się nie zmienia).
  const q = [useSharedValue(q0[0]!), useSharedValue(q0[1]!), useSharedValue(q0[2]!)];
  const opacity = useSharedValue(1);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const [moved, setMoved] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [held, setHeld] = useState(false);
  const done = useRef(false);
  const latest = useRef({ onDone, hideSplash });
  useEffect(() => {
    latest.current = { onDone, hideSplash };
  });
  const finish = () => {
    if (done.current) return;
    done.current = true;
    latest.current.hideSplash();
    latest.current.onDone();
  };
  const toEnd = () =>
    q.forEach((v) => {
      cancelAnimation(v);
      v.set(1);
    });

  useEffect(() => {
    if (frame != null) return;
    let alive = true;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    new Promise<boolean | null>((res) => {
      timers.push(setTimeout(() => res(null), intro.REDUCE_MOTION_WAIT_MS));
      AccessibilityInfo.isReduceMotionEnabled().then(
        (v) => res(!!v),
        () => res(null),
      );
    }).then((rm) => {
      if (!alive) return;
      if (introMode(rm) === 'none') return finish();
      let frames = intro.HIDE_AFTER_FRAMES;
      const step = () => {
        if (!alive) return;
        if (--frames > 0) {
          raf = requestAnimationFrame(step);
          return;
        }
        latest.current.hideSplash();
        q.forEach((v, i) => {
          v.set(withDelay(i * intro.STAGGER_MS, withTiming(1, { duration: intro.RIBBON_MS, easing: Easing.linear })));
        });
        // Dokładnie ostatnia klatka (ikona), nawet gdy ruch się spóźnił; potem najdłużej HOLD_MAX_MS czekania na dane.
        timers.push(setTimeout(() => alive && (toEnd(), setMoved(true)), INTRO_MOVE_MS));
        timers.push(setTimeout(() => alive && setHeld(true), intro.HOLD_MAX_MS));
      };
      raf = requestAnimationFrame(step);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (frame != null || !(ready || held) || !(moved || skipped)) return;
    if (skipped) return finish();
    // .set() zamiast przypisania .value (reguły kompilatora Reacta w ESLint): „When working with the React Compiler, you should
    // refrain from accessing and modifying the `value` property directly.” „Instead, use the `get` and `set` methods.”
    // (https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/)
    opacity.set(withTiming(0, { duration: intro.FADE_MS, easing: Easing.linear }));
    const t = setTimeout(finish, intro.FADE_MS);
    return () => clearTimeout(t);
  }, [ready, held, moved, skipped]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => {
    if (frame != null || skipped) return;
    toEnd();
    setSkipped(true);
  };

  return (
    <Animated.View
      testID="intro"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setBox({ w: width, h: height });
      }}
      style={[StyleSheet.absoluteFill, { backgroundColor: splashBackground(sch) }, fade]}
    >
      <Pressable testID="intro-skip" accessible={false} onPressIn={skip} style={StyleSheet.absoluteFill}>
        <View testID="intro-icon" style={{ position: 'absolute', left: (W - side) / 2, top: (H - side) / 2, width: side, height: side }}>
          {q.map((v, i) => (
            <Ribbon key={brandIcon.ribbons[i]!.key} i={i} q={v} side={side} />
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}
