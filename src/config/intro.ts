/**
 * Animacja przy starcie „Splątane i się rozplatają” (decyzja właściciela z 10.10.2026, ADR-0045): na ekranie startowym
 * trzy wstążki ikony leżą jako krótkie, splątane kawałki; w locie na swoje miejsce każda wydłuża się do pełnej długości
 * i wplata w „O” ikony — kolejno niebieska, pomarańczowa, terakota. Nieład w porządek. Układ startowy zawsze ten sam
 * (bez losowania), a ekran startowy iOS (assets/splash*.png, scripts/brand/splash.mjs) pokazuje dokładnie pierwszą klatkę.
 *
 * Jedyne źródło liczb animacji. Klatkę w chwili t liczy czysta funkcja src/domain/intro.ts; rysunek src/ui/Intro.tsx,
 * podpięcie src/app/Root.tsx. Czasy i układ to wybory projektowe (bez źródła zewnętrznego) w granicach warunków
 * właściciela: ok. 1 s razem ze zniknięciem, tylko zimny start, tapnięcie pomija, „Ogranicz ruch” = bez animacji.
 */
export type Tangle = {
  /** Gdzie na ścieżce zaczyna się krótki kawałek (ułamek długości łuku od początku ścieżki). */
  readonly from: number;
  /** Długość kawałka jako ułamek długości ścieżki (0 < length ≤ 1; zero dałoby kropkę z zaokrąglonych końców). */
  readonly length: number;
  /** Przesunięcie (jednostki viewBox ikony), obrót (stopnie, zgodnie z ruchem wskazówek zegara) i skala wokół środka ikony. */
  readonly dx: number;
  readonly dy: number;
  readonly rotate: number;
  readonly scale: number;
};

export const intro = {
  /** Cała animacja razem ze zniknięciem nakładki (warunek właściciela: ok. 1 s). */
  TOTAL_MS: 1000,
  /** Zniknięcie nakładki (przejście do aplikacji). */
  FADE_MS: 150,
  /** Lot jednej wstążki z nieładu na miejsce. */
  RIBBON_MS: 550,
  /** Odstęp startu kolejnych wstążek (niebieska, pomarańczowa, terakota). */
  STAGGER_MS: 150,
  /**
   * Ile najdłużej czekać na odpowiedź „Ogranicz ruch” (AccessibilityInfo.isReduceMotionEnabled); brak odpowiedzi = bez
   * animacji — ruch tylko wtedy, gdy wiadomo, że wolno.
   */
  REDUCE_MOTION_WAIT_MS: 300,
  /**
   * Ile najdłużej ostatnia klatka (ikona) czeka na gotowe dane; potem nakładka i tak znika i widać to, co pod nią
   * (ładowanie albo komunikat błędu) — błąd albo zawieszone ładowanie nie zostawi ikony na zawsze.
   */
  HOLD_MAX_MS: 4000,
  /**
   * Bok kwadratu ikony na ekranie startowym (pt) = `imageWidth` wtyczki expo-splash-screen w app.json. Wtyczka (SDK 57,
   * plugin/build/InterfaceBuilder.js) stawia obraz o tym boku na środku ekranu (więzy centerX/centerY), więc nakładka
   * rysuje ten sam kwadrat w tym samym miejscu; 260 pt = 1 jednostka viewBox na 1 pt i mieści się na najwęższym iPhonie.
   */
  SPLASH_SIZE: 260,
  /** Klatki ekranu (requestAnimationFrame) między zamontowaniem nakładki a schowaniem ekranu startowego — nakładka już narysowana. */
  HIDE_AFTER_FRAMES: 2,
  /**
   * Układ startowy (pierwsza klatka = ekran startowy), w kolejności brandIcon.ribbons. Dobrany tak, żeby kawałki się
   * krzyżowały blisko środka i mieściły w kwadracie ikony (test: cała klatka w viewBox).
   */
  tangles: [
    { from: 0.36, length: 0.3, dx: 30, dy: 41, rotate: -70, scale: 1 },
    { from: 0.2, length: 0.55, dx: 54, dy: -77, rotate: 40, scale: 1 },
    { from: 0.05, length: 0.9, dx: -49, dy: -15, rotate: -120, scale: 1 },
  ] as const satisfies readonly Tangle[],
} as const;
