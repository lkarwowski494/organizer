/**
 * Kontekst aplikacji dla ekranów: stan z pętli synchronizacji (useSyncExternalStore), operacje
 * offline (`dispatch`) i operacje serwerowe (`account`). Ekrany nie znają Supabase ani SQLite.
 */
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react';

import type { CivilDate, LocalDateTime } from '../domain/civil-date';
import { materialize, type NewOp } from '../domain/sync-engine/client';
import type { Tables } from '../domain/views';
import type { AccountApi } from '../sync/account';
import type { Snapshot } from '../sync/runtime';

export type AppStore = {
  getSnapshot: () => Snapshot;
  subscribe: (fn: () => void) => () => void;
  dispatch: (op: NewOp) => void;
  /** Pobierz zmiany teraz (po operacji serwerowej, np. utworzeniu grupy albo przyjęciu zaproszenia). */
  refresh: () => void;
};

export type AppServices = {
  store: AppStore;
  account: AccountApi;
  userId: string;
  displayName: string;
  newId: () => string;
  /** Lokalny czas Europe/Warsaw (config.TIME_ZONE). */
  now: () => LocalDateTime;
  nowIso: () => string;
  nowMs: () => number;
};

const AppContext = createContext<AppServices | null>(null);

export function AppProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>;
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
