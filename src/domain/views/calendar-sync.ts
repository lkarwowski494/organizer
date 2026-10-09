/**
 * Kalendarz iPhone'a w obie strony (D95, D96; ADR 0021) — czysta logika, bez expo-calendar.
 *  1. Odczyt: moje wydarzenia z kalendarzy iPhone'a (także kont Google/Outlook dodanych w iPhonie) pokazujemy obok
 *     spraw grup. Zostają na telefonie (D96) — nie trafiają do kolejki synchronizacji ani na serwer.
 *  2. Lustro grup: wydarzenia każdej grupy telefon utrzymuje w osobnym kalendarzu „Organizer – <grupa>”. Każde
 *     wystąpienie to osobne wydarzenie (bez reguł powtarzania — iPhone nie musi rozumieć naszych wyjątków), w oknie
 *     [dziś − MIRROR_DAYS_BACK, dziś + MIRROR_DAYS_AHEAD]. Plan to różnica między tym, co powinno być, a zapisanym
 *     stanem (identyfikatory wydarzeń iPhone'a i skrót treści): utwórz / zmień / usuń.
 *     D174 (decyzja właściciela 8.10.2026, audyt 2 M-97): tylko sprawy, które mnie dotyczą (ta sama reguła co Moje
 *     sprawy), lekcje dziecka jednym wpisem na dzień (jak D127), wybrane grupy (Ustawienia → Kalendarz i dojazd).
 *  Kalendarze lustra nie są czytane jako „moje wydarzenia” (inaczej sprawy grup pokazałyby się dwa razy) — także
 *  kalendarze „Organizer – …” spoza stanu tego konta (drugie konto, iPad z tym samym iCloud, stara instalacja).
 */
import { config } from '../../config';
import { groupLines } from '../../config/theme';
import { addDays, type CivilDate, formatIsoDate } from '../civil-date';
import { parseTarget, targetPath } from '../notification-target';
import type { DayPart } from '../span';
import { expandEvents } from './events';
import { groupsView } from './index';
import type { Tables } from './model';
import { type ScopeOf, occurrenceInScope, scopeAll } from './my-scope';

/**
 * Wydarzenie z kalendarza iPhone'a. Całodniowe — daty (koniec wyłącznie); z godziną — chwile (ms).
 * `organizer` — w notatce jest znacznik Organizera (wpis z „Dodaj do kalendarza” albo z lustra, D173); `location` — miejsce;
 * `link` — termin aplikacji z adresu wydarzenia (occurrenceKey, eventLink — audyt 3, N-183).
 */
type DeviceEventBase = { id: string; calendarId: string; calendarTitle: string; title: string; organizer?: boolean; location?: string | null; link?: string | null };
export type DeviceEvent = (DeviceEventBase & { allDay: true; startDate: string; endDate: string }) | (DeviceEventBase & { allDay: false; startMs: number; endMs: number });

/** Wpis dnia `date` (ISO) z wydarzenia iPhone'a. */
export type DeviceEntry = {
  key: string;
  date: string;
  title: string;
  calendarId: string;
  calendarTitle: string;
  time: string | null;
  endTime: string | null;
  continued: boolean;
  /**
   * D199: wielodniowe — który to dzień i godziny całego wydarzenia (początek pierwszego dnia, koniec ostatniego; całodniowe
   * — `null`), do napisu jak przy wydarzeniach grup („do 06:00 · dzień 2 z 2”, span.ts) i do „Dodaj do grupy”.
   */
  part: DayPart | null;
  eventStart: string | null;
  eventEnd: string | null;
  /** Ostatni dzień wydarzenia (włącznie). */
  lastDate: string;
  organizer: boolean;
  location: string | null;
  /** Termin aplikacji, z którego jest ta kopia (occurrenceKey); brak albo `null` — bez adresu. */
  link?: string | null;
};

/** Klucz terminu wydarzenia: `<id wydarzenia>|<data wystąpienia>` (jak w lustrze i dojeździe). */
export const occurrenceKey = (o: { eventId: string; occurrenceDate: string }) => `${o.eventId}|${o.occurrenceDate}`;

/**
 * Audyt 3 (N-183): adres terminu zapisywany w kopii z „Dodaj do kalendarza” — link głęboki aplikacji (event/<id>/<data>,
 * linking w src/app/navigation.tsx), więc z kalendarza iPhone'a da się wrócić do wydarzenia, a odczyt wie, którego
 * terminu to kopia.
 */
export const eventLink = (eventId: string, occurrenceDate: string) => `${config.URL_SCHEME}://${targetPath({ screen: 'event', id: eventId, date: occurrenceDate })}`;

/** Termin z adresu wydarzenia iPhone'a (eventLink) albo `null` — inny adres, inna aplikacja, brak daty. */
export function linkKey(url: string | null | undefined): string | null {
  const prefix = `${config.URL_SCHEME}://`;
  if (!url?.startsWith(prefix)) return null;
  const t = parseTarget(url.slice(prefix.length));
  return t?.screen === 'event' && t.date ? occurrenceKey({ eventId: t.id, occurrenceDate: t.date }) : null;
}

/** Początek nazwy kalendarza lustra (mirrorCalendarTitle). */
export const MIRROR_PREFIX = 'Organizer – ';
/** Kalendarz lustra po nazwie — także cudzy (drugie konto, iPad z tym samym iCloud, poprzednia instalacja). */
export const isMirrorCalendar = (title: string) => title.startsWith(MIRROR_PREFIX);

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Moje wydarzenia iPhone'a po dniach (ISO → wpisy) w [from, to]. `toLocal` zamienia chwilę na czas Europe/Warsaw.
 * Wydarzenie przez kilka dni pokazuje się w każdym, z numerem dnia (`part`, D199 — dawniej „cd.”, audyt 2 M-253).
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
    if (exclude.has(e.calendarId) || isMirrorCalendar(e.calendarTitle)) continue;
    const base = { key: `d|${e.id}`, title: e.title, calendarId: e.calendarId, calendarTitle: e.calendarTitle, organizer: e.organizer === true, location: e.location?.trim() || null, link: e.link ?? null };
    if (e.allDay) {
      const days = Math.min(366, Math.max(0, dayNo(e.endDate) - dayNo(e.startDate)));
      const lastDate = formatIsoDate(addDays(isoDate(e.startDate), days - 1));
      for (let d = e.startDate, i = 0; i < days; i++) {
        push(d, { ...base, date: d, time: null, endTime: null, continued: i > 0, part: days > 1 ? { day: i + 1, days } : null, eventStart: null, eventEnd: null, lastDate });
        d = formatIsoDate(addDays(isoDate(d), 1));
      }
      continue;
    }
    const s = toLocal(e.startMs);
    // Koniec wyłącznie: wydarzenie do północy nie wchodzi na następny dzień.
    const end = toLocal(Math.max(e.startMs, e.endMs - 1));
    const first = formatIsoDate(s);
    const last = formatIsoDate(end);
    // Godziny na każdym dniu (audyt 8.10.2026 — wcześniej kolejne dni bez godzin, a koniec o północy jako „00:00”,
    // więc widok dnia z przerwami (D122) pokazywał „wolne” w środku wydarzenia): pierwszy dzień do 24:00, kolejne od 00:00.
    const e2 = toLocal(e.endMs);
    const lastEnd = formatIsoDate(e2) === last ? `${pad(e2.hh)}:${pad(e2.mm)}` : '24:00';
    const days = Math.min(366, dayNo(last) - dayNo(first) + 1);
    const eventStart = `${pad(s.hh)}:${pad(s.mm)}`;
    for (let d = first, i = 0; i < days; i++) {
      push(d, {
        ...base,
        date: d,
        time: i === 0 ? eventStart : '00:00',
        endTime: d === last ? lastEnd : '24:00',
        continued: i > 0,
        part: days > 1 ? { day: i + 1, days } : null,
        eventStart,
        eventEnd: lastEnd,
        lastDate: last,
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
  for (const e of events) if (!exclude.has(e.calendarId) && !isMirrorCalendar(e.calendarTitle)) m.set(e.calendarId, e.calendarTitle);
  return [...m].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
/** Nazwa do porównania: małe litery, bez polskich znaków, znaki inne niż litery i cyfry jako jedna spacja. */
export const normalizeTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]!)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Dubel (D173, decyzja właściciela 8.10.2026, audyt 2 M-105; zastępuje regułę wspólnego słowa z D107): wpis
 * z iPhone'a ze znacznikiem Organizera w notatce (kopia z „Dodaj do kalendarza” — aplikacja ma aktualną wersję) albo
 * o tej samej nazwie po ujednoliceniu co wpis aplikacji tego dnia, oba z godziną (różnica najwyżej
 * config.calendar.DUPLICATE_WINDOW_MIN minut) albo oba bez godziny. Kolejny dzień wielodniowego (D199) jest dublem kolejnego
 * dnia wpisu aplikacji o tej samej nazwie (`continued`) — godzin się wtedy nie porównuje.
 * Audyt 3 (N-183): kopia ze znacznikiem jest dublem tylko wtedy, gdy aplikacja ma tego dnia jej odpowiednik — ten sam
 * termin (`link` = `key` wpisu aplikacji) albo, w kopiach bez adresu (sprzed tej wersji), wpis o tej samej nazwie.
 * Kopia odwołanego albo przeniesionego terminu i wpis z grupy, której już nie widzę, zostają widoczne.
 */
export type AppEntry = { title: string; time: string | null; continued?: boolean; key?: string };
export function isDuplicate(e: DeviceEntry, app: readonly AppEntry[]): boolean {
  const mine = normalizeTitle(e.title);
  if (e.organizer) return e.link ? app.some((a) => a.key === e.link) : mine !== '' && app.some((a) => normalizeTitle(a.title) === mine);
  if (e.continued) return mine !== '' && app.some((a) => a.continued === true && normalizeTitle(a.title) === mine);
  return (
    mine !== '' &&
    app.some((a) => {
      const t = a.time?.slice(0, 5) ?? null;
      const timeOk = e.time === null || t === null ? e.time === t : Math.abs(minutes(e.time) - minutes(t)) <= config.calendar.DUPLICATE_WINDOW_MIN;
      return timeOk && normalizeTitle(a.title) === mine;
    })
  );
}

/** Wpisy dnia bez dubli i ukryte duble — do licznika „Ukryto N” z podglądem (D173: nic nie znika bez śladu). */
export function splitDuplicates(entries: readonly DeviceEntry[], app: readonly AppEntry[]): { shown: DeviceEntry[]; hidden: DeviceEntry[] } {
  const shown: DeviceEntry[] = [];
  const hidden: DeviceEntry[] = [];
  for (const e of entries) (isDuplicate(e, app) ? hidden : shown).push(e);
  return { shown, hidden };
}

const isoDate = (s: string): CivilDate => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });

/** Jedno wystąpienie wydarzenia grupy w lustrze (albo dzień lekcji dziecka, D174). */
export type MirrorItem = {
  key: string;
  groupId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** D199: ile dni trwa całodniowe (1 — jeden; przez północ mówią godziny: draftOf). */
  days: number;
  /** D199: długość z godziną w minutach, gdy dłuższa niż z godzin (wyjazd pt. 18:00 – nd. 16:00); inaczej `null`. */
  durationMin: number | null;
  location: string | null;
  notes: string;
};

export type MirrorState = {
  /** grupa → identyfikator kalendarza iPhone'a */
  calendars: { [groupId: string]: string };
  /** klucz wystąpienia → wydarzenie iPhone'a i skrót treści */
  events: { [key: string]: { id: string; calendarId: string; hash: string } };
  /** grupa → nazwa i kolor zapisane w iPhonie (calendarLook); brak w stanie sprzed audytu 2 — wtedy jedno odświeżenie. */
  looks?: { [groupId: string]: string };
};

export const emptyMirror = (): MirrorState => ({ calendars: {}, events: {} });

/** Nazwy wpisów lustra (teksty z strings.pl.ts): blok lekcji dziecka i wydarzenie z osobą odpowiedzialną. */
export type MirrorTitles = { lessons: (name: string, count: number) => string; responsible: (title: string, name: string) => string };

/**
 * Co powinno być w lustrze (D174): wystąpienia, które mnie dotyczą (Occurrence.concernsMe — jak Moje sprawy), z grup
 * spoza `skip`, z osobą odpowiedzialną w nazwie (audyt 3, N-187: „Basen · odpowiada: Ala” jak w wierszu aplikacji,
 * słownik docs/glossary.md; gdy odpowiadam ja — sama nazwa) i miejscem. Lekcje dziecka, w których sam nie jestem
 * (D127), jednym wpisem na dziecko i dzień: nazwa jak wiersz w Moich sprawach (`titles.lessons` =
 * strings['lessons.title'], „Tymek: 5 lekcji”), od pierwszej do ostatniej lekcji, lista lekcji w notatce.
 */
export function mirrorItems(
  t: Tables,
  userId: string,
  today: CivilDate,
  back: number,
  ahead: number,
  skip: ReadonlySet<string>,
  titles: MirrorTitles,
  scopeOf: ScopeOf = scopeAll,
): MirrorItem[] {
  const out: MirrorItem[] = [];
  const blocks = new Map<string, { item: MirrorItem; lessons: { time: string | null; end: string | null; title: string }[] }>();
  for (const o of expandEvents(t, userId, addDays(today, -back), addDays(today, ahead))) {
    if (!occurrenceInScope(o, scopeOf) || skip.has(o.groupId)) continue;
    const startTime = o.startTime?.slice(0, 5) ?? null;
    const endTime = o.endTime?.slice(0, 5) ?? null;
    if (o.lessonFor) {
      // Wspólna lekcja rodzeństwa — w bloku każdego z dzieci (jak Moje sprawy, audyt 2 E-15).
      for (const child of o.lessonFor) {
        const key = `lessons|${child.memberId}|${o.date}`;
        const b = blocks.get(key) ?? { item: { key, groupId: o.groupId, title: '', date: o.date, startTime: null, endTime: null, days: 1, durationMin: null, location: null, notes: o.groupName }, lessons: [] };
        blocks.set(key, b);
        b.lessons.push({ time: startTime, end: endTime, title: o.title });
        b.item.title = titles.lessons(child.name, b.lessons.length);
      }
      continue;
    }
    out.push({
      key: `${o.eventId}|${o.occurrenceDate}`,
      groupId: o.groupId,
      // Imię osoby odpowiedzialnej jest tylko przy żywym wierszu członka (expandEvents), więc wiersz jest w tabeli.
      title: o.responsibleName && t.group_members![o.responsibleId!]!.user_id !== userId ? titles.responsible(o.title, o.responsibleName) : o.title,
      date: o.date,
      startTime,
      endTime,
      // D199: w iPhonie jedno wydarzenie przez wszystkie dni (koniec wyłączny — RFC 5545 §3.6.1, draftOf).
      days: startTime === null ? o.days : 1,
      durationMin: startTime === null ? null : o.durationMin,
      location: o.location?.trim() || null,
      notes: o.groupName,
    });
  }
  for (const { item, lessons } of blocks.values()) {
    // Godziny bloku jak w Moich sprawach (my-days.ts): od najwcześniejszego początku do najpóźniejszego końca.
    const timed = lessons.filter((l) => l.time !== null).sort((a, b) => a.time!.localeCompare(b.time!) || a.title.localeCompare(b.title, 'pl'));
    item.startTime = timed[0]?.time ?? null;
    item.endTime = timed.length ? timed.map((l) => l.end ?? l.time!).sort().at(-1)! : null;
    const list = [...timed, ...lessons.filter((l) => l.time === null)].map((l) => (l.time ? `${l.time} ${l.title}` : l.title));
    item.notes = [item.notes, ...list].join('\n');
    out.push(item);
  }
  return out;
}

// Długość tylko, gdy wielodniowe — skrót wpisów sprzed D199 się nie zmienia (bez przepisywania całego lustra).
export const mirrorHash = (i: MirrorItem) => JSON.stringify([i.title, i.date, i.startTime, i.endTime, i.notes, i.location, ...(i.days > 1 ? [i.days] : []), ...(i.durationMin !== null ? [i.durationMin] : [])]);

/** Nazwa i kolor kalendarza grupy w iPhonie — zmiana nazwy albo koloru grupy zmienia kalendarz (audyt 2, M-27). */
export const calendarLook = (title: string, color: string) => JSON.stringify([title, color]);

/** Nazwa kalendarza lustra. */
export const mirrorCalendarTitle = (groupName: string) => `${MIRROR_PREFIX}${groupName}`;

export type MirrorPlan = {
  /** Grupy, które potrzebują nowego kalendarza (nazwa jak w aplikacji). */
  createCalendars: { groupId: string; title: string; color: string }[];
  /** Kalendarze, których nazwa albo kolor nie nadąża za grupą. */
  updateCalendars: { groupId: string; calendarId: string; title: string; color: string }[];
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
export function planMirror(items: readonly MirrorItem[], state: MirrorState, groups: readonly { id: string; name: string; color: string }[], todayIso: string, max: number): MirrorPlan {
  const live = new Set(groups.map((g) => g.id));
  const removeCalendars = Object.entries(state.calendars)
    .filter(([g]) => !live.has(g))
    .map(([groupId, calendarId]) => ({ groupId, calendarId }));
  const gone = new Set(removeCalendars.map((c) => c.calendarId));
  const wanted = mirrorWanted(items, groups, todayIso, max);
  const byKey = new Map(wanted.map((i) => [i.key, i]));
  const needCalendars = new Set(wanted.map((i) => i.groupId));
  const createCalendars = groups.filter((g) => needCalendars.has(g.id) && !state.calendars[g.id]).map((g) => ({ groupId: g.id, title: mirrorCalendarTitle(g.name), color: g.color }));
  const updateCalendars = groups
    .filter((g) => state.calendars[g.id] && state.looks?.[g.id] !== calendarLook(mirrorCalendarTitle(g.name), g.color))
    .map((g) => ({ groupId: g.id, calendarId: state.calendars[g.id]!, title: mirrorCalendarTitle(g.name), color: g.color }));
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
  return { createCalendars, updateCalendars, removeCalendars, create: create.sort((a, b) => a.key.localeCompare(b.key)), update, remove };
}

/** Wpisy, które lustro trzyma: z grup lustra, najwyżej `max` najbliższych dacie `todayIso` (planMirror, mirrorCalendarOf). */
export function mirrorWanted(items: readonly MirrorItem[], groups: readonly { id: string }[], todayIso: string, max: number): MirrorItem[] {
  const live = new Set(groups.map((g) => g.id));
  return [...items]
    .filter((i) => live.has(i.groupId))
    .sort((a, b) => Math.abs(dayNo(a.date) - dayNo(todayIso)) - Math.abs(dayNo(b.date) - dayNo(todayIso)) || a.key.localeCompare(b.key))
    .slice(0, max);
}

const dayNo = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Czy dane są już pobrane na tyle, żeby układać lustro (audyt 8.10.2026). Po „Wyczyść dane na telefonie” (D121) albo
 * przed pierwszym pobraniem nie ma żadnej grupy, a planMirror usunąłby wtedy kalendarze wszystkich grup z iPhone'a
 * (nowy kalendarz nie miałby kolorów i ustawień, które osoba zmieniła w iPhonie). Czekamy, aż każda moja grupa ma
 * kursor pobierania — i wiersz grupy (audyt 2, M-5): wiersz grupy ma najwyższą wersję, więc przychodzi w ostatniej porcji, a resync i pobranie od zera
 * zaczynają od jego usunięcia. Grupa z kursorem, ale bez wiersza = pobieranie porcjami w toku, a lustro skasowałoby
 * jej kalendarz z iPhone'a.
 */
export function mirrorReady(t: Tables, userId: string, cursors: Readonly<Record<string, number>>): boolean {
  const groups = groupsView(t, userId);
  return groups.length > 0 && groups.every((g) => cursors[g.id] !== undefined) && Object.keys(cursors).every((g) => t.groups?.[g] !== undefined);
}

/**
 * Moje grupy z nazwą w kalendarzu iPhone'a (osobista jako „Osobiste”) i kolorem linii (jasny wariant — iPhone ma
 * jeden kolor kalendarza dla obu wyglądów). Do lustra trafiają te spoza
 * `skip` (D174: wybór w Ustawieniach; domyślnie wszystkie, osobista też).
 */
export const mirrorGroups = (t: Tables, userId: string, skip: ReadonlySet<string> = new Set()) =>
  groupsView(t, userId)
    .filter((g) => !skip.has(g.id))
    .map((g) => ({ id: g.id, name: g.kind === 'personal' ? PERSONAL_NAME : g.name, color: groupLines[g.line]!.light.line }));

/** mirrorLookup potrzebuje tylko kluczy wpisów, nie nazw. */
const NO_TITLES: MirrorTitles = { lessons: () => '', responsible: (title) => title };

/** Nazwa grupy osobistej w kalendarzu iPhone'a (jak w aplikacji: strings['groups.personal']). */
export const PERSONAL_NAME = 'Osobiste';

/**
 * PWD-2 (decyzja właściciela 8.10.2026, audyt 2 M-174): nazwa kalendarza lustra, w którym jest to wystąpienie (dzień
 * `date`, klucz `occurrenceDate`), albo null — wtedy ekran wydarzenia proponuje „Dodaj do kalendarza iPhone'a”.
 * W lustrze jest dokładnie to, co wybiera lustro (mirrorItems + mirrorWanted): mnie dotyczy w zakresie grupy (PW-2),
 * grupa nie jest wyłączona (D174), dzień mieści się w oknie i wpis jest wśród config.calendar.MIRROR_MAX najbliższych
 * (audyt 2, P8: wcześniej limit pomijano, więc dalekie terminy przy setkach wydarzeń mówiły „Jest w kalendarzu”, choć
 * ich tam nie było). Lekcje dziecka są tam w bloku dnia.
 */
export function mirrorCalendarOf(t: Tables, userId: string, eventId: string, occurrenceDate: string, date: string, today: CivilDate, skip: ReadonlySet<string>, scopeOf: ScopeOf = scopeAll, stored: MirrorState | null = null): string | null {
  return mirrorLookup(t, userId, today, skip, scopeOf, stored)(eventId, occurrenceDate, date);
}

/** Klucze wpisów, które lustro naprawdę zapisało w iPhonie (w kalendarzu ze stanu), do mirrorLookup. */
export const storedKeys = (s: MirrorState) => {
  const cals = new Set(Object.values(s.calendars));
  return new Set(Object.entries(s.events).filter(([, e]) => cals.has(e.calendarId)).map(([k]) => k));
};

/**
 * To samo dla wielu wystąpień: zawartość lustra liczona raz (ekran wydarzenia pyta przy każdym renderze).
 * Audyt 3 (N-58): ze stanem lustra (`stored`) — tylko wpisy, które lustro zapisało w iPhonie; plan bez zapisu (np.
 * kalendarza nie dało się założyć) nie mówi „Jest w kalendarzu”.
 */
export function mirrorLookup(t: Tables, userId: string, today: CivilDate, skip: ReadonlySet<string>, scopeOf: ScopeOf, stored: MirrorState | null): (eventId: string, occurrenceDate: string, date: string) => string | null {
  const items = mirrorItems(t, userId, today, config.calendar.MIRROR_DAYS_BACK, config.calendar.MIRROR_DAYS_AHEAD, skip, NO_TITLES, scopeOf);
  const groups = mirrorGroups(t, userId, skip);
  const saved = stored ? storedKeys(stored) : null;
  const wanted = new Set(mirrorWanted(items, groups, formatIsoDate(today), config.calendar.MIRROR_MAX).map((i) => i.key).filter((k) => !saved || saved.has(k)));
  return (eventId, occurrenceDate, date) => {
    const day = isoDate(date);
    const o = expandEvents(t, userId, day, day).find((x) => x.eventId === eventId && x.occurrenceDate === occurrenceDate);
    if (!o) return null;
    const keys = o.lessonFor ? o.lessonFor.map((c) => `lessons|${c.memberId}|${o.date}`) : [`${eventId}|${occurrenceDate}`];
    if (!keys.some((k) => wanted.has(k))) return null;
    return mirrorCalendarTitle(groups.find((g) => g.id === o.groupId)!.name);
  };
}

