/**
 * „Dodaj do kalendarza” (D7: tylko zapis, bez odczytu kalendarza). expo-calendar SDK 57
 * (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/): requestCalendarPermissions(writeOnly = true) — iOS 17+ pyta
 * o samo dodawanie wydarzeń; getDefaultCalendarSync() przy dostępie tylko do zapisu zwraca wirtualny kalendarz
 * EventKit, a addEventWithForm otwiera systemowy formularz z wypełnionymi polami — zapisuje dopiero użytkownik.
 */
import { getDefaultCalendarSync, requestCalendarPermissions } from 'expo-calendar';

import { addDays, formatIsoDate } from '../domain/civil-date';
import { parseIsoDate } from '../domain/format';
import { localToMs } from './clock';

export type CalendarDraft = { title: string; start: Date; end: Date; allDay: boolean; notes?: string };
export type CalendarResult = 'saved' | 'canceled' | 'denied';
export type DeviceCalendar = { add(e: CalendarDraft): Promise<CalendarResult> };

export const expoDeviceCalendar: DeviceCalendar = {
  async add(e) {
    const p = await requestCalendarPermissions(true);
    if (!p.granted) return 'denied';
    const r = await getDefaultCalendarSync().addEventWithForm({ title: e.title, startDate: e.start, endDate: e.end, allDay: e.allDay, notes: e.notes });
    return r.action === 'saved' ? 'saved' : 'canceled';
  },
};

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
