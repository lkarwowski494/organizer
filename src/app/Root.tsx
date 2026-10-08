/**
 * Korzeń aplikacji: kroje, sesja, baza telefonu, pętla synchronizacji, sygnały Realtime, linki.
 * Wszystkie zależności zewnętrzne przychodzą w `deps`, więc test podaje atrapy (src/app/__tests__/root.test.tsx),
 * a App.tsx — prawdziwe moduły (src/app/wiring.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadLocal, readState, rebuildNewer, saveLocal, wipeSynced, writeState } from '../data/store';
import type { DbAdapter } from '../data/db/adapter';
import { isNewerSchema, migrate } from '../data/db/migrations';
import { adoptDevice } from '../domain/sync-engine/client';
import { strings } from '../i18n/strings.pl';
import type { AccountApi, ClientError } from '../sync/account';
import { SyncRuntime } from '../sync/runtime';
import type { SyncTransport } from '../sync/transport';
import { parseAuthCallback } from '../sync/supabase';
import { SignInScreen } from '../features/auth/SignInScreen';
import { Body, Button, Screen, Title } from '../ui/components';
import { type AppearanceStore, ThemeProvider, useTheme } from '../ui/theme';
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
export type Session = { userId: string; displayName: string; needsName?: boolean; emailName?: string | null };

export type RootDeps = {
  /** Bieżąca sesja i zmiany (logowanie, wylogowanie, wygaśnięcie). */
  session: {
    current(): Promise<Session | null>;
    onChange(fn: (s: Session | null) => void): () => void;
    setFromLink(t: { access_token: string; refresh_token: string }): Promise<void>;
    /** Odświeżenie tokenu po 401 z serwera (audyt 2, M-9); sukces przychodzi przez onChange. */
    refresh?(): Promise<void>;
    /** Wylogowanie tylko na tym telefonie, bez czyszczenia danych — ponowne logowanie po wygaśnięciu sesji (M-9). */
    signOutLocal?(): Promise<void>;
  };
  /**
   * Identyfikator instalacji w pęku kluczy „tylko to urządzenie” (audyt 2, M-8): nie przechodzi do kopii iCloud, więc
   * baza odtworzona z kopii dostaje nowy. Brak = bez sprawdzania (testy).
   */
  deviceClientId?: { load(userId: string): string | null; save(userId: string, clientId: string): void };
  /** Stan sieci telefonu (NetInfo, audyt 2, M-10): „Offline” we wskaźniku i wyzwalacz „sieć wróciła”. */
  network?: { subscribe(fn: (online: boolean) => void): () => void };
  account: AccountApi;
  /** Kalendarz iPhone'a, tylko zapis (D7). */
  calendar: DeviceCalendar;
  /** Czas dojazdu z Map Apple (D116); brak = bez tej funkcji. */
  travel?: TravelService;
  push?: DevicePush;
  prefs?: Prefs;
  transport: SyncTransport;
  /** Baza per użytkownik (osobny plik), więc po zmianie konta nic nie przecieka między osobami. */
  openDb(userId: string): DbAdapter;
  newId(): string;
  /** Prywatne kanały Realtime (poke): wywołuje `onPoke` z wersją grupy albo bez (zmiana dostępu). */
  subscribe(topics: string[], onPoke: (topic: string, version: number | null) => void): () => void;
  links: { initial(): Promise<string | null>; onUrl(fn: (url: string) => void): () => void };
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

/**
 * Baza z nowszej wersji aplikacji (np. tester wrócił do starszego buildu TestFlight, audyt 2, M-177): tej wersji nie wolno
 * jej ruszać, więc zamiast awarii przy starcie — wyjaśnienie i wybór.
 */
function NewerData({ onReset }: { onReset: () => void }) {
  return (
    <Screen testID="screen-newer-data">
      <Title>{strings['newer.title']}</Title>
      <Body>{strings['newer.info']}</Body>
      <Button kind="danger" label={strings['reset.confirm']} testID="newer-reset" onPress={onReset} />
    </Screen>
  );
}

function SignedIn({ deps, session }: { deps: RootDeps; session: Session }) {
  const [rebuilt, setRebuilt] = useState(0);
  const opened = useMemo(() => {
    const db = deps.openDb(session.userId);
    try {
      if (rebuilt) rebuildNewer(db);
      migrate(db);
      return { db, newer: false };
    } catch (e) {
      if (!isNewerSchema(e)) throw e;
      return { db, newer: true };
    }
  }, [deps, session.userId, rebuilt]);
  if (opened.newer) return <NewerData onReset={() => setRebuilt((n) => n + 1)} />;
  return <SignedInApp deps={deps} session={session} db={opened.db} />;
}

function SignedInApp({ deps, session, db }: { deps: RootDeps; session: Session; db: DbAdapter }) {
  const nowMs = deps.nowMs ?? Date.now;
  // D121: „Wyczyść dane na telefonie” — nowy silnik z pustym stanem (epoch), pobiera wszystko od zera.
  const [epoch, setEpoch] = useState(0);
  const runtime = useMemo(() => {
    const stored = readState(db, deps.newId());
    // M-8: baza z kopii iCloud (inny identyfikator niż w pęku kluczy tego urządzenia) — nowy identyfikator od razu w bazie.
    const initial = deps.deviceClientId ? adoptDevice(stored, deps.deviceClientId.load(session.userId), deps.newId) : stored;
    if (initial !== stored) writeState(db, stored, initial, nowMs());
    deps.deviceClientId?.save(session.userId, initial.clientId);
    return new SyncRuntime({
      initial,
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
  }, [db, deps, epoch, session.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Samosprawdzenie na tym telefonie raz na wersję (S3, S4).
  useEffect(() => void reportSelfCheck(db, deps.prefs, deps.account, appVersion()).catch(() => {}), [db, deps]);

  // M-9: prośba o odświeżenie tokenu już wysłana w tym epizodzie „wygasłej sesji”.
  const asked = useRef(false);
  useEffect(() => {
    runtime.start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') asked.current = false;
      runtime.event(s === 'active' ? { t: 'foreground' } : { t: 'background' });
    });
    return () => {
      sub.remove();
      runtime.stop();
    };
  }, [runtime]);

  // M-10: sieć z NetInfo — „Offline · N zmian czeka” i natychmiastowa próba po powrocie sieci.
  useEffect(() => deps.network?.subscribe((online) => runtime.event({ t: 'network', online })), [deps, runtime]);

  // M-9: nowy token (odświeżony w tle albo po naszej prośbie) tego samego konta zdejmuje „wygasłą sesję”. Po 401 prosimy
  // raz o odświeżenie; następna prośba dopiero po udanej synchronizacji albo powrocie do aplikacji (bez pętli 401).
  useEffect(() => deps.session.onChange((s) => s?.userId === session.userId && runtime.event({ t: 'auth_refreshed' })), [deps, runtime, session.userId]);
  useEffect(
    () =>
      runtime.subscribe(() => {
        const i = runtime.getSnapshot().indicator;
        if (i.state !== 'auth_expired') {
          if (i.state === 'synced' || i.state === 'pending') asked.current = false;
          return;
        }
        if (asked.current || !deps.session.refresh) return;
        asked.current = true;
        void deps.session.refresh().catch(() => {});
      }),
    [deps, runtime],
  );

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

  const services: AppServices = useMemo(
    () => ({
      store: { getSnapshot: runtime.getSnapshot, subscribe: runtime.subscribe, dispatch: (op) => runtime.dispatch(op), refresh: () => runtime.event({ t: 'refresh' }) },
      account: deps.account,
      calendar: deps.calendar,
      travel: deps.travel,
      push: deps.push,
      prefs: deps.prefs,
      local: { load: (k) => loadLocal(db, k), save: (k, v) => saveLocal(db, k, v) },
      resetLocal: () => {
        runtime.stop();
        wipeSynced(db);
        setEpoch((e) => e + 1);
      },
      signInAgain: deps.session.signOutLocal ? () => void deps.session.signOutLocal!().catch(() => {}) : undefined,
      userId: session.userId,
      displayName: session.displayName,
      needsName: session.needsName,
      emailName: session.emailName,
      newId: deps.newId,
      now: () => localNow(nowMs()),
      nowIso: () => new Date(nowMs()).toISOString(),
      nowMs,
    }),
    [runtime, db, deps, session, nowMs],
  );

  // D80: nieobsłużone wyjątki i błędy renderowania trafiają do zgłoszeń (bez treści z tabel).
  const report = useCallback((e: ClientError) => void deps.account.reportError(e).catch(() => {}), [deps]);
  useEffect(() => installGlobalHandler((globalThis as unknown as { ErrorUtils: Parameters<typeof installGlobalHandler>[0] }).ErrorUtils ?? NO_ERROR_UTILS, report, appVersion()), [report]);
  const { c } = useTheme();

  return (
    <AppProvider services={services}>
      <ErrorBoundary report={report} version={appVersion()} colors={c}>
        <AppNavigation />
      </ErrorBoundary>
    </AppProvider>
  );
}

export function Root({ deps, fontsLoaded }: { deps: RootDeps; fontsLoaded: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void deps.session.current().then((s) => alive && setSession((old) => (old === undefined ? s : old)));
    const off = deps.session.onChange((s) => setSession(s));
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

  // Link z e-maila (magic link): tokeny → sesja. Linki zaproszeń obsługuje nawigacja (linking).
  useEffect(() => {
    const handle = (url: string | null) => {
      const r = url ? parseAuthCallback(url) : null;
      if (r && 'error' in r) setLinkError(r.error);
      else if (r) void deps.session.setFromLink(r).catch(() => setLinkError(strings['common.error']));
    };
    void deps.links.initial().then(handle);
    return deps.links.onUrl(handle);
  }, [deps]);

  let body;
  if (!fontsLoaded || session === undefined) body = <Loading />;
  else if (session === null)
    body = (
      <>
        <SignInScreen account={deps.account} />
        {linkError ? <Text accessibilityRole="alert" style={{ position: 'absolute', bottom: 40, left: 20, right: 20 }}>{linkError}</Text> : null}
      </>
    );
  else body = <SignedIn key={session.userId} deps={deps} session={session} />;

  return (
    <SafeAreaProvider>
      <ThemeProvider store={deps.appearance}>{body}</ThemeProvider>
    </SafeAreaProvider>
  );
}
