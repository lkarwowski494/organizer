/**
 * Wzorzec do testów równoważności (audyt 3, N-6, N-16): plan przypomnień, Moje sprawy, rozwinięcie wydarzeń, RRULE
 * zagnieżdżenie i miesiąc Kalendarza w wersji sprzed optymalizacji (stan z commita 0430562), słowo w słowo — 14 pełnych przeliczeń myDays,
 * filtry całych tabel i przeglądanie serii od początku. Nowa wersja ma dawać ten sam wynik.
 */
import { config } from '../../../config';
import { addDays, type CivilDate, compareDates, daysInMonth, formatIsoDate, isoWeekday, isValidDate, type LocalDateTime, toDayNumber } from '../../civil-date';
import { compareByDue, type Due, effectiveDue, isVisible } from '../../deadlines';
import { monthGrid } from '../../month-grid';
import { parseIsoDate } from '../../format';
import type { Target } from '../../notification-target';
import { parseRule, type Rule } from '../../rrule';
import { daySpan, isContinuation } from '../../span';
import { agenda, type LessonBlock } from '../../views/agenda';
import { childEventConcerns, childOwner } from '../../views/child';
import { asEvent, asOverride, asParticipant, occurrenceDays, occurrenceDuration, occurrenceResolver, occurrenceResponsible, occurrenceTimes, ruleOf } from '../../views/event-rows';
import type { Occurrence } from '../../views/events';
import { assigneeName, type CalendarDay, type CalendarItem, concernsMeTask, groupsView, isExpired, liveMembers, type TodayItem, visibleOnItsDay } from '../../views/index';
import { asList, asMember, asTask, type Member, rows, type Tables, type Task } from '../../views/model';
import type { MyDay, MyDaysView, MyEntry, MyTask, RangeMode } from '../../views/my-days';
import { rangeOf } from '../../views/my-days';
import { type ScopeOf, occurrenceInScope, scopeAll } from '../../views/my-scope';
import type { Nested, ParentLabel } from '../../views/nesting';
import type { Reminder, ReminderSettings } from '../../views/reminders';
import { silencedForMe } from '../../views/rsvp';
import { doneTrips, tripEntries } from '../../views/shopping-trip';
import { formatRepeat, repeatOf } from '../../views/task-repeat';
import { type Person, personOf } from '../../views/who';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const toDate = (iso: string): CivilDate => {
  const m = ISO.exec(iso)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

/** Dni pasujące do reguły w jednym okresie (tydzień / miesiąc / rok), rosnąco. */
function periodDays(r: Rule, start: CivilDate, k: number): CivilDate[] {
  switch (r.freq) {
    case 'DAILY':
      return [addDays(start, k * r.interval)];
    case 'WEEKLY': {
      const monday = addDays(start, -isoWeekday(start) + 7 * k * r.interval);
      const wds = r.byday.length ? [...new Set(r.byday.map((b) => b.wd))].sort((a, b) => a - b) : [isoWeekday(start)];
      return wds.map((wd) => addDays(monday, wd));
    }
    case 'MONTHLY': {
      const idx = start.y * 12 + (start.m - 1) + k * r.interval;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const dim = daysInMonth(y, m);
      const days = new Set<number>();
      if (r.byday.length) {
        for (const b of r.byday) {
          const all: number[] = [];
          const firstWd = isoWeekday({ y, m, d: 1 });
          for (let d = 1 + ((b.wd - firstWd + 7) % 7); d <= dim; d += 7) all.push(d);
          if (b.n === null) all.forEach((d) => days.add(d));
          else {
            const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
            if (d !== undefined) days.add(d);
          }
        }
      } else if (r.bymonthday.length) {
        for (const md of r.bymonthday) {
          const d = md > 0 ? md : dim + 1 + md;
          if (d >= 1 && d <= dim) days.add(d);
        }
      } else if (start.d <= dim) days.add(start.d);
      return [...days].sort((a, b) => a - b).map((d) => ({ y, m, d }));
    }
    case 'YEARLY': {
      const y = start.y + k * r.interval;
      return isValidDate(y, start.m, start.d) ? [{ y, m: start.m, d: start.d }] : [];
    }
  }
}

/** Ile okresów najwyżej przeglądamy — bezpiecznik na regułę, która nic nie daje (np. 31. dzień co 12 miesięcy w lutym). */
const MAX_PERIODS = 20_000;

/**
 * Wystąpienia od `start` (pierwsze wystąpienie, zgodne z regułą) w zakresie [from, to], z COUNT i UNTIL liczonymi
 * od początku serii. Bez reguły — tylko `start`.
 */
export function refOccurrences(start: CivilDate, rule: Rule | null, from: CivilDate, to: CivilDate): CivilDate[] {
  if (rule === null) return compareDates(start, from) >= 0 && compareDates(start, to) <= 0 ? [start] : [];
  const until = rule.until === null ? null : toDate(rule.until);
  const out: CivilDate[] = [];
  let n = 0;
  for (let k = 0; k < MAX_PERIODS; k++) {
    for (const d of periodDays(rule, start, k)) {
      if (compareDates(d, start) < 0) continue;
      if (until && compareDates(d, until) > 0) return out;
      if (compareDates(d, to) > 0) return out;
      n++;
      if (rule.count !== null && n > rule.count) return out;
      if (compareDates(d, from) >= 0) out.push(d);
    }
  }
  return out;
}


const MOVE_WINDOW_DAYS = config.events.MOVE_WINDOW_DAYS;

const alive = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at === null;

/**
 * Wystąpienia w [from, to] z moich grup. Do „Moich spraw” trafia (D58): wydarzenie całej grupy, albo jestem uczestnikiem,
 * albo uczestnikiem jest dziecko z tej grupy, a ja jestem dorosłym (rodzic zawozi na zajęcia). W grupie, w której jestem
 * dzieckiem z kontem, tylko wystąpienia, które mnie dotyczą — także w Kalendarzu (PW-14 B, child.ts), a moje lekcje
 * zwijają się jak lekcje dziecka u dorosłych, bez przypomnień (D127; audyt 2, N-38).
 */
export function refExpandEvents(t: Tables, userId: string, from: CivilDate, to: CivilDate): Occurrence[] {
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const members = new Map(rows(t, 'group_members', asMember).map((m) => [m.member_id, m]));
  const parts = rows(t, 'event_participants', asParticipant).filter(alive);
  const overrides = rows(t, 'event_overrides', asOverride).filter(alive);
  const out: Occurrence[] = [];
  const isoFrom = formatIsoDate(from);
  const isoTo = formatIsoDate(to);
  for (const e of rows(t, 'events', asEvent).filter(alive)) {
    const g = groups.get(e.group_id);
    if (!g) continue;
    const rule = ruleOf(e);
    const mine = parts.filter((p) => p.event_id === e.id).map((p) => members.get(p.member_id));
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
    const byDate = new Map(overrides.filter((o) => o.event_id === e.id).map((o) => [o.occurrence_date, o]));
    // Jedyna zmiana względem 0430562 (audyt 3, seed -253130834): wyjątek przeniesiony do zakresu z dalszej daty niż okno
    // ±MOVE_WINDOW_DAYS też się liczy (RFC 5545, RECURRENCE-ID), żeby wynik nie zależał od szerokości zakresu.
    const window = refOccurrences(parseIsoDate(e.start_date), rule, addDays(from, -MOVE_WINDOW_DAYS), addDays(to, MOVE_WINDOW_DAYS)).map(formatIsoDate);
    const far = [...byDate.values()]
      .filter((o) => o.start_date !== null && o.start_date >= isoFrom && o.start_date <= isoTo && !window.includes(o.occurrence_date))
      .filter((o) => refOccurrences(parseIsoDate(e.start_date), rule, parseIsoDate(o.occurrence_date), parseIsoDate(o.occurrence_date)).length > 0)
      .map((o) => o.occurrence_date);
    for (const occ of [...window, ...far].sort()) {
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
export function refExpandEventDays(t: Tables, userId: string, from: CivilDate, to: CivilDate): Occurrence[] {
  const isoFrom = formatIsoDate(from);
  const isoTo = formatIsoDate(to);
  const out: Occurrence[] = [];
  for (const o of refExpandEvents(t, userId, addDays(from, 1 - config.events.MAX_DAYS), to)) {
    for (let i = 0; i < o.days; i++) {
      const date = i === 0 ? o.date : formatIsoDate(addDays(parseIsoDate(o.date), i));
      if (date >= isoFrom && date <= isoTo) out.push(i === 0 ? o : { ...o, date, part: { day: i + 1, days: o.days } });
    }
  }
  const at = (o: Occurrence) => daySpan(o.startTime, o.endTime, o.part).start ?? '';
  return out.sort((a, b) => a.date.localeCompare(b.date) || at(a).localeCompare(at(b)) || a.title.localeCompare(b.title, 'pl') || a.eventId.localeCompare(b.eventId));
}


/**
 * Dni zakresu z ich zawartością. W tygodniu i miesiącu tylko dni, w których coś jest (i zawsze dziś);
 * w trybie dnia — zawsze ten jeden dzień. `localDate` zamienia chwilę odhaczenia (ISO, UTC) na dzień w Warszawie.
 */
export function refMyDays(t: Tables, userId: string, today: CivilDate, mode: RangeMode, anchor: CivilDate, localDate: (iso: string) => string, scopeOf: ScopeOf = scopeAll): MyDaysView {
  const { from, to } = rangeOf(mode, anchor);
  const isoToday = formatIsoDate(today);
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter((l) => l.deleted_at === null).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
  const byId = new Map(all.map((x) => [x.id, x]));
  const live = liveMembers(t);
  const owns = childOwner(t, live);
  const occ = occurrenceResolver(t);
  const pinned: TodayItem[] = [];
  const doneToday: TodayItem[] = [];
  const overdue: MyTask[] = [];
  const tasksByDay = new Map<string, TodayItem[]>();
  const push = (d: string, item: TodayItem) => tasksByDay.set(d, [...(tasksByDay.get(d) ?? []), item]);
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    // Pozycje list zakupów nie są sprawami — lista pokazuje się raz, jako „Zakupy: …” (D73; audyt 8.10.2026).
    if (!g || !l || l.kind === 'shopping') continue;
    const due = effectiveDue(x, byId, occ);
    if (!concernsMeTask(t, x, g, due, live, l, owns, scopeOf(g.id))) continue;
    const item: TodayItem = { ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: assigneeName(x, live) };
    if (x.completed_at !== null) {
      const d = localDate(x.completed_at);
      // Historia dla minionych dni; odhaczone dziś — w „Zrobione dziś”, nie w planie dnia.
      // (Odhaczone „jutro” przez przesunięty zegar telefonu liczy się jako dziś.)
      if (d < isoToday) push(d, item);
      else doneToday.push(item);
      continue;
    }
    if (!visibleOnItsDay(x, due, today) || isExpired(x, due, isoToday, byId)) continue;
    if (due === null) pinned.push(item);
    else if (due.date < isoToday) overdue.push({ ...item, overdueDays: toDayNumber(today) - toDayNumber(parseIsoDate(due.date)) });
    else push(due.date, item);
  }
  // Zakupy z terminem albo osobą (D73) — jak zadanie: bez terminu przypięte, po terminie zaległe, inaczej w swoim dniu.
  for (const trip of tripEntries(t, groups, false, scopeOf)) {
    if (trip.due === null) pinned.push(trip);
    else if (trip.due.date < isoToday) overdue.push({ ...trip, overdueDays: toDayNumber(today) - toDayNumber(parseIsoDate(trip.due.date)) });
    else push(trip.due.date, trip);
  }
  const events = new Map<string, Occurrence[]>();
  // D127: lekcje dziecka (sam w nich nie jestem) — jeden wiersz na dziecko i dzień; wspólna lekcja rodzeństwa w wierszu
  // każdego z dzieci (audyt 2, E-15: plan każdego dziecka kompletny).
  const lessons = new Map<string, Map<string, LessonBlock>>();
  // D199: wielodniowe w każdym swoim dniu („dzień 2 z 5”).
  for (const e of refExpandEventDays(t, userId, from, to)) {
    const info = !e.concernsMe && e.childInfo !== null && scopeOf(e.groupId) !== 'mine';
    if (!occurrenceInScope(e, scopeOf) && !info) continue;
    if (!e.lessonFor) {
      events.set(e.date, [...(events.get(e.date) ?? []), e]);
      continue;
    }
    const day = lessons.get(e.date) ?? new Map<string, LessonBlock>();
    lessons.set(e.date, day);
    for (const child of e.lessonFor) {
      const b = day.get(child.memberId);
      if (b) b.lessons.push(e);
      else day.set(child.memberId, { memberId: child.memberId, name: child.name, groupId: e.groupId, groupName: e.groupName, line: e.line, start: null, end: null, lessons: [e] });
    }
  }
  for (const day of lessons.values())
    for (const b of day.values()) {
      // Godziny bloku: od najwcześniejszego początku do najpóźniejszego końca (lekcja bez końca liczy się początkiem).
      const starts = b.lessons.flatMap((x) => (x.startTime ? [x.startTime.slice(0, 5)] : [])).sort();
      const ends = b.lessons.flatMap((x) => (x.startTime ? [(x.endTime ?? x.startTime).slice(0, 5)] : [])).sort();
      b.start = starts[0] ?? null;
      b.end = ends.at(-1) ?? null;
    }

  const days: MyDay[] = [];
  for (let d = from; toDayNumber(d) <= toDayNumber(to); d = addDays(d, 1)) {
    const iso = formatIsoDate(d);
    const isToday = iso === isoToday;
    const past = iso < isoToday;
    const entries: MyEntry[] = [
      ...(isToday ? overdue.sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id)).map((x) => ({ kind: 'overdue' as const, key: `o-${x.id}`, task: x })) : []),
      ...agenda(tasksByDay.get(iso) ?? [], events.get(iso) ?? [], [...(lessons.get(iso)?.values() ?? [])]),
    ];
    if (mode === 'day' || isToday || entries.length) days.push({ date: iso, past, isToday, entries });
  }
  const byTitle = (a: TodayItem, b: TodayItem) => a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id);
  return { pinned: pinned.sort(byTitle), days, doneToday: doneToday.sort(byTitle) };
}


type EventLike = { kind: 'event'; event: { eventId: string; occurrenceDate: string } };
type TaskLike = { kind: 'task' | 'overdue'; task: { id: string; parent_id: string | null; event_id: string | null; occurrence_date: string | null } };
/** Zwinięte lekcje (D127) nie mają podzadań ani rodzica. */
type BlockLike = { kind: 'lessons'; key: string };

const keyOf = (e: EventLike | TaskLike | BlockLike) => (e.kind === 'event' ? `e:${e.event.eventId}|${e.event.occurrenceDate}` : e.kind === 'lessons' ? `l:${e.key}` : `t:${e.task.id}`);
const parentOf = (x: TaskLike['task']) => (x.parent_id ? `t:${x.parent_id}` : x.event_id && x.occurrence_date ? `e:${x.event_id}|${x.occurrence_date}` : null);

export function refNestEntries<E extends EventLike | TaskLike | BlockLike>(entries: readonly E[], t: Tables): Nested<E>[] {
  const tasks = rows(t, 'tasks', asTask).filter((x) => x.deleted_at === null);
  const present = new Set(entries.map(keyOf));
  const children = new Map<string, E[]>();
  const roots: E[] = [];
  for (const e of entries) {
    const p = e.kind === 'event' || e.kind === 'lessons' ? null : parentOf(e.task);
    if (p && present.has(p) && p !== keyOf(e)) children.set(p, [...(children.get(p) ?? []), e]);
    else roots.push(e);
  }
  const progressOf = (e: E) => {
    if (e.kind === 'lessons') return null;
    const mine = e.kind === 'event' ? tasks.filter((x) => x.event_id === e.event.eventId && x.occurrence_date === e.event.occurrenceDate && x.parent_id === null) : tasks.filter((x) => x.parent_id === e.task.id);
    return mine.length ? { done: mine.filter((x) => x.completed_at !== null).length, total: mine.length } : null;
  };
  const parentLabel = (e: E): ParentLabel | null => {
    if (e.kind === 'event' || e.kind === 'lessons') return null;
    if (e.task.parent_id) {
      const p = t.tasks?.[e.task.parent_id];
      return p && p.deleted_at == null ? { kind: 'task', title: String(p.title) } : null;
    }
    if (e.task.event_id) {
      const ev = t.events?.[e.task.event_id];
      return ev && ev.deleted_at == null ? { kind: 'event', title: String(ev.title) } : null;
    }
    return null;
  };
  const out: Nested<E>[] = [];
  const seen = new Set<string>();
  const walk = (e: E, depth: number) => {
    const k = keyOf(e);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ entry: e, depth, parent: depth === 0 ? parentLabel(e) : null, progress: progressOf(e) });
    for (const c of children.get(k) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // Cykl (dane z błędem) — nieodwiedzone dokładamy płasko, żeby nic nie zniknęło.
  for (const e of entries) walk(e, 0);
  return out;
}

const hm = (t: string) => ({ hh: Number(t.slice(0, 2)), mm: Number(t.slice(3, 5)) });

export function refPlanReminders(
  t: Tables,
  userId: string,
  today: CivilDate,
  nowMs: number,
  s: ReminderSettings,
  opts: { days: number; max: number; toMs: (t: LocalDateTime) => number; localDate: (iso: string) => string; label: { trip: (name: string) => string; morningTitle: string; more: (n: number) => string; summary: (n: number, overdue: number) => string; leave?: (title: string) => string; late?: (minutes: number) => string; subtasks?: (titles: string[]) => string; parent?: (title: string, isEvent: boolean) => string; who?: (p: Person) => string };
    leaveFor?: (eventId: string, occurrenceDate: string) => { at: number; body: string } | null;
    /** Zakres Moich spraw w grupach (PW-2, my-scope.ts) — przypomnienia i poranne podsumowanie jak Moje sprawy. */
    scopeOf?: ScopeOf;
  },
): Reminder[] {
  const out: Reminder[] = [];
  // PW-23 (decyzja właściciela 8.10.2026): termin, na który odpowiedziałem „nie będę” — bez przypomnienia, „Czas
  // wyjść” i miejsca w porannym podsumowaniu (wiersz w „Moich sprawach” zostaje, D129). Jego zadania przypominają same.
  // D160: tak samo termin, który dotyczy mnie tylko przez dzieci, a żadne z nich nie będzie (silencedForMe).
  const declined = silencedForMe(t, userId);
  for (let k = 0; k < opts.days; k++) {
    const day = addDays(today, k);
    const iso = formatIsoDate(day);
    // Audyt 2 (T-21, N-12): dzień liczony tak, jak aplikacja pokaże go tego dnia — z zaległymi (niezrobione z „przenoś
    // na kolejne dni” sprzed tego dnia), bez wygasłych. Plan zakłada, że do tego dnia nic się nie zmieni; zmiana
    // danych i tak przelicza plan.
    const view = refMyDays(t, userId, day, 'day', day, opts.localDate, opts.scopeOf);
    // Chwila własnego przypomnienia wpisu („Czas wyjść” albo `leadMin` przed) albo `null`.
    type Fire = { at: number; leave: { at: number; body: string } | null };
    const fires = new Map<string, Fire | null>();
    const fire = (e: MyEntry): Fire | null => {
      if (fires.has(e.key)) return fires.get(e.key)!;
      let f: Fire | null = null;
      const time = e.kind === 'event' ? e.event.startTime : e.kind === 'task' ? e.task.due!.time : null;
      if (time !== null) {
        const leave = e.kind === 'event' && opts.leaveFor && s.leave !== false ? opts.leaveFor(e.event.eventId, e.event.occurrenceDate) : null;
        if (leave) f = { at: leave.at, leave };
        else if (s.leadMin > 0) f = { at: opts.toMs({ ...parseIsoDate(iso), ...hm(time) }) - s.leadMin * 60_000, leave: null };
      }
      fires.set(e.key, f);
      return f;
    };
    // D134: wpis pod rodzicem trafia do przypomnienia najbliższego przodka, który je ma — chyba że to przyszłoby
    // później niż jego własne; wtedy przypomina sam (i niesie swoje podzadania).
    // PWD-32 B: wydarzenie dziecka, które prowadzi ktoś inny, stoi w Moich sprawach tylko informacyjnie — bez przypomnień.
    // D199: kolejne dni wielodniowego (obóz, koniec nocnego dyżuru) — bez przypomnień i poza porannym podsumowaniem:
    // wydarzenie przypomina się raz, przed startem. Wiersz w „Moich sprawach” zostaje.
    const nested = refNestEntries(view.days[0]!.entries.filter((e) => e.kind !== 'event' || (e.event.concernsMe && !declined.has(`${e.event.eventId}|${e.event.occurrenceDate}`) && !isContinuation(e.event.part))), t);
    const under = new Map<string, string[]>();
    const parentOf = new Map<string, MyEntry>();
    const holder: MyEntry[] = [];
    const entries: MyEntry[] = [];
    for (const n of nested) {
      const up = n.depth > 0 ? holder[n.depth - 1] : undefined;
      const own = fire(n.entry);
      if (up && (own === null || (fire(up) !== null && fire(up)!.at <= own.at))) {
        // Pod rodzicem stoją tylko zadania (nesting.ts).
        under.set(up.key, [...(under.get(up.key) ?? []), (n.entry as { task: { title: string } }).task.title]);
        holder[n.depth] = up;
        continue;
      }
      if (up) parentOf.set(n.entry.key, up);
      holder[n.depth] = n.entry;
      entries.push(n.entry);
    }
    const extra = (e: MyEntry) => {
      const list = under.get(e.key);
      const p = parentOf.get(e.key);
      const parent = p && p.kind !== 'lessons' && opts.label.parent ? ` · ${opts.label.parent(p.kind === 'event' ? p.event.title : p.task.title, p.kind === 'event')}` : '';
      return `${parent}${list && opts.label.subtasks ? ` · ${opts.label.subtasks(list)}` : ''}`;
    };
    // Zadanie dziecka bez konta przypomina dorosłym (decyzja właściciela z 8.10.2026) — z imieniem, jak „dla: …” w wierszu (D119).
    const whom = (e: MyEntry) => {
      const who = opts.label.who;
      const p = who && e.kind === 'task' ? personOf(t, userId, e.task.assignee_member_id) : null;
      return who && p && !p.me ? ` · ${who(p)}` : '';
    };
    // Bez terminu (przypięte) nie przypominamy — codziennie to samo byłoby szumem.
    const untimed: string[] = [];
    const timed: string[] = [];
    let overdue = 0;
    for (const e of entries) {
      // D127: zwinięte lekcje dziecka — bez przypomnień i bez miejsca w porannym podsumowaniu (codzienna rutyna szkoły).
      if (e.kind === 'lessons') continue;
      const title = e.kind === 'event' ? e.event.title : e.task.trip ? opts.label.trip(e.task.title) : e.task.title;
      // Zadania w dniu mają termin (myDays); odhaczone dziś i w przyszłości do widoku nie trafiają.
      const time = e.kind === 'event' ? e.event.startTime : e.kind === 'overdue' ? null : e.task.due!.time;
      if (e.kind === 'overdue') overdue++;
      if (time === null) {
        untimed.push(title);
        continue;
      }
      timed.push(`${time.slice(0, 5)} ${title}`);
      const f = fire(e);
      if (!f) continue;
      const target: Target =
        e.kind === 'event' ? { screen: 'event', id: e.event.eventId, date: e.event.occurrenceDate } : e.task.trip ? { screen: 'list', id: e.task.id } : { screen: 'task', id: e.task.id };
      if (f.leave && e.kind === 'event') {
        const id = `l|${e.event.eventId}|${e.event.occurrenceDate}|${iso}`;
        if (f.at > nowMs) out.push({ id, at: f.at, title: opts.label.leave!(title), body: `${f.leave.body}${extra(e)}`, target });
        // PW-24 (decyzja właściciela 8.10.2026): wyjście już minęło (np. dojazd wydłużył się w korkach), a wydarzenie
        // jeszcze się nie zaczęło — od razu „Masz N min spóźnienia” zamiast ciszy. Zamiast „N min przed”, nie obok.
        else if (opts.label.late && opts.toMs({ ...parseIsoDate(iso), ...hm(time) }) > nowMs)
          out.push({ id: `${id}|late`, at: nowMs, now: true, title: opts.label.leave!(title), body: `${opts.label.late(Math.max(1, Math.ceil((nowMs - f.at) / 60_000)))}${extra(e)}`, target });
        continue;
      }
      if (f.at <= nowMs) continue;
      const group = e.kind === 'event' ? e.event.groupName : e.task.groupName;
      const key = e.kind === 'event' ? `e|${e.event.eventId}|${e.event.occurrenceDate}` : `t|${e.task.id}`;
      out.push({ id: `${key}|${iso}`, at: f.at, title, body: `${time.slice(0, 5)} · ${group}${whom(e)}${extra(e)}`, target });
    }
    const all = [...untimed, ...timed];
    if (s.morning !== 'off' && all.length) {
      const at = opts.toMs({ ...parseIsoDate(iso), ...hm(s.morning) });
      const max = config.reminders.MORNING_LIST_MAX;
      const shown = all.slice(0, max).join(', ');
      const list = all.length > max ? `${shown} ${opts.label.more(all.length - max)}` : shown;
      if (at > nowMs) out.push({ id: `m|${iso}`, at, title: opts.label.morningTitle, body: `${opts.label.summary(all.length, overdue)}: ${list}`, target: { screen: 'today' } });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(0, opts.max);
}

export function refCalendarMonth(t: Tables, userId: string, year: number, month: number, opts: { today?: CivilDate; localDate?: (iso: string) => string } = {}): CalendarDay[] {
  const isoToday = formatIsoDate(opts.today ?? { y: 1970, m: 1, d: 1 });
  const localDate = opts.localDate ?? ((iso: string) => iso.slice(0, 10));
  const grid = monthGrid(year, month);
  const last = grid.at(-1)!.date;
  const groups = new Map(groupsView(t, userId).map((g) => [g.id, g]));
  const lists = new Map(rows(t, 'lists', asList).filter(alive).map((l) => [l.id, l]));
  const all = rows(t, 'tasks', asTask).filter(alive);
  const byId = new Map(all.map((x) => [x.id, x]));
  const occ = occurrenceResolver(t);
  const owns = childOwner(t, liveMembers(t));
  const byDate = new Map<string, CalendarItem[]>();
  const add = (date: string, item: CalendarItem) => byDate.set(date, [...(byDate.get(date) ?? []), item]);
  const doneOn = (date: string, completedAt: string | null) => {
    const d = completedAt === null ? null : localDate(completedAt);
    return d === date ? null : d;
  };
  for (const x of all) {
    const g = groups.get(x.group_id);
    const l = lists.get(x.list_id);
    const due = effectiveDue(x, byId, occ);
    // D135: Kalendarz = co było zaplanowane — także zrobione (przekreślone) i minione, w dniu swojego terminu.
    // Niezrobione „widoczne od” późniejszego dnia (start_date) w dniu terminu jeszcze nie stoi — jak w Moich sprawach.
    if (!g || !l || l.kind === 'shopping' || due === null || (x.completed_at === null && !isVisible(x, parseIsoDate(due.date)))) continue;
    // PW-14 B: dziecko z kontem widzi tylko swoje sprawy (child.ts).
    if (g.me.role === 'child' && !owns(x, g.me.member_id)) continue;
    const expired = isExpired(x, due, isoToday, byId);
    const overdue = x.completed_at === null && !expired && due.date < isoToday;
    const item: TodayItem = { ...x, due, line: g.line, groupName: g.name, listName: l.name, assignee: null };
    add(due.date, { ...item, doneOn: doneOn(due.date, x.completed_at), projected: false, expired, overdueDays: overdue ? dayDiff(isoToday, due.date) : 0 });
    // PWD-15 A: kolejne terminy otwartego zadania powtarzanego według kalendarza (od wykonania — nie da się ich
    // przewidzieć), tylko w oknie siatki; zadanie powstanie dopiero po odhaczeniu poprzedniego (task-repeat.ts).
    for (const date of x.completed_at === null && x.parent_id === null ? futureRepeats(t, x, due, last) : []) add(date, { ...item, due: { date, time: due.time }, doneOn: null, projected: true, expired: false, overdueDays: 0 });
  }
  // Zaplanowane zakupy z dniem (D73) — także cudze, jak zadania grupy; ostatnie zrobione — przekreślone (PWD-11 A).
  for (const trip of tripEntries(t, groups, true)) {
    if (trip.due === null) continue;
    const overdue = trip.due.date < isoToday;
    add(trip.due.date, { ...trip, doneOn: null, projected: false, expired: false, overdueDays: overdue ? dayDiff(isoToday, trip.due.date) : 0 });
  }
  for (const trip of doneTrips(t, groups, localDate)) add(trip.due!.date, { ...trip, doneOn: doneOn(trip.due!.date, trip.completed_at), projected: false, expired: false, overdueDays: 0 });
  return grid.map((g) => ({
    date: g.date,
    inMonth: g.inMonth,
    holiday: g.holiday,
    items: (byDate.get(g.date) ?? []).sort((a, b) => compareByDue(a.due, b.due) || a.title.localeCompare(b.title, 'pl')),
  }));
}

const dayDiff = (a: string, b: string) => toDayNumber(parseIsoDate(a)) - toDayNumber(parseIsoDate(b));

/** Daty kolejnych terminów zadania powtarzanego według kalendarza po `due`, do `last` włącznie (PWD-15 A). */
function futureRepeats(t: Tables, x: Task, due: NonNullable<Due>, last: string): string[] {
  const r = x.deadline_mode === 'own' ? repeatOf(t, x.id) : null;
  if (!r || r.kind === 'after' || due.date >= last) return [];
  const start = parseIsoDate(due.date);
  return refOccurrences(start, parseRule(formatRepeat(r)), addDays(start, 1), parseIsoDate(last)).map(formatIsoDate);
}
