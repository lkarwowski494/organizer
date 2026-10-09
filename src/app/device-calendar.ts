/**
 * „Dodaj do kalendarza” (D7: tylko zapis, bez odczytu kalendarza). expo-calendar SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/): requestCalendarPermissions(writeOnly = true) — iOS 17+ pyta
 * o samo dodawanie wydarzeń; getDefaultCalendarSync() przy dostępie tylko do zapisu zwraca wirtualny kalendarz
 * EventKit, a addEventWithForm otwiera systemowy formularz z wypełnionymi polami — zapisuje dopiero użytkownik.
 * iOS 16 (najniższy, config.IOS_MIN) nie zna zgody tylko na zapis: expo-calendar prosi wtedy o zwykły dostęp do
 * kalendarza (CalendarWriteOnlyNextPermissionsRequester.swift: `if #available(iOS 17.0, *) { requestWriteOnlyAccessToEvents }
 * else { requestAccess(to: .event) }`, opis z NSCalendarsUsageDescription) — jedno okno zgody, potem ten sam formularz.
 */
import {
  createCalendar,
  EntityTypes,
  ExpoCalendar,
  ExpoCalendarEvent,
  getCalendarPermissions,
  getCalendars,
  getDefaultCalendarSync,
  listEvents,
  requestCalendarPermissions,
} from 'expo-calendar';

import type { DeviceEvent } from '../domain/views/calendar-sync';

import { config } from '../config';
import { addDays, type CivilDate } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { endDayOffset, lengthMinutes } from '../domain/span';
import { strings } from '../i18n/strings.pl';
import { localToMs } from '../domain/local-time';

export type CalendarDraft = { title: string; start: Date; end: Date; allDay: boolean; notes?: string; location?: string | null };
/**
 * Stan zgody na kalendarz. `writeOnly` (iOS 17+, po „Dodaj do kalendarza”): moduł pełnego dostępu expo-calendar
 * zwraca wtedy odmowę bez ponownego pytania (CalendarNextPermissionsRequester: `.writeOnly` → denied), ale iOS pokaże
 * okno pełnego dostępu („The operating system only prompts them the first time your app requests full access to
 * events”, https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents(completion:)),
 * więc „Połącz z kalendarzem” ma sens (audyt 2, M-217).
 */
export type CalendarStatus = 'granted' | 'denied' | 'undetermined' | 'writeOnly';
export type CalendarResult = 'saved' | 'canceled' | 'denied';
/**
 * Kalendarz w obie strony (D95, ADR 0021) — pełny dostęp. Klasy expo-calendar SDK 57: getCalendars, createCalendar,
 * listEvents, ExpoCalendar.get / createEvent / delete, ExpoCalendarEvent.get / update / delete
 * (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/, typy w node_modules/expo-calendar/build/ExpoCalendar.types.d.ts).
 */
export type DeviceCalendarSync = {
  status(): Promise<CalendarStatus>;
  request(): Promise<boolean>;
  listEvents(from: Date, to: Date): Promise<DeviceEvent[]>;
  createCalendar(title: string, color: string): Promise<string>;
  /** Nazwa i kolor kalendarza (ExpoCalendar.update — modyfikowalne są tylko `color` i `title`). */
  updateCalendar(id: string, title: string, color: string): Promise<void>;
  hasCalendar(id: string): Promise<boolean>;
  deleteCalendar(id: string): Promise<void>;
  createEvent(calendarId: string, d: CalendarDraft): Promise<string>;
  updateEvent(id: string, d: CalendarDraft): Promise<void>;
  deleteEvent(id: string): Promise<void>;
};

export type DeviceCalendar = { add(e: CalendarDraft): Promise<CalendarResult>; sync?: DeviceCalendarSync };

export const expoDeviceCalendar: DeviceCalendar = {
  async add(e) {
    const p = await requestCalendarPermissions(true);
    if (!p.granted) return 'denied';
    const r = await getDefaultCalendarSync().addEventWithForm({ title: e.title, startDate: e.start, endDate: e.end, allDay: e.allDay, notes: e.notes, location: e.location ?? undefined });
    return r.action === 'saved' ? 'saved' : 'canceled';
  },
  sync: {
    async status() {
      const p = await getCalendarPermissions(false);
      if (p.granted) return 'granted';
      if (p.canAskAgain) return 'undetermined';
      return (await getCalendarPermissions(true)).granted ? 'writeOnly' : 'denied';
    },
    async request() {
      return (await requestCalendarPermissions(false)).granted;
    },
    async listEvents(from, to) {
      const cals = await getCalendars(EntityTypes.EVENT);
      const titles = new Map(cals.map((c) => [c.id, c.title]));
      const evs = cals.length ? await listEvents(cals.map((c) => c.id), from, to) : [];
      return evs.map((e) => toDeviceEvent(e, titles.get(e.calendarId) ?? ''));
    },
    async updateCalendar(id, title, color) {
      await (await ExpoCalendar.get(id)).update({ title, color });
    },
    async createCalendar(title, color) {
      // Źródło (konto) jak domyślny kalendarz — na iPhonie zwykle iCloud; dokumentacja nie mówi, czy jest wymagane.
      const source = getDefaultCalendarSync().source;
      const cal = await createCalendar({ title, color, entityType: EntityTypes.EVENT, source, sourceId: source?.id, name: title });
      return cal.id;
    },
    async hasCalendar(id) {
      return ExpoCalendar.get(id).then(
        () => true,
        () => false,
      );
    },
    async deleteCalendar(id) {
      await (await ExpoCalendar.get(id)).delete();
    },
    async createEvent(calendarId, d) {
      const cal = await ExpoCalendar.get(calendarId);
      return (await cal.createEvent({ title: d.title, startDate: d.start, endDate: d.end, allDay: d.allDay, notes: d.notes, location: d.location ?? null })).id;
    },
    async updateEvent(id, d) {
      // Usunięte miejsce: `null` („To remove a property, explicitly set it to null in details” — dokumentacja update; klasa
      // ExpoCalendarEvent sama przekazuje pola z null jako nullableFields, node_modules/expo-calendar/build/Calendar.js).
      await (await ExpoCalendarEvent.get(id)).update({ title: d.title, startDate: d.start, endDate: d.end, allDay: d.allDay, notes: d.notes, location: d.location ?? null });
    },
    async deleteEvent(id) {
      await (await ExpoCalendarEvent.get(id)).delete();
    },
  },
};

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Data w strefie telefonu (wydarzenia całodniowe iPhone'a zaczynają się o lokalnej północy). */
const localIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Znacznik Organizera w notatce wydarzenia iPhone'a (D173): ostatni wiersz. */
export const withMark = (notes: string) => `${notes}\n\n${strings['device.mark']}`;
const hasMark = (notes: string | null | undefined) => (notes ?? '').split('\n').some((l) => l.trim() === strings['device.mark']);

export function toDeviceEvent(
  e: { id: string; calendarId: string; title: string; startDate: string | Date; endDate: string | Date; allDay: boolean; notes?: string | null; location?: string | null },
  calendarTitle: string,
): DeviceEvent {
  const start = new Date(e.startDate);
  const end = new Date(e.endDate);
  const base = { id: e.id, calendarId: e.calendarId, calendarTitle, title: e.title, organizer: hasMark(e.notes), location: e.location?.trim() || null };
  if (!e.allDay) return { ...base, allDay: false, startMs: start.getTime(), endMs: end.getTime() };
  // Koniec całodniowego bywa podany jako 23:59:59 ostatniego dnia albo północ dnia następnego — w obu razach
  // koniec wyłączny = dzień po ostatnim dniu.
  const lastDay = new Date(end.getTime() - 1);
  const endExclusive = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  // Koniec równy początkowi (zdarza się przy jednodniowych) — co najmniej jeden dzień.
  const atLeast = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { ...base, allDay: true, startDate: localIso(start), endDate: localIso(endExclusive > atLeast ? endExclusive : atLeast) };
}

/** Domyślna długość wydarzenia bez godziny końca w kalendarzu iPhone'a (min, config.calendar). */
const DEFAULT_MINUTES = config.calendar.DEFAULT_EVENT_MINUTES;

/**
 * Wystąpienie (dzień, godziny Europe/Warsaw) → szkic wydarzenia kalendarza iPhone'a.
 *  - Całodniowe od lokalnej północy telefonu do północy po ostatnim dniu (audyt 2, M-219): iPhone pokazuje całodniowe
 *    w swojej strefie (`timeZone: null` = strefa urządzenia, https://docs.expo.dev/versions/v57.0.0/sdk/calendar/), więc
 *    północ warszawska w Nowym Jorku dawała poprzedni dzień. Wielodniowe (D199) — `days` dni, koniec wyłączny jak DTEND
 *    (RFC 5545 §3.6.1: „specifies the non-inclusive end of the event”).
 *  - Z godziną — chwile według Europe/Warsaw (R2); koniec nie później niż początek = następnego dnia, a z zapisaną
 *    długością — dzień startu + długość (D199, span.ts).
 *    Koniec nie wcześniej niż początek: godzina nieistniejąca wiosną przesuwa początek o godzinę (clock.ts), więc koniec
 *    liczymy wtedy od początku z tą samą długością.
 */
export function draftOf(o: { title: string; date: string; startTime: string | null; endTime: string | null; days?: number; durationMin?: number | null; location?: string | null }, notes?: string): CalendarDraft {
  const d = parseIsoDate(o.date);
  const base = { title: o.title, notes, ...(o.location ? { location: o.location } : {}) };
  if (o.startTime === null) return { ...base, start: new Date(d.y, d.m - 1, d.d), end: new Date(d.y, d.m - 1, d.d + (o.days ?? 1)), allDay: true };
  const at = (day: CivilDate, hhmm: string) => new Date(localToMs({ ...day, hh: Number(hhmm.slice(0, 2)), mm: Number(hhmm.slice(3, 5)) }));
  const start = at(d, o.startTime);
  const length = lengthMinutes(o.startTime, o.endTime, o.durationMin ?? null) ?? DEFAULT_MINUTES;
  const end = o.endTime ? at(addDays(d, endDayOffset(o.startTime, length)), o.endTime) : null;
  return { ...base, start, end: end && end > start ? end : new Date(start.getTime() + length * 60_000), allDay: false };
}
