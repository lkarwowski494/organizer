/**
 * Zgłaszanie błędów z telefonu (D80, ADR 0017). Wysyłamy tylko komunikat, stos, nazwę ekranu i wersję aplikacji —
 * nigdy treści z tabel (list, zadań, imion). Dwa źródła: błędy renderowania (granica błędów — ekran „Coś poszło nie
 * tak” z „Spróbuj ponownie”) i nieobsłużone wyjątki (globalny handler React Native, ErrorUtils.setGlobalHandler —
 * poprzedni handler wołany dalej, więc zachowanie systemu się nie zmienia). ErrorUtils nie ma strony w dokumentacji
 * React Native; definicja w kodzie react-native 0.86: Libraries/vendor/core/ErrorUtils.js („error handler specified via
 * ErrorUtils.setGlobalHandler”) i @react-native/js-polyfills/error-guard.js.
 */
import * as Application from 'expo-application';
import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { config } from '../config';
import { sizes } from '../config/theme';
import { strings } from '../i18n/strings.pl';
import type { ClientError } from '../sync/account';

/** Numer buildu TestFlight (NaN, gdy nieznany). */
export const buildNumber = () => Number(Application.nativeBuildVersion ?? Number.NaN);
export const appVersion = () => `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;

const clip = (s: string | undefined | null, n: number) => (s == null ? null : s.slice(0, n));
/** Długości pól zgłoszenia — te same co w SQL (client_errors, report_client_error). */
const F = config.feedback;
/** Ramka stosu V8/Hermes: „at nazwa (plik:wiersz:kolumna)” albo „at plik:wiersz:kolumna”. */
const FRAME = /^\s*at [\w$.<>[\] ]*(\([^()]*:\d+(:\d+)?\)|[^\s()]+:\d+(:\d+)?)$/;
/** Kod błędu modułu natywnego (np. expo „E_CALENDAR_ERROR_UNKNOWN”) — tylko taki napis, bez treści. */
const codeOf = (err: Error) => {
  const c = (err as { code?: unknown }).code;
  return typeof c === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(c) ? c : null;
};
/**
 * Zgłoszenie błędu. `opts.private` (audyt 2, M-159): błędy kalendarza iPhone'a i dojazdu mogą mieć w komunikacie nazwę
 * kalendarza, tytuł wydarzenia albo adres — wysyłamy wtedy tylko nazwę i kod błędu oraz same ramki stosu (wiersze „at …”,
 * bez pierwszego wiersza z komunikatem), zgodnie z polityką prywatności („nie dołącza treści”).
 */
export function toClientError(e: unknown, kind: ClientError['kind'], screen: string | null, version: string, opts: { private?: boolean } = {}): ClientError {
  const err = e instanceof Error ? e : new Error(String(e));
  if (opts.private) {
    const code = codeOf(err);
    const frames = (err.stack ?? '')
      .split('\n')
      .filter((l) => FRAME.test(l) && !(err.message && l.includes(err.message)))
      .join('\n');
    return { kind, message: clip(code ? `${err.name} (${code})` : err.name, F.ERROR_MESSAGE_MAX)!, stack: clip(frames || null, F.ERROR_STACK_MAX), screen: clip(screen, F.SCREEN_MAX), appVersion: version };
  }
  return { kind, message: clip(`${err.name}: ${err.message}`, F.ERROR_MESSAGE_MAX)!, stack: clip(err.stack, F.ERROR_STACK_MAX), screen: clip(screen, F.SCREEN_MAX), appVersion: version };
}

type GlobalHandler = (e: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };

/** Globalny handler: zgłoś (bez czekania) i oddaj dalej poprzedniemu. Zwraca funkcję przywracającą. */
export function installGlobalHandler(utils: ErrorUtilsLike, report: (e: ClientError) => void, version: string): () => void {
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((e, isFatal) => {
    try {
      report(toClientError(e, isFatal ? 'crash' : 'error', null, version));
    } catch {
      // zgłaszanie nie może psuć obsługi błędu
    }
    previous(e, isFatal);
  });
  return () => utils.setGlobalHandler(previous);
}

/** `screen` — nazwa ekranu w zgłoszeniu (granica jednego ekranu, N-1); brak = granica całej aplikacji („render”). */
type Props = { report: (e: ClientError) => void; version: string; children: ReactNode; colors: { ground: string; ink: string; inkMuted: string }; screen?: string };

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    try {
      this.props.report(toClientError(e, 'crash', this.props.screen ?? 'render', this.props.version));
    } catch {
      // jak wyżej
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const { colors: c } = this.props;
    return (
      <View testID="screen-crash" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: c.ground }}>
        <Text accessibilityRole="header" style={{ fontSize: sizes.DETAIL, fontWeight: '700', color: c.ink }}>{strings['crash.title']}</Text>
        <Text style={{ fontSize: sizes.BODY, color: c.inkMuted, textAlign: 'center' }}>{strings['crash.body']}</Text>
        <Text accessibilityRole="button" accessibilityLabel={strings['crash.retry']} onPress={() => this.setState({ failed: false })} style={{ fontSize: sizes.BODY, fontWeight: '700', color: c.ink, minHeight: 44, paddingVertical: 12, paddingHorizontal: 20 }}>
          {strings['crash.retry']}
        </Text>
      </View>
    );
  }
}
