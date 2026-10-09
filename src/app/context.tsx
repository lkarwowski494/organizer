/**
 * Kontekst aplikacji dla ekranów: stan z pętli synchronizacji (useSyncExternalStore), operacje
 * offline (`dispatch`) i operacje serwerowe (`account`). Ekrany nie znają Supabase ani SQLite.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { CivilDate, LocalDateTime } from '../domain/civil-date';
import { materialize, type NewOp } from '../domain/sync-engine/client';
import type { Tables } from '../domain/views';
import { fingerprint, isStale } from '../domain/views/recent';
import type { AccountApi } from '../sync/account';
import type { LocalStore } from './calendar-mirror';
import type { TravelService } from './travel-service';
import type { DeviceCalendar } from './device-calendar';
import type { DevicePush } from './push';
import type { Snapshot } from '../sync/runtime';
import { type UndoBackend, UndoProvider } from '../ui/undo';
import { routineUndoOps } from '../domain/views/routines';

/** Klucz „Ostatnich zmian” w bazie konta (`local:` w sync_state, D194 b). */
const RECENT_KEY = 'recent.changes';

export type AppStore = {
  getSnapshot: () => Snapshot;
  subscribe: (fn: () => void) => () => void;
  /** Jedna operacja albo kilka w jednej transakcji. */
  dispatch: (op: NewOp | readonly NewOp[]) => void;
  /** Pobierz zmiany teraz (po operacji serwerowej, np. utworzeniu grupy albo przyjęciu zaproszenia). */
  refresh: () => void;
  /** „Wyczyść listę” odrzuconych zmian (D190). */
  clearRejected: () => void;
};

export type Prefs = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };

export type AppServices = {
  store: AppStore;
  account: AccountApi;
  /** Kalendarz iPhone'a, tylko zapis (D7). */
  calendar: DeviceCalendar;
  /** Czas dojazdu (D116); brak = funkcja wyłączona (testy, telefon bez modułu). */
  travel?: TravelService;
  /** Powiadomienia push (D70); brak = bez push (np. testy, które go nie dotyczą). */
  push?: DevicePush;
  /**
   * Drobne ustawienia konta na tym telefonie (np. „wprowadzenie obejrzane”), osobno dla każdego konta (D175,
   * account-prefs.ts); brak = nic nie zapamiętujemy.
   */
  prefs?: Prefs;
  /** Dane tylko tego telefonu w lokalnej bazie (stan lustra kalendarza, D95); brak = funkcja wyłączona. */
  local?: LocalStore;
  /**
   * Sprzątanie telefonu przy wylogowaniu i usunięciu konta (np. kalendarze lustra w iPhonie, D172): funkcja wykonuje się,
   * zanim sesja się skończy; zwraca wyrejestrowanie. Błąd nie zatrzymuje wylogowania.
   */
  onSignOut?: (fn: () => Promise<void>) => () => void;
  /** D121: wyczyść kopię danych na telefonie i pobierz od nowa (grupy i członkowie wracają z serwera). */
  resetLocal?: () => void;
  /**
   * Sesja wygasła i nie dała się odświeżyć (audyt 2, M-9): ponowne logowanie bez czyszczenia danych — kolejka zmian
   * czeka w bazie tego konta i wyjdzie po zalogowaniu. Brak = funkcja wyłączona (testy).
   */
  signInAgain?: () => void;
  userId: string;
  displayName: string;
  /** D100: konto bez imienia (logowanie e-mailem) — zapytamy przy starcie. */
  needsName?: boolean;
  /** Początek adresu e-mail — dawne imię zastępcze (przed D100). */
  emailName?: string | null;
  /** Konto bez Apple (D177): wylogowanie ostrzega, że w becie nie da się wrócić. */
  emailOnly?: boolean;
  newId: () => string;
  /** Lokalny czas Europe/Warsaw (config.TIME_ZONE). */
  now: () => LocalDateTime;
  nowIso: () => string;
  nowMs: () => number;
};

const AppContext = createContext<AppServices | null>(null);

/**
 * Zegar dnia (audyt 2, M-203): „dziś” przelicza się o północy w Warszawie i po powrocie aplikacji na pierwszy plan, a nie
 * dopiero przy zmianie danych — ekran otwarty przez północ nie pokazuje wczorajszych „minęło”, „zaległe” i godzin.
 * Odstęp do północy liczony z czasu lokalnego (now(), config.TIME_ZONE przez Intl), ale timer czeka najwyżej
 * DAY_CLOCK_MAX_MS i po każdym przebiegu liczy od nowa — nie zakładamy, kiedy w nocy przestawia się czas (zmiana czasu
 * między wyliczeniem a północą przesunęłaby jedno długie czekanie o godzinę).
 */
const DayContext = createContext(0);
const DAY_CLOCK_MAX_MS = 60 * 60_000;

function DayClock({ services, children }: { services: AppServices; children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const { now, nowMs } = services;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let day = now().d;
    const schedule = () => {
      const l = now();
      const left = ((24 * 60 - (l.hh * 60 + l.mm)) * 60 - (Math.floor(nowMs() / 1000) % 60)) * 1000 + 1000;
      timer = setTimeout(() => {
        // Nowy dzień — ekrany przeliczają „dziś”; inaczej tylko kolejne czekanie.
        if (now().d !== day) {
          day = now().d;
          setTick((k) => k + 1);
        }
        schedule();
      }, Math.min(left, DAY_CLOCK_MAX_MS));
    };
    schedule();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setTick((k) => k + 1));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [now, nowMs]);
  return <DayContext.Provider value={tick}>{children}</DayContext.Provider>;
}

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  // D194: odcisk po zmianie i sprawdzenie przed cofnięciem — na stanie z oczekującymi zmianami (jak ekrany); lista
  // w bazie konta (D194 b), cofnięcie rutyny liczone w chwili cofnięcia (kopie kroków z międzyczasu, audyt 2 E-3).
  const { store, local } = services;
  const backend = useMemo<UndoBackend>(
    () => ({
      fingerprint: (ops) => fingerprint(materialize(store.getSnapshot().state), ops),
      isStale: (fp) => isStale(materialize(store.getSnapshot().state), fp),
      run: (u) => store.dispatch(u.recipe === 'routine' ? routineUndoOps(materialize(store.getSnapshot().state), u.ops) : u.ops),
      load: () => local?.load(RECENT_KEY) ?? null,
      save: (json) => local?.save(RECENT_KEY, json),
    }),
    [store, local],
  );
  return (
    <AppContext.Provider value={services}>
      <DayClock services={services}>
        <UndoProvider nowMs={services.nowMs} backend={backend}>
          {children}
        </UndoProvider>
      </DayClock>
    </AppContext.Provider>
  );
}

export function useServices(): AppServices {
  const s = useContext(AppContext);
  if (!s) throw new Error('useServices: brak AppProvider');
  return s;
}

/** Stan do ekranu: tabele po nałożeniu oczekujących zmian (materialize) + wskaźnik synchronizacji. */
export function useAppData(): Snapshot & { tables: Tables; today: CivilDate } {
  const { store, now } = useServices();
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const tables = useMemo(() => materialize(snap.state), [snap.state]);
  // Zegar dnia (DayClock) odświeża ekran o północy — wtedy now() daje już nowy dzień.
  useContext(DayContext);
  const { y, m, d } = now();
  // Ta sama data → ten sam obiekt, żeby widoki liczone w useMemo nie przeliczały się przy każdym renderze.
  const today = useMemo(() => ({ y, m, d }), [y, m, d]);
  return { ...snap, tables, today };
}
