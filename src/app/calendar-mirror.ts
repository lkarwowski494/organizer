/**
 * Wykonanie planu lustra (D95, ADR 0021) na kalendarzu iPhone'a. Plan liczy domain/views/calendar-sync.ts; tu kolejne
 * kroki z zapisem stanu po każdym, żeby przerwanie (zamknięcie aplikacji, błąd) nie zostawiło dubli przy następnym razie.
 *  - Kalendarz usunięty ręcznie w iPhonie → zapominamy go z wydarzeniami i tworzymy od nowa.
 *  - Wydarzenie usunięte ręcznie → zmiana nie wyjdzie, więc tworzymy je ponownie.
 *  - Audyt 2 (M-27, D172): kalendarze utworzone na tym telefonie (dowolnym kontem) zapisujemy też w pęku kluczy
 *    telefonu (`MirrorOwned`, przeżywa wylogowanie i zwykle reinstalację). Kalendarz z tej listy, którego nie zna stan
 *    zalogowanego konta (drugie konto, reinstalacja), jest pozostałością — usuwamy go zamiast tworzyć drugi o tej samej
 *    nazwie. Cudzych kalendarzy (np. iPada z tym samym iCloud) nie ruszamy — nie ma ich na liście tego telefonu.
 */
import { config } from '../config';
import { type CivilDate, formatIsoDate } from '../domain/civil-date';
import { calendarLook, emptyMirror, mirrorGroups, mirrorHash, mirrorItems, type MirrorItem, type MirrorState, planMirror } from '../domain/views/calendar-sync';
import type { Tables } from '../domain/views/model';
import type { ScopeOf } from '../domain/views/my-scope';
import { strings } from '../i18n/strings.pl';
import type { Prefs } from './context';
import { type DeviceCalendar, type DeviceCalendarSync, draftOf, withMark } from './device-calendar';

export const MIRROR_KEY = 'calendarMirror';
/** D174: grupy, których nie ma w lustrze (JSON: lista identyfikatorów), w bazie konta. */
export const MIRROR_SKIP_KEY = 'calendarMirrorSkip';
/** Pęk kluczy telefonu: identyfikatory kalendarzy lustra utworzonych na tym telefonie (JSON: lista). */
export const MIRROR_OWNED = 'calendarMirrorOwned';
export type LocalStore = { load(key: string): string | null; save(key: string, value: string | null): void };

const parseIds = (v: string | null): string[] => {
  try {
    const x: unknown = JSON.parse(v ?? '[]');
    return Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
  } catch {
    return [];
  }
};
export const loadSkip = (local: LocalStore) => parseIds(local.load(MIRROR_SKIP_KEY));

/** Lista kalendarzy lustra tego telefonu w pęku kluczy. */
export type MirrorOwned = { get(): Promise<string[]>; set(ids: string[]): Promise<void> };
export const ownedIn = (prefs: Prefs): MirrorOwned => ({
  get: async () => parseIds(await prefs.get(MIRROR_OWNED)),
  set: (ids) => prefs.set(MIRROR_OWNED, JSON.stringify([...new Set(ids)])),
});

export function loadMirror(local: LocalStore): MirrorState {
  try {
    const s = JSON.parse(local.load(MIRROR_KEY) ?? 'null') as MirrorState | null;
    return s && typeof s === 'object' && s.calendars && s.events ? s : emptyMirror();
  } catch {
    return emptyMirror();
  }
}

const draft = (i: MirrorItem) => draftOf({ title: i.title, date: i.date, startTime: i.startTime, endTime: i.endTime, location: i.location }, withMark(i.notes));

/** Przerwanie przebiegu (wylogowanie, wyłączenie lustra) — po bieżącym kroku nic więcej nie zmieniamy w iPhonie. */
class Stopped extends Error {}

export async function runMirror(
  sync: DeviceCalendarSync,
  local: LocalStore,
  t: Tables,
  userId: string,
  today: CivilDate,
  opts: { owned?: MirrorOwned; alive?: () => boolean; scopeOf?: ScopeOf } = {},
): Promise<{ created: number; updated: number; removed: number }> {
  const alive = opts.alive ?? (() => true);
  const step = () => {
    if (!alive()) throw new Stopped();
  };
  const state = loadMirror(local);
  const save = () => local.save(MIRROR_KEY, JSON.stringify(state));
  const forget = (calendarId: string) => {
    for (const [k, e] of Object.entries(state.events)) if (e.calendarId === calendarId) delete state.events[k];
  };
  try {
    // Kalendarze usunięte ręcznie w iPhonie.
    for (const [g, id] of Object.entries(state.calendars)) {
      if (!(await sync.hasCalendar(id))) {
        delete state.calendars[g];
        delete state.looks?.[g];
        forget(id);
      }
    }
    // Pozostałości z tego telefonu (inne konto, reinstalacja) — usunąć; kalendarze ze stanu dopisać do listy telefonu.
    let owned = opts.owned ? await opts.owned.get() : [];
    const mine = new Set(Object.values(state.calendars));
    for (const id of owned.filter((x) => !mine.has(x))) {
      step();
      await sync.deleteCalendar(id).catch(() => {});
    }
    const keep = async (ids: string[]) => {
      owned = ids;
      await opts.owned?.set(ids);
    };
    if (owned.some((x) => !mine.has(x)) || [...mine].some((x) => !owned.includes(x))) await keep([...mine]);
    const skip = new Set(loadSkip(local));
    const groups = mirrorGroups(t, userId, skip);
    const items = mirrorItems(t, userId, today, config.calendar.MIRROR_DAYS_BACK, config.calendar.MIRROR_DAYS_AHEAD, skip, strings['lessons.title'], opts.scopeOf);
    const todayIso = formatIsoDate(today);
    const first = planMirror(items, state, groups, todayIso, config.calendar.MIRROR_MAX);
    for (const c of first.removeCalendars) {
      step();
      await sync.deleteCalendar(c.calendarId).catch(() => {});
      delete state.calendars[c.groupId];
      delete state.looks?.[c.groupId];
      forget(c.calendarId);
      save();
      await keep(owned.filter((x) => x !== c.calendarId));
    }
    for (const c of first.createCalendars) {
      step();
      const id = await sync.createCalendar(c.title, c.color);
      state.calendars[c.groupId] = id;
      state.looks = { ...state.looks, [c.groupId]: calendarLook(c.title, c.color) };
      save();
      await keep([...owned, id]);
    }
    // Nazwa i kolor nadążają za grupą (audyt 2, M-27, P-27).
    for (const c of first.updateCalendars) {
      step();
      await sync.updateCalendar(c.calendarId, c.title, c.color);
      state.looks = { ...state.looks, [c.groupId]: calendarLook(c.title, c.color) };
      save();
    }
    const plan = planMirror(items, state, groups, todayIso, config.calendar.MIRROR_MAX);
    for (const r of plan.remove) {
      step();
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
      step();
      try {
        await sync.updateEvent(u.deviceId, draft(u.item));
        state.events[u.item.key] = { ...state.events[u.item.key]!, hash: mirrorHash(u.item) };
        save();
      } catch {
        await put(u.item);
      }
    }
    for (const c of plan.create) {
      step();
      await put(c);
    }
    return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
  } catch (e) {
    if (e instanceof Stopped) return { created: 0, updated: 0, removed: 0 };
    throw e;
  }
}

/** Wyłączenie lustra: usuwamy nasze kalendarze (iPhone usuwa z nimi wydarzenia) i zapomniany stan. */
export async function clearMirror(sync: DeviceCalendarSync, local: LocalStore, owned?: MirrorOwned): Promise<void> {
  const state = loadMirror(local);
  const ids = Object.values(state.calendars);
  for (const id of ids) await sync.deleteCalendar(id).catch(() => {});
  local.save(MIRROR_KEY, null);
  if (owned) await owned.set((await owned.get()).filter((x) => !ids.includes(x)));
}

/**
 * D172 (decyzja właściciela 8.10.2026, audyt 2 M-27): wylogowanie, usunięcie konta i zalogowanie innego konta usuwają
 * kalendarze „Organizer – …” utworzone na tym telefonie (iPhone usuwa z nimi wydarzenia). Baza aplikacji zostaje; stan
 * lustra konta wskazuje wtedy nieistniejące kalendarze, więc po ponownym zalogowaniu lustro odtworzy je samo
 * (`hasCalendar` w runMirror). Bez pełnej zgody na kalendarz nic się nie dzieje (iOS nie pozwoli usunąć).
 */
export async function removeMirrorCalendars(calendar: DeviceCalendar, prefs: Prefs | undefined): Promise<void> {
  if (!calendar.sync || !prefs) return;
  const owned = ownedIn(prefs);
  const ids = await owned.get();
  if (!ids.length || (await calendar.sync.status()) !== 'granted') return;
  for (const id of ids) await calendar.sync.deleteCalendar(id).catch(() => {});
  // Tylko usunięte — kalendarz utworzony w tym czasie przez nowo zalogowane konto zostaje na liście.
  await owned.set((await owned.get()).filter((x) => !ids.includes(x)));
}
