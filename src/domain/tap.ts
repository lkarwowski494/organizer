/**
 * Dotknięcie czy przeciągnięcie (ADR 0049). Przycisk w systemie iOS wykonuje akcję przy puszczeniu palca w jego obrębie
 * i nie wykonuje jej po przeciągnięciu; React Native domyślnie pozwala jeszcze na ruch w marginesie wokół przycisku
 * (https://reactnative.dev/docs/0.86/pressable#pressretentionoffset — „default is 20 / 30 pt”), więc na wysokim pasku
 * (duży tekst) przeciągnięcie zaczęte i skończone na nim liczyło się jako dotknięcie.
 */
export type Point = { x: number; y: number };

/** `true`, gdy ruch od `start` do `end` nie przekroczył `slop` punktów (odległość euklidesowa). Bez punktu początkowego — dotknięcie. */
export function isTap(start: Point | null, end: Point | null, slop: number): boolean {
  if (!start || !end) return true;
  return Math.hypot(end.x - start.x, end.y - start.y) <= slop;
}
