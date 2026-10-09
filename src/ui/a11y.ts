/**
 * Wspólne klocki VoiceOvera (audyt 2: M-37, M-44, M-269; D194): ogłoszenia, stan czytnika i przenoszenie fokusu.
 * Jedno miejsce, żeby każdy ekran ogłaszał i przenosił fokus tak samo.
 *
 * AccessibilityInfo w React Native 0.86 (SDK 57), https://reactnative.dev/docs/0.86/accessibilityinfo:
 *  - „announceForAccessibilityWithOptions … queue: The announcement will be queued behind existing announcements. iOS
 *    only.” — ogłoszenie nie przerywa tego, co VoiceOver właśnie czyta (np. nazwy dotkniętego przycisku);
 *  - „isScreenReaderEnabled() … resolves to a boolean”, zdarzenie „screenReaderChanged … The argument to the event
 *    handler is a boolean”;
 *  - „sendAccessibilityEvent … like changing the focused element for a screen reader” (zamiast setAccessibilityFocus,
 *    które wymaga numeru widoku).
 * Na iOS `accessibilityLiveRegion` i rola „alert” niczego nie ogłaszają
 * (https://reactnative.dev/docs/0.86/accessibility#accessibilityliveregion-android — „Android”), więc ogłaszamy wprost.
 */
import { type RefObject, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';

type Target = Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0];

/** Ogłoszenie VoiceOvera w kolejce (bez przerywania bieżącej wypowiedzi). Pusty tekst — nic. */
export function announce(text: string | null | undefined): void {
  if (text) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
}

/** Czy działa czytnik ekranu (VoiceOver); śledzi włączanie i wyłączanie w trakcie. */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => live && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => setOn(v));
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * Cel, który ma pierwszeństwo przed tytułem ekranu (pasek „Cofnij”, D194): pasek pokazany tuż przed przejściem na inny
 * ekran (np. usunięcie z ekranu zadania i powrót) nie traci fokusu na rzecz tytułu nowego ekranu.
 */
let pinned: { focus: () => () => void; at: number } | null = null;

/** Pasek ustawia (fokus na sobie, zwraca odwołanie) i zdejmuje (null) cel pierwszeństwa. */
export function pinFocus(focus: (() => () => void) | null, nowMs: number = Date.now()): void {
  pinned = focus ? { focus, at: nowMs } : null;
}

/**
 * Przeniesienie fokusu VoiceOvera na element po config.a11y.FOCUS_DELAY_MS (widok musi już być na ekranie).
 * Zwraca funkcję odwołującą (np. przy odmontowaniu).
 */
export function focusLater(ref: RefObject<unknown>): () => void {
  const t = setTimeout(() => {
    if (ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current as Target, 'focus');
  }, config.a11y.FOCUS_DELAY_MS);
  return () => clearTimeout(t);
}

/**
 * Fokus na tytule po wejściu na ekran (M-269), chyba że przed chwilą (config.a11y.PIN_MS) pojawił się pasek „Cofnij” —
 * wtedy fokus wraca na pasek.
 */
export function focusScreenTitle(ref: RefObject<unknown>, nowMs: number = Date.now()): () => void {
  if (pinned && nowMs - pinned.at <= config.a11y.PIN_MS) return pinned.focus();
  return focusLater(ref);
}

/**
 * Fokus VoiceOvera na elemencie z `ref` po jego pojawieniu się i przy każdej zmianie `key` (M-44): nagłówek panelu,
 * który zastępuje przycisk (przycisk z fokusem znika, a iOS przenosi wtedy fokus na początek ekranu), nowy krok
 * w Pierwszych krokach. `active=false` — bez przenoszenia.
 */
export function useA11yFocus<T>(key: unknown = null, active = true): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => (active ? focusLater(ref) : undefined), [key, active]);
  return ref;
}

/**
 * Dopisek wiersza (termin, długość, postęp, zadanie nadrzędne) w wersji do czytania przez VoiceOver (audyt 2, M-263):
 * symbole z widoku zamienione na słowa — „↳ Zakupy” → „podzadanie: Zakupy”, „2/3 zrobione” → „2 z 3 zrobione”,
 * „1 h 30 min” → „1 godzina 30 minut”, separator „·” → przecinek. Tylko dla dopisków budowanych przez aplikację
 * (strings.pl.ts, domain/format.ts), nie dla tytułów wpisanych przez ludzi. Jak polski VoiceOver czyta „↳” i „h” —
 * do sprawdzenia na iPhonie (audyt 2, A-42); słowa są czytane zawsze tak samo.
 */
export function spoken(text: string): string {
  return text
    .replace(/↳ /g, strings['spoken.parent'])
    .replace(/(\d+)\/(\d+) zrobione/g, (_, d: string, t: string) => strings['spoken.progress'](Number(d), Number(t)))
    .replace(/(\d+) h\b/g, (_, n: string) => strings['spoken.hours'](Number(n)))
    .replace(/(\d+) min\b/g, (_, n: string) => strings['spoken.minutes'](Number(n)))
    .replace(/\s+·\s+/g, ', ');
}
