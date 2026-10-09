/**
 * Plan lekcji z tygodniami A/B (D112, ADR 0027): lekcje osoby (np. dziecka) zapisane jako zwykłe wydarzenia cykliczne
 * z tą osobą jako uczestnikiem — od razu w Kalendarzu, „Moich sprawach” uczestnika, lustrze iPhone'a i przypomnieniach.
 * Rodzaj `lesson` (D126): bez pytania o obecność. Dorosły, który sam nie uczestniczy, widzi lekcje dziecka w Moich
 * sprawach jednym zwiniętym wierszem na dzień, bez przypomnień i poza porannym podsumowaniem (D127, ADR 0035).
 *  - „co tydzień” = FREQ=WEEKLY; tydzień A albo B = FREQ=WEEKLY;INTERVAL=2 z pierwszym dniem w tygodniu A albo B
 *    (RFC 5545: INTERVAL liczony od DTSTART, https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10);
 *  - tydzień od poniedziałku (PN-EN ISO 8601; źródło — CLDR firstDay dla PL, src/domain/month-grid.ts); który tydzień
 *    jest A, zapisuje się przy osobie (D171, audyt 2 M-15): group_members.week_a = poniedziałek jakiegoś tygodnia A.
 *    Litery są więc stałe i zgodne ze szkołą; parzystość liczona różnicą dni (bez numerów tygodni ISO, więc rok
 *    z 53 tygodniami jej nie psuje). Bez zapisanej kotwicy
 *    (plan sprzed D171) ten tydzień to A, jak dotąd. Przełącznik „Ten tydzień to A/B” zmienia tylko nazwy tygodni:
 *    lekcje zostają w swoich dniach (ekran zamienia litery lekcji — `swapWeeks`), a zapis ustawia kotwicę;
 *  - ta sama lekcja (nazwa, godziny, tydzień) w kilka dni = jedna seria z kilkoma dniami.
 *
 * Edycja planu (D128, audyt 2 M-14): ekran otwiera się z obecnym planem osoby (`memberTimetable` — serie lekcji z tą
 * osobą, które mają terminy od jutra). Zmiany obowiązują od jutra — dzisiejsze i minione lekcje zostają, jak były.
 *  - seria bez zmian zostaje nietknięta (z odwołaniami, zadaniami i swoją datą końca);
 *  - zmieniona (para ze starą serią: ta sama nazwa albo te same dni i godziny) przechodzi tym samym poleceniem co
 *    „to i następne” (split_event, src/domain/event-split.ts): stara kończy się dziś, nowa zaczyna od jutra i dostaje
 *    od tego dnia odwołania, zmiany terminów, obecność, przekazania, zadania i stałe zadania; zadania z terminów, których
 *    nowa seria nie ma, idą na najbliższy nowy termin albo zostają odpięte (`lost` — wybór z tego samego podglądu co przy
 *    „to i następne”; ekran pokazuje go, gdy zapis zmienia zadania albo zmienione pojedynczo terminy), kopie stałych
 *    zadań do kosza. Seria, która jeszcze się nie zaczęła, zmienia się w miejscu (te same skutki dla zadań i wyjątków);
 *  - usunięta kończy się dziś (nierozpoczęta idzie do kosza);
 *  - lekcja wspólna z rodzeństwem (inni uczestnicy, audyt 2 E-26): zmiana albo usunięcie dotyczy tylko tej osoby — seria
 *    trwa dalej bez niej (split_event z tymi samymi polami i pozostałymi uczestnikami; nierozpoczęta — bez jej udziału),
 *    a zmieniona lekcja tej osoby to nowa seria.
 * Cofnięcie (pasek „Cofnij”) liczone w chwili cofnięcia przywraca stary plan: nowe serie do kosza, zakończone wracają
 * z poprzednią regułą, a seria po split_event wraca do starych pól (od jutra). Świadome ryzyko (audyt 2, M-215): zmiana
 * tej samej serii z innego telefonu w czasie paska zostaje nadpisana.
 */
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate, isoWeekday, toDayNumber } from '../civil-date';
import { type SplitArgs, type SplitTask, splitId } from '../event-split';
import { parseIsoDate } from '../format';
import { endBefore, formatRule, occurrences, type Rule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { emptyForm, type FormError, validateForm } from './event-form';
import { asEvent, asParticipant, ruleOf } from './event-rows';
import { type SeriesEffects, seriesEditEffects, seriesEditOps } from './event-tasks';
import { createEvent, eventDetail, type EventFields, participantId } from './events';
import { groupsView } from './index';
import { asMember, asTask, rows, type Tables } from './model';

export type Week = 'both' | 'A' | 'B';
export type Lesson = { day: number; title: string; start: string; end: string; week: Week };

/** Opis serii do porównania planów (audyt 2, E-5): seria bez zmian zostaje nietknięta. */
type Spec = { title: string; start: string; end: string; days: number[]; interval: number; thisWeek: boolean; until: string | null };
/** Seria obecnego planu (D128). `others` — pozostali uczestnicy z grupy (lekcja z rodzeństwem, audyt 2 E-26). */
export type PlanSeries = { id: string; start_date: string; rrule: string; spec: Spec; others: string[] };
/** `thisWeek` — litera bieżącego tygodnia według kotwicy; `weekA` — zapisana kotwica (D171) albo `null`. */
export type CurrentPlan = { lessons: Lesson[]; until: string; series: PlanSeries[]; thisWeek: 'A' | 'B'; weekA: string | null };

const sameSpec = (a: Spec, b: Spec, ignoreUntil: boolean) =>
  a.title === b.title && a.start === b.start && a.end === b.end && a.interval === b.interval && a.thisWeek === b.thisWeek && a.days.join() === b.days.join() && (ignoreUntil || a.until === b.until);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOOKAHEAD = config.eventTasks.LOOKAHEAD_DAYS;
const mondayOf = (d: CivilDate) => addDays(d, -isoWeekday(d));
const weeksBetween = (a: CivilDate, b: CivilDate) => Math.round((toDayNumber(mondayOf(b)) - toDayNumber(mondayOf(a))) / 7);
const even = (n: number) => n % 2 === 0;

/** Przełącznik „Ten tydzień to …” (D171): nazwy tygodni się zamieniają, lekcje zostają w swoich dniach. */
export const swapWeeks = (lessons: readonly Lesson[]): Lesson[] => lessons.map((l) => (l.week === 'both' ? l : { ...l, week: l.week === 'A' ? 'B' : 'A' }));

/** Obecny plan osoby: cykliczne lekcje z tą osobą jako uczestnikiem, które mają terminy od jutra. */
export function memberTimetable(t: Tables, groupId: string, memberId: string, today: CivilDate): CurrentPlan {
  const iso = formatIsoDate(today);
  const raw = t.group_members?.[memberId]?.week_a;
  const weekA = typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null;
  const anchor = weekA ? parseIsoDate(weekA) : today;
  const inGroup = new Set(rows(t, 'group_members', asMember).filter((m) => m.deleted_at === null && m.group_id === groupId).map((m) => m.member_id));
  const parts = rows(t, 'event_participants', asParticipant).filter((p) => p.deleted_at === null);
  const mine = new Set(parts.filter((p) => p.member_id === memberId).map((p) => p.event_id));
  const lessons: Lesson[] = [];
  const series: PlanSeries[] = [];
  const untils = new Set<string>();
  for (const e of rows(t, 'events', asEvent)) {
    const rule = ruleOf(e);
    // Kończąca się dziś (np. po wcześniejszym zapisie planu) nie ma już terminów od jutra.
    if (e.kind !== 'lesson' || e.deleted_at !== null || e.group_id !== groupId || !mine.has(e.id) || !rule || rule.freq !== 'WEEKLY' || (rule.until !== null && rule.until <= iso)) continue;
    untils.add(rule.until ?? '');
    const start = parseIsoDate(e.start_date);
    // Co 2 tygodnie: litera z kotwicy (D171); `thisWeek` — czy seria wypada w tym tygodniu (do porównania planów).
    const thisWeek = rule.interval === 1 || even(weeksBetween(start, today));
    const week: Week = rule.interval === 1 ? 'both' : even(weeksBetween(anchor, start)) ? 'A' : 'B';
    const days = [...new Set(rule.byday.length ? rule.byday.map((b) => b.wd) : [isoWeekday(start)])].sort((x, y) => x - y);
    const times = { start: (e.start_time ?? '').slice(0, 5), end: (e.end_time ?? '').slice(0, 5) };
    const others = [...new Set(parts.filter((p) => p.event_id === e.id && p.member_id !== memberId && inGroup.has(p.member_id)).map((p) => p.member_id))].sort();
    series.push({ id: e.id, start_date: e.start_date, rrule: e.rrule!, spec: { title: e.title, ...times, days, interval: rule.interval, thisWeek, until: rule.until }, others });
    for (const day of days) lessons.push({ day, title: e.title, ...times, week });
  }
  lessons.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'pl'));
  // Jedna data końca dla całego planu — tylko gdy wszystkie serie ją mają.
  const until = untils.size === 1 ? [...untils][0]! : '';
  return { lessons, until, series, thisWeek: even(weeksBetween(anchor, today)) ? 'A' : 'B', weekA };
}

/** Cofnięcie jednej zmiany, liczone na tabelach z chwili cofnięcia (kopie stałych zadań dołożone w międzyczasie). */
type Step = { ops: NewOp[]; undo: (t: Tables) => NewOp[]; effects?: SeriesEffects };
/** Wybór z podglądu dla zadań z terminów, których nowa seria nie ma (jak przy „to i następne”). */
export type LostChoice = 'nearest' | 'unlink';

/**
 * Plan do zapisu (opis zmian w nagłówku). `edit` — edycja obecnego planu (D128): tabele, ja i serie z
 * `memberTimetable`. `keepUntil` — pole „do dnia” bez zmiany: porównanie pomija datę końca (różne daty końca zostają,
 * E-27). `weekA` — zapisana kotwica tygodnia A (D171); gdy plan ma lekcje A/B, zapis ustawia ją według `thisWeek`.
 * `undo(t)` przywraca stary plan na tabelach z chwili cofnięcia.
 */
export function timetableOps(a: {
  groupId: string;
  memberId: string;
  lessons: readonly Lesson[];
  thisWeek: 'A' | 'B';
  today: CivilDate;
  until: string | null;
  newId: () => string;
  edit?: { tables: Tables; userId: string; series: readonly PlanSeries[] };
  keepUntil?: boolean;
  weekA?: string | null;
  lost?: LostChoice;
}): { ops: NewOp[]; undo: (t: Tables) => NewOp[]; series: number; effects: SeriesEffects } | { error: FormError | 'empty'; index: number } {
  const existing = a.edit?.series ?? [];
  const lessons = a.lessons.map((l, index) => ({ ...l, index, title: l.title.trim(), start: l.start.trim(), end: l.end.trim() })).filter((l) => l.title || l.start || l.end);
  // Pusty plan przy edycji = zakończenie planu; przy nowym — błąd.
  if (lessons.length === 0 && existing.length === 0) return { error: 'empty', index: -1 };
  const monday = mondayOf(a.today);
  const tomorrow = addDays(a.today, 1);
  const isoTomorrow = formatIsoDate(tomorrow);
  const groups = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const k = JSON.stringify([l.title, l.start, l.end, l.week]);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  // 1. Nowe serie: walidacja i pierwszy dzień.
  const wanted: { spec: Spec; f: EventFields }[] = [];
  for (const g of groups.values()) {
    const l = g[0]!;
    const offset = l.week === 'both' || l.week === a.thisWeek ? 0 : 7;
    const days = [...new Set(g.map((x) => x.day))].sort((x, y) => x - y);
    let date = formatIsoDate(addDays(monday, offset + days[0]!));
    if (a.edit) {
      // Edycja: pierwszy dzień serii od jutra (w tygodniu właściwym dla A/B; co 2 tygodnie — następny jest 14 dni dalej).
      const step = l.week === 'both' ? 7 : 14;
      const cands = days.flatMap((d) => [0, step].map((k) => formatIsoDate(addDays(monday, offset + d + k))));
      date = cands.filter((x) => x >= isoTomorrow).sort()[0]!;
    }
    const r = validateForm({
      ...emptyForm(date, [a.memberId]),
      title: l.title,
      repeat: 'weekly',
      interval: l.week === 'both' ? '1' : '2',
      slots: [{ days, start: l.start, end: l.end }],
      ends: a.until ? 'until' : 'never',
      until: a.until ?? '',
    });
    if ('error' in r) return { error: r.error, index: l.index };
    wanted.push({ spec: { title: l.title, start: l.start, end: l.end, days, interval: l.week === 'both' ? 1 : 2, thisWeek: offset === 0, until: a.until }, f: { ...r.fields[0]!, kind: 'lesson' } });
  }

  // 2. Bez zmian — nietknięte; zmienione — para ze starą serią bez rodzeństwa (ta sama nazwa albo te same dni i godziny).
  const used = new Set<string>();
  const changed = wanted.filter((w) => {
    const same = existing.find((x) => !used.has(x.id) && sameSpec(x.spec, w.spec, a.keepUntil === true));
    if (same) used.add(same.id);
    return !same;
  });
  const score = (x: Spec, s: Spec) => (x.title === s.title ? 4 : 0) + (x.start === s.start && x.end === s.end ? 2 : 0) + (x.days.join() === s.days.join() ? 1 : 0);
  const created: Step[] = [];
  const other: Step[] = [];
  for (const w of changed) {
    const pair = existing.filter((x) => !used.has(x.id) && x.others.length === 0 && score(x.spec, w.spec) >= 3).sort((x, y) => score(y.spec, w.spec) - score(x.spec, w.spec))[0];
    if (pair) {
      used.add(pair.id);
      other.push(changeSeries(a.edit!.tables, a.edit!.userId, pair, w.f, a.memberId, tomorrow, a.lost ?? 'nearest'));
      continue;
    }
    const c = createEvent(a.groupId, w.f, a.newId);
    created.push({ ops: c.ops, undo: () => [{ kind: 'delete', entity: 'events', id: c.id }] });
  }
  for (const x of existing.filter((e) => !used.has(e.id))) other.push(x.others.length ? leaveSeries(a.edit!.tables, x, a.memberId, tomorrow) : endSeries(x, tomorrow));

  // 3. Kotwica tygodnia A (D171): gdy plan ma lekcje A/B, a zapisana kotwica nie zgadza się z przełącznikiem.
  const target = addDays(monday, a.thisWeek === 'A' ? 0 : -7);
  const stored = a.weekA ?? null;
  const anchor: Step[] = [];
  if (stored === null ? wanted.some((w) => w.spec.interval === 2) : !even(weeksBetween(parseIsoDate(stored), target))) {
    anchor.push({ ops: [{ kind: 'patch', entity: 'group_members', id: a.memberId, set: { week_a: formatIsoDate(target) } }], undo: () => [{ kind: 'patch', entity: 'group_members', id: a.memberId, set: { week_a: stored } }] });
  }

  // Skutki dla zadań i zmienionych pojedynczo terminów ze wszystkich zmienionych serii — do podglądu (jak „to i następne”).
  const all = other.flatMap((s) => (s.effects ? [s.effects] : []));
  const effects: SeriesEffects = {
    preview: [...new Set(all.flatMap((x) => x.preview))].sort().slice(0, 3),
    kept: all.flatMap((x) => x.kept),
    lost: all.flatMap((x) => x.lost),
    overridesLost: all.reduce((n, x) => n + x.overridesLost, 0),
  };
  // Cofnięcie: najpierw nowe serie do kosza, potem stare wracają.
  return {
    effects,
    ops: [...other, ...created, ...anchor].flatMap((s) => s.ops),
    undo: (now) => [...created, ...other, ...anchor].flatMap((s) => s.undo(now)),
    series: wanted.length,
  };
}

/** Reguła bez COUNT (COUNT liczony od nowego początku dałby inne terminy) — UNTIL = ostatni termin. */
function withoutCount(start: CivilDate, rule: Rule): string {
  if (rule.count === null) return formatRule(rule);
  const all = occurrences(start, rule, start, addDays(start, 366 * 100));
  return formatRule({ ...rule, count: null, until: formatIsoDate(all.at(-1)!) });
}

/** Kopie stałych zadań serii z terminów od `from`, których stara reguła nie ma (dołożone po zapisie) — do kosza. */
function strayCopies(t: Tables, eventId: string, start: CivilDate, rule: Rule, from: string): NewOp[] {
  return rows(t, 'tasks', asTask)
    .filter((x) => x.deleted_at === null && x.series_id !== null && x.event_id === eventId && x.occurrence_date! >= from && occurrences(start, rule, parseIsoDate(x.occurrence_date!), parseIsoDate(x.occurrence_date!)).length === 0)
    .map((x): NewOp => ({ kind: 'delete', entity: 'tasks', id: x.id }));
}

/** Cofnięcie decyzji o zadaniach (przepięcie na najbliższy termin, odpięcie, kopia do kosza) — stan sprzed zapisu. */
function taskUndo(t: Tables, decisions: readonly SplitTask[], eventId: string): NewOp[] {
  const before = new Map(rows(t, 'tasks', asTask).map((x) => [x.id, x]));
  return decisions.map((d): NewOp => {
    const x = before.get(d.id)!;
    if (d.action === 'delete') return { kind: 'restore', entity: 'tasks', id: d.id };
    return { kind: 'patch', entity: 'tasks', id: d.id, set: { event_id: eventId, occurrence_date: x.occurrence_date, ...(d.action === 'unlink' ? { deadline_mode: x.deadline_mode } : {}) } };
  });
}

/** Decyzje o zadaniach z operacji zmiany serii w miejscu (seriesEditOps) — do cofnięcia. */
const decisionsOf = (ops: readonly NewOp[]): SplitTask[] =>
  ops.flatMap((o): SplitTask[] => (o.kind === 'delete' && o.entity === 'tasks' ? [{ id: o.id, action: 'delete' }] : o.kind === 'patch' && o.entity === 'tasks' ? [o.set.event_id === null ? { id: o.id, action: 'unlink' } : { id: o.id, action: 'relink', date: String(o.set.occurrence_date) }] : []));

/** Zmieniona seria tej osoby (bez rodzeństwa): split_event od jutra albo — nierozpoczęta — zmiana w miejscu. */
function changeSeries(t: Tables, userId: string, x: PlanSeries, f: EventFields, memberId: string, tomorrow: CivilDate, choice: LostChoice): Step {
  const d = eventDetail(t, userId, x.id)!;
  const e = d.event;
  const isoTomorrow = formatIsoDate(tomorrow);
  const oldStart = parseIsoDate(e.start_date);
  const oldRule = d.rule!;
  const newStart = parseIsoDate(f.date);
  const kept = (iso: string) => occurrences(newStart, f.rule, parseIsoDate(iso), parseIsoDate(iso)).length > 0;
  const fields = { title: f.title, start_date: f.date, start_time: f.startTime, end_time: f.endTime, rrule: formatRule({ ...f.rule!, until: f.until }) };
  const back = { title: e.title, start_time: e.start_time, end_time: e.end_time };
  if (e.start_date >= isoTomorrow) {
    // Nierozpoczęta: zmiana w miejscu; wyjątki z dni, których nowa reguła nie ma, do kosza (jak „wszystkie”). Tylko pola,
    // które zmieniłem względem planu z chwili otwarcia (x) — zmiany są per pole, więc to, czego nie ruszałem, a co w tym
    // czasie zmienił drugi telefon, zostaje (jak editEvent z polami z chwili otwarcia). Godziny parą.
    const changed: { [k: string]: unknown } = {
      ...(f.title !== x.spec.title ? { title: f.title } : {}),
      ...(f.startTime !== x.spec.start || (f.endTime ?? '') !== x.spec.end ? { start_time: f.startTime, end_time: f.endTime } : {}),
      ...(f.date !== x.start_date ? { start_date: f.date } : {}),
      ...(fields.rrule !== x.rrule ? { rrule: fields.rrule } : {}),
    };
    const restore: { [k: string]: unknown } = Object.fromEntries(Object.keys(changed).map((k) => [k, k === 'start_date' ? e.start_date : k === 'rrule' ? x.rrule : back[k as keyof typeof back]]));
    const lost = d.overrides.filter((o) => !kept(o.occurrence_date));
    // Para z inną specyfikacją (sameSpec) zawsze zmienia któreś pole.
    const base: NewOp[] = [{ kind: 'patch', entity: 'events', id: e.id, set: changed }, ...lost.map((o): NewOp => ({ kind: 'delete', entity: 'event_overrides', id: o.id }))];
    const effects = seriesEditEffects(t, d, e.start_date, 'all', base);
    const ops = seriesEditOps(base, effects, choice);
    const tasks = taskUndo(t, decisionsOf(ops), e.id);
    return {
      ops,
      effects,
      undo: (now) => [
        { kind: 'patch', entity: 'events', id: e.id, set: restore },
        ...lost.map((o): NewOp => ({ kind: 'restore', entity: 'event_overrides', id: o.id })),
        ...tasks,
        ...strayCopies(now, e.id, oldStart, oldRule, e.start_date),
      ],
    };
  }
  const id = splitId(e.id, isoTomorrow);
  const args: SplitArgs = {
    id,
    event_id: e.id,
    date: isoTomorrow,
    set: { ...fields, audience: 'members', responsible_member_id: e.responsible_member_id, location: e.location },
    participants: [{ id: participantId(id, memberId), member_id: memberId }],
    drop_overrides: d.overrides.filter((o) => o.occurrence_date >= isoTomorrow && !kept(o.occurrence_date)).map((o) => o.id),
    tasks: [],
  };
  const cmd: NewOp[] = [{ kind: 'cmd', cmd: 'split_event', args }];
  const effects = seriesEditEffects(t, d, isoTomorrow, 'following', cmd);
  const ops = seriesEditOps(cmd, effects, choice);
  const tasks = taskUndo(t, (ops[0] as unknown as { args: SplitArgs }).args.tasks, id);
  const [first] = occurrences(oldStart, oldRule, tomorrow, addDays(tomorrow, LOOKAHEAD));
  return {
    ops,
    effects,
    // Nowa seria wraca do starych pól od pierwszego starego terminu od jutra; stara kończy się dziś — terminy jak przed zapisem.
    undo: (now) =>
      first
        ? [
            { kind: 'patch', entity: 'events', id, set: { ...back, start_date: formatIsoDate(first), rrule: withoutCount(oldStart, oldRule) } },
            ...args.drop_overrides.map((o): NewOp => ({ kind: 'restore', entity: 'event_overrides', id: o })),
            ...tasks,
            ...strayCopies(now, id, oldStart, oldRule, isoTomorrow),
          ]
        : [{ kind: 'delete', entity: 'events', id }],
  };
}

/** Usunięta lekcja tej osoby (bez rodzeństwa): koniec dziś, nierozpoczęta do kosza. */
function endSeries(x: PlanSeries, tomorrow: CivilDate): Step {
  if (x.start_date >= formatIsoDate(tomorrow)) return { ops: [{ kind: 'delete', entity: 'events', id: x.id }], undo: () => [{ kind: 'restore', entity: 'events', id: x.id }] };
  return {
    ops: [{ kind: 'patch', entity: 'events', id: x.id, set: { rrule: formatRule(endBefore(ruleOf({ rrule: x.rrule })!, tomorrow)) } }],
    undo: () => [{ kind: 'patch', entity: 'events', id: x.id, set: { rrule: x.rrule } }],
  };
}

/**
 * Lekcja z rodzeństwem (audyt 2, E-26): ta osoba odchodzi od jutra, seria trwa dla pozostałych — split_event z tymi
 * samymi polami (zadania i wyjątki zostają na swoich terminach); nierozpoczęta — bez jej udziału od początku.
 */
function leaveSeries(t: Tables, x: PlanSeries, memberId: string, tomorrow: CivilDate): Step {
  const e = asEvent(t.events![x.id]!);
  const mine = rows(t, 'event_participants', asParticipant).find((p) => p.deleted_at === null && p.event_id === x.id && p.member_id === memberId)!;
  const start = parseIsoDate(e.start_date);
  const rule = ruleOf(e)!;
  const [first] = occurrences(start, rule, tomorrow, addDays(tomorrow, LOOKAHEAD));
  if (!first || e.start_date >= formatIsoDate(tomorrow)) {
    return { ops: [{ kind: 'delete', entity: 'event_participants', id: mine.id }], undo: () => [{ kind: 'restore', entity: 'event_participants', id: mine.id }] };
  }
  const id = splitId(e.id, formatIsoDate(tomorrow));
  const args: SplitArgs = {
    id,
    event_id: e.id,
    date: formatIsoDate(tomorrow),
    set: { title: e.title, start_date: formatIsoDate(first), start_time: e.start_time, end_time: e.end_time, rrule: withoutCount(start, rule), audience: e.audience, responsible_member_id: e.responsible_member_id, location: e.location },
    participants: x.others.map((m) => ({ id: participantId(id, m), member_id: m })),
    drop_overrides: [],
    tasks: [],
  };
  const pid = participantId(id, memberId);
  return {
    ops: [{ kind: 'cmd', cmd: 'split_event', args }],
    // Powrót do serii od jutra: utworzenie z identyfikatorem z serii i osoby, potem przywrócenie (jak w edycji wydarzenia).
    undo: () => [
      { kind: 'create', entity: 'event_participants', id: pid, group_id: e.group_id, set: { event_id: id, member_id: memberId } },
      { kind: 'restore', entity: 'event_participants', id: pid },
    ],
  };
}

/** Dokąd skopiować plan lekcji (audyt 3, N-47, decyzja Q27 B): profil dziecka w innej grupie wspólnej, w której jestem dorosłym. */
export type CopyTarget = { groupId: string; groupName: string; memberId: string; name: string };

/**
 * „Skopiuj plan lekcji do…” (Q27 B): dzieci w moich innych grupach wspólnych (np. ten sam Tymek w „Rodzinie” i w „Domu
 * taty” — profil dziecka jest wierszem jednej grupy, więc plan nie przechodzi sam). Kolejność grup jak na ekranie Grupy,
 * w grupie — imiona alfabetycznie. Kopia otwiera ekran planu tamtego dziecka z planem do sprawdzenia; zapis — jak zawsze.
 */
export function copyTargets(t: Tables, userId: string, fromGroupId: string): CopyTarget[] {
  const kids = rows(t, 'group_members', asMember).filter((m) => m.deleted_at === null && m.role === 'child');
  return groupsView(t, userId)
    .filter((g) => g.kind === 'shared' && g.id !== fromGroupId && g.me.role !== 'child')
    .flatMap((g) =>
      kids
        .filter((m) => m.group_id === g.id)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'))
        .map((m) => ({ groupId: g.id, groupName: g.name, memberId: m.member_id, name: m.display_name })),
    );
}
