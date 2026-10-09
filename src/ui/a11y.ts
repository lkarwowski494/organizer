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
import { AccessibilityInfo, type AccessibilityState } from 'react-native';

import { config } from '../config';
import { WEEKDAYS_ABBREVIATED, WEEKDAYS_NOMINATIVE } from '../config/calendar.pl';
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
 * Panel w miejscu, który się zamknął (audyt 3, N-62): przycisk z fokusem w panelu znika, a iOS przenosi wtedy fokus na
 * początek ekranu (ADR 0039, M-44 — fokus przechodził tylko DO panelu). Element, który wraca na miejsce panelu (przycisk,
 * który go otworzył, pole z nową wartością), dostaje fokus przez `a11yFocus` / useA11yFocus. `open` — co jest otwarte
 * (null albo false — nic); wynik — ostatnio otwarte, dopóki nic nie jest otwarte; przy otwartym i przed pierwszym
 * otwarciem — null (wejście na ekran nie przenosi fokusu).
 */
export function useClosedPanel<K>(open: K | null | false): K | null {
  const [last, setLast] = useState<K | null>(null);
  const shown = open === null || open === false ? null : open;
  // Zmiana stanu w trakcie rysowania (bez efektu), jak openSignal w DateField.
  if (shown !== null && shown !== last) setLast(shown);
  return shown === null ? last : null;
}

/**
 * Dopisek wiersza (termin, długość, postęp, zadanie nadrzędne) w wersji do czytania przez VoiceOver (audyt 2, M-263):
 * symbole z widoku zamienione na słowa — „↳ Zakupy” → „podzadanie: Zakupy”, „2/3 zrobione” → „2 z 3 zrobione”,
 * „1 h 30 min” → „1 godzina 30 minut”, separator „·” → przecinek, skrót dnia tygodnia słowem („śr.” → „środa”,
 * audyt 3, N-65 — „Co tydzień: śr.”, nazwy z config/calendar.pl.ts). Tylko dla dopisków budowanych przez aplikację
 * (strings.pl.ts, domain/format.ts), nie dla tytułów wpisanych przez ludzi. Jak polski VoiceOver czyta „↳” i „h” —
 * do sprawdzenia na iPhonie (audyt 2, A-42); słowa są czytane zawsze tak samo.
 */
const WEEKDAY_SHORT = new RegExp(`(?<!\\p{L})(${WEEKDAYS_ABBREVIATED.map((w) => w.replace('.', '\\.')).join('|')})`, 'gu');

export function spoken(text: string): string {
  return text
    .replace(WEEKDAY_SHORT, (w: string) => WEEKDAYS_NOMINATIVE[(WEEKDAYS_ABBREVIATED as readonly string[]).indexOf(w)]!)
    .replace(/↳ /g, strings['spoken.parent'])
    .replace(/(\d+)\/(\d+) zrobione/g, (_, d: string, t: string) => strings['spoken.progress'](Number(d), Number(t)))
    .replace(/(\d+) h\b/g, (_, n: string) => strings['spoken.hours'](Number(n)))
    .replace(/(\d+) min\b/g, (_, n: string) => strings['spoken.minutes'](Number(n)))
    .replace(/\s+·\s+/g, ', ');
}

/** Stan elementu dotykowego dla VoiceOvera (`buttonA11y`). */
export type ButtonState = { selected?: boolean; disabled?: boolean; expanded?: boolean; busy?: boolean };

/**
 * Rola i stan przycisku dla VoiceOvera po polsku (audyt 3, N-9) — jedno miejsce dla pól odhaczenia, opcji wyboru,
 * pól rozwijanych i przycisków „w toku”. React Native 0.86 na iOS dopisuje do wartości elementu angielskie słowa:
 * rola „checkbox” → „checkbox”, „radio” → „radio button”, accessibilityState.checked → „checked”/„unchecked”,
 * expanded: true → „expanded”, busy: true → „busy” (node_modules/react-native/React/Fabric/Mounting/ComponentViews/View/
 * RCTViewComponentView.mm, `accessibilityValue`: RCTLocalizedString, a React/I18n/strings/pl.lproj/Localizable.strings
 * jest pusty), a role „checkbox” i „radio” nie dają żadnej cechy iOS (accessibilityPropsConversions.h — także bez
 * „przycisk”). Cechy systemowe VoiceOver czyta w języku telefonu: `selected` → UIAccessibilityTraitSelected,
 * `disabled` → UIAccessibilityTraitNotEnabled (ten sam plik, `updateProps`, „accessibilityState”). Dlatego:
 *  - rola zawsze „button” (pole odhaczenia, opcja, dzień, kafelek godziny — wszystko, co się naciska);
 *  - zaznaczenie i wybór (jedna albo wiele opcji, odhaczone zadanie) — cechą `selected`;
 *  - rozwinięcie i „w toku” — polską wartością (accessibilityValue), dopisaną po wartości pola; zwinięte i wolne nic
 *    nie dodają, jak w RN (expanded: false i busy: false nie dają słowa).
 * Aplikacja jest tylko na iOS (CLAUDE.md), więc bez osobnej gałęzi dla Androida. Audyt drzewa (a11y-audit.ts, reguła 17)
 * oblewa `checked` (poza systemowym przełącznikiem), `expanded` i `busy` w accessibilityState.
 * Jak brzmi to na iPhonie z polskim VoiceOverem — do sprawdzenia na urządzeniu.
 */
export function buttonA11y(s: ButtonState = {}, value?: string | null): { accessibilityRole: 'button'; accessibilityState?: AccessibilityState; accessibilityValue?: { text: string } } {
  const state: AccessibilityState = {};
  if (s.selected !== undefined) state.selected = s.selected;
  if (s.disabled !== undefined) state.disabled = s.disabled;
  const text = [value, s.expanded ? strings['a11y.expanded'] : null, s.busy ? strings['a11y.busy'] : null].filter(Boolean).join(', ');
  return {
    accessibilityRole: 'button',
    ...(Object.keys(state).length ? { accessibilityState: state } : {}),
    ...(text ? { accessibilityValue: { text } } : {}),
  };
}
