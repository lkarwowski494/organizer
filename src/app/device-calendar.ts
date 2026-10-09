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
  getCalendarPermissions,
  getCalendars,
  getDefaultCalendarSync,
  getSourcesSync,
  listEvents,
  requestCalendarPermissions,
} from 'expo-calendar';
// Audyt 3 (N-5): zmiana i usuwanie wydarzeń przez API „legacy” tego samego pakietu (ten sam EKEventStore,
// CalendarModule.sharedEventStore) — patrz DeviceCalendarSync niżej.
import { Availability, deleteEventAsync, getEventAsync, updateEventAsync } from 'expo-calendar/legacy';

import { type DeviceEvent, linkKey } from '../domain/views/calendar-sync';

import { config } from '../config';
import { addDays, type CivilDate } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { endDayOffset, lengthMinutes } from '../domain/span';
import { strings } from '../i18n/strings.pl';
import { localToMs } from '../domain/local-time';

/** `url` — link do terminu w aplikacji (eventLink): po nim odczyt rozpoznaje kopię z „Dodaj do kalendarza” (audyt 3, N-183). */
export type CalendarDraft = { title: string; start: Date; end: Date; allDay: boolean; notes?: string; location?: string | null; url?: string };
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
 * listEvents, ExpoCalendar.get / createEvent / delete (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/, typy
 * w node_modules/expo-calendar/build/ExpoCalendar.types.d.ts).
 * Audyt 3 (N-5): wydarzenie zmieniamy, usuwamy i sprawdzamy przez expo-calendar/legacy (getEventAsync,
 * updateEventAsync, deleteEventAsync — https://docs.expo.dev/versions/v57.0.0/sdk/calendar-legacy/), nie przez
 * ExpoCalendarEvent.get. W expo-calendar 57.0.5 identyfikator wydarzenia (`id` z createEvent i listEvents) to
 * `calendarItemIdentifier` (ios/Next/CalendarNextModule.swift: Property("id") → `event?.calendarItemIdentifier`), a
 * ExpoCalendarEvent.get szuka przez `eventStore.event(withIdentifier:)` (tamże, getEventById). Apple: tamta metoda
 * przyjmuje `eventIdentifier` („You can use this identifier to look up an event with the EKEventStore method
 * event(withIdentifier:)”, https://developer.apple.com/documentation/eventkit/ekevent/eventidentifier), a
 * `calendarItemIdentifier` ma swoją („Use calendarItem(withIdentifier:) to look up the item by this value”,
 * https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemidentifier) — nic nie mówi, że to te
 * same wartości. Legacy szuka spójnie przez `calendarItem(withIdentifier:)` (ios/CalendarModule.swift, getEvent(with:)).
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
  /** Wydarzenia już nie ma — bez błędu (legacy deleteEventAsync: `guard let calendarEvent else { return }`). */
  deleteEvent(id: string): Promise<void>;
  hasEvent(id: string): Promise<boolean>;
};

export type DeviceCalendar = { add(e: CalendarDraft): Promise<CalendarResult>; sync?: DeviceCalendarSync };

const EVENT_NOT_FOUND = 'ERR_EVENT_NOT_FOUND';

/** Konta do założenia kalendarza lustra (audyt 3, N-58): domyślne, iCloud, „Na moim iPhonie” — bez powtórzeń. */
function calendarSources() {
  const out: NonNullable<ReturnType<typeof getDefaultCalendarSync>['source']>[] = [];
  const add = (s: (typeof out)[number] | undefined | null) => {
    if (s && !out.some((x) => x.id === s.id)) out.push(s);
  };
  try {
    add(getDefaultCalendarSync().source);
  } catch {
    // Bez kalendarza domyślnego — dalej po liście kont.
  }
  const all = getSourcesSync();
  // iCloud to konto CalDAV o nazwie „iCloud” (tak nazywa je iPhone; typ SourceType w expo-calendar nie ma osobnego).
  for (const s of all) if (s.type === 'caldav' && s.name === 'iCloud') add(s);
  for (const s of all) if (s.type === 'local') add(s);
  return out;
}

export const expoDeviceCalendar: DeviceCalendar = {
  async add(e) {
    const p = await requestCalendarPermissions(true);
    if (!p.granted) return 'denied';
    const r = await getDefaultCalendarSync().addEventWithForm({ title: e.title, startDate: e.start, endDate: e.end, allDay: e.allDay, notes: e.notes, location: e.location ?? undefined, url: e.url });
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
      // Audyt 3 (N-58): gdy konto domyślne nie pozwala założyć kalendarza (np. konto innego dostawcy — do sprawdzenia na
      // urządzeniu), próbujemy iCloud, potem „Na moim iPhonie”; błąd ostatniej próby wychodzi do lustra (komunikat).
      let last: unknown = null;
      for (const source of calendarSources()) {
        try {
          return (await createCalendar({ title, color, entityType: EntityTypes.EVENT, source, sourceId: source.id, name: title })).id;
        } catch (e) {
          last = e;
        }
      }
      throw last ?? new Error('NoCalendarSource');
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
      // Legacy przepisuje pola wprost (ios/CalendarModule.swift, initializeEvent: `calendarEvent.location =
      // event.location`; pola rekordu Event bez `?` mają wartość pustą), więc usunięte miejsce = pusty tekst, a
      // dostępność podajemy jawnie („Zajęty”, jak nowe wydarzenie w iPhonie) — pusta dawałaby `.notSupported`.
      await updateEventAsync(id, { title: d.title, startDate: d.start, endDate: d.end, allDay: d.allDay, notes: d.notes ?? '', location: d.location ?? '', availability: Availability.BUSY });
    },
    async deleteEvent(id) {
      await deleteEventAsync(id);
    },
    async hasEvent(id) {
      // Tylko „nie ma takiego wydarzenia” to false; inny błąd (np. brak zgody) wychodzi — lustro nic wtedy nie tworzy.
      // Kod z nazwy wyjątku EventNotFoundException (expo-modules-core ios/Core/Exceptions/CodedError.swift,
      // errorCodeFromString: „ERR_” + nazwa bez „Exception”, słowa rozdzielone „_”).
      return getEventAsync(id).then(
        () => true,
        (e: unknown) => {
          if ((e as { code?: unknown } | null)?.code === EVENT_NOT_FOUND) return false;
          throw e;
        },
      );
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
  e: { id: string; calendarId: string; title: string; startDate: string | Date; endDate: string | Date; allDay: boolean; notes?: string | null; location?: string | null; url?: string | null },
  calendarTitle: string,
): DeviceEvent {
  const start = new Date(e.startDate);
  const end = new Date(e.endDate);
  const base = { id: e.id, calendarId: e.calendarId, calendarTitle, title: e.title, organizer: hasMark(e.notes), location: e.location?.trim() || null, link: linkKey(e.url) };
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
