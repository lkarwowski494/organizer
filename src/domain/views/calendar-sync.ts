/**
 * Kalendarz iPhone'a w obie strony (D95, D96; ADR 0021) — czysta logika, bez expo-calendar.
 *  1. Odczyt: moje wydarzenia z kalendarzy iPhone'a (także kont Google/Outlook dodanych w iPhonie) pokazujemy obok
 *     spraw grup. Zostają na telefonie (D96) — nie trafiają do kolejki synchronizacji ani na serwer.
 *  2. Lustro grup: wydarzenia każdej grupy telefon utrzymuje w osobnym kalendarzu „Organizer – <grupa>”. Każde
 *     wystąpienie to osobne wydarzenie (bez reguł powtarzania — iPhone nie musi rozumieć naszych wyjątków), w oknie
 *     [dziś − MIRROR_DAYS_BACK, dziś + MIRROR_DAYS_AHEAD]. Plan to różnica między tym, co powinno być, a zapisanym
 *     stanem (identyfikatory wydarzeń iPhone'a i skrót treści): utwórz / zmień / usuń.
 *  Kalendarze lustra nie są czytane jako „moje wydarzenia” (inaczej sprawy grup pokazałyby się dwa razy).
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate } from '../civil-date';
import { expandEvents } from './events';
import { groupsView } from './index';
import type { Tables } from './model';

/** Wydarzenie z kalendarza iPhone'a. Całodniowe — daty (koniec wyłącznie); z godziną — chwile (ms). */
export type DeviceEvent =
  | { id: string; calendarId: string; calendarTitle: string; title: string; allDay: true; startDate: string; endDate: string }
  | { id: string; calendarId: string; calendarTitle: string; title: string; allDay: false; startMs: number; endMs: number };

export type DeviceEntry = { key: string; title: string; calendarId: string; calendarTitle: string; time: string | null; endTime: string | null; continued: boolean };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Moje wydarzenia iPhone'a po dniach (ISO → wpisy) w [from, to]. `toLocal` zamienia chwilę na czas Europe/Warsaw.
 * Wydarzenie przez kilka dni pokazuje się w każdym; godzina tylko pierwszego dnia, kolejne jako „cd.”.
 */
export function deviceDays(
  events: readonly DeviceEvent[],
  from: CivilDate,
  to: CivilDate,
  toLocal: (ms: number) => { y: number; m: number; d: number; hh: number; mm: number },
  exclude: ReadonlySet<string>,
): Map<string, DeviceEntry[]> {
  const out = new Map<string, DeviceEntry[]>();
  const isoFrom = formatIsoDate(from);
  const isoTo = formatIsoDate(to);
  const push = (iso: string, e: DeviceEntry) => {
    if (iso < isoFrom || iso > isoTo) return;
    out.set(iso, [...(out.get(iso) ?? []), e]);
  };
  for (const e of events) {
    if (exclude.has(e.calendarId)) continue;
    const base = { key: `d|${e.id}`, title: e.title, calendarId: e.calendarId, calendarTitle: e.calendarTitle };
    if (e.allDay) {
      for (let d = e.startDate, i = 0; d < e.endDate && i < 366; i++) {
        push(d, { ...base, time: null, endTime: null, continued: d !== e.startDate });
        d = formatIsoDate(addDays(isoDate(d), 1));
      }
      continue;
    }
    const s = toLocal(e.startMs);
    // Koniec wyłącznie: wydarzenie do północy nie wchodzi na następny dzień.
    const end = toLocal(Math.max(e.startMs, e.endMs - 1));
    const first = formatIsoDate(s);
    const last = formatIsoDate(end);
    const sameDay = first === last;
    for (let d = first, i = 0; d <= last && i < 366; i++) {
      push(d, {
        ...base,
        time: d === first ? `${pad(s.hh)}:${pad(s.mm)}` : null,
        endTime: sameDay ? `${pad(toLocal(e.endMs).hh)}:${pad(toLocal(e.endMs).mm)}` : null,
        continued: d !== first,
      });
      d = formatIsoDate(addDays(isoDate(d), 1));
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'pl'));
  return out;
}

/** Kalendarze iPhone'a z pobranych wydarzeń (do wyboru w Ustawieniach, D106), bez kalendarzy lustra, po nazwie. */
export function deviceCalendars(events: readonly DeviceEvent[], exclude: ReadonlySet<string>): { id: string; title: string }[] {
  const m = new Map<string, string>();
  for (const e of events) if (!exclude.has(e.calendarId)) m.set(e.calendarId, e.calendarTitle);
  return [...m].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]!)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= config.calendar.DUPLICATE_MIN_WORD && !/^\d+$/.test(w)),
  );
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Dubel (D107): wydarzenie z iPhone'a, które opisuje to samo co wpis w aplikacji tego dnia — oba z godziną
 * (różnica najwyżej config.calendar.DUPLICATE_WINDOW_MIN minut) albo oba bez godziny, i wspólne słowo nazwy
 * (co najmniej DUPLICATE_MIN_WORD liter, bez liczb, bez polskich znaków). Kolejne dni wielodniowego („cd.”) nie są dublami.
 */
export function isDuplicate(e: DeviceEntry, app: readonly { title: string; time: string | null }[]): boolean {
  if (e.continued) return false;
  const mine = words(e.title);
  return app.some((a) => {
    const t = a.time?.slice(0, 5) ?? null;
    const timeOk = e.time === null || t === null ? e.time === t : Math.abs(minutes(e.time) - minutes(t)) <= config.calendar.DUPLICATE_WINDOW_MIN;
    return timeOk && [...words(a.title)].some((w) => mine.has(w));
  });
}

export const withoutDuplicates = (entries: readonly DeviceEntry[], app: readonly { title: string; time: string | null }[]) => entries.filter((e) => !isDuplicate(e, app));

const isoDate = (s: string): CivilDate => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });

/** Jedno wystąpienie wydarzenia grupy w lustrze. */
export type MirrorItem = { key: string; groupId: string; title: string; date: string; startTime: string | null; endTime: string | null; notes: string };

export type MirrorState = {
  /** grupa → identyfikator kalendarza iPhone'a */
  calendars: { [groupId: string]: string };
  /** klucz wystąpienia → wydarzenie iPhone'a i skrót treści */
  events: { [key: string]: { id: string; calendarId: string; hash: string } };
};

export const emptyMirror = (): MirrorState => ({ calendars: {}, events: {} });

/** Co powinno być w lustrze: wystąpienia wszystkich moich grup w oknie, z osobą odpowiedzialną w nazwie. */
export function mirrorItems(t: Tables, userId: string, today: CivilDate, back: number, ahead: number): MirrorItem[] {
  return expandEvents(t, userId, addDays(today, -back), addDays(today, ahead)).map((o) => ({
    key: `${o.eventId}|${o.occurrenceDate}`,
    groupId: o.groupId,
    title: o.responsibleName ? `${o.title} (${o.responsibleName})` : o.title,
    date: o.date,
    startTime: o.startTime?.slice(0, 5) ?? null,
    endTime: o.endTime?.slice(0, 5) ?? null,
    notes: o.groupName,
  }));
}

export const mirrorHash = (i: MirrorItem) => JSON.stringify([i.title, i.date, i.startTime, i.endTime, i.notes]);

/** Nazwa kalendarza lustra. */
export const mirrorCalendarTitle = (groupName: string) => `Organizer – ${groupName}`;

export type MirrorPlan = {
  /** Grupy, które potrzebują nowego kalendarza (nazwa jak w aplikacji). */
  createCalendars: { groupId: string; title: string }[];
  /** Kalendarze grup, których już nie mam (usunięte, wyszedłem) — usunąć razem z wydarzeniami. */
  removeCalendars: { groupId: string; calendarId: string }[];
  create: MirrorItem[];
  update: { deviceId: string; item: MirrorItem }[];
  remove: { key: string; deviceId: string }[];
};

/**
 * Różnica: stan zapisany → stan docelowy. Najwyżej `max` wystąpień (najbliższe dacie `todayIso`), żeby nie zalać
 * kalendarza przy wielu seriach. Wydarzenia w kalendarzach usuwanych grup znikają razem z kalendarzem.
 */
export function planMirror(items: readonly MirrorItem[], state: MirrorState, groups: readonly { id: string; name: string }[], todayIso: string, max: number): MirrorPlan {
  const live = new Set(groups.map((g) => g.id));
  const removeCalendars = Object.entries(state.calendars)
    .filter(([g]) => !live.has(g))
    .map(([groupId, calendarId]) => ({ groupId, calendarId }));
  const gone = new Set(removeCalendars.map((c) => c.calendarId));
  const wanted = [...items]
    .filter((i) => live.has(i.groupId))
    .sort((a, b) => Math.abs(dayNo(a.date) - dayNo(todayIso)) - Math.abs(dayNo(b.date) - dayNo(todayIso)) || a.key.localeCompare(b.key))
    .slice(0, max);
  const byKey = new Map(wanted.map((i) => [i.key, i]));
  const needCalendars = new Set(wanted.map((i) => i.groupId));
  const createCalendars = groups.filter((g) => needCalendars.has(g.id) && !state.calendars[g.id]).map((g) => ({ groupId: g.id, title: mirrorCalendarTitle(g.name) }));
  const create: MirrorItem[] = [];
  const update: MirrorPlan['update'] = [];
  const remove: MirrorPlan['remove'] = [];
  for (const [key, ev] of Object.entries(state.events)) {
    const item = byKey.get(key);
    if (gone.has(ev.calendarId)) continue;
    // Brak w docelowym albo wydarzenie zostało w kalendarzu innej grupy (nie zmieniamy grupy wydarzenia w iPhonie).
    if (!item || state.calendars[item.groupId] !== ev.calendarId) remove.push({ key, deviceId: ev.id });
    else if (mirrorHash(item) !== ev.hash) update.push({ deviceId: ev.id, item });
  }
  const kept = new Set(Object.entries(state.events).filter(([key, ev]) => byKey.has(key) && state.calendars[byKey.get(key)!.groupId] === ev.calendarId).map(([key]) => key));
  for (const i of wanted) if (!kept.has(i.key)) create.push(i);
  return { createCalendars, removeCalendars, create: create.sort((a, b) => a.key.localeCompare(b.key)), update, remove };
}

const dayNo = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Czy dane są już pobrane na tyle, żeby układać lustro (audyt 8.10.2026). Po „Wyczyść dane na telefonie” (D121) albo
 * przed pierwszym pobraniem nie ma żadnej grupy, a planMirror usunąłby wtedy kalendarze wszystkich grup z iPhone'a
 * (iOS nie odtworzy ich kolorów i ustawień). Czekamy, aż każda moja grupa ma kursor pobierania.
 */
export function mirrorReady(t: Tables, userId: string, cursors: Readonly<Record<string, number>>): boolean {
  const groups = groupsView(t, userId);
  return groups.length > 0 && groups.every((g) => cursors[g.id] !== undefined);
}

/** Grupy do lustra: wszystkie moje (osobista też — jej wydarzenia też są „grupowe” w aplikacji). */
export const mirrorGroups = (t: Tables, userId: string) => groupsView(t, userId).map((g) => ({ id: g.id, name: g.kind === 'personal' ? PERSONAL_NAME : g.name }));

/** Nazwa grupy osobistej w kalendarzu iPhone'a (jak w aplikacji: strings['groups.personal']). */
export const PERSONAL_NAME = 'Osobiste';
