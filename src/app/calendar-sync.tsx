/**
 * Kalendarz iPhone'a w obie strony (D95, D96; ADR 0021): ustawienia konta na tym telefonie (D175), odczyt moich wydarzeń (odświeżany
 * przy wejściu do aplikacji) i lustro wydarzeń grup (po każdej zmianie danych, z opóźnieniem). Moje wydarzenia nie
 * wychodzą poza telefon — trzymamy je tylko w pamięci ekranu.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { config } from '../config';
import { addDays } from '../domain/civil-date';
import { deviceCalendars, type DeviceEntry, deviceDays, type DeviceEvent, mirrorCalendarOf, mirrorGroups, mirrorReady } from '../domain/views/calendar-sync';
import { localNow, localToMs } from '../domain/local-time';
import { clearMirror, loadMirror, loadSkip, MIRROR_SKIP_KEY, ownedIn, runMirror } from './calendar-mirror';
import type { CalendarStatus } from './device-calendar';
import { useAppData, useServices } from './context';
import { appVersion, toClientError } from './diagnostics';

export const CAL_READ = 'calendarRead';
export const CAL_MIRROR = 'calendarMirror';
/** D106: kalendarze iPhone'a, których nie czytamy (JSON: lista identyfikatorów). */
export const CAL_SKIP = 'calendarSkip';

type Api = {
  available: boolean;
  status: CalendarStatus | null;
  read: boolean;
  mirror: boolean;
  /** Moje wydarzenia po dniach (ISO), bez kalendarzy lustra. */
  days: ReadonlyMap<string, DeviceEntry[]>;
  /** Kalendarze iPhone'a z pobranych wydarzeń i czy je czytamy (D106). */
  calendars: { id: string; title: string; read: boolean }[];
  setCalendarRead(id: string, read: boolean): void;
  /** Zgoda iOS i włączenie obu funkcji (D95). */
  connect(): Promise<boolean>;
  setRead(on: boolean): void;
  setMirror(on: boolean): void;
  /** D174: moje grupy i czy są w lustrze (wybór w Ustawieniach, w bazie konta). */
  groups: { id: string; name: string; mirrored: boolean }[];
  setGroupMirrored(id: string, on: boolean): void;
  /** PWD-2: kalendarz lustra, w którym jest to wystąpienie (przy włączonym lustrze), albo null. */
  mirrorCalendar(eventId: string, occurrenceDate: string, date: string): string | null;
  /** Ustawienia iPhone'a (zgoda odmówiona — iOS nie zapyta drugi raz). */
  openSettings(): void;
};

const EMPTY = new Map<string, DeviceEntry[]>();
const Ctx = createContext<Api>({
  available: false, status: null, read: false, mirror: false, days: EMPTY, calendars: [], setCalendarRead: () => {}, connect: async () => false, setRead: () => {}, setMirror: () => {},
  groups: [], setGroupMirrored: () => {}, mirrorCalendar: () => null, openSettings: () => {},
});
const parseSkip = (v: string | null): string[] => {
  try {
    const x: unknown = JSON.parse(v ?? '[]');
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
  } catch {
    return [];
  }
};
export const useDeviceCalendar = () => useContext(Ctx);

export function CalendarSyncProvider({ children }: { children: ReactNode }) {
  const { calendar, prefs, local, account, userId } = useServices();
  const { tables, today, state } = useAppData();
  const ready = mirrorReady(tables, userId, state.cursors);
  const sync = calendar.sync;
  const available = !!sync && !!prefs && !!local;
  const [status, setStatus] = useState<Api['status']>(null);
  const [read, setReadState] = useState(false);
  const [mirror, setMirrorState] = useState(false);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [skip, setSkip] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  // D174: grupy wyłączone z lustra — wybór konta, więc w jego bazie (nie w pęku kluczy telefonu).
  const [mirrorSkip, setMirrorSkip] = useState<string[]>(() => (local ? loadSkip(local) : []));
  const reported = useRef(false);
  const report = useCallback(
    (e: unknown, screen: string) => {
      // Jedno zgłoszenie na uruchomienie — błąd kalendarza powtarza się przy każdej zmianie danych.
      if (reported.current) return;
      reported.current = true;
      // Audyt 2 (M-159): komunikat EventKit może zawierać nazwę kalendarza albo tytuł — tylko nazwa i kod błędu.
      account.reportError(toClientError(e, 'error', screen, appVersion(), { private: true })).catch(() => {});
    },
    [account],
  );

  useEffect(() => {
    if (!available) return;
    let live = true;
    Promise.all([sync!.status(), prefs!.get(CAL_READ), prefs!.get(CAL_MIRROR), prefs!.get(CAL_SKIP)])
      .then(([s, r, m, k]) => {
        if (!live) return;
        setStatus(s);
        setReadState(r === '1');
        setMirrorState(m === '1');
        setSkip(parseSkip(k));
      })
      .catch(() => {});
    // Powrót do aplikacji: odczyt od nowa, a zgoda mogła się zmienić w Ustawieniach iPhone'a (audyt 2, N-21 —
    // iOS zamyka aplikację przy odebraniu zgody, ale nie przy jej nadaniu).
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      setTick((n) => n + 1);
      sync!
        .status()
        .then((s) => live && setStatus(s))
        .catch(() => {});
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [available, sync, prefs]);

  // Odczyt: przy włączeniu i przy każdym powrocie do aplikacji.
  useEffect(() => {
    if (!available || !read || status !== 'granted') return;
    let live = true;
    const from = new Date(localToMs({ ...addDays(today, -config.calendar.READ_DAYS_BACK), hh: 0, mm: 0 }));
    const to = new Date(localToMs({ ...addDays(today, config.calendar.READ_DAYS_AHEAD + 1), hh: 0, mm: 0 }));
    sync!
      .listEvents(from, to)
      .then((e) => live && setEvents(e))
      .catch((e: unknown) => report(e, 'calendar-read'));
    return () => {
      live = false;
    };
  }, [available, read, status, today, tick, sync, report]);

  // Lustro: po zmianie danych (z opóźnieniem — seria zmian z synchronizacji daje jedno przeliczenie). Zmiana w trakcie
  // przebiegu (audyt 2, M-220) nie przepada: przebieg kończy się i rusza od nowa z najnowszymi danymi.
  const running = useRef(false);
  const latest = useRef<() => void>(() => {});
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      // Odmontowanie (wylogowanie, zmiana konta): przebieg w toku nie tworzy już nic w iPhonie (D172).
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!available || !mirror || status !== 'granted' || !ready) return;
    // Przebieg tego ustawienia danych: nowsze dane, wyłączenie lustra albo odmontowanie kończą go po bieżącym kroku
    // (stan zapisany po każdym kroku — następny przebieg zaczyna od tego miejsca).
    let current = true;
    const run = () => {
      if (running.current) {
        dirty.current = true;
        return;
      }
      running.current = true;
      dirty.current = false;
      runMirror(sync!, local!, tables, userId, today, { owned: ownedIn(prefs!), alive: () => current && mounted.current })
        .catch((e: unknown) => report(e, 'calendar-mirror'))
        .finally(() => {
          running.current = false;
          if (dirty.current && mounted.current) latest.current();
        });
    };
    latest.current = run;
    const timer = setTimeout(run, config.calendar.MIRROR_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [available, mirror, status, ready, tables, userId, today, tick, sync, local, prefs, report, mirrorSkip]);

  const mirrors = useMemo(() => (local ? new Set(Object.values(loadMirror(local).calendars)) : new Set<string>()), [local, events]); // eslint-disable-line react-hooks/exhaustive-deps
  const exclude = useMemo(() => new Set([...mirrors, ...skip]), [mirrors, skip]);
  // Wyłączony odczyt albo brak zgody — nic nie pokazujemy (ostatnio pobrane wydarzenia zostają tylko w pamięci).
  const shown = read && status === 'granted' ? events : null;
  const days = useMemo(
    () => (shown?.length ? deviceDays(shown, addDays(today, -config.calendar.READ_DAYS_BACK), addDays(today, config.calendar.READ_DAYS_AHEAD), localNow, exclude) : EMPTY),
    [shown, today, exclude],
  );

  const calendars = useMemo(() => (shown ? deviceCalendars(shown, mirrors).map((c) => ({ ...c, read: !skip.includes(c.id) })) : []), [shown, mirrors, skip]);
  const groups = useMemo(() => mirrorGroups(tables, userId).map((g) => ({ id: g.id, name: g.name, mirrored: !mirrorSkip.includes(g.id) })), [tables, userId, mirrorSkip]);
  const skipSet = useMemo(() => new Set(mirrorSkip), [mirrorSkip]);
  const mirrorOn = available && mirror && status === 'granted';

  const api = useMemo<Api>(
    () => ({
      available,
      status,
      read,
      mirror,
      days,
      calendars,
      setCalendarRead: (id, on) => {
        const next = on ? skip.filter((x) => x !== id) : [...new Set([...skip, id])];
        setSkip(next);
        prefs?.set(CAL_SKIP, JSON.stringify(next)).catch(() => {});
      },
      connect: async () => {
        if (!available) return false;
        // Odmowa: iOS nie zapyta drugi raz — tylko Ustawienia iPhone'a.
        if (status === 'denied') {
          void Linking.openSettings().catch(() => {});
          return false;
        }
        const ok = await sync!.request().catch(() => false);
        setStatus(ok ? 'granted' : 'denied');
        if (!ok) return false;
        setReadState(true);
        setMirrorState(true);
        await Promise.all([prefs!.set(CAL_READ, '1'), prefs!.set(CAL_MIRROR, '1')]).catch(() => {});
        return true;
      },
      setRead: (on) => {
        setReadState(on);
        prefs?.set(CAL_READ, on ? '1' : '0').catch(() => {});
      },
      setMirror: (on) => {
        setMirrorState(on);
        prefs?.set(CAL_MIRROR, on ? '1' : '0').catch(() => {});
        if (!on && sync && local) clearMirror(sync, local, prefs ? ownedIn(prefs) : undefined).catch((e: unknown) => report(e, 'calendar-mirror-off'));
      },
      groups,
      setGroupMirrored: (id, on) => {
        const next = on ? mirrorSkip.filter((x) => x !== id) : [...new Set([...mirrorSkip, id])];
        setMirrorSkip(next);
        local?.save(MIRROR_SKIP_KEY, JSON.stringify(next));
      },
      mirrorCalendar: (eventId, occurrenceDate, date) => (mirrorOn ? mirrorCalendarOf(tables, userId, eventId, occurrenceDate, date, today, skipSet) : null),
      openSettings: () => void Linking.openSettings().catch(() => {}),
    }),
    [available, status, read, mirror, days, calendars, skip, sync, prefs, local, report, groups, mirrorSkip, mirrorOn, tables, userId, today, skipSet],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
