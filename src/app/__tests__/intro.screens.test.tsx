/**
 * Animacja przy starcie „Splątane i się rozplatają” (ADR-0045), komponent src/ui/Intro.tsx: klatki statyczne w obu
 * motywach (= czysta funkcja introFrame i ekran startowy), chowanie ekranu startowego dopiero po zamontowaniu nakładki,
 * czas ok. 1 s, ostatnia klatka do końca ładowania (najdłużej HOLD_MAX_MS), pominięcie tapnięciem, „Ogranicz ruch”
 * i brak odpowiedzi systemu, ukrycie dla VoiceOvera, ruch w wątku UI (style z Reanimated w chwili t = introFrame(t)).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Appearance, processColor, StyleSheet } from 'react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

import { brandIcon, pathD, splashBackground } from '../../config/brand-icon';
import { intro } from '../../config/intro';
import { INTRO_MOVE_MS, introFrame, type Pose } from '../../domain/intro';
import { Intro } from '../../ui/Intro';

setUpTests();

const H_ = { includeHiddenElements: true } as const; // nakładka jest ukryta dla VoiceOvera
const W = 390;
const H = 844;
const side = intro.SPLASH_SIZE;
const k = side / brandIcon.VIEWBOX;
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id, H_).props.style);
const transformOf = (p: Pose) => [{ translateX: p.translateX * k }, { translateY: p.translateY * k }, { rotate: `${p.rotate}deg` }, { scale: p.scale }];
const layout = async () => {
  await act(async () => {
    fireEvent(screen.getByTestId('intro', H_), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } });
  });
};
/** Upływ czasu krokami po 10 ms z obietnicami między nimi (odpowiedź „Ogranicz ruch” przychodzi obietnicą). */
const tick = async (ms: number) => {
  for (let left = ms; ; left -= 10) {
    await act(async () => {
      jest.advanceTimersByTime(Math.max(0, Math.min(10, left)));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    if (left <= 10) break;
  }
};

let rm: jest.SpyInstance;
const raf = globalThis.requestAnimationFrame;
beforeEach(() => {
  jest.useFakeTimers();
  // Zegar klatek jak w atrapie react-native-worklets (performance.now — ten sam, którym Reanimated mierzy start ruchu);
  // jest.app-setup.js zostawia pozostałym testom requestAnimationFrame z presetu React Native (jest.now).
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 0)) as unknown as typeof raf;
  rm = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  globalThis.requestAnimationFrame = raf;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const expectFrame = (t: number) => {
  introFrame(t).poses.forEach((p, i) => {
    const key = brandIcon.ribbons[i]!.key;
    expect(flat(`intro-ribbon-${key}`).transform).toEqual(transformOf(p));
    const path = screen.getByTestId(`intro-path-${key}`, H_).props;
    expect(path.strokeDasharray).toEqual(p.dashArray);
    expect(path.strokeDashoffset).toBe(p.dashOffset);
  });
};

describe('klatki statyczne = introFrame(t) i ekran startowy', () => {
  it.each(['light', 'dark'] as const)('motyw %s: tło motywu, kwadrat ikony na środku jak ekran startowy, wstążki ikony; klatka 0 = nieład', async (s) => {
    const hide = jest.fn();
    await render(<Intro ready={false} onDone={() => {}} hideSplash={hide} scheme={s} frame={0} />);
    await layout();
    expect(flat('intro').backgroundColor).toBe(splashBackground(s));
    expect(flat('intro-icon')).toMatchObject({ position: 'absolute', left: (W - side) / 2, top: (H - side) / 2, width: side, height: side });
    brandIcon.ribbons.forEach((r) => {
      const path = screen.getByTestId(`intro-path-${r.key}`, H_).props;
      // Węzeł natywny RNSVGPath: kolor po processColor, końce jako wyliczenie (react-native-svg: butt 0, round 1, square 2), fill="none" = null.
      expect([path.d, path.stroke, path.strokeWidth, path.strokeLinecap, path.fill]).toEqual([pathD(r.path), { type: 0, payload: processColor(r.color) }, brandIcon.STROKE_WIDTH, 1, null]);
    });
    expectFrame(0);
    await tick(2000);
    expect(hide).not.toHaveBeenCalled(); // klatka statyczna nie chowa ekranu startowego i się nie rusza
    expectFrame(0);
  });

  it.each([150, 300, 600, INTRO_MOVE_MS])('klatka %s ms = introFrame', async (t) => {
    await render(<Intro ready={false} onDone={() => {}} hideSplash={() => {}} scheme="light" frame={t} />);
    expect(flat('intro').backgroundColor).toBe(splashBackground('light'));
    expectFrame(t);
  });

  it('bez wymiarów z onLayout — wymiary okna; motyw systemu z chwili startu (Appearance), nie z ustawień aplikacji', async () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    await render(<Intro ready={false} onDone={() => {}} hideSplash={() => {}} frame={0} />);
    expect(flat('intro').backgroundColor).toBe(splashBackground('dark'));
    fireEvent(screen.getByTestId('intro', H_), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0 } } });
    expect(flat('intro-icon').width).toBe(side);
  });

  it('motyw systemu jasny albo nieznany (null) — jasne tło', async () => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(null);
    await render(<Intro ready={false} onDone={() => {}} hideSplash={() => {}} frame={0} />);
    expect(flat('intro').backgroundColor).toBe(splashBackground('light'));
  });

  it('VoiceOver: grafika ukryta, pominięcie tapnięciem bez elementu dostępności', async () => {
    await render(<Intro ready onDone={() => {}} hideSplash={() => {}} scheme="light" frame={0} />);
    const n = screen.getByTestId('intro', H_);
    expect(n.props.accessibilityElementsHidden).toBe(true);
    expect(n.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('intro-skip', H_).props.accessible).toBe(false);
    expect(screen.queryByTestId('intro')).toBeNull(); // bez includeHiddenElements nie istnieje
  });
});

describe('przebieg', () => {
  it('dane gotowe: ekran startowy schowany dopiero po klatkach nakładki, ruch w wątku UI = introFrame, potem znika ok. 1 s od startu', async () => {
    const done = jest.fn();
    const hide = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={hide} scheme="light" />);
    await layout();
    expect(hide).not.toHaveBeenCalled(); // nakładka zamontowana, ale jeszcze nie narysowana
    await tick(10);
    expect(hide).toHaveBeenCalledTimes(1);
    await tick(300);
    // Styl liczony workletem ribbonPose w Reanimated (w Jest — w wątku JS) ≈ introFrame w tej samej chwili (± klatka).
    const style = getAnimatedStyle(screen.getByTestId('intro-ribbon-blue', H_)) as { transform: { translateX: number }[] };
    const near = [270, 320].map((t) => introFrame(t).poses[0]!.translateX * k);
    expect(style.transform[0]!.translateX).toBeLessThanOrEqual(Math.max(...near) + 1e-9);
    expect(style.transform[0]!.translateX).toBeGreaterThanOrEqual(Math.min(...near) - 1e-9);
    expect(done).not.toHaveBeenCalled();
    await tick(INTRO_MOVE_MS - 300);
    expect(done).not.toHaveBeenCalled();
    await tick(intro.FADE_MS + 30);
    expect(done).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(2); // koniec też chowa (bezpiecznie, gdyby coś poszło nie tak po drodze)
  });

  it('po ruchu dokładnie ostatnia klatka (ikona), także gdy ruch się spóźnił', async () => {
    await render(<Intro ready={false} onDone={() => {}} hideSplash={() => {}} scheme="light" />);
    await tick(INTRO_MOVE_MS + 40);
    brandIcon.ribbons.forEach((r) => {
      const st = getAnimatedStyle(screen.getByTestId(`intro-ribbon-${r.key}`, H_)) as { transform: object[] };
      expect(st.transform).toEqual(transformOf(introFrame(INTRO_MOVE_MS).poses[0]!));
    });
  });

  it('dane ładują się dłużej: ikona zostaje bez pętli, nakładka znika dopiero po załadowaniu (+ zniknięcie)', async () => {
    const done = jest.fn();
    await render(<Intro ready={false} onDone={done} hideSplash={() => {}} scheme="dark" />);
    await tick(intro.TOTAL_MS + 1500);
    expect(done).not.toHaveBeenCalled();
    expect(getAnimatedStyle(screen.getByTestId('intro', H_))).toMatchObject({ opacity: 1 });
    await screen.rerender(<Intro ready onDone={done} hideSplash={() => {}} scheme="dark" />);
    await tick(intro.FADE_MS - 20);
    expect(done).not.toHaveBeenCalled();
    await tick(30);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('dane nie przychodzą wcale (błąd, zawieszone ładowanie): po HOLD_MAX_MS nakładka i tak znika', async () => {
    const done = jest.fn();
    await render(<Intro ready={false} onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(intro.HOLD_MAX_MS - 50);
    expect(done).not.toHaveBeenCalled();
    await tick(intro.FADE_MS + 100);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('tapnięcie pomija: dane gotowe — od razu aplikacja; dane w drodze — od razu ikona, aplikacja zaraz po załadowaniu', async () => {
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(150);
    await act(async () => fireEvent(screen.getByTestId('intro-skip', H_), 'pressIn'));
    await tick(0);
    expect(done).toHaveBeenCalledTimes(1);
    await screen.unmount();

    const d2 = jest.fn();
    await render(<Intro ready={false} onDone={d2} hideSplash={() => {}} scheme="light" />);
    await tick(150);
    await act(async () => fireEvent(screen.getByTestId('intro-skip', H_), 'pressIn'));
    await act(async () => fireEvent(screen.getByTestId('intro-skip', H_), 'pressIn')); // drugie tapnięcie nic nie zmienia
    await tick(0);
    expect(d2).not.toHaveBeenCalled();
    brandIcon.ribbons.forEach((r) => {
      const st = getAnimatedStyle(screen.getByTestId(`intro-ribbon-${r.key}`, H_)) as { transform: object[] };
      expect(st.transform).toEqual(transformOf(introFrame(INTRO_MOVE_MS).poses[0]!));
    });
    await screen.rerender(<Intro ready onDone={d2} hideSplash={() => {}} scheme="light" />);
    await tick(0);
    expect(d2).toHaveBeenCalledTimes(1);
  });

  it('tapnięcie w klatce statycznej nic nie robi', async () => {
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" frame={100} />);
    await act(async () => fireEvent(screen.getByTestId('intro-skip', H_), 'pressIn'));
    await tick(100);
    expect(done).not.toHaveBeenCalled();
    expectFrame(100);
  });

  it('„Ogranicz ruch”: bez animacji — od razu ekran startowy schowany i koniec', async () => {
    rm.mockResolvedValue(true);
    const done = jest.fn();
    const hide = jest.fn();
    await render(<Intro ready={false} onDone={done} hideSplash={hide} scheme="light" />);
    await tick(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('system nie odpowiada o „Ogranicz ruch”: po REDUCE_MOTION_WAIT_MS bez animacji (nie wisi na ekranie)', async () => {
    rm.mockReturnValue(new Promise(() => {}));
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(intro.REDUCE_MOTION_WAIT_MS - 10);
    expect(done).not.toHaveBeenCalled();
    await tick(20);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('błąd odpowiedzi o „Ogranicz ruch” = brak odpowiedzi: bez animacji', async () => {
    rm.mockRejectedValue(new Error('x'));
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('odmontowanie w trakcie (np. zmiana konta): nic nie woła po odmontowaniu', async () => {
    const done = jest.fn();
    const hide = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={hide} scheme="light" />);
    await screen.unmount();
    await tick(intro.HOLD_MAX_MS + 500);
    expect(done).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('odmontowanie przed odpowiedzią o „Ogranicz ruch”: spóźniona odpowiedź niczego nie uruchamia', async () => {
    let answer!: (v: boolean) => void;
    rm.mockReturnValue(new Promise<boolean>((r) => (answer = r)));
    const done = jest.fn();
    const hide = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={hide} scheme="light" />);
    await screen.unmount();
    await act(async () => answer(false));
    await tick(intro.HOLD_MAX_MS + 500);
    expect([done.mock.calls.length, hide.mock.calls.length]).toEqual([0, 0]);
  });

  it('odmontowanie między odpowiedzią a pierwszą klatką: ekran startowy nie jest chowany przez odmontowaną nakładkę', async () => {
    let answer!: (v: boolean) => void;
    rm.mockReturnValue(new Promise<boolean>((r) => (answer = r)));
    const hide = jest.fn();
    await render(<Intro ready onDone={() => {}} hideSplash={hide} scheme="light" />);
    let frames: (() => void)[] = [];
    globalThis.requestAnimationFrame = ((cb: () => void) => (frames.push(cb), frames.length)) as unknown as typeof raf;
    await act(async () => answer(false));
    expect(frames).toHaveLength(1);
    const pending = frames;
    frames = [];
    await screen.unmount();
    pending.forEach((f) => f()); // klatka, którą system i tak dostarczy po odmontowaniu
    expect(hide).not.toHaveBeenCalled();
  });

  it('koniec tylko raz: tapnięcie po zniknięciu nie woła onDone drugi raz', async () => {
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(intro.TOTAL_MS + 50);
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent(screen.getByTestId('intro-skip', H_), 'pressIn'));
    await tick(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('odmontowanie w trakcie ruchu: liczniki czasu zatrzymane', async () => {
    const done = jest.fn();
    await render(<Intro ready onDone={done} hideSplash={() => {}} scheme="light" />);
    await tick(100);
    await screen.unmount();
    await tick(intro.HOLD_MAX_MS + 500);
    expect(done).not.toHaveBeenCalled();
  });
});
