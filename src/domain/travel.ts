/**
 * Nawigacja i „wyjdź o” (D115–D117, ADR 0029).
 *  - „Nawiguj”: link do Map Apple albo Google Maps z celem i środkiem transportu.
 *    Mapy Apple, iOS 18.4+: https://maps.apple.com/directions?destination=…&mode=driving|walking|transit
 *    (https://developer.apple.com/documentation/mapkit/unified-map-urls); starsze iOS: ?daddr=…&dirflg=d|w|r
 *    (dawny opis Map Links: „Only the daddr parameter is required”). Google: https://www.google.com/maps/dir/?api=1
 *    &destination=…&travelmode=driving|walking|transit — otwiera aplikację, gdy jest zainstalowana
 *    (https://developers.google.com/maps/documentation/urls/get-started).
 *  - „Wyjdź o”: początek wydarzenia − czas dojazdu − zapas (config.travel.BUFFER_MIN), zaokrąglone w dół do minuty.
 */
import { config } from '../config';

export type TravelMode = 'driving' | 'transit' | 'walking';
export type NavApp = 'apple' | 'google';
export const TRAVEL_MODES: readonly TravelMode[] = ['driving', 'transit', 'walking'];

const DIRFLG: Record<TravelMode, string> = { driving: 'd', transit: 'r', walking: 'w' };

/** `iosVersion` jak Platform.Version na iOS („18.4”, „17.5.1”). */
export function navigationUrl(app: NavApp, destination: string, mode: TravelMode, iosVersion: string): string {
  const d = encodeURIComponent(destination.trim());
  if (app === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=${mode}`;
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
 * Wydarzenia, dla których liczymy dojazd (D116): dzisiejsze, które mnie dotyczą, z miejscem i godziną, zaczynające się
 * od teraz do config.travel.AHEAD_HOURS naprzód; najbliższe config.travel.MAX_EVENTS (MapKit dławi zbyt wiele zapytań).
 * `skip` — terminy z moją odpowiedzią „nie będę” (`<id wydarzenia>|<data wystąpienia>`, PW-23).
 */
export function travelTargets(
  occ: readonly { eventId: string; occurrenceDate: string; date: string; startTime: string | null; title: string; location: string | null; concernsMe: boolean }[],
  isoToday: string,
  nowMs: number,
  toMs: (date: string, time: string) => number,
  modeFor: (eventId: string) => TravelMode,
  skip: ReadonlySet<string> = new Set(),
): TravelTarget[] {
  return occ
    .filter((o) => o.concernsMe && o.date === isoToday && o.startTime !== null && o.location !== null && o.location.trim() !== '' && !skip.has(`${o.eventId}|${o.occurrenceDate}`))
    .map((o) => ({ key: `${o.eventId}|${o.occurrenceDate}`, eventId: o.eventId, title: o.title, location: o.location!.trim(), startMs: toMs(o.date, o.startTime!.slice(0, 5)), mode: modeFor(o.eventId) }))
    .filter((t) => t.startMs > nowMs && t.startMs <= nowMs + config.travel.AHEAD_HOURS * 3_600_000)
    .sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key))
    .slice(0, config.travel.MAX_EVENTS);
}
