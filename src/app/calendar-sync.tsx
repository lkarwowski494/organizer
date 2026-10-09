/**
 * Kalendarz iPhone'a w obie strony (D95, D96; ADR 0021): ustawienia konta na tym telefonie (D175), odczyt moich wydarzeń (odświeżany
 * przy wejściu do aplikacji) i lustro wydarzeń grup (po każdej zmianie danych, z opóźnieniem). Moje wydarzenia nie
 * wychodzą poza telefon — trzymamy je tylko w pamięci ekranu.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { config } from '../config';
import { addDays } from '../domain/civil-date';
import { deviceCalendars, type DeviceEntry, deviceDays, type DeviceEvent, mirrorGroups, mirrorLookup, mirrorReady } from '../domain/views/calendar-sync';
import { localNow, localToMs } from '../domain/local-time';
import { clearMirror, loadMirror, loadSkip, MIRROR_SKIP_KEY, ownedIn, runMirror } from './calendar-mirror';
import type { CalendarStatus } from './device-calendar';
import { useAppData, useServices } from './context';
import { useMyScope } from './my-scope';
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
  /** Audyt 3 (N-58): ostatni przebieg lustra się nie udał (np. kalendarza nie dało się założyć). */
  mirrorFailed: boolean;
  /**
   * Audyt 3 (N-186, Q21 cz. 2 A): lustro włączone, kalendarze „Organizer – …” są w iPhonie, a zgoda nie jest już pełna —
   * przestały się aktualizować.
   */
  mirrorStale: boolean;
  /** Audyt 3 (N-57, Q21 cz. 1 A): iPad — lustro domyślnie wyłączone (to samo iCloud co iPhone dałoby każde wydarzenie dwa razy). */
  tablet: boolean;
};

const EMPTY = new Map<string, DeviceEntry[]>();
const Ctx = createContext<Api>({
  available: false, status: null, read: false, mirror: false, days: EMPTY, calendars: [], setCalendarRead: () => {}, connect: async () => false, setRead: () => {}, setMirror: () => {},
  groups: [], setGroupMirrored: () => {}, mirrorCalendar: () => null, openSettings: () => {}, mirrorFailed: false, mirrorStale: false, tablet: false,
});
/** iPad (Platform.isPad, https://reactnative.dev/docs/platform#ispad-ios). */
const isTablet = () => Platform.OS === 'ios' && Platform.isPad;
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
  const { calendar, prefs, devicePrefs, local, account, userId, onSignOut } = useServices();
  const { tables, today, state } = useAppData();
  const { scopeOf } = useMyScope();
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
  // Audyt 3 (N-58): wynik ostatniego przebiegu i numer zapisu stanu lustra (po nim „Jest w kalendarzu” liczy się od nowa).
  const [mirrorFailed, setMirrorFailed] = useState(false);
  const [mirrorRev, setMirrorRev] = useState(0);
  // Audyt 3 (N-4): lista kalendarzy lustra tego telefonu — w pęku kluczy (wylogowanie czyta ją stamtąd), nie w bazie konta.
  const owned = useMemo(() => (devicePrefs ? ownedIn(devicePrefs) : undefined), [devicePrefs]);
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
  // Audyt 3 (N-184): przebieg w toku — wyłączenie lustra i wylogowanie czekają na jego koniec (inaczej kalendarz założony
  // po sprzątaniu zostawał w iPhonie).
  const runDone = useRef<Promise<void>>(Promise.resolve());
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
  // Wylogowanie i usunięcie konta (D172): przebieg kończy się po bieżącym kroku, a sprzątanie (Root,
  // removeMirrorCalendars) rusza dopiero po nim — z pełną listą kalendarzy tego telefonu.
  useEffect(
    () =>
      onSignOut?.(async () => {
        mounted.current = false;
        await runDone.current;
      }),
    [onSignOut],
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
      runDone.current = runMirror(sync!, local!, tables, userId, today, { owned, alive: () => current && mounted.current, scopeOf })
        .then(
          () => {
            if (mounted.current) setMirrorFailed(false);
          },
          (e: unknown) => {
            report(e, 'calendar-mirror');
            if (mounted.current) setMirrorFailed(true);
          },
        )
        .finally(() => {
          running.current = false;
          if (mounted.current) setMirrorRev((n) => n + 1);
          if (dirty.current && mounted.current) latest.current();
        });
    };
    latest.current = run;
    const timer = setTimeout(run, config.calendar.MIRROR_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [available, mirror, status, ready, tables, userId, today, tick, sync, local, owned, report, mirrorSkip, scopeOf]);

  // Stan lustra zapisany w bazie telefonu — odczyt po każdym przebiegu (mirrorRev) i odczycie kalendarza.
  const stored = useMemo(() => (local ? loadMirror(local) : null), [local, events, mirrorRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const mirrors = useMemo(() => new Set(stored ? Object.values(stored.calendars) : []), [stored]);
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
  // „Jest w kalendarzu” (PWD-2): zawartość lustra liczona przy pierwszym pytaniu i trzymana do zmiany danych.
  const inMirror = useMemo(() => {
    let lookup: ReturnType<typeof mirrorLookup> | null = null;
    return () => (lookup ??= mirrorLookup(tables, userId, today, skipSet, scopeOf, stored));
  }, [tables, userId, today, skipSet, scopeOf, stored]);
  const mirrorOn = available && mirror && status === 'granted';
  const mirrorStale = available && mirror && (status === 'writeOnly' || status === 'denied') && mirrors.size > 0;
  const tablet = isTablet();

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
        // Audyt 3 (N-185): lustro wyłączone świadomie zostaje wyłączone (np. połączenie po zmianie zgody na „Tylko
        // dodawanie”); na iPadzie domyślnie wyłączone (N-57, Q21 cz. 1 A) — włączysz je w Ustawieniach.
        const on = mirror || ((await prefs!.get(CAL_MIRROR).catch(() => null)) === null && !tablet);
        setReadState(true);
        setMirrorState(on);
        await Promise.all([prefs!.set(CAL_READ, '1'), prefs!.set(CAL_MIRROR, on ? '1' : '0')]).catch(() => {});
        return true;
      },
      setRead: (on) => {
        setReadState(on);
        prefs?.set(CAL_READ, on ? '1' : '0').catch(() => {});
      },
      setMirror: (on) => {
        setMirrorState(on);
        prefs?.set(CAL_MIRROR, on ? '1' : '0').catch(() => {});
        // Audyt 3 (N-184): po końcu przebiegu w toku (wyłączenie przerywa go po bieżącym kroku) — razem z tym, co założył.
        if (!on && sync && local)
          void runDone.current
            .then(() => clearMirror(sync, local, owned))
            .then(() => setMirrorRev((n) => n + 1))
            .catch((e: unknown) => report(e, 'calendar-mirror-off'));
      },
      groups,
      setGroupMirrored: (id, on) => {
        const next = on ? mirrorSkip.filter((x) => x !== id) : [...new Set([...mirrorSkip, id])];
        setMirrorSkip(next);
        local?.save(MIRROR_SKIP_KEY, JSON.stringify(next));
      },
      mirrorCalendar: (eventId, occurrenceDate, date) => (mirrorOn ? inMirror()(eventId, occurrenceDate, date) : null),
      openSettings: () => void Linking.openSettings().catch(() => {}),
      mirrorFailed: mirrorOn && mirrorFailed,
      mirrorStale,
      tablet,
    }),
    [available, status, read, mirror, days, calendars, skip, sync, prefs, local, report, groups, mirrorSkip, mirrorOn, inMirror, owned, mirrorFailed, mirrorStale, tablet],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
