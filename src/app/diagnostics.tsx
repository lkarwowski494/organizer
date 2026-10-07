/**
 * Zgłaszanie błędów z telefonu (D80, ADR 0017). Wysyłamy tylko komunikat, stos, nazwę ekranu i wersję aplikacji —
 * nigdy treści z tabel (list, zadań, imion). Dwa źródła: błędy renderowania (granica błędów — ekran „Coś poszło nie
 * tak” z „Spróbuj ponownie”) i nieobsłużone wyjątki (globalny handler React Native, ErrorUtils.setGlobalHandler,
 * https://reactnative.dev/docs/0.86/... — poprzedni handler wołany dalej, więc zachowanie systemu się nie zmienia).
 */
import * as Application from 'expo-application';
import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { strings } from '../i18n/strings.pl';
import type { ClientError } from '../sync/account';

export const appVersion = () => `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;

const clip = (s: string | undefined | null, n: number) => (s == null ? null : s.slice(0, n));
export function toClientError(e: unknown, kind: ClientError['kind'], screen: string | null, version: string): ClientError {
  const err = e instanceof Error ? e : new Error(String(e));
  return { kind, message: clip(`${err.name}: ${err.message}`, 500)!, stack: clip(err.stack, 4000), screen: clip(screen, 100), appVersion: version };
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

type Props = { report: (e: ClientError) => void; version: string; children: ReactNode; colors: { ground: string; ink: string; inkMuted: string } };

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    try {
      this.props.report(toClientError(e, 'crash', 'render', this.props.version));
    } catch {
      // jak wyżej
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const { colors: c } = this.props;
    return (
      <View testID="screen-crash" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: c.ground }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: c.ink }}>{strings['crash.title']}</Text>
        <Text style={{ fontSize: 17, color: c.inkMuted, textAlign: 'center' }}>{strings['crash.body']}</Text>
        <Text accessibilityRole="button" accessibilityLabel={strings['crash.retry']} onPress={() => this.setState({ failed: false })} style={{ fontSize: 17, fontWeight: '700', color: c.ink, minHeight: 44, paddingVertical: 12, paddingHorizontal: 20 }}>
          {strings['crash.retry']}
        </Text>
      </View>
    );
  }
}
