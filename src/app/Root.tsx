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
import { adoptDevice, materialize } from '../domain/sync-engine/client';
import { strings } from '../i18n/strings.pl';
import type { AccountApi, ClientError } from '../sync/account';
import { SyncRuntime, type Timer } from '../sync/runtime';
import { groupWaker } from '../sync/wake';
import { addDays, formatIsoDate } from '../domain/civil-date';
import { wakeGroups } from '../domain/reminder-wake';
import type { SyncTransport } from '../sync/transport';
import { SignInScreen } from '../features/auth/SignInScreen';
import { Body, Button, Screen, Title } from '../ui/components';
import { type AppearanceStore, ThemeProvider, useTheme } from '../ui/theme';
import { config } from '../config';
import { accountPrefs, adoptLegacyPrefs, type LegacyStore } from './account-prefs';
import { setLiveSession } from './background';
import { localNow } from './clock';
import { storedReminderPlan } from './reminders';
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
  session: {
    current(): Promise<Session | null>;
    onChange(fn: (s: Session | null) => void): () => void;
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

const defaultTimer: Timer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
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

function SignedIn({ deps, session, pendingUrl }: { deps: RootDeps; session: Session; pendingUrl: string | null }) {
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
  return <SignedInApp deps={deps} session={session} db={opened.db} pendingUrl={pendingUrl} />;
}

function SignedInApp({ deps, session, db, pendingUrl }: { deps: RootDeps; session: Session; db: DbAdapter; pendingUrl: string | null }) {
  const nowMs = deps.nowMs ?? Date.now;
  const local = useMemo(() => ({ load: (k: string) => loadLocal(db, k), save: (k: string, v: string | null) => saveLocal(db, k, v) }), [db]);
  // D175: ustawienia konta w jego bazie; dawne wspólne ustawienia z pęku kluczy przejmuje pierwsze konto.
  const prefs = useMemo(() => accountPrefs(local, adoptLegacyPrefs(deps.legacyPrefs, local)), [local, deps]);
  // D159: po moich zmianach, które mogą zmienić czyjeś przypomnienia — ciche powiadomienia dla członków grup.
  const waker = useMemo(() => groupWaker((r) => deps.account.notifyGroups(r), deps.setTimer ?? defaultTimer), [deps]);
  useEffect(() => () => waker.stop(), [waker]);
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
      setTimer: deps.setTimer ?? defaultTimer,
      persist: (prev, next, now) => writeState(db, prev, next, now),
      onPushed: (ops, res, st) => {
        const { y, m, d } = localNow(nowMs());
        waker.add(wakeGroups(ops, res, st.base, materialize(st), formatIsoDate(addDays({ y, m, d }, config.reminders.DAYS_AHEAD))));
      },
    });
  }, [db, deps, epoch, session.userId, waker]); // eslint-disable-line react-hooks/exhaustive-deps

  // Samosprawdzenie na tym telefonie raz na wersję (S3, S4).
  useEffect(() => void reportSelfCheck(db, deps.prefs, deps.account, appVersion()).catch(() => {}), [db, deps]);

  // M-9: prośba o odświeżenie tokenu już wysłana w tym epizodzie „wygasłej sesji”.
  const asked = useRef(false);
  useEffect(() => {
    runtime.start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') asked.current = false;
      runtime.event(s === 'active' ? { t: 'foreground' } : { t: 'background' });
      // Wyjście z aplikacji: prośba o ciche powiadomienia od razu (iOS zaraz uśpi aplikację).
      if (s === 'background') void waker.flush();
    });
    return () => {
      sub.remove();
      runtime.stop();
    };
  }, [runtime, waker]);

  // D159: ciche powiadomienie przy działającej aplikacji — pobiera jej pętla (jeden pisarz bazy), potem plan przypomnień.
  useEffect(
    () =>
      setLiveSession({
        userId: session.userId,
        refresh: async () => {
          await runtime.refreshNow();
          if (!deps.push || (await deps.push.status()) !== 'granted') return;
          await deps.push.replaceReminders(await storedReminderPlan(materialize(runtime.getSnapshot().state), session.userId, nowMs(), prefs, local));
        },
      }),
    [runtime, deps, session.userId, nowMs, prefs, local],
  );

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
      store: { getSnapshot: runtime.getSnapshot, subscribe: runtime.subscribe, dispatch: (op) => runtime.dispatch(op), refresh: () => runtime.event({ t: 'refresh' }) },
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
      signInAgain: deps.session.signOutLocal ? () => void deps.session.signOutLocal!().catch(() => {}) : undefined,
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
