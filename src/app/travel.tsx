/**
 * Dojazd do dzisiejszych wydarzeń (D116, D117; ADR 0029): ustawienia na tym telefonie (środek transportu, aplikacja
 * nawigacji, włączenie), zmiana środka przy wydarzeniu (tylko u mnie), czas dojazdu z Map Apple odświeżany co
 * config.travel.REFRESH_MIN minut i przy powrocie do aplikacji, „Wyjdź o …” i „Nawiguj”.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { config } from '../config';
import { formatIsoDate } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { isTravelMode, leaveAt, type NavApp, navigationUrl, type TravelMode, travelMinutes, travelTargets } from '../domain/travel';
import { expandEvents } from '../domain/views/events';
import { localToMs } from './clock';
import { useAppData, useServices } from './context';
import { appVersion, toClientError } from './diagnostics';
import type { Coords } from './travel-service';

export const TRAVEL_ON = 'travelEnabled';
export const TRAVEL_MODE = 'travelMode';
export const NAV_APP = 'navApp';
const MODES_KEY = 'travelModes';
const GEO_KEY = 'travelGeo';

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
  navigate(location: string, eventId: string): void;
};

const noop = () => {};
const Ctx = createContext<Api>({
  available: false, enabled: false, status: null, mode: 'driving', navApp: 'apple',
  setEnabled: async () => {}, setMode: noop, setNavApp: noop, modeFor: () => 'driving', setEventMode: noop, info: () => null, navigate: noop,
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

export function TravelProvider({ children }: { children: ReactNode }) {
  const { travel, prefs, local, account, userId, nowMs } = useServices();
  const { tables, today } = useAppData();
  const available = !!travel && !!prefs && !!local;
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<Api['status']>(null);
  const [mode, setModeState] = useState<TravelMode>('driving');
  const [navApp, setNavAppState] = useState<NavApp>('apple');
  // Zmiany środka transportu przy wydarzeniach — tylko na tym telefonie (lokalna baza).
  const [overrides, setOverrides] = useState<Record<string, TravelMode>>(() => {
    const saved = (local && parse(local.load(MODES_KEY), isRecord)) || {};
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, TravelMode] => isTravelMode(e[1])));
  });
  const [results, setResults] = useState<Record<string, { seconds: number; mode: TravelMode }>>({});
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
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setTick((n) => n + 1));
    const timer = setInterval(() => setTick((n) => n + 1), config.travel.REFRESH_MIN * 60_000);
    return () => {
      live = false;
      sub.remove();
      clearInterval(timer);
    };
  }, [available, travel, prefs, local]);

  const modeFor = useCallback((eventId: string) => overrides[eventId] ?? mode, [overrides, mode]);
  const isoToday = formatIsoDate(today);
  const targets = useMemo(
    () =>
      travelTargets(expandEvents(tables, userId, today, today), isoToday, nowMs(), (d, t) => localToMs({ ...parseIsoDate(d), hh: Number(t.slice(0, 2)), mm: Number(t.slice(3, 5)) }), modeFor),
    [tables, userId, today, isoToday, nowMs, modeFor, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const signature = targets.map((t) => `${t.key}:${t.location}:${t.mode}:${t.startMs}`).join('|');

  useEffect(() => {
    if (!available || !enabled || status !== 'granted' || targets.length === 0) return;
    let live = true;
    (async () => {
      const here = await travel!.position();
      if (!here || !live) return;
      const geo = parse(local!.load(GEO_KEY), isRecord) ?? {};
      const next: Record<string, { seconds: number; mode: TravelMode }> = {};
      for (const t of targets) {
        let to = geo[t.location] as Coords | null | undefined;
        if (to === undefined) {
          to = await travel!.geocode(t.location);
          geo[t.location] = to;
        }
        if (!to) continue;
        next[t.key] = { seconds: await travel!.eta(here, to, t.mode, nowMs()), mode: t.mode };
      }
      local!.save(GEO_KEY, JSON.stringify(geo));
      if (live) setResults(next);
    })().catch((e: unknown) => {
      if (reported.current) return;
      reported.current = true;
      account.reportError(toClientError(e, 'error', 'travel', appVersion())).catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [available, enabled, status, signature, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo<Api>(() => {
    const starts = new Map(targets.map((t) => [t.key, t.startMs]));
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
      info: (eventId, occurrenceDate) => {
        const key = `${eventId}|${occurrenceDate}`;
        const r = results[key];
        const start = starts.get(key);
        if (!enabled || !r || start === undefined || r.mode !== modeFor(eventId)) return null;
        return { minutes: travelMinutes(r.seconds), leaveMs: leaveAt(start, r.seconds), mode: r.mode };
      },
      navigate: (location, eventId) => void Linking.openURL(navigationUrl(navApp, location, modeFor(eventId), String(Platform.Version))).catch(() => {}),
    };
  }, [available, enabled, status, mode, navApp, modeFor, overrides, results, targets, travel, prefs, local]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
