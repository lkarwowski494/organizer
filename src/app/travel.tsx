/**
 * Dojazd do najbliższych wydarzeń (D116, D117; ADR 0029; okno AHEAD_HOURS także po północy — audyt 2, M-211): ustawienia konta na tym telefonie (D175; środek transportu, aplikacja
 * nawigacji, włączenie), zmiana środka przy wydarzeniu (tylko u mnie), czas dojazdu z Map Apple odświeżany co
 * config.travel.REFRESH_MIN minut i przy powrocie do aplikacji, „Wyjdź o …” i „Nawiguj”.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { config } from '../config';
import { addDays } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { type CivilDate } from '../domain/civil-date';
import { departureMs, type GeoCache, geoLookup, geoStore, isTravelMode, type NavApp, navigationUrl, readGeoCache, readTravelResults, type TravelMode, type TravelResult, travelInfoFor, type TravelTarget, travelTargets } from '../domain/travel';
import type { Tables } from '../domain/views/model';
import { expandEvents } from '../domain/views/events';
import { silencedForMe } from '../domain/views/rsvp';
import { localToMs } from './clock';
import type { LocalStore } from './calendar-mirror';
import { type Prefs, useAppData, useServices } from './context';
import { storedScopes, useMyScope } from './my-scope';
import { type ScopeOf, scopeAll } from '../domain/views/my-scope';
import { appVersion, toClientError } from './diagnostics';

export const TRAVEL_ON = 'travelEnabled';
export const TRAVEL_MODE = 'travelMode';
export const NAV_APP = 'navApp';
const MODES_KEY = 'travelModes';
const GEO_KEY = 'travelGeo';
/** Ostatnie wyniki dojazdu (D159): z nich „Czas wyjść” planuje się także w tle, bez pytania o położenie. */
export const RESULTS_KEY = 'travelResults';

export type TravelInfo = { minutes: number; leaveMs: number; mode: TravelMode };

type Api = {
  available: boolean;
  enabled: boolean;
  status: 'granted' | 'denied' | 'undetermined' | null;
  mode: TravelMode;
  navApp: NavApp;
  setEnabled(on: boolean): Promise<void>;
  setMode(m: TravelMode): void;
  setNavApp(a: NavApp): void;
  modeFor(eventId: string): TravelMode;
  setEventMode(eventId: string, m: TravelMode | null): void;
  info(eventId: string, occurrenceDate: string): TravelInfo | null;
  /** M-106: Mapy nie znalazły tego adresu (przy ostatnim sprawdzeniu). */
  notFound(location: string): boolean;
  /** M-218: ponowna prośba o zgodę na lokalizację (np. po wygaśnięciu „Pozwól raz”). */
  requestPermission(): Promise<void>;
  navigate(location: string, eventId: string): void;
};

const noop = () => {};
const Ctx = createContext<Api>({
  available: false, enabled: false, status: null, mode: 'driving', navApp: 'apple',
  setEnabled: async () => {}, setMode: noop, setNavApp: noop, modeFor: () => 'driving', setEventMode: noop, info: () => null, notFound: () => false, requestPermission: async () => {}, navigate: noop,
});
export const useTravel = () => useContext(Ctx);

const parse = <T,>(s: string | null, ok: (x: unknown) => x is T): T | null => {
  try {
    const x: unknown = JSON.parse(s ?? 'null');
    return ok(x) ? x : null;
  } catch {
    return null;
  }
};
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const savedModes = (local: LocalStore): Record<string, TravelMode> =>
  Object.fromEntries(Object.entries(parse(local.load(MODES_KEY), isRecord) ?? {}).filter((e): e is [string, TravelMode] => isTravelMode(e[1])));

/** Cele dojazdu: dziś i jutro (okno AHEAD_HOURS sięga po północy, audyt 2, M-211), bez terminów wyciszonych. */
function targetsFor(tables: Tables, userId: string, today: CivilDate, nowMs: number, modeFor: (eventId: string) => TravelMode, scopeOf: ScopeOf = scopeAll): TravelTarget[] {
  return travelTargets(expandEvents(tables, userId, today, addDays(today, 1)), nowMs, (d, t) => localToMs({ ...parseIsoDate(d), hh: Number(t.slice(0, 2)), mm: Number(t.slice(3, 5)) }), modeFor, silencedForMe(tables, userId), scopeOf);
}

/**
 * Dojazd z zapisanych ustawień i ostatnich wyników — do planowania przypomnień w tle (D159), gdy aplikacja nie jest
 * otwarta. Ta sama reguła co `info` dostawcy niżej (travelInfoFor).
 */
export async function savedTravel(prefs: Prefs, local: LocalStore, tables: Tables, userId: string, today: CivilDate, nowMs: number): Promise<(eventId: string, occurrenceDate: string) => TravelInfo | null> {
  if ((await prefs.get(TRAVEL_ON)) !== '1') return () => null;
  const m = await prefs.get(TRAVEL_MODE);
  const mode: TravelMode = isTravelMode(m) ? m : 'driving';
  const overrides = savedModes(local);
  const results = readTravelResults(parse(local.load(RESULTS_KEY), isRecord));
  const targets = targetsFor(tables, userId, today, nowMs, (id) => overrides[id] ?? mode, storedScopes(tables, userId));
  return (eventId, occurrenceDate) => travelInfoFor(targets, results, `${eventId}|${occurrenceDate}`);
}

export function TravelProvider({ children }: { children: ReactNode }) {
  const { travel, prefs, local, account, userId, nowMs } = useServices();
  const { tables, today } = useAppData();
  const { scopeOf } = useMyScope();
  const available = !!travel && !!prefs && !!local;
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<Api['status']>(null);
  const [mode, setModeState] = useState<TravelMode>('driving');
  const [navApp, setNavAppState] = useState<NavApp>('apple');
  // Zmiany środka transportu przy wydarzeniach — tylko na tym telefonie (lokalna baza).
  const [overrides, setOverrides] = useState<Record<string, TravelMode>>(() => (local ? savedModes(local) : {}));
  const [results, setResults] = useState<Record<string, TravelResult>>({});
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  // Poprzednie wyniki — pora odjazdu do kolejnego zapytania (M-106).
  const previous = useRef<Record<string, TravelResult>>({});
  const [tick, setTick] = useState(0);
  const reported = useRef(false);

  useEffect(() => {
    if (!available) return;
    let live = true;
    Promise.all([travel!.status(), prefs!.get(TRAVEL_ON), prefs!.get(TRAVEL_MODE), prefs!.get(NAV_APP)])
      .then(([s, on, m, a]) => {
        if (!live) return;
        setStatus(s);
        setEnabledState(on === '1');
        if (isTravelMode(m)) setModeState(m);
        if (a === 'google') setNavAppState('google');
      })
      .catch(() => {});
    // Powrót do aplikacji: dojazd od nowa, a zgoda na lokalizację mogła się zmienić w Ustawieniach iPhone'a (audyt 2, N-21).
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      setTick((n) => n + 1);
      travel!
        .status()
        .then((s) => live && setStatus(s))
        .catch(() => {});
    });
    const timer = setInterval(() => setTick((n) => n + 1), config.travel.REFRESH_MIN * 60_000);
    return () => {
      live = false;
      sub.remove();
      clearInterval(timer);
    };
  }, [available, travel, prefs, local]);

  const modeFor = useCallback((eventId: string) => overrides[eventId] ?? mode, [overrides, mode]);
  const targets = useMemo(
    () => targetsFor(tables, userId, today, nowMs(), modeFor, scopeOf),
    [tables, userId, today, nowMs, modeFor, tick, scopeOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const signature = targets.map((t) => `${t.key}:${t.location}:${t.mode}:${t.startMs}`).join('|');

  const report = (e: unknown) => {
    if (reported.current) return;
    reported.current = true;
    // Audyt 2 (M-159): komunikat geokodera albo MapKit może zawierać adres — tylko nazwa i kod błędu.
    account.reportError(toClientError(e, 'error', 'travel', appVersion(), { private: true })).catch(() => {});
  };

  useEffect(() => {
    if (!available || !enabled || status !== 'granted' || targets.length === 0) return;
    let live = true;
    (async () => {
      const here = await travel!.position();
      if (!here || !live) return;
      let geo: GeoCache = readGeoCache(parse(local!.load(GEO_KEY), isRecord));
      const next: Record<string, TravelResult> = {};
      const notFound = new Set<string>();
      // Błąd jednego wydarzenia (np. brak komunikacji w MapKit) nie kasuje pozostałych (ADR 0029; audyt 8.10.2026).
      for (const t of targets) {
        try {
          let to = geoLookup(geo, t.location, nowMs());
          if (to === undefined) {
            to = await travel!.geocode(t.location);
            geo = geoStore(geo, t.location, to, nowMs());
          }
          if (!to) {
            notFound.add(t.location);
            continue;
          }
          // Odjazd o porze wyjścia (korki o 18:00, nie o 8:00); bez poprzedniego wyniku — drugie zapytanie od razu.
          const prev = previous.current[t.key];
          const before = prev && prev.mode === t.mode && prev.location === t.location ? prev.seconds : null;
          let seconds = await travel!.eta(here, to, t.mode, departureMs(t.startMs, before, nowMs()));
          if (before === null && departureMs(t.startMs, seconds, nowMs()) > nowMs()) seconds = await travel!.eta(here, to, t.mode, departureMs(t.startMs, seconds, nowMs()));
          next[t.key] = { seconds, mode: t.mode, location: t.location };
        } catch (e: unknown) {
          report(e);
        }
      }
      local!.save(GEO_KEY, JSON.stringify(geo));
      previous.current = { ...previous.current, ...next };
      if (live) {
        local!.save(RESULTS_KEY, JSON.stringify(next));
        setResults(next);
        setMissing(notFound);
      }
    })().catch(report);
    return () => {
      live = false;
    };
  }, [available, enabled, status, signature, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo<Api>(() => {
    return {
      available,
      enabled,
      status,
      mode,
      navApp,
      setEnabled: async (on) => {
        if (on && travel && status !== 'granted') {
          const ok = await travel.request().catch(() => false);
          setStatus(ok ? 'granted' : 'denied');
          if (!ok) return;
        }
        setEnabledState(on);
        prefs?.set(TRAVEL_ON, on ? '1' : '0').catch(() => {});
      },
      setMode: (m) => (setModeState(m), prefs?.set(TRAVEL_MODE, m).catch(() => {})),
      setNavApp: (a) => (setNavAppState(a), prefs?.set(NAV_APP, a).catch(() => {})),
      modeFor,
      setEventMode: (eventId, m) => {
        const next = { ...overrides };
        if (m === null) delete next[eventId];
        else next[eventId] = m;
        setOverrides(next);
        local?.save(MODES_KEY, JSON.stringify(next));
      },
      info: (eventId, occurrenceDate) => (enabled ? travelInfoFor(targets, results, `${eventId}|${occurrenceDate}`) : null),
      notFound: (location) => enabled && missing.has(location.trim()),
      requestPermission: async () => {
        if (!travel) return;
        const ok = await travel.request().catch(() => false);
        setStatus(ok ? 'granted' : await travel.status().catch(() => 'denied' as const));
      },
      navigate: (location, eventId) => void Linking.openURL(navigationUrl(navApp, location, modeFor(eventId), String(Platform.Version))).catch(() => {}),
    };
  }, [available, enabled, status, mode, navApp, modeFor, overrides, results, missing, targets, travel, prefs, local]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
