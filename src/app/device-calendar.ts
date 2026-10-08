/**
 * „Dodaj do kalendarza” (D7: tylko zapis, bez odczytu kalendarza). expo-calendar SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/): requestCalendarPermissions(writeOnly = true) — iOS 17+ pyta
 * o samo dodawanie wydarzeń; getDefaultCalendarSync() przy dostępie tylko do zapisu zwraca wirtualny kalendarz
 * EventKit, a addEventWithForm otwiera systemowy formularz z wypełnionymi polami — zapisuje dopiero użytkownik.
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

import { addDays, formatIsoDate } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { localToMs } from './clock';

export type CalendarDraft = { title: string; start: Date; end: Date; allDay: boolean; notes?: string };
export type CalendarResult = 'saved' | 'canceled' | 'denied';
/**
 * Kalendarz w obie strony (D95, ADR 0021) — pełny dostęp. Klasy expo-calendar SDK 57: getCalendars, createCalendar,
 * listEvents, ExpoCalendar.get / createEvent / delete, ExpoCalendarEvent.get / update / delete
 * (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/, typy w node_modules/expo-calendar/build/ExpoCalendar.types.d.ts).
 */
export type DeviceCalendarSync = {
  status(): Promise<'granted' | 'denied' | 'undetermined'>;
  request(): Promise<boolean>;
  listEvents(from: Date, to: Date): Promise<DeviceEvent[]>;
  createCalendar(title: string, color: string): Promise<string>;
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
    const r = await getDefaultCalendarSync().addEventWithForm({ title: e.title, startDate: e.start, endDate: e.end, allDay: e.allDay, notes: e.notes });
    return r.action === 'saved' ? 'saved' : 'canceled';
  },
  sync: {
    async status() {
      const p = await getCalendarPermissions(false);
      return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
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
      return (await cal.createEvent({ title: d.title, startDate: d.start, endDate: d.end, allDay: d.allDay, notes: d.notes })).id;
    },
    async updateEvent(id, d) {
      await (await ExpoCalendarEvent.get(id)).update({ title: d.title, startDate: d.start, endDate: d.end, allDay: d.allDay, notes: d.notes });
    },
    async deleteEvent(id) {
      await (await ExpoCalendarEvent.get(id)).delete();
    },
  },
};

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Data w strefie telefonu (wydarzenia całodniowe iPhone'a zaczynają się o lokalnej północy). */
const localIso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function toDeviceEvent(e: { id: string; calendarId: string; title: string; startDate: string | Date; endDate: string | Date; allDay: boolean }, calendarTitle: string): DeviceEvent {
  const start = new Date(e.startDate);
  const end = new Date(e.endDate);
  const base = { id: e.id, calendarId: e.calendarId, calendarTitle, title: e.title };
  if (!e.allDay) return { ...base, allDay: false, startMs: start.getTime(), endMs: end.getTime() };
  // Koniec całodniowego bywa podany jako 23:59:59 ostatniego dnia albo północ dnia następnego — w obu razach
  // koniec wyłączny = dzień po ostatnim dniu.
  const lastDay = new Date(end.getTime() - 1);
  const endExclusive = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1);
  // Koniec równy początkowi (zdarza się przy jednodniowych) — co najmniej jeden dzień.
  const atLeast = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { ...base, allDay: true, startDate: localIso(start), endDate: localIso(endExclusive > atLeast ? endExclusive : atLeast) };
}

/** Domyślna długość wydarzenia bez godziny końca w kalendarzu iPhone'a (min). Wybór projektowy, bez źródła. */
const DEFAULT_MINUTES = 60;

/** Wystąpienie (dzień, godziny Europe/Warsaw) → szkic wydarzenia kalendarza iPhone'a. */
export function draftOf(o: { title: string; date: string; startTime: string | null; endTime: string | null }, notes?: string): CalendarDraft {
  const d = parseIsoDate(o.date);
  const at = (date: typeof d, hhmm: string) => new Date(localToMs({ ...date, hh: Number(hhmm.slice(0, 2)), mm: Number(hhmm.slice(3, 5)) }));
  if (o.startTime === null) return { title: o.title, start: at(d, '00:00'), end: at(parseIsoDate(formatIsoDate(addDays(d, 1))), '00:00'), allDay: true, notes };
  const start = at(d, o.startTime);
  return { title: o.title, start, end: o.endTime ? at(d, o.endTime) : new Date(start.getTime() + DEFAULT_MINUTES * 60_000), allDay: false, notes };
}
