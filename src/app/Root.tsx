/**
 * Korzeń aplikacji: kroje, sesja, baza telefonu, pętla synchronizacji, sygnały Realtime, linki.
 * Wszystkie zależności zewnętrzne przychodzą w `deps`, więc test podaje atrapy (src/app/__tests__/root.test.tsx),
 * a App.tsx — prawdziwe moduły (src/app/wiring.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadLocal, readState, saveLocal, wipeSynced, writeState } from '../data/store';
import type { DbAdapter } from '../data/db/adapter';
import { migrate } from '../data/db/migrations';
import { strings } from '../i18n/strings.pl';
import type { AccountApi, ClientError } from '../sync/account';
import { SyncRuntime } from '../sync/runtime';
import type { SyncTransport } from '../sync/transport';
import { SignInScreen } from '../features/auth/SignInScreen';
import { type AppearanceStore, ThemeProvider, useTheme } from '../ui/theme';
import { config } from '../config';
import { accountPrefs, adoptLegacyPrefs, type LegacyStore } from './account-prefs';
import { localNow } from './clock';
import { AppProvider, type AppServices, type Prefs } from './context';
import { appVersion, ErrorBoundary, installGlobalHandler } from './diagnostics';
import { reportSelfCheck } from './self-check';
import type { DeviceCalendar } from './device-calendar';
import { removeMirrorCalendars } from './calendar-mirror';
import type { TravelService } from './travel-service';
import type { DevicePush } from './push';
import { AppNavigation } from './navigation';

/** `needsName` i `emailName` — D100 (konto bez imienia; dawne imię zastępcze z adresu e-mail). */
/** `emailOnly` — konto bez logowania Apple (D177: w becie po wylogowaniu nie da się do niego wrócić). */
export type Session = { userId: string; displayName: string; needsName?: boolean; emailName?: string | null; emailOnly?: boolean };

export type RootDeps = {
  /** Bieżąca sesja i zmiany (logowanie, wylogowanie, wygaśnięcie). */
  session: { current(): Promise<Session | null>; onChange(fn: (s: Session | null) => void): () => void };
  account: AccountApi;
  /** Kalendarz iPhone'a, tylko zapis (D7). */
  calendar: DeviceCalendar;
  /** Czas dojazdu z Map Apple (D116); brak = bez tej funkcji. */
  travel?: TravelService;
  push?: DevicePush;
  /** Ustawienia telefonu, nie konta (pęk kluczy; np. samosprawdzenie). Ustawienia konta są w jego bazie (D175, account-prefs). */
  prefs?: Prefs;
  /** Dawne ustawienia konta w pęku kluczy (sprzed D175) — przejmuje je pierwsze zalogowane konto. */
  legacyPrefs?: LegacyStore;
  transport: SyncTransport;
  /** Baza per użytkownik (osobny plik), więc po zmianie konta nic nie przecieka między osobami. */
  openDb(userId: string): DbAdapter;
  /** Zamknięcie i usunięcie pliku bazy konta (po usunięciu konta, audyt 2 M-64). */
  removeDb?(userId: string): void;
  newId(): string;
  /** Prywatne kanały Realtime (poke): wywołuje `onPoke` z wersją grupy albo bez (zmiana dostępu). */
  subscribe(topics: string[], onPoke: (topic: string, version: number | null) => void): () => void;
  /** Linki otwierające aplikację, gdy już działa (pierwszy link przy starcie czyta sama nawigacja). */
  links: { onUrl(fn: (url: string) => void): () => void };
  /** Zapamiętany wygląd (D69). */
  appearance?: AppearanceStore;
  nowMs?: () => number;
  setTimer?: (fn: () => void, ms: number) => () => void;
};

/** Bez globalnego ErrorUtils (np. środowisko testów) — nic nie podmieniamy. */
const NO_ERROR_UTILS = { getGlobalHandler: () => () => {}, setGlobalHandler: () => {} };

function Loading() {
  const { c, font } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.ground }}>
      <Text style={{ fontFamily: font.text600, color: c.inkMuted }}>{strings['app.loading']}</Text>
    </View>
  );
}

function SignedIn({ deps, session, pendingUrl }: { deps: RootDeps; session: Session; pendingUrl: string | null }) {
  const nowMs = deps.nowMs ?? Date.now;
  const db = useMemo(() => {
    const db = deps.openDb(session.userId);
    migrate(db);
    return db;
  }, [deps, session.userId]);
  const local = useMemo(() => ({ load: (k: string) => loadLocal(db, k), save: (k: string, v: string | null) => saveLocal(db, k, v) }), [db]);
  // D175: ustawienia konta w jego bazie; dawne wspólne ustawienia z pęku kluczy przejmuje pierwsze konto.
  const prefs = useMemo(() => accountPrefs(local, adoptLegacyPrefs(deps.legacyPrefs, local)), [local, deps]);
  // D121: „Wyczyść dane na telefonie” — nowy silnik z pustym stanem (epoch), pobiera wszystko od zera.
  const [epoch, setEpoch] = useState(0);
  const runtime = useMemo(() => {
    return new SyncRuntime({
      initial: readState(db, deps.newId()),
      transport: deps.transport,
      now: nowMs,
      newId: deps.newId,
      setTimer:
        deps.setTimer ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        }),
      persist: (prev, next, now) => writeState(db, prev, next, now),
    });
  }, [db, deps, epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Samosprawdzenie na tym telefonie raz na wersję (S3, S4).
  useEffect(() => void reportSelfCheck(db, deps.prefs, deps.account, appVersion()).catch(() => {}), [db, deps]);

  useEffect(() => {
    runtime.start();
    const sub = AppState.addEventListener('change', (s) => runtime.event(s === 'active' ? { t: 'foreground' } : { t: 'background' }));
    return () => {
      sub.remove();
      runtime.stop();
    };
  }, [runtime]);

  // Kanały: mój (zmiana dostępu) + każdej mojej grupy (nowa wersja). Odnawiane, gdy zmienia się zbiór grup.
  const [groupIds, setGroupIds] = useState<string[]>([]);
  useEffect(
    () =>
      runtime.subscribe(() => {
        const ids = Object.keys(runtime.getSnapshot().state.cursors).sort();
        setGroupIds((old) => (old.join() === ids.join() ? old : ids));
      }),
    [runtime],
  );
  useEffect(
    () =>
      deps.subscribe([`user:${session.userId}`, ...groupIds.map((g) => `group:${g}`)], (topic, version) => {
        const cursor = runtime.getSnapshot().state.cursors[topic.slice('group:'.length)] ?? 0;
        runtime.event({ t: 'poke', fresh: version === null || version > cursor });
      }),
    [deps, runtime, session.userId, groupIds],
  );

  // Koniec sesji z tego telefonu (wylogowanie, usunięcie konta): sprzątanie zgłoszone przez moduły (onSignOut, np.
  // kalendarze lustra — D172), zanim ekrany znikną. Po usunięciu konta także plik bazy (M-64) — przy odmontowaniu.
  const leaving = useRef(new Set<() => Promise<void>>());
  const removeDb = useRef(false);
  const runLeaving = useCallback(async () => {
    await Promise.all([...leaving.current].map((fn) => fn().catch(() => {})));
  }, []);
  useEffect(
    () => () => {
      if (removeDb.current) deps.removeDb?.(session.userId);
    },
    [deps, session.userId],
  );
  const account = useMemo(
    () => ({
      ...deps.account,
      signOut: async () => {
        await runLeaving();
        await deps.account.signOut();
      },
      deleteAccount: () =>
        deps.account.deleteAccount(async () => {
          // Konta już nie ma na serwerze: bez dalszej synchronizacji; dane tego konta znikają z telefonu.
          runtime.stop();
          await runLeaving();
          removeDb.current = true;
        }),
    }),
    [deps, runtime, runLeaving],
  );

  const services: AppServices = useMemo(
    () => ({
      store: { getSnapshot: runtime.getSnapshot, subscribe: runtime.subscribe, dispatch: (op) => runtime.dispatch(op), refresh: () => runtime.event({ t: 'poke', fresh: true }) },
      account,
      calendar: deps.calendar,
      travel: deps.travel,
      push: deps.push,
      prefs,
      local,
      onSignOut: (fn) => {
        leaving.current.add(fn);
        return () => void leaving.current.delete(fn);
      },
      resetLocal: () => {
        runtime.stop();
        wipeSynced(db);
        setEpoch((e) => e + 1);
      },
      userId: session.userId,
      displayName: session.displayName,
      needsName: session.needsName,
      emailName: session.emailName,
      emailOnly: session.emailOnly,
      newId: deps.newId,
      now: () => localNow(nowMs()),
      nowIso: () => new Date(nowMs()).toISOString(),
      nowMs,
    }),
    [runtime, db, deps, session, nowMs, account, prefs, local],
  );

  // D80: nieobsłużone wyjątki i błędy renderowania trafiają do zgłoszeń (bez treści z tabel).
  const report = useCallback((e: ClientError) => void deps.account.reportError(e).catch(() => {}), [deps]);
  useEffect(() => installGlobalHandler((globalThis as unknown as { ErrorUtils: Parameters<typeof installGlobalHandler>[0] }).ErrorUtils ?? NO_ERROR_UTILS, report, appVersion()), [report]);
  const { c } = useTheme();

  return (
    <AppProvider services={services}>
      <ErrorBoundary report={report} version={appVersion()} colors={c}>
        <AppNavigation pendingUrl={pendingUrl} />
      </ErrorBoundary>
    </AppProvider>
  );
}

export function Root({ deps, fontsLoaded }: { deps: RootDeps; fontsLoaded: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Audyt 2 (M-221): link (np. zaproszenie) dotknięty, gdy nikt nie był zalogowany — nawigacja dostaje go po zalogowaniu.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const signedIn = useRef(false);
  useEffect(() => {
    signedIn.current = !!session;
  }, [session]);

  useEffect(() => {
    let alive = true;
    void deps.session.current().then((s) => alive && setSession((old) => (old === undefined ? s : old)));
    const off = deps.session.onChange((s) => {
      // Link oddany nawigacji przy jej starcie (useState w AppNavigation) — po końcu tamtej sesji już nie wraca.
      if (signedIn.current) setPendingUrl(null);
      setSession(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, [deps]);

  // Audyt 2 (N-4): bez sesji albo po zmianie konta zaplanowane przypomnienia poprzedniego konta (tytuły spraw
  // na ekranie blokady) znikają. Nowe planuje dostawca przypomnień zalogowanego konta.
  // D172 (M-27): tak samo kalendarze „Organizer – …” tego telefonu (wylogowanie, usunięcie konta, inne konto).
  const shownFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (session === undefined) return;
    const who = session?.userId ?? null;
    if (who === null || (shownFor.current != null && shownFor.current !== who)) {
      void deps.push?.replaceReminders([]).catch(() => {});
      void removeMirrorCalendars(deps.calendar, deps.prefs).catch(() => {});
    }
    shownFor.current = who;
  }, [session, deps]);

  // Wylogowanie bez sieci (koordynator, 8.10.2026): zaległe wyrejestrowanie tokenu push starą sesją — przy starcie, przy
  // każdej zmianie konta (także zaraz po zalogowaniu innego), po powrocie do aplikacji i co config.account.SIGNOUT_RETRY_MS.
  const who = session === undefined ? undefined : (session?.userId ?? null);
  useEffect(() => {
    const finish = () => void deps.account.finishSignOut().catch(() => {});
    finish();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && finish());
    const timer = setInterval(finish, config.account.SIGNOUT_RETRY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [deps, who]);

  // Linki obsługuje nawigacja (linking); bez sesji nawigacji jeszcze nie ma, więc ostatni link czeka na zalogowanie.
  // Logowania z linku nie ma (D177, M-76): aplikacja nie przyjmuje sesji z adresu.
  useEffect(() => deps.links.onUrl((url) => !signedIn.current && setPendingUrl(url)), [deps]);

  let body;
  if (!fontsLoaded || session === undefined) body = <Loading />;
  else if (session === null) body = <SignInScreen account={deps.account} />;
  else body = <SignedIn key={session.userId} deps={deps} session={session} pendingUrl={pendingUrl} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider store={deps.appearance}>{body}</ThemeProvider>
    </SafeAreaProvider>
  );
}
