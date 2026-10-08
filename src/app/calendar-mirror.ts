/**
 * Wykonanie planu lustra (D95, ADR 0021) na kalendarzu iPhone'a. Plan liczy domain/views/calendar-sync.ts; tu kolejne
 * kroki z zapisem stanu po każdym, żeby przerwanie (zamknięcie aplikacji, błąd) nie zostawiło dubli przy następnym razie.
 *  - Kalendarz usunięty ręcznie w iPhonie → zapominamy go z wydarzeniami i tworzymy od nowa.
 *  - Wydarzenie usunięte ręcznie → zmiana nie wyjdzie, więc tworzymy je ponownie.
 */
import { config } from '../config';
import { groupLines } from '../config/theme';
import { type CivilDate, formatIsoDate } from '../domain/civil-date';
import { emptyMirror, mirrorGroups, mirrorHash, mirrorItems, type MirrorItem, type MirrorState, planMirror } from '../domain/views/calendar-sync';
import { groupsView } from '../domain/views';
import type { Tables } from '../domain/views/model';
import { type DeviceCalendarSync, draftOf } from './device-calendar';

export const MIRROR_KEY = 'calendarMirror';
export type LocalStore = { load(key: string): string | null; save(key: string, value: string | null): void };

export function loadMirror(local: LocalStore): MirrorState {
  try {
    const s = JSON.parse(local.load(MIRROR_KEY) ?? 'null') as MirrorState | null;
    return s && typeof s === 'object' && s.calendars && s.events ? s : emptyMirror();
  } catch {
    return emptyMirror();
  }
}

const draft = (i: MirrorItem) => draftOf({ title: i.title, date: i.date, startTime: i.startTime, endTime: i.endTime }, i.notes);

export async function runMirror(sync: DeviceCalendarSync, local: LocalStore, t: Tables, userId: string, today: CivilDate): Promise<{ created: number; updated: number; removed: number }> {
  const state = loadMirror(local);
  const save = () => local.save(MIRROR_KEY, JSON.stringify(state));
  const forget = (calendarId: string) => {
    for (const [k, e] of Object.entries(state.events)) if (e.calendarId === calendarId) delete state.events[k];
  };
  // Kalendarze usunięte ręcznie w iPhonie.
  for (const [g, id] of Object.entries(state.calendars)) {
    if (!(await sync.hasCalendar(id))) {
      delete state.calendars[g];
      forget(id);
    }
  }
  const lines = new Map(groupsView(t, userId).map((g) => [g.id, g.line]));
  const groups = mirrorGroups(t, userId);
  const items = mirrorItems(t, userId, today, config.calendar.MIRROR_DAYS_BACK, config.calendar.MIRROR_DAYS_AHEAD);
  const todayIso = formatIsoDate(today);
  const first = planMirror(items, state, groups, todayIso, config.calendar.MIRROR_MAX);
  for (const c of first.removeCalendars) {
    await sync.deleteCalendar(c.calendarId).catch(() => {});
    delete state.calendars[c.groupId];
    forget(c.calendarId);
    save();
  }
  for (const c of first.createCalendars) {
    state.calendars[c.groupId] = await sync.createCalendar(c.title, groupLines[lines.get(c.groupId)!]!.light.line);
    save();
  }
  const plan = planMirror(items, state, groups, todayIso, config.calendar.MIRROR_MAX);
  for (const r of plan.remove) {
    await sync.deleteEvent(r.deviceId).catch(() => {});
    delete state.events[r.key];
    save();
  }
  const put = async (i: MirrorItem) => {
    const calendarId = state.calendars[i.groupId]!;
    state.events[i.key] = { id: await sync.createEvent(calendarId, draft(i)), calendarId, hash: mirrorHash(i) };
    save();
  };
  for (const u of plan.update) {
    try {
      await sync.updateEvent(u.deviceId, draft(u.item));
      state.events[u.item.key] = { ...state.events[u.item.key]!, hash: mirrorHash(u.item) };
      save();
    } catch {
      await put(u.item);
    }
  }
  for (const c of plan.create) await put(c);
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}

/** Wyłączenie lustra: usuwamy nasze kalendarze (iPhone usuwa z nimi wydarzenia) i zapomniany stan. */
export async function clearMirror(sync: DeviceCalendarSync, local: LocalStore): Promise<void> {
  const state = loadMirror(local);
  for (const id of Object.values(state.calendars)) await sync.deleteCalendar(id).catch(() => {});
  local.save(MIRROR_KEY, null);
}
