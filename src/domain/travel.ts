/**
 * Nawigacja i „wyjdź o” (D115–D117, ADR 0029).
 *  - „Nawiguj”: link do Map Apple z celem i środkiem transportu (tylko Mapy Apple — ADR 0043).
 *    Mapy Apple, iOS 18.4+: https://maps.apple.com/directions?destination=…&mode=driving|walking|transit
 *    (https://developer.apple.com/documentation/mapkit/unified-map-urls); starsze iOS: ?daddr=…&dirflg=d|w|r
 *    (dawny opis Map Links: „Only the daddr parameter is required”).
 *  - „Wyjdź o”: początek wydarzenia − czas dojazdu − zapas (config.travel.BUFFER_MIN), zaokrąglone w dół do minuty.
 */
import { config } from '../config';
import { type ScopeOf, occurrenceInScope, scopeAll } from './views/my-scope';

export type TravelMode = 'driving' | 'transit' | 'walking';
export const TRAVEL_MODES: readonly TravelMode[] = ['driving', 'transit', 'walking'];

const DIRFLG: Record<TravelMode, string> = { driving: 'd', transit: 'r', walking: 'w' };

/** `iosVersion` jak Platform.Version na iOS („18.4”, „17.5.1”). */
export function navigationUrl(destination: string, mode: TravelMode, iosVersion: string): string {
  const d = encodeURIComponent(destination.trim());
  const v = iosVersion.split('.').map((x) => Number(x) || 0);
  const unified = v[0]! * 100 + (v[1] ?? 0) >= 1804;
  return unified ? `https://maps.apple.com/directions?destination=${d}&mode=${mode}` : `https://maps.apple.com/?daddr=${d}&dirflg=${DIRFLG[mode]}`;
}

/** Chwila wyjścia (ms): start − dojazd − zapas, w dół do pełnej minuty. */
export function leaveAt(startMs: number, travelSeconds: number, bufferMin: number = config.travel.BUFFER_MIN): number {
  const ms = startMs - travelSeconds * 1000 - bufferMin * 60_000;
  return Math.floor(ms / 60_000) * 60_000;
}

/** Minuty dojazdu do pokazania (w górę, co najmniej 1). */
export const travelMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

export const isTravelMode = (v: unknown): v is TravelMode => v === 'driving' || v === 'transit' || v === 'walking';

export type TravelTarget = { key: string; eventId: string; title: string; location: string; startMs: number; mode: TravelMode };

/**
 * Wydarzenia, dla których liczymy dojazd (D116): te, które mnie dotyczą, z miejscem i godziną (lekcje dziecka — tylko
 * pierwsza w dniu), zaczynające się od teraz
 * do config.travel.AHEAD_HOURS naprzód — także jutro po północy (audyt 2, M-211: wieczorem „Czas wyjść” na 0:30);
 * najbliższe config.travel.MAX_EVENTS (MapKit dławi zbyt wiele zapytań).
 * `skip` — terminy wyciszone (`<id wydarzenia>|<data wystąpienia>`): moje „nie będę” (PW-23) i dzieci, które nie będą (D160);
 * `scopeOf` — zakres Moich spraw w grupach (PW-2): dojazd tylko do tego, co stoi w Moich sprawach.
 */
export function travelTargets(
  occ: readonly { eventId: string; occurrenceDate: string; date: string; startTime: string | null; title: string; location: string | null; concernsMe: boolean; assignedToMe: boolean; groupId: string; lessonFor?: readonly { memberId: string }[] | null }[],
  nowMs: number,
  toMs: (date: string, time: string) => number,
  modeFor: (eventId: string) => TravelMode,
  skip: ReadonlySet<string> = new Set(),
  scopeOf: ScopeOf = scopeAll,
): TravelTarget[] {
  const usable = occ.filter((o) => occurrenceInScope(o, scopeOf) && o.startTime !== null && o.location !== null && o.location.trim() !== '' && !skip.has(`${o.eventId}|${o.occurrenceDate}`));
  // Audyt 3 (N-189): lekcje dziecka (D127) to w Moich sprawach i w lustrze jeden blok dnia, więc dojazd — jeden cel na
  // dziecko i dzień: pierwsza lekcja z miejscem (wybrana przed oknem czasu — po jej początku następna lekcja nie dostaje
  // „Wyjdź o”, bo dziecko jest już na miejscu).
  const first = new Map<string, (typeof usable)[number]>();
  for (const o of [...usable].sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.eventId.localeCompare(b.eventId)))
    for (const c of o.lessonFor ?? []) if (!first.has(`${c.memberId}|${o.date}`)) first.set(`${c.memberId}|${o.date}`, o);
  const firstLessons = new Set(first.values());
  return usable
    .filter((o) => !o.lessonFor || firstLessons.has(o))
    .map((o) => ({ key: `${o.eventId}|${o.occurrenceDate}`, eventId: o.eventId, title: o.title, location: o.location!.trim(), startMs: toMs(o.date, o.startTime!.slice(0, 5)), mode: modeFor(o.eventId) }))
    .filter((t) => t.startMs > nowMs && t.startMs <= nowMs + config.travel.AHEAD_HOURS * 3_600_000)
    .sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key))
    .slice(0, config.travel.MAX_EVENTS);
}

/** Współrzędne adresu z geokodera. */
export type GeoPoint = { lat: number; lng: number };
/** Pamięć geokodera na telefonie: adres → współrzędne albo „nie znaleziono” (null) i chwila sprawdzenia (ms). */
export type GeoCache = Record<string, { c: GeoPoint | null; at: number }>;

const isPoint = (x: unknown): x is GeoPoint => typeof x === 'object' && x !== null && typeof (x as GeoPoint).lat === 'number' && typeof (x as GeoPoint).lng === 'number';

/**
 * Odczyt zapisanej pamięci (audyt 2, M-106). Dawny zapis (adres → współrzędne albo null bez daty) przechodzi z chwilą 0:
 * współrzędne zostają, a „nie znaleziono” sprawdzamy od razu znowu.
 */
export function readGeoCache(x: unknown): GeoCache {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return {};
  const out: GeoCache = {};
  for (const [k, v] of Object.entries(x)) {
    if (isPoint(v)) out[k] = { c: v, at: 0 };
    else if (v === null) out[k] = { c: null, at: 0 };
    else if (typeof v === 'object' && typeof (v as { at?: unknown }).at === 'number' && ((v as { c?: unknown }).c === null || isPoint((v as { c?: unknown }).c))) out[k] = v as GeoCache[string];
  }
  return out;
}

/**
 * Co wiemy o adresie: współrzędne, `null` (Mapy go nie znalazły — sprawdzimy znowu po config.travel.GEO_RETRY_H godzinach)
 * albo `undefined` — trzeba zapytać geokoder (audyt 2, M-106: wcześniej chwilowy błąd albo literówka zostawały na zawsze).
 */
export function geoLookup(cache: GeoCache, address: string, nowMs: number): GeoPoint | null | undefined {
  const e = cache[address];
  if (!e) return undefined;
  if (e.c === null && nowMs - e.at >= config.travel.GEO_RETRY_H * 3_600_000) return undefined;
  return e.c;
}

/** Zapis wyniku; najwyżej config.travel.GEO_MAX adresów (zostają najświeżej sprawdzone). */
export function geoStore(cache: GeoCache, address: string, c: GeoPoint | null, nowMs: number): GeoCache {
  const next = { ...cache, [address]: { c, at: nowMs } };
  const keys = Object.keys(next);
  if (keys.length <= config.travel.GEO_MAX) return next;
  const keep = new Set(keys.sort((a, b) => next[b]!.at - next[a]!.at || a.localeCompare(b)).slice(0, config.travel.GEO_MAX));
  return Object.fromEntries(Object.entries(next).filter(([k]) => keep.has(k)));
}

/**
 * Chwila odjazdu do zapytania o czas dojazdu (audyt 2, M-106): korki zależą od godziny, więc pytamy o odjazd o porze
 * wyjścia (start − poprzedni wynik − zapas), nie „teraz”; nigdy wcześniej niż teraz. Bez poprzedniego wyniku — teraz
 * (drugie zapytanie poprawia wynik od razu, travel.tsx).
 */
export function departureMs(startMs: number, previousSeconds: number | null, nowMs: number): number {
  return previousSeconds === null ? nowMs : Math.max(nowMs, leaveAt(startMs, previousSeconds));
}

/**
 * Policzony dojazd zapamiętany na telefonie (D159): planowanie przypomnień w tle nie pyta o położenie (zgoda tylko
 * „podczas używania”, D116), więc korzysta z ostatniego wyniku z otwartej aplikacji — tylko dla tego samego miejsca
 * i środka transportu.
 */
export type TravelResult = { seconds: number; mode: TravelMode; location: string };

/** Odczyt zapisanych wyników; uszkodzone pozycje pomijane. */
export function readTravelResults(x: unknown): Record<string, TravelResult> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return {};
  return Object.fromEntries(
    Object.entries(x as Record<string, unknown>).filter((e): e is [string, TravelResult] => {
      const r = e[1] as Partial<TravelResult> | null;
      return typeof r === 'object' && r !== null && typeof r.seconds === 'number' && isTravelMode(r.mode) && typeof r.location === 'string';
    }),
  );
}

/** „Wyjdź o” dla terminu `key` z celów i wyników; inny środek albo miejsce niż przy liczeniu — brak (null). */
export function travelInfoFor(targets: readonly TravelTarget[], results: Readonly<Record<string, TravelResult>>, key: string): { minutes: number; leaveMs: number; mode: TravelMode } | null {
  const t = targets.find((x) => x.key === key);
  const r = results[key];
  if (!t || !r || r.mode !== t.mode || r.location !== t.location) return null;
  return { minutes: travelMinutes(r.seconds), leaveMs: leaveAt(t.startMs, r.seconds), mode: r.mode };
}
