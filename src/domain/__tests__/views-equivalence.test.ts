/**
 * Audyt 3 (N-6, N-16): plan przypomnień, Moje sprawy, rozwinięcie wydarzeń i zagnieżdżenie po optymalizacji dają ten
 * sam wynik co wersja sprzed niej (support/views-reference.ts) na losowych danych: grupy z dzieckiem (z kontem i bez),
 * listy prywatne i zakupy, zadania z terminem własnym, dziedziczonym i ze spotkania, zrobione dawno i dziś, serie
 * z wyjątkami, uczestnikami i odpowiedziami „nie będę”.
 */
import * as fc from "fast-check";

import { addDays, type CivilDate, formatIsoDate } from "../civil-date";
import { localNow } from "../local-time";
import { alignStart, occurrences, parseRule } from "../rrule";
import type { Row } from "../sync-engine/client";
import { calendarMonth } from "../views";
import { expandEventDays, expandEvents } from "../views/events";
import { myDays, type RangeMode } from "../views/my-days";
import { nestEntries } from "../views/nesting";
import { planReminders } from "../views/reminders";
import {
  refCalendarMonth,
  refExpandEventDays,
  refExpandEvents,
  refMyDays,
  refNestEntries,
  refPlanReminders,
} from "./support/views-reference";

const ME = "u-me";
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 };
type T = { [e: string]: { [id: string]: Row } };
const iso = (k: number) => formatIsoDate(addDays(TODAY, k));
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
// Strefa uproszczona do UTC+2, jak w reminders.test.ts; dzień odhaczenia — prawdziwa Europe/Warsaw albo dzień UTC.
const toMs = (l: { y: number; m: number; d: number; hh: number; mm: number }) =>
  Date.UTC(l.y, l.m - 1, l.d, l.hh - 2, l.mm);
const warsaw = (s: string) => formatIsoDate(localNow(Date.parse(s)));
const utc = (s: string) => s.slice(0, 10);

const RULES = [
  null,
  null,
  "FREQ=DAILY",
  "FREQ=WEEKLY",
  "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
  "FREQ=MONTHLY;BYDAY=-1FR",
  "FREQ=MONTHLY;BYMONTHDAY=7",
  "FREQ=DAILY;COUNT=30",
  "FREQ=WEEKLY;UNTIL=20261015",
  "FREQ=YEARLY",
];
const LISTS = ["l1", "l2", "lp", "z", "lx"];
const pick = <X>(xs: readonly X[], i: number) => xs[i % xs.length]!;

const arbTask = fc.record({
  list: fc.nat(),
  parent: fc.option(fc.nat(), { freq: 3 }),
  mode: fc.constantFrom("own", "own", "none", "inherit", "event"),
  due: fc.integer({ min: -20, max: 20 }),
  time: fc.option(fc.integer({ min: 0, max: 1439 }), { freq: 2 }),
  start: fc.option(fc.integer({ min: -5, max: 10 }), { freq: 4 }),
  rollover: fc.boolean(),
  done: fc.option(fc.integer({ min: -600 * 24, max: 2 * 24 }), { freq: 2 }),
  deleted: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
  repeat: fc.constantFrom(
    null,
    null,
    null,
    "FREQ=DAILY",
    "FREQ=MONTHLY",
    "FREQ=WEEKLY;BYDAY=MO",
  ),
  who: fc.nat(),
  event: fc.nat(),
  occ: fc.nat(),
});
const arbEvent = fc.record({
  rule: fc.nat(),
  start: fc.integer({ min: -900, max: 30 }),
  time: fc.option(fc.integer({ min: 0, max: 1380 }), { freq: 4 }),
  len: fc.integer({ min: 15, max: 600 }),
  days: fc.constantFrom(1, 1, 1, 2, 4),
  group: fc.boolean(),
  audience: fc.boolean(),
  responsible: fc.option(fc.nat(), { freq: 2 }),
  kind: fc.constantFrom("event", "lesson", "routine"),
  parts: fc.array(fc.nat(), { maxLength: 3 }),
  overrides: fc.array(
    fc.record({
      k: fc.nat({ max: 3 }),
      cancelled: fc.boolean(),
      move: fc.integer({ min: -3, max: 3 }),
    }),
    { maxLength: 2 },
  ),
  rsvpNo: fc.option(fc.nat(), { freq: 3 }),
  deleted: fc.boolean(),
});
const arbWorld = fc.record({
  childMe: fc.boolean(),
  tasks: fc.array(arbTask, { maxLength: 40 }),
  events: fc.array(arbEvent, { maxLength: 12 }),
  tripDue: fc.option(fc.integer({ min: -3, max: 10 })),
  tripTime: fc.boolean(),
});

type World = typeof arbWorld extends fc.Arbitrary<infer W> ? W : never;

function build(w: World): T {
  const t: T = {};
  const put = (e: string, k: string, r: Row) =>
    ((t[e] ??= {})[k] = { version: 1, ...r });
  put("groups", "gp", {
    id: "gp",
    name: "Osobiste",
    kind: "personal",
    deleted_at: null,
  });
  put("groups", "gf", {
    id: "gf",
    name: "Rodzina",
    kind: "shared",
    deleted_at: null,
  });
  put("group_members", "mp", {
    member_id: "mp",
    group_id: "gp",
    user_id: ME,
    display_name: "Ja",
    role: "owner",
    deleted_at: null,
  });
  put("group_members", "mf", {
    member_id: "mf",
    group_id: "gf",
    user_id: ME,
    display_name: "Ja",
    role: w.childMe ? "child" : "admin",
    deleted_at: null,
  });
  put("group_members", "ma", {
    member_id: "ma",
    group_id: "gf",
    user_id: "u-ala",
    display_name: "Ala",
    role: "admin",
    deleted_at: null,
  });
  put("group_members", "mk", {
    member_id: "mk",
    group_id: "gf",
    user_id: null,
    display_name: "Tymek",
    role: "child",
    deleted_at: null,
  });
  put("group_members", "mz", {
    member_id: "mz",
    group_id: "gf",
    user_id: null,
    display_name: "Zosia",
    role: "child",
    deleted_at: null,
  });
  put("group_members", "mx", {
    member_id: "mx",
    group_id: "gf",
    user_id: "u-jan",
    display_name: "Jan",
    role: "member",
    deleted_at: "2026-09-01T00:00:00Z",
  });
  const MEMBERS = ["mf", "ma", "mk", "mz", "mx"];
  put("lists", "l1", {
    id: "l1",
    group_id: "gf",
    kind: "tasks",
    name: "Dom",
    visibility: "group",
    owner_member_id: null,
    deleted_at: null,
  });
  put("lists", "l2", {
    id: "l2",
    group_id: "gf",
    kind: "tasks",
    name: "Tylko ja",
    visibility: "private",
    owner_member_id: "mf",
    deleted_at: null,
  });
  put("lists", "lp", {
    id: "lp",
    group_id: "gp",
    kind: "tasks",
    name: "Moje",
    visibility: "group",
    owner_member_id: null,
    deleted_at: null,
  });
  put("lists", "lx", {
    id: "lx",
    group_id: "gf",
    kind: "tasks",
    name: "Stara",
    visibility: "group",
    owner_member_id: null,
    deleted_at: "2026-09-01T00:00:00Z",
  });
  put("lists", "z", {
    id: "z",
    group_id: "gf",
    kind: "shopping",
    name: "Zakupy",
    visibility: "group",
    owner_member_id: null,
    deleted_at: null,
    due_date: w.tripDue === null ? null : iso(w.tripDue),
    due_time: w.tripDue !== null && w.tripTime ? "17:00:00" : null,
    responsible_member_id: w.tripDue === null ? null : "mf",
  });
  const events = w.events.map((e, i) => {
    const id = `e${i}`;
    const rrule = pick(RULES, e.rule);
    const group = e.group ? "gf" : "gp";
    const time = e.time;
    const timed = time !== null;
    const start = formatIsoDate(
      rrule
        ? alignStart(addDays(TODAY, e.start), parseRule(rrule))
        : addDays(TODAY, e.start),
    );
    put("events", id, {
      id,
      group_id: group,
      title: `Wydarzenie ${i % 4}`,
      note: null,
      location: null,
      start_date: start,
      start_time: timed ? hhmm(time) : null,
      end_time: timed ? hhmm(Math.min(1439, time + e.len)) : null,
      rrule,
      audience: e.audience ? "group" : "members",
      responsible_member_id:
        e.responsible === null || group === "gp"
          ? null
          : pick(MEMBERS, e.responsible),
      kind: e.kind,
      days: timed ? 1 : e.days,
      duration_min: null,
      deleted_at: e.deleted && i % 3 === 0 ? "2026-09-01T00:00:00Z" : null,
    });
    e.parts.forEach((p, j) =>
      put("event_participants", `${id}-p${j}`, {
        id: `${id}-p${j}`,
        group_id: group,
        event_id: id,
        member_id: group === "gp" ? "mp" : pick(MEMBERS, p),
        deleted_at: j === 2 ? "2026-09-01T00:00:00Z" : null,
      }),
    );
    const occ = rrule
      ? occurrences(
          parseIsoDate(start),
          parseRule(rrule),
          addDays(TODAY, -3),
          addDays(TODAY, 16),
        ).map(formatIsoDate)
      : [start];
    e.overrides.forEach((o, j) => {
      const date = occ[o.k % Math.max(1, occ.length)];
      if (!date) return;
      put("event_overrides", `${id}-o${j}`, {
        id: `${id}-o${j}`,
        group_id: group,
        event_id: id,
        occurrence_date: date,
        cancelled: o.cancelled,
        start_date: o.move
          ? formatIsoDate(addDays(parseIsoDate(date), o.move))
          : null,
        start_time: null,
        end_time: null,
        title: o.move ? "Przeniesione" : null,
        responsible_member_id: null,
        all_day: false,
        responsible_cleared: false,
        days: null,
        duration_min: null,
        deleted_at: null,
      });
    });
    if (e.rsvpNo !== null && occ[0])
      put("event_rsvps", `${id}-r`, {
        id: `${id}-r`,
        group_id: group,
        event_id: id,
        occurrence_date: occ[e.rsvpNo % occ.length],
        member_id: group === "gp" ? "mp" : pick(["mf", "mk", "mz"], e.rsvpNo),
        answer: "no",
        deleted_at: null,
      });
    return { id, occ };
  });
  w.tasks.forEach((x, i) => {
    const id = `t${i}`;
    const list = pick(LISTS, x.list);
    const group = list === "lp" ? "gp" : "gf";
    const ev = events.length ? pick(events, x.event) : null;
    const mode = x.mode === "event" && !ev ? "own" : x.mode;
    const doneAt =
      x.done === null
        ? null
        : new Date(Date.UTC(2026, 9, 7, 10) + x.done * 3_600_000).toISOString();
    put("tasks", id, {
      id,
      group_id: group,
      list_id: list,
      parent_id: x.parent !== null && i > 0 ? `t${x.parent % i}` : null,
      title: `Zadanie ${i % 5}`,
      note: null,
      sort_key: `a${i % 3}`,
      assignee_member_id:
        x.who % 3 === 0 ? null : group === "gp" ? "mp" : pick(MEMBERS, x.who),
      deadline_mode: mode,
      due_date: mode === "own" ? iso(x.due) : null,
      due_time: mode === "own" && x.time !== null ? hhmm(x.time) : null,
      start_date: x.start === null ? null : iso(x.start),
      event_id: mode === "event" ? ev!.id : null,
      occurrence_date:
        mode === "event"
          ? pick(ev!.occ.length ? ev!.occ : ["2026-10-07"], x.occ)
          : null,
      rollover: x.rollover,
      series_id: null,
      repeat: x.repeat,
      completed_at: doneAt,
      deleted_at: x.deleted ? "2026-09-01T00:00:00Z" : null,
    });
  });
  return t;
}
const parseIsoDate = (s: string): CivilDate => ({
  y: Number(s.slice(0, 4)),
  m: Number(s.slice(5, 7)),
  d: Number(s.slice(8, 10)),
});

const label = {
  trip: (n: string) => `Zakupy: ${n}`,
  morningTitle: "Dziś",
  more: (n: number) => `i ${n}`,
  summary: (n: number, o: number) => `${n}/${o}`,
  leave: (s: string) => `Wyjdź: ${s}`,
  late: (m: number) => `${m} min`,
  subtasks: (xs: string[]) => xs.join(", "),
  parent: (s: string, e: boolean) => `${e ? "W" : "Z"}: ${s}`,
  who: (p: { name: string }) => p.name,
};
const RUNS = { numRuns: 100 };

describe("audyt 3, N-6 i N-16: wynik jak przed optymalizacją", () => {
  it("plan przypomnień (14 dni)", () => {
    fc.assert(
      fc.property(
        arbWorld,
        fc.integer({ min: 0, max: 1439 }),
        fc.constantFrom(0, 30),
        fc.constantFrom("off", "08:00"),
        fc.boolean(),
        fc.boolean(),
        (w, nowMin, leadMin, morning, travel, realTz) => {
          const t = build(w);
          const nowMs = toMs({
            ...TODAY,
            hh: Math.floor(nowMin / 60),
            mm: nowMin % 60,
          });
          const opts = {
            days: 14,
            max: 64,
            toMs,
            localDate: realTz ? warsaw : utc,
            label,
            leaveFor: travel
              ? (id: string, occ: string) =>
                  id.endsWith("1")
                    ? {
                        at: toMs({ ...parseIsoDate(occ), hh: 7, mm: 0 }),
                        body: "Dojazd 20 min",
                      }
                    : null
              : undefined,
            scopeOf: (g: string) =>
              g === "gf" && leadMin === 0
                ? ("mine" as const)
                : ("all" as const),
          };
          const s = { leadMin, morning };
          expect(planReminders(t, ME, TODAY, nowMs, s, opts)).toEqual(
            refPlanReminders(t, ME, TODAY, nowMs, s, opts),
          );
        },
      ),
      RUNS,
    );
  });

  it("Moje sprawy (dzień, tydzień, miesiąc; dziś, wczoraj, za tydzień) i zagnieżdżenie dnia", () => {
    fc.assert(
      fc.property(
        arbWorld,
        fc.constantFrom<RangeMode>("day", "week", "month"),
        fc.integer({ min: -40, max: 40 }),
        fc.boolean(),
        (w, mode, shift, realTz) => {
          const t = build(w);
          const anchor = addDays(TODAY, shift);
          const ld = realTz ? warsaw : utc;
          const v = myDays(t, ME, TODAY, mode, anchor, ld);
          expect(v).toEqual(refMyDays(t, ME, TODAY, mode, anchor, ld));
          for (const d of v.days)
            expect(nestEntries(d.entries, t)).toEqual(
              refNestEntries(d.entries, t),
            );
        },
      ),
      RUNS,
    );
  });

  it("rozwinięcie wydarzeń w dowolnym zakresie", () => {
    fc.assert(
      fc.property(
        arbWorld,
        fc.integer({ min: -60, max: 60 }),
        fc.integer({ min: 0, max: 45 }),
        (w, from, len) => {
          const t = build(w);
          const a = addDays(TODAY, from);
          const b = addDays(a, len);
          expect(expandEvents(t, ME, a, b)).toEqual(
            refExpandEvents(t, ME, a, b),
          );
          expect(expandEventDays(t, ME, a, b)).toEqual(
            refExpandEventDays(t, ME, a, b),
          );
        },
      ),
      RUNS,
    );
  });

  it("miesiąc Kalendarza", () => {
    fc.assert(
      fc.property(
        arbWorld,
        fc.integer({ min: -2, max: 2 }),
        fc.boolean(),
        (w, shift, realTz) => {
          const t = build(w);
          const ym = TODAY.y * 12 + TODAY.m - 1 + shift;
          const o = { today: TODAY, localDate: realTz ? warsaw : utc };
          expect(
            calendarMonth(t, ME, Math.floor(ym / 12), (ym % 12) + 1, o),
          ).toEqual(
            refCalendarMonth(t, ME, Math.floor(ym / 12), (ym % 12) + 1, o),
          );
        },
      ),
      RUNS,
    );
  });
});
