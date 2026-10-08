/**
 * Kontekst aplikacji dla ekranów: stan z pętli synchronizacji (useSyncExternalStore), operacje
 * offline (`dispatch`) i operacje serwerowe (`account`). Ekrany nie znają Supabase ani SQLite.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

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
import { UndoProvider } from '../ui/undo';

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

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  // D194: odcisk po zmianie i sprawdzenie przed cofnięciem — na stanie z oczekującymi zmianami (jak ekrany).
  const { store } = services;
  const track = useCallback(
    (ops: readonly NewOp[]) => {
      const fp = fingerprint(materialize(store.getSnapshot().state), ops);
      return () => isStale(materialize(store.getSnapshot().state), fp);
    },
    [store],
  );
  return (
    <AppContext.Provider value={services}>
      <UndoProvider nowMs={services.nowMs} track={track}>
        {children}
      </UndoProvider>
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
  const { y, m, d } = now();
  // Ta sama data → ten sam obiekt, żeby widoki liczone w useMemo nie przeliczały się przy każdym renderze.
  const today = useMemo(() => ({ y, m, d }), [y, m, d]);
  return { ...snap, tables, today };
}
