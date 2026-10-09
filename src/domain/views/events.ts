/**
 * Wydarzenia (D57, D58; migracja serwera 20261008100000_events). Seria = wiersz events z regułą RRULE
 * (src/domain/rrule.ts); zmiana jednego wystąpienia = event_overrides (data pierwotna → nowe wartości albo
 * odwołanie); „to i następne” = jedno polecenie split_event: koniec starej serii (UNTIL) i nowa seria od tego dnia
 * razem z jej terminami, obecnością i przekazaniami. Serwer wykonuje je w jednej transakcji (wszystko albo nic),
 * a telefon od razu u siebie tym samym algorytmem (src/domain/event-split.ts), więc działa też offline (R1).
 * Wcześniej była to paczka osobnych operacji i odrzucenie nowej serii ucinało starą (audyt 2, M-3).
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate, toDayNumber } from '../civil-date';
import { formatLongDate, formatMinutes, formatRange, parseIsoDate } from '../format';
import { chainParts } from '../event-chain';
import { type SplitArgs, type SplitFollow, splitId } from '../event-split';
import { uuidv5 } from '../ids';
import { type DayPart, daySpan, lengthMinutes, storedDuration } from '../span';
import { alignStart, formatRule, occurrences, type Rule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { childEventConcerns } from './child';
import { groupsView, myMemberships } from './index';
import { asEvent, asOverride, asParticipant, type EventKind, type EventRow, occurrenceDays, occurrenceDuration, occurrenceResponsible, occurrenceTimes, type Override, type Participant, ruleOf } from './event-rows';
import { asMember, type Member, rows, type Tables } from './model';

export { asEvent, asOverride, asParticipant, type EventRow, type Override, type Participant, ruleOf } from './event-rows';

/** Przestrzeń nazw: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/event-override”). */
export const OVERRIDE_NAMESPACE = '507f935e-7343-5bf0-a46c-cedc524fb294';
/** Przestrzeń nazw: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/event-participant”). */
export const PARTICIPANT_NAMESPACE = 'd1b68427-56bc-5060-92d6-b370118f2099';
/**
 * Audyt 2 (S-8): wyjątek terminu i dopisany uczestnik mają identyfikator z serii i daty (osoby), jak odpowiedzi
 * o obecności (D124) — dwa telefony zmieniające ten sam termin piszą ten sam wiersz: utworzenie istniejącego serwer
 * pomija, a zmiana scala pola (wcześniej druga zmiana dostawała odrzucenie z unikalności).
 */
export const overrideId = (eventId: string, occurrenceDate: string) => uuidv5(OVERRIDE_NAMESPACE, `${eventId}|${occurrenceDate}`);
export const participantId = (eventId: string, memberId: string) => uuidv5(PARTICIPANT_NAMESPACE, `${eventId}|${memberId}`);

export type Occurrence = {
  eventId: string;
  /** Data wystąpienia według reguły — klucz wystąpienia (także gdy przeniesione). */
  occurrenceDate: string;
  /** Dzień, w którym wpis stoi — w widokach dni (expandEventDays) każdy dzień wielodniowego; inaczej dzień startu. */
  date: string;
  /** D199: dzień startu (po przeniesieniu), ostatni dzień (włącznie) i liczba dni kalendarzowych (span.ts). */
  startDate: string;
  endDate: string;
  days: number;
  /** D199: który to dzień wielodniowego (`null` — jednodniowe). */
  part: DayPart | null;
  /** D199: zapisana długość z godziną w minutach (dłuższa niż z godzin); `null` — z godzin (span.ts). */
  durationMin: number | null;
  startTime: string | null;
  endTime: string | null;
  title: string;
  recurring: boolean;
  overrideId: string | null;
  groupId: string;
  groupName: string;
  line: number;
  concernsMe: boolean;
  /**
   * Odpowiadam za ten termin albo jestem imiennie uczestnikiem — „przypisane do mnie” w zakresie „Tylko przypisane do
   * mnie” (PW-2, my-scope.ts).
   */
  assignedToMe: boolean;
  /**
   * PWD-32 B (decyzja właściciela 8.10.2026, audyt 2 M-301): wydarzenie dziecka z grupy, za które odpowiada ktoś inny —
   * mnie (dorosłemu) nie dotyczy (D66), ale Moje sprawy pokazują je wyszarzone „Tymek: basen (zawozi Ala)”, bez
   * przypomnień i lustra. Imiona dzieci-uczestników; `null`, gdy to nie ten przypadek.
   */
  childInfo: string[] | null;
  /** Osoba odpowiedzialna w tym wystąpieniu (D66) i jej imię. */
  responsibleId: string | null;
  responsibleName: string | null;
  /** Miejsce serii (D115). */
  location: string | null;
  /** Rodzaj wpisu (D126). */
  kind: EventKind;
  /**
   * D127: lekcja planu dziecka, w której sam nie uczestniczę (dorosły) — „Moje sprawy” zwijają takie lekcje do jednego
   * wiersza na dziecko i dzień; bez przypomnień. Wspólna lekcja rodzeństwa — każde dziecko (audyt 2, E-15). `null` dla
   * wszystkiego innego.
   */
  lessonFor: { memberId: string; name: string }[] | null;
};

const MOVE_WINDOW_DAYS = config.events.MOVE_WINDOW_DAYS;

/** Czy przeniesienie jednego wystąpienia mieści się w oknie (dalej — zniknęłoby z widoków; audyt 8.10.2026). */
export function moveTooFar(occurrenceDate: string, newDate: string): boolean {
  return Math.abs(toDayNumber(parseIsoDate(newDate)) - toDayNumber(parseIsoDate(occurrenceDate))) > MOVE_WINDOW_DAYS;
}

const alive = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at === null;

/**
 * Daty wystąpień (rosnąco), które mogą stać w [from, to]: według reguły w tym zakresie i te przeniesione do niego wyjątkiem
 * z najwyżej MOVE_WINDOW_DAYS dni dalej (audyt 3, N-16). Dawniej rozwijane było całe okno ±MOVE_WINDOW_DAYS — przy
 * codziennej serii ok. 190 dat na każde wywołanie, choć poza zakresem zostają tylko przeniesione.
 */
function occurrenceDates(e: EventRow, rule: Rule | null, byDate: ReadonlyMap<string, Override>, from: CivilDate, to: CivilDate, isoFrom: string, isoTo: string): string[] {
  const start = parseIsoDate(e.start_date);
  const dates = new Set(occurrences(start, rule, from, to).map(formatIsoDate));
  const lo = formatIsoDate(addDays(from, -MOVE_WINDOW_DAYS));
  const hi = formatIsoDate(addDays(to, MOVE_WINDOW_DAYS));
  for (const [occ, o] of byDate) {
    if (dates.has(occ) || o.start_date === null || o.start_date < isoFrom || o.start_date > isoTo || occ < lo || occ > hi) continue;
    // Wyjątek tylko dla daty, która jest wystąpieniem serii (jak przy rozwijaniu całego okna).
    const d = parseIsoDate(occ);
    if (occurrences(start, rule, d, d).length) dates.add(occ);
  }
  return [...dates].sort();
}

/** Wiersze po `event_id`, w kolejności tabeli. */
function byEvent<T extends { event_id: string }>(xs: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const list = out.get(x.event_id);
    if (list) list.push(x);
    else out.set(x.event_id, [x]);
  }
  return out;
}

/**
 * Wystąpienia w [from, to] z moich grup. Do „Moich spraw” trafia (D58): wydarzenie całej grupy, albo jestem uczestnikiem,
 * albo uczestnikiem jest dziecko z tej grupy, a ja jestem dorosłym (rodzic zawozi na zajęcia). W grupie, w której jestem
 * dzieckiem z kontem, tylko wystąpienia, które mnie dotyczą — także w Kalendarzu (PW-14 B, child.ts), a moje lekcje
 * zwijają się jak lekcje dziecka u dorosłych, bez przypomnień (D127; audyt 2, N-38).
 */
export function expandEvents(t: Tables, userId: string, from: CivilDate, to: CivilDate): Occurrence[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const members = new Map(rows(t, 'group_members', asMember).map((m) => [m.member_id, m]));
  // Uczestnicy i wyjątki pogrupowane po wydarzeniu raz na wywołanie (audyt 3, N-16) — dawniej filtr całej tabeli dla
  // każdego wydarzenia.
  const partsOf = byEvent(rows(t, 'event_participants', asParticipant).filter(alive));
  const overridesOf = byEvent(rows(t, 'event_overrides', asOverride).filter(alive));
  const out: Occurrence[] = [];
  const isoFrom = formatIsoDate(from);
  const isoTo = formatIsoDate(to);
  for (const e of rows(t, 'events', asEvent).filter(alive)) {
    const g = groups.get(e.group_id);
    if (!g) continue;
    const rule = ruleOf(e);
    const mine = (partsOf.get(e.id) ?? []).map((p) => members.get(p.member_id));
    // D58 bez osoby odpowiedzialnej: cała grupa, ja uczestnikiem albo dziecko uczestnikiem (dla dorosłych).
    const byRule =
      e.audience === 'group' ||
      mine.some((m) => m?.member_id === g.me.member_id) ||
      (g.me.role !== 'child' && mine.some((m) => m?.role === 'child' && m.deleted_at === null));
    // D66: wskazana osoba odpowiedzialna — tylko ona i dorośli wskazani imiennie jako uczestnicy.
    const iParticipate = e.audience === 'members' && mine.some((m) => m?.member_id === g.me.member_id);
    const iAmIn = mine.some((m) => m?.member_id === g.me.member_id);
    const child = g.me.role === 'child';
    const children = e.kind !== 'lesson' ? [] : !iAmIn ? mine.filter((m): m is Member => m?.role === 'child' && m.deleted_at === null) : child ? [g.me] : [];
    const kids = mine.filter((m): m is Member => m?.role === 'child' && m.deleted_at === null);
    const lessonFor = children.length ? children.map((c) => ({ memberId: c.member_id, name: c.display_name })) : null;
    const byDate = new Map((overridesOf.get(e.id) ?? []).map((o) => [o.occurrence_date, o]));
    for (const occ of occurrenceDates(e, rule, byDate, from, to, isoFrom, isoTo)) {
      const o = byDate.get(occ);
      if (o?.cancelled) continue;
      const date = o?.start_date ?? occ;
      if (date < isoFrom || date > isoTo) continue;
      const days = occurrenceDays(o, e);
      const raw = occurrenceResponsible(o, e);
      // D132: osoba usunięta z grupy już nie odpowiada — wydarzenie wraca do reguły „nikt konkretny”.
      const responsibleId = raw !== null && members.get(raw)?.deleted_at === null ? raw : null;
      if (child && !childEventConcerns(e.audience, responsibleId, g.me.member_id, iAmIn)) continue;
      const concernsMe = responsibleId === null ? byRule : responsibleId === g.me.member_id || iParticipate;
      out.push({
        eventId: e.id,
        occurrenceDate: occ,
        date,
        startDate: date,
        endDate: days === 1 ? date : formatIsoDate(addDays(parseIsoDate(date), days - 1)),
        days,
        part: days === 1 ? null : { day: 1, days },
        durationMin: occurrenceDuration(o, e),
        startTime: occurrenceTimes(o, e).start,
        endTime: occurrenceTimes(o, e).end,
        title: o?.title ?? e.title,
        recurring: rule !== null,
        overrideId: o?.id ?? null,
        groupId: g.id,
        groupName: g.name,
        line: g.line,
        concernsMe,
        assignedToMe: responsibleId === g.me.member_id || iAmIn,
        // Lekcje dziecka mają własny wiersz (D127), więc bez dopisku informacyjnego.
        childInfo: !concernsMe && !lessonFor && g.me.role !== 'child' && kids.length ? kids.map((k) => k.display_name) : null,
        responsibleId,
        responsibleName: responsibleId === null ? null : members.get(responsibleId)!.display_name,
        location: e.location,
        kind: e.kind,
        lessonFor,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title, 'pl') || a.eventId.localeCompare(b.eventId));
}

/**
 * D199: wpisy dni [from, to] — wydarzenie wielodniowe (obóz, nocny dyżur) w każdym swoim dniu, z `part` („dzień 2 z 5”)
 * i `date` = ten dzień; także takie, które zaczęło się przed `from` (najwyżej config.events.MAX_DAYS dni wcześniej).
 * Kolejność dnia: według godzin tego dnia (kolejny dzień wydarzenia przez północ — od 00:00).
 */
export function expandEventDays(t: Tables, userId: string, from: CivilDate, to: CivilDate): Occurrence[] {
  const isoFrom = formatIsoDate(from);
  const isoTo = formatIsoDate(to);
  const out: Occurrence[] = [];
  for (const o of expandEvents(t, userId, addDays(from, 1 - config.events.MAX_DAYS), to)) {
    for (let i = 0; i < o.days; i++) {
      const date = i === 0 ? o.date : formatIsoDate(addDays(parseIsoDate(o.date), i));
      if (date >= isoFrom && date <= isoTo) out.push(i === 0 ? o : { ...o, date, part: { day: i + 1, days: o.days } });
    }
  }
  const at = (o: Occurrence) => daySpan(o.startTime, o.endTime, o.part).start ?? '';
  return out.sort((a, b) => a.date.localeCompare(b.date) || at(a).localeCompare(at(b)) || a.title.localeCompare(b.title, 'pl') || a.eventId.localeCompare(b.eventId));
}

/**
 * Słowa opisu reguły (audyt 2, M-158: teksty w src/i18n/strings.pl.ts, `strings['event.rule']`, wstrzykiwane — domena
 * składa tylko kształt opisu). `base` to wynik `every`; n = −1 to „ostatni”.
 */
export type RuleLabels = {
  every: (freq: Rule['freq'], n: number) => string;
  weekdays: (base: string, days: readonly number[]) => string;
  nth: (base: string, n: number, weekday: number) => string;
  monthDay: (base: string, day: number) => string;
  until: (until: CivilDate) => string;
  count: (n: number) => string;
};

/** Opis reguły po polsku, np. „Co tydzień: pon., sob.”, „Co miesiąc, w ostatni piątek”, „Codziennie, do 31.12.2026”. */
export function describeRule(rule: Rule, start: CivilDate, L: RuleLabels): string {
  const base = L.every(rule.freq, rule.interval);
  const days = [...new Set(rule.byday.map((x) => x.wd))].sort((x, y) => x - y);
  const b = rule.byday[0];
  const md = rule.bymonthday[0];
  let text = base;
  if (rule.freq === 'WEEKLY' && days.length) text = L.weekdays(base, days);
  else if (rule.freq === 'MONTHLY') {
    if (b && b.n === null) text = L.weekdays(base, days);
    else if (b) text = L.nth(base, b.n!, b.wd);
    else text = L.monthDay(base, md ?? start.d);
  }
  if (rule.until) text += L.until(parseIsoDate(rule.until));
  if (rule.count !== null) text += L.count(rule.count);
  return text;
}

export type EventDetail = {
  event: EventRow;
  rule: Rule | null;
  groupName: string;
  line: number;
  members: Member[];
  participants: Participant[];
  overrides: Override[];
  /** Wyjątki w koszu (np. po zmianie reguły) — nowa zmiana tego terminu przywraca wiersz, bo unikalność (seria, data). */
  deletedOverrides: Override[];
  canEdit: boolean;
  /**
   * Audyt 3 (PK-05): żywe części łańcucha po „to i następne” (z tą) w kolejności dni — dla użytkownika jedna seria, więc
   * „Całą serię”, „Ten i następne” i koniec serii działają na wszystkich (N-3, N-21, N-22). Jednorazowe — samo.
   */
  chain: EventRow[];
  /** Żywe wyjątki i uczestnicy wszystkich części łańcucha. */
  chainOverrides: Override[];
  chainParticipants: Participant[];
};

export function eventDetail(t: Tables, userId: string, eventId: string): EventDetail | null {
  const raw = t.events?.[eventId];
  if (!raw) return null;
  const event = asEvent(raw);
  const g = groupsView(t, userId).find((x) => x.id === event.group_id);
  if (!g) return null;
  const chain = chainParts(t.events!, eventId).map(asEvent);
  const ids = new Set(chain.map((p) => p.id));
  return {
    event,
    rule: ruleOf(event),
    groupName: g.name,
    line: g.line,
    members: rows(t, 'group_members', asMember).filter((m) => alive(m) && m.group_id === g.id),
    participants: rows(t, 'event_participants', asParticipant).filter((p) => p.event_id === eventId),
    overrides: rows(t, 'event_overrides', asOverride).filter((o) => alive(o) && o.event_id === eventId),
    deletedOverrides: rows(t, 'event_overrides', asOverride).filter((o) => !alive(o) && o.event_id === eventId),
    canEdit: event.deleted_at === null && myMemberships(t, userId).get(g.id)?.role !== 'child',
    chain,
    chainOverrides: rows(t, 'event_overrides', asOverride).filter((o) => alive(o) && ids.has(o.event_id)),
    chainParticipants: rows(t, 'event_participants', asParticipant).filter((p) => ids.has(p.event_id)),
  };
}

/** Ostatni dzień serii według reguły części (COUNT → dzień ostatniego terminu); `null` — bez końca albo jednorazowe. */
function partEnd(p: EventRow): string | null {
  const rule = ruleOf(p);
  if (rule === null || rule.count === null) return rule?.until ?? null;
  const start = parseIsoDate(p.start_date);
  return formatIsoDate(occurrences(start, rule, start, addDays(start, 366 * 100)).at(-1)!);
}

/** Ostatnia część łańcucha (sama, gdy jednorazowe albo nie ma innych). */
const lastPart = (d: EventDetail) => d.chain.at(-1) ?? d.event;

/** N-21: koniec całej serii — koniec ostatniej części łańcucha (koniec wcześniejszej części to tylko dzień podziału). */
export function seriesEnd(d: EventDetail): string | null {
  return partEnd(lastPart(d));
}

/** Reguła do opisu serii („Co tydzień: pon., do …”): z tej części, z końcem całej serii (N-21). */
export function seriesRule(d: EventDetail): Rule | null {
  if (d.rule === null || lastPart(d).id === d.event.id) return d.rule;
  return { ...d.rule, count: null, until: seriesEnd(d) };
}

// ───────────────────────── operacje ─────────────────────────

export type EventFields = {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** Reguła bez COUNT/UNTIL (koniec osobno w `until`); `null` = jednorazowe. */
  rule: Rule | null;
  until: string | null;
  audience: 'group' | 'members';
  participantIds: string[];
  /** Osoba odpowiedzialna (D66); `null` = nikt konkretny. */
  responsibleId: string | null;
  /** Miejsce (D115) — całej serii; `undefined` = bez zmiany przy edycji. */
  location?: string | null;
  /** Rodzaj (D126) — tylko przy utworzeniu; bez = zwykłe. */
  kind?: EventKind;
  /** D199: ile dni trwa całodniowe (bez = 1; z godziną nie ma znaczenia). */
  days?: number;
  /** D199: długość z godziną w minutach, gdy kończy się później niż wynika z godzin (bez = z godzin, span.ts). */
  durationMin?: number | null;
};

/** Długość z godziną do zapisu w wierszu wydarzenia (`null` — z godzin, span.ts storedDuration). */
const durationOf = (f: Pick<EventFields, 'startTime' | 'endTime' | 'durationMin'>) => storedDuration(f.startTime, f.endTime, f.durationMin ?? null);

/** Długość zapisywana w wierszu: całodniowe — z formularza, z godziną — 1 (span.ts). */
const daysOf = (f: Pick<EventFields, 'startTime' | 'days'>) => (f.startTime === null ? (f.days ?? 1) : 1);

const ruleText = (r: Rule | null, until: string | null) => (r === null ? null : formatRule({ ...r, count: null, until }));

/**
 * Uczestnicy: dodanie nowych, przywrócenie usuniętych (unikalność event_id + member_id), usunięcie zbędnych. Przy zmianie
 * istniejącego wydarzenia nowy wiersz ma identyfikator z serii i osoby (audyt 2, S-8), a po nim idzie przywrócenie: gdy
 * drugi telefon w międzyczasie dopisał i usunął tę osobę, wraca ona zamiast odrzucenia.
 */
function participantOps(eventId: string, groupId: string, existing: Participant[], wanted: string[], idFor: (memberId: string) => string, edit: boolean): NewOp[] {
  const ops: NewOp[] = [];
  for (const m of wanted) {
    const p = existing.find((x) => x.member_id === m);
    if (p) {
      if (p.deleted_at !== null) ops.push({ kind: 'restore', entity: 'event_participants', id: p.id });
      continue;
    }
    const id = idFor(m);
    ops.push({ kind: 'create', entity: 'event_participants', id, group_id: groupId, set: { event_id: eventId, member_id: m } });
    if (edit) ops.push({ kind: 'restore', entity: 'event_participants', id });
  }
  for (const p of existing) if (p.deleted_at === null && !wanted.includes(p.member_id)) ops.push({ kind: 'delete', entity: 'event_participants', id: p.id });
  return ops;
}

export function createEvent(groupId: string, f: EventFields, newId: () => string): { id: string; ops: NewOp[] } {
  const id = newId();
  const start = f.rule ? alignStart(parseIsoDate(f.date), f.rule) : parseIsoDate(f.date);
  const ops: NewOp[] = [
    {
      kind: 'create',
      entity: 'events',
      id,
      group_id: groupId,
      set: { title: f.title, start_date: formatIsoDate(start), start_time: f.startTime, end_time: f.endTime, rrule: ruleText(f.rule, f.until), audience: f.audience, responsible_member_id: f.responsibleId, ...(f.location ? { location: f.location } : {}), ...(f.kind && f.kind !== 'event' ? { kind: f.kind } : {}), ...(daysOf(f) > 1 ? { days: daysOf(f) } : {}), ...(durationOf(f) !== null ? { duration_min: durationOf(f) } : {}) },
    },
    ...participantOps(id, groupId, [], f.audience === 'members' ? f.participantIds : [], () => newId(), false),
  ];
  return { id, ops };
}

export type Scope = 'this' | 'following' | 'all';

/** Pola wyjątku jednego terminu; `null` = jak w serii. */
type OverrideFields = Pick<Override, 'start_date' | 'start_time' | 'end_time' | 'title' | 'responsible_member_id' | 'all_day' | 'responsible_cleared' | 'cancelled' | 'days' | 'duration_min'>;
const AS_SERIES: OverrideFields = { start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, all_day: false, responsible_cleared: false, cancelled: false, days: null, duration_min: null };
const hhmm = (v: string | null) => (v === null ? null : v.slice(0, 5));

/**
 * Pola, które trzeba zapisać, żeby z `from` zrobić `to` — tylko zmienione (audyt 2, S-8: zmiana scala się z równoczesną
 * zmianą innych pól z drugiego telefonu). Godziny parą (koniec bez początku nie istnieje, a koniec przed początkiem znaczy następny dzień — D199). Znaczniki all_day i
 * responsible_cleared też tylko, gdy coś zmieniają — starszy serwer ich nie zna (D136).
 */
function overrideDiff(from: OverrideFields, to: OverrideFields): { [k: string]: unknown } {
  const set: { [k: string]: unknown } = {};
  for (const k of ['start_date', 'title', 'responsible_member_id', 'cancelled', 'all_day', 'responsible_cleared', 'days', 'duration_min'] as const) if (from[k] !== to[k]) set[k] = to[k];
  if (hhmm(from.start_time) !== hhmm(to.start_time) || hhmm(from.end_time) !== hhmm(to.end_time)) Object.assign(set, { start_time: to.start_time, end_time: to.end_time });
  return set;
}

/**
 * Zapis wyjątku terminu: zmiana istniejącego; wyjątek z kosza wraca (unikalność seria + data); nowy — utworzenie
 * z identyfikatorem z serii i daty i zaraz zmiana tych samych pól (gdy drugi telefon utworzył go pierwszy, utworzenie
 * serwer pomija, a zmiana scala pola).
 */
function overrideOps(d: EventDetail, occurrenceDate: string, to: OverrideFields): NewOp[] {
  const e = d.event;
  const live = d.overrides.find((x) => x.occurrence_date === occurrenceDate);
  const patch = (id: string, set: { [k: string]: unknown }): NewOp[] => (Object.keys(set).length ? [{ kind: 'patch', entity: 'event_overrides', id, set }] : []);
  if (live) return patch(live.id, overrideDiff(live, to));
  const fresh = overrideDiff(AS_SERIES, to);
  // Nic innego niż w serii — wyjątek niepotrzebny.
  if (Object.keys(fresh).length === 0) return [];
  const trashed = d.deletedOverrides.find((x) => x.occurrence_date === occurrenceDate);
  if (trashed) return [{ kind: 'restore', entity: 'event_overrides', id: trashed.id }, ...patch(trashed.id, overrideDiff(trashed, to))];
  const id = overrideId(e.id, occurrenceDate);
  // Wiersz lokalny od razu z pełnymi kolumnami (jak DEFAULT w SQL) — „Cofnij” ma z czego odtworzyć stan.
  const columns = { start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, cancelled: false };
  return [{ kind: 'create', entity: 'event_overrides', id, group_id: e.group_id, set: { event_id: e.id, occurrence_date: occurrenceDate, ...columns, ...fresh } }, ...patch(id, fresh)];
}

/**
 * Zmiana wydarzenia w wybranym zakresie (D57). Dla jednorazowego zakres nie ma znaczenia (= „all”).
 * `loaded` — pola formularza z chwili otwarcia (fieldsOf). Z nimi zapis „tylko to” i „wszystkie” wysyła tylko pola, które
 * zmieniłem — zmiany wiersza są per pole (sync_push), więc pole, którego nie ruszałem, a które w tym czasie zmienił
 * drugi telefon, zostaje (audyt 2: formularz wysyłał wszystkie pola i nadpisywał cudzą zmianę). Tak jak szkic formularza
 * (src/domain/drafts.ts, changedFields: tylko pola różne od wartości z chwili otwarcia). Uczestnicy: dopisani i skreśleni
 * względem chwili otwarcia, na obecnej liście. „To i następne” zakłada nową serię (split_event).
 * Audyt 3 (PK-05): po wcześniejszym „to i następne” seria to łańcuch części — „Całą serię” zmienia każdą część, a „Ten
 * i następne” także późniejsze części, tylko w polach, które zmieniłem (N-3, N-22); koniec serii z formularza dotyczy
 * ostatniej części, a część, która zaczynałaby się po nowym końcu, idzie do kosza (N-21).
 */
export function editEvent(d: EventDetail, occurrenceDate: string, scope: Scope, f: EventFields, loaded?: EventFields): NewOp[] {
  const e = d.event;
  const effective: Scope = d.rule === null || (scope === 'following' && occurrenceDate === e.start_date) ? 'all' : scope;
  if (effective === 'this') {
    if (loaded) {
      const live = d.overrides.find((x) => x.occurrence_date === occurrenceDate) ?? AS_SERIES;
      // Obecny stan terminu z tym, co zmieniłem (różnica formularza od chwili otwarcia); zmiana przywraca odwołany termin.
      return overrideOps(d, occurrenceDate, { ...pick(live), ...overrideDiff(overrideTarget(e, occurrenceDate, loaded), overrideTarget(e, occurrenceDate, f)), cancelled: false } as OverrideFields);
    }
    return overrideOps(d, occurrenceDate, overrideTarget(e, occurrenceDate, f));
  }
  if (effective === 'following') return splitOps(d, occurrenceDate, f, loaded);
  const until = untilFor(d, e, f.until) ?? f.until;
  const rule = f.rule === null ? null : { ...f.rule, count: null, until };
  const start = f.rule ? alignStart(parseIsoDate(d.rule === null ? f.date : e.start_date), f.rule) : parseIsoDate(f.date);
  const kept = (date: string) => occurrences(start, rule, parseIsoDate(date), parseIsoDate(date)).length > 0;
  // „Całą serię” — wszystkie części; „ten i następne” od pierwszego terminu tej części — ta i późniejsze.
  const others = d.rule === null ? [] : d.chain.filter((p) => p.id !== e.id && (scope === 'all' || p.start_date > e.start_date));
  const base = loaded ?? fieldsOf(d, occurrenceDate, 'all');
  return [
    ...(loaded ? changedColumns(d, loaded, f) : [fullPatch(d, f)]),
    ...participantOps(e.id, e.group_id, d.participants, wantedParticipants(d.participants, f, loaded), (m) => participantId(e.id, m), true),
    // Audyt 2 (E-20, E-7): zmienione pojedynczo terminy, których nowa reguła nie ma (a przy zmianie serii na jednorazowe —
    // wszystkie), do kosza — inaczej przepadają po cichu, a odwołany dzień „ożywa” po powrocie do starej reguły.
    ...d.overrides.filter((o) => (d.rule !== null && f.rule === null) || !kept(o.occurrence_date)).map((o): NewOp => ({ kind: 'delete', entity: 'event_overrides', id: o.id })),
    ...others.flatMap((p) => planOps(d, partPlan(d, p, f, base))),
  ];
}

const OVERRIDE_KEYS = ['start_date', 'start_time', 'end_time', 'title', 'responsible_member_id', 'all_day', 'responsible_cleared', 'cancelled', 'days', 'duration_min'] as const;
const pick = (o: OverrideFields): OverrideFields => Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, o[k]])) as OverrideFields;

/** Wyjątek terminu, jaki daje formularz (pełny, względem serii). */
function overrideTarget(e: EventRow, occurrenceDate: string, f: EventFields): OverrideFields {
  // PW-33 (decyzja właściciela z 8.10.2026, wariant A): własne godziny tylko wtedy, gdy różnią się od godzin serii —
  // termin ze zmienioną samą nazwą, osobą albo dniem dalej idzie za godziną serii (także po jej późniejszej zmianie).
  const sameClock = hhmm(f.startTime) === hhmm(e.start_time) && hhmm(f.endTime) === hhmm(e.end_time);
  // D199: ta sama godzina, ale inna długość (pt. 18:00 – sob. 16:00 w serii do niedzieli) — własne godziny z długością
  // zapisaną wprost (z godzin wyszłaby długość serii, a serwer uznałby godziny za „jak w serii”).
  const length = lengthMinutes(f.startTime, f.endTime, f.durationMin ?? null);
  const seriesTime = sameClock && length === lengthMinutes(e.start_time, e.end_time, e.duration_min);
  // D199: własna długość całodniowego terminu tylko, gdy inna niż w serii (całodniowy termin serii z godziną — 1 dzień).
  const seriesDays = e.start_time === null ? e.days : 1;
  return {
    days: f.startTime === null && daysOf(f) !== seriesDays ? daysOf(f) : null,
    duration_min: seriesTime || f.startTime === null ? null : sameClock ? length : durationOf(f),
    start_date: f.date === occurrenceDate ? null : f.date,
    start_time: seriesTime ? null : f.startTime,
    end_time: seriesTime ? null : f.endTime,
    title: f.title === e.title ? null : f.title,
    responsible_member_id: f.responsibleId === e.responsible_member_id ? null : f.responsibleId,
    // D136: bez godziny w serii z godziną — znacznik całodniowy.
    all_day: f.startTime === null && e.start_time !== null,
    // Audyt 2 (E-8): „nikt konkretny” w terminie serii, która ma osobę odpowiedzialną (pusta osoba = jak w serii).
    responsible_cleared: f.responsibleId === null && e.responsible_member_id !== null,
    // Zmiana odwołanego terminu przywraca go.
    cancelled: false,
  };
}

/** Kolumny serii, jakie daje formularz („wszystkie”); miejsce tylko, gdy formularz je zna; `until` — koniec tej części. */
function seriesColumns(d: EventDetail, f: EventFields, until: string | null = f.until): { [k: string]: unknown } {
  const start = f.rule ? alignStart(parseIsoDate(d.rule === null ? f.date : d.event.start_date), f.rule) : parseIsoDate(f.date);
  return {
    title: f.title,
    start_date: formatIsoDate(start),
    start_time: f.startTime,
    end_time: f.endTime,
    rrule: ruleText(f.rule, until),
    audience: f.audience,
    responsible_member_id: f.responsibleId,
    ...(f.location !== undefined ? { location: f.location || null } : {}),
    days: daysOf(f),
    duration_min: durationOf(f),
  };
}

/**
 * Koniec części `p` po zapisie z końcem serii `until` (N-21): ostatnia część — koniec z formularza; wcześniejsza — swój
 * (dzień przed następną częścią), najwyżej nowy koniec serii. `undefined` — część zaczyna się po nowym końcu (do kosza).
 */
function untilFor(d: EventDetail, p: EventRow, until: string | null): string | null | undefined {
  if (until !== null && until < p.start_date) return undefined;
  if (p.id === lastPart(d).id) return until;
  const own = partEnd(p);
  return until !== null && (own === null || own > until) ? until : own;
}

/** Bez pól z chwili otwarcia: wszystkie kolumny formularza; miejsce i długość tylko, gdy różne od wiersza (D199). */
function fullPatch(d: EventDetail, f: EventFields): NewOp {
  const e = d.event;
  const { location, days, duration_min, ...set } = seriesColumns(d, f, untilFor(d, e, f.until) ?? f.until);
  return {
    kind: 'patch',
    entity: 'events',
    id: e.id,
    set: { ...set, ...(location !== undefined && location !== e.location ? { location } : {}), ...(days !== e.days ? { days } : {}), ...(duration_min !== e.duration_min ? { duration_min } : {}) },
  };
}

const TIME_KEYS = ['start_time', 'end_time', 'duration_min'];
const differs = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

/** Tylko kolumny, które zmieniłem od otwarcia formularza; godziny parą z długością (koniec przed początkiem = następny dzień, D199). */
function changedColumns(d: EventDetail, loaded: EventFields, f: EventFields): NewOp[] {
  const was = seriesColumns(d, loaded, untilFor(d, d.event, loaded.until) ?? loaded.until);
  const now = seriesColumns(d, f, untilFor(d, d.event, f.until) ?? f.until);
  const set: { [k: string]: unknown } = {};
  for (const k of Object.keys(now)) if (differs(was[k], now[k])) set[k] = now[k];
  if (TIME_KEYS.some((k) => k in set)) Object.assign(set, { start_time: now.start_time, end_time: now.end_time, duration_min: now.duration_min });
  return Object.keys(set).length ? [{ kind: 'patch', entity: 'events', id: d.event.id, set }] : [];
}

/** Uczestnicy części po zapisie: bez pól z chwili otwarcia — lista z formularza; z nimi — obecni plus dopisani minus skreśleni. */
function wantedParticipants(parts: Participant[], f: EventFields, loaded?: EventFields): string[] {
  if (f.audience !== 'members') return [];
  if (!loaded) return f.participantIds;
  const live = parts.filter(alive).map((p) => p.member_id);
  const before = loaded.audience === 'members' ? loaded.participantIds : [];
  const added = f.participantIds.filter((m) => !before.includes(m));
  return [...live.filter((m) => !before.includes(m) || f.participantIds.includes(m)), ...added.filter((m) => !live.includes(m))];
}

/** Zmiana innej części łańcucha: do kosza albo zmienione pola, uczestnicy i wyjątki, których nowa reguła nie ma. */
type PartPlan = { id: string; delete: boolean; set: { [k: string]: unknown }; participants: string[] | null; dropOverrides: string[] };

/**
 * Audyt 3 (N-3, N-22): co zmienić w innej części łańcucha — tylko pola zmienione w formularzu (`base` → `f`); jej własne
 * godziny, dni i nazwa zostają, jeśli ich nie zmieniałem. Zmiana dni: reguła części od jej pierwszego dnia, z jej końcem.
 * Seria zmieniona na jednorazową albo część po nowym końcu serii — do kosza.
 */
function partPlan(d: EventDetail, p: EventRow, f: EventFields, base: EventFields): PartPlan {
  const until = untilFor(d, p, f.until);
  const own = ruleOf(p);
  if (until === undefined || f.rule === null || own === null) return { id: p.id, delete: true, set: {}, participants: null, dropOverrides: [] };
  const was = seriesColumns(d, base);
  const now = seriesColumns(d, f);
  const set: { [k: string]: unknown } = {};
  for (const k of ['title', 'audience', 'responsible_member_id', 'location', 'days']) if (k in now && differs(was[k], now[k])) set[k] = now[k];
  if (TIME_KEYS.some((k) => differs(was[k], now[k]))) Object.assign(set, { start_time: now.start_time, end_time: now.end_time, duration_min: now.duration_min });
  const pattern = ruleText(base.rule, null) !== ruleText(f.rule, null);
  const rule = pattern ? f.rule : { ...own, count: null, until: null };
  const start = pattern ? alignStart(parseIsoDate(p.start_date), f.rule) : parseIsoDate(p.start_date);
  if (formatIsoDate(start) !== p.start_date) set.start_date = formatIsoDate(start);
  if (pattern || until !== partEnd(p)) set.rrule = ruleText(rule, until);
  const next = { ...rule, count: null, until };
  const day = (iso: string) => parseIsoDate(iso);
  const dropOverrides = 'rrule' in set ? d.chainOverrides.filter((o) => o.event_id === p.id && occurrences(start, next, day(o.occurrence_date), day(o.occurrence_date)).length === 0).map((o) => o.id) : [];
  const people = base.audience !== f.audience || differs([...base.participantIds].sort(), [...f.participantIds].sort());
  const mine = d.chainParticipants.filter((x) => x.event_id === p.id);
  return { id: p.id, delete: false, set, participants: people ? wantedParticipants(mine, f, base) : null, dropOverrides };
}

/** Plan części jako zwykłe operacje („Całą serię”). */
function planOps(d: EventDetail, plan: PartPlan): NewOp[] {
  if (plan.delete) return [{ kind: 'delete', entity: 'events', id: plan.id }];
  const mine = d.chainParticipants.filter((x) => x.event_id === plan.id);
  return [
    ...(Object.keys(plan.set).length ? [{ kind: 'patch', entity: 'events', id: plan.id, set: plan.set } as NewOp] : []),
    ...(plan.participants ? participantOps(plan.id, d.event.group_id, mine, plan.participants, (m) => participantId(plan.id, m), true) : []),
    ...plan.dropOverrides.map((id): NewOp => ({ kind: 'delete', entity: 'event_overrides', id })),
  ];
}

/** Plan części jako część polecenia split_event („ten i następne”, krok 4b); `null` — nic do zmiany. */
function followOf(plan: PartPlan): SplitFollow | null {
  if (plan.delete) return { id: plan.id, delete: true };
  const out: SplitFollow = {
    id: plan.id,
    ...(Object.keys(plan.set).length ? { set: plan.set } : {}),
    ...(plan.participants ? { participants: plan.participants.map((m) => ({ id: participantId(plan.id, m), member_id: m })) } : {}),
    ...(plan.dropOverrides.length ? { drop_overrides: plan.dropOverrides } : {}),
  };
  return Object.keys(out).length > 1 ? out : null;
}

/**
 * N-135: pola nowej części — zmienione w formularzu z formularza, reszta z obecnego stanu serii (drugi telefon mógł
 * w tym czasie zmienić nazwę, miejsce, osobę albo uczestników — jak „wszystkie”, changedColumns).
 */
function mergeFields(cur: EventFields, loaded: EventFields, f: EventFields): EventFields {
  const ch = (k: keyof EventFields) => differs(f[k], loaded[k]);
  const times = ch('startTime') || ch('endTime') || ch('durationMin');
  const take = <K extends keyof EventFields>(k: K): EventFields[K] => (ch(k) ? f[k] : cur[k]);
  const audience = take('audience');
  return {
    ...cur,
    title: take('title'),
    date: f.date,
    startTime: times ? f.startTime : cur.startTime,
    endTime: times ? f.endTime : cur.endTime,
    durationMin: times ? f.durationMin : cur.durationMin,
    days: take('days'),
    rule: take('rule'),
    until: take('until'),
    audience,
    participantIds: audience === 'members' ? wantedParticipants(cur.participantIds.map((m) => ({ id: m, event_id: '', member_id: m, deleted_at: null })), { ...f, audience }, loaded) : [],
    responsibleId: take('responsibleId'),
    location: take('location'),
  };
}

/** „To i następne”: polecenie split_event. */
function splitOps(d: EventDetail, occurrenceDate: string, form: EventFields, loaded?: EventFields): NewOp[] {
  const e = d.event;
  const current = fieldsOf(d, occurrenceDate, 'following');
  const f = loaded ? mergeFields(current, loaded, form) : form;
  const rule = f.rule === null ? null : { ...f.rule, count: null, until: f.until };
  // „To i następne” (audyt 2, M-3): jedno polecenie split_event (opis w src/domain/event-split.ts). Nowa seria zaczyna się
  // od tego wystąpienia i zostaje tym samym rodzajem (lekcja zostaje lekcją — rodzaj bierze serwer z dzielonej serii).
  const start = f.rule ? alignStart(parseIsoDate(occurrenceDate), f.rule) : parseIsoDate(occurrenceDate);
  const id = splitId(e.id, occurrenceDate);
  // N-22: późniejsze części łańcucha — tylko to, co zmieniłem.
  const follow = d.chain.filter((p) => p.start_date > e.start_date).flatMap((p) => followOf(partPlan(d, p, form, loaded ?? current)) ?? []);
  const args: SplitArgs = {
    id,
    event_id: e.id,
    date: occurrenceDate,
    set: {
      title: f.title,
      start_date: formatIsoDate(start),
      start_time: f.startTime,
      end_time: f.endTime,
      rrule: ruleText(f.rule, f.until),
      audience: f.audience,
      responsible_member_id: f.responsibleId,
      location: (f.location === undefined ? e.location : f.location) || null,
      days: daysOf(f),
      duration_min: durationOf(f),
    },
    participants: (f.audience === 'members' ? f.participantIds : []).map((m) => ({ id: participantId(id, m), member_id: m })),
    drop_overrides: d.overrides.filter((o) => o.occurrence_date >= occurrenceDate && occurrences(start, rule, parseIsoDate(o.occurrence_date), parseIsoDate(o.occurrence_date)).length === 0).map((o) => o.id),
    tasks: [],
    ...(follow.length ? { follow } : {}),
  };
  return [{ kind: 'cmd', cmd: 'split_event', args }];
}

/**
 * Odwołanie / usunięcie w zakresie: to wystąpienie, to i następne, cała seria. Serię kończy jedno polecenie end_series na
 * całym łańcuchu (audyt 3, N-3: wcześniej tylko ta część — po „to i następne” druga część zostawała w planie), razem
 * z wyjątkami i odpowiedziami z terminów, które znikają (N-117). „Cofnij” — src/domain/event-chain.ts, endSeriesEffects.
 */
export function cancelEvent(d: EventDetail, occurrenceDate: string, scope: Scope): NewOp[] {
  const e = d.event;
  if (d.rule === null) return [{ kind: 'delete', entity: 'events', id: e.id }];
  if (scope !== 'this') return [{ kind: 'cmd', cmd: 'end_series', args: { event_id: e.id, date: scope === 'all' ? null : occurrenceDate, title: e.title } }];
  const o = d.overrides.find((x) => x.occurrence_date === occurrenceDate);
  return overrideOps(d, occurrenceDate, { ...(o ?? AS_SERIES), cancelled: true });
}

/** Stan terminu na ekranie wydarzenia (audyt 2, E-18): zwykły, odwołany albo taki, którego w serii już nie ma. */
export function occurrenceState(d: EventDetail, occurrenceDate: string): 'active' | 'cancelled' | 'missing' {
  const day = parseIsoDate(occurrenceDate);
  if (occurrences(parseIsoDate(d.event.start_date), d.rule, day, day).length === 0) return 'missing';
  return d.overrides.some((o) => o.occurrence_date === occurrenceDate && o.cancelled) ? 'cancelled' : 'active';
}

/** Przywrócenie odwołanego terminu (audyt 2, E-18). */
export function restoreOccurrence(d: EventDetail, occurrenceDate: string): NewOp[] {
  const o = d.overrides.find((x) => x.occurrence_date === occurrenceDate);
  return o?.cancelled ? [{ kind: 'patch', entity: 'event_overrides', id: o.id, set: { cancelled: false } }] : [];
}

const liveOrNull = (d: EventDetail, id: string | null) => (id !== null && d.members.some((m) => m.member_id === id) ? id : null);

/**
 * Wartości formularza dla wystąpienia w wybranym zakresie: „this” — to wystąpienie (z jego zmianami), „following” —
 * seria od tego dnia, „all” — cała seria od początku. Koniec serii zawsze jako data (COUNT → data ostatniego wystąpienia).
 */
export function fieldsOf(d: EventDetail, occurrenceDate: string, scope: Scope): EventFields {
  const e = d.event;
  const o = scope === 'this' ? d.overrides.find((x) => x.occurrence_date === occurrenceDate) : undefined;
  // N-21: koniec całej serii (ostatniej części łańcucha), nie dzień, w którym ta część przeszła w następną.
  const until = d.rule === null ? null : seriesEnd(d);
  return {
    title: o?.title ?? e.title,
    date: scope === 'all' ? e.start_date : (o?.start_date ?? occurrenceDate),
    startTime: occurrenceTimes(o, e).start,
    endTime: occurrenceTimes(o, e).end,
    // D199: długość całodniowego (wyjątek albo seria); z godziną 1.
    days: occurrenceTimes(o, e).start === null ? (o?.days ?? e.days) : 1,
    durationMin: occurrenceDuration(o, e),
    rule: d.rule ? { ...d.rule, count: null, until: null } : null,
    until,
    audience: e.audience,
    // Audyt 2 (E-1): tylko osoby, które są w grupie (D132) — osoba usunięta przeniesiona do nowej serii
    // („to i następne”) sprawiała, że serwer odrzucał nową serię, a starą i tak ucinał.
    participantIds: d.participants.filter((p) => alive(p) && d.members.some((m) => m.member_id === p.member_id)).map((p) => p.member_id),
    responsibleId: liveOrNull(d, occurrenceResponsible(o, e)),
    location: e.location,
  };
}

/** Wydarzenia, które dotyczą mnie dziś i jutro (do widoku „Moje sprawy”). */
export function todayEvents(t: Tables, userId: string, today: CivilDate): { today: Occurrence[]; tomorrow: Occurrence[] } {
  const all = expandEventDays(t, userId, today, addDays(today, 1)).filter((x) => x.concernsMe);
  const iso = formatIsoDate(today);
  return { today: all.filter((x) => x.date === iso), tomorrow: all.filter((x) => x.date !== iso) };
}

/** Wszystkie wydarzenia z moich grup w [from, to], pogrupowane po dniu (kalendarz). */
export function eventsByDate(t: Tables, userId: string, from: CivilDate, to: CivilDate): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>();
  // Dopisywanie w miejscu (audyt 3, N-16) — dawniej kopia listy dnia przy każdym wpisie.
  for (const x of expandEventDays(t, userId, from, to)) {
    const day = out.get(x.date);
    if (day) day.push(x);
    else out.set(x.date, [x]);
  }
  return out;
}

/** „18:00–19:00”, „18:00” albo `null` (cały dzień); serwer zwraca godziny z sekundami (typ time). */
export function timeLabel(start: string | null, end: string | null): string | null {
  if (start === null) return null;
  return end === null ? start.slice(0, 5) : `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** Długość do wiersza (D120), tylko gdy jest początek i koniec; koniec następnego dnia (D199) liczy się z północą. */
export function lengthLabel(start: string | null, end: string | null, duration: number | null = null): string | null {
  const m = lengthMinutes(start, end, duration);
  return m === null ? null : formatMinutes(m);
}

export type SeriesItem = {
  id: string;
  title: string;
  summary: string;
  time: string | null;
  start: string;
  /** Najbliższy termin od dziś — dzień po przeniesieniu (do wyświetlenia, audyt 2 E-19). */
  next: string | null;
  /** Ten sam termin jako data wystąpienia według reguły (do otwarcia). */
  nextOccurrence: string | null;
};

/**
 * Wydarzenia grupy (ekran grupy): opis powtarzania i najbliższy termin od dziś (w ciągu roku). Seria po „to i następne”
 * to jeden wiersz (audyt 3, N-116; wcześniej do dnia podziału dwa wiersze, a zakończona część — audyt 2, E-17): nazwa,
 * godzina i opis z części najbliższego terminu (bez niego — z ostatniej), koniec — całej serii.
 */
export function groupSeries(t: Tables, userId: string, groupId: string, today: CivilDate, L: RuleLabels): SeriesItem[] {
  const g = groupsView(t, userId).find((x) => x.id === groupId);
  if (!g) return [];
  const upcoming = expandEvents(t, userId, today, addDays(today, 366));
  // PW-14 B: dziecko z kontem widzi tylko wydarzenia, które go dotyczą (child.ts) — według serii.
  const live = new Set(rows(t, 'group_members', asMember).filter(alive).map((m) => m.member_id));
  const mine = new Set(rows(t, 'event_participants', asParticipant).filter((p) => alive(p) && p.member_id === g.me.member_id).map((p) => p.event_id));
  const forMe = (e: EventRow) =>
    g.me.role !== 'child' || childEventConcerns(e.audience, e.responsible_member_id !== null && live.has(e.responsible_member_id) ? e.responsible_member_id : null, g.me.member_id, mine.has(e.id));
  const events = rows(t, 'events', asEvent).filter((e) => alive(e) && e.group_id === groupId && forMe(e));
  const shown = new Set<string>();
  const out: SeriesItem[] = [];
  for (const first of events) {
    if (shown.has(first.id)) continue;
    const parts = chainParts(t.events!, first.id).map(asEvent).filter(forMe);
    parts.forEach((p) => shown.add(p.id));
    const ids = new Set(parts.map((p) => p.id));
    const next = upcoming.find((x) => ids.has(x.eventId));
    const last = parts.at(-1)!;
    const e = parts.find((p) => p.id === next?.eventId) ?? last;
    const rule = ruleOf(e);
    out.push({
      id: e.id,
      title: e.title,
      // D199: jednorazowe przez kilka dni — zakres dni („12–16 października”).
      summary: rule
        ? describeRule(e.id === last.id ? rule : { ...rule, count: null, until: partEnd(last) }, parseIsoDate(e.start_date), L)
        : e.start_time === null && e.days > 1
          ? formatRange(parseIsoDate(e.start_date), addDays(parseIsoDate(e.start_date), e.days - 1), today)
          : formatLongDate(parseIsoDate(e.start_date), today),
      // D199: dłuższe niż z godzin — sam początek („18:00–16:00” byłoby mylące; dni pokazuje ekran wydarzenia).
      time: timeLabel(e.start_time, e.duration_min === null ? e.end_time : null),
      start: e.start_date,
      next: next?.date ?? null,
      nextOccurrence: next?.occurrenceDate ?? null,
    });
  }
  return out.sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}
