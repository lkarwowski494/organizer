/**
 * Wydarzenia (D57, D58; migracja serwera 20261008100000_events). Seria = wiersz events z regułą RRULE
 * (src/domain/rrule.ts); zmiana jednego wystąpienia = event_overrides (data pierwotna → nowe wartości albo
 * odwołanie); „to i następne” = koniec starej serii (UNTIL) + nowa seria od tego dnia, w jednej paczce operacji,
 * więc działa też offline (R1).
 */
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE } from '../../config/quickadd.pl';
import { config } from '../../config';
import { addDays, type CivilDate, formatIsoDate, toDayNumber } from '../civil-date';
import { formatLength, formatLongDate, parseIsoDate } from '../format';
import { plural } from '../plural';
import { alignStart, endBefore, formatRule, occurrences, type Rule } from '../rrule';
import type { NewOp } from '../sync-engine/client';
import { groupsView, myMemberships } from './index';
import { asEvent, asOverride, asParticipant, type EventKind, type EventRow, occurrenceTimes, type Override, type Participant, ruleOf } from './event-rows';
import { asMember, type Member, rows, type Tables } from './model';
import { rsvpId } from './rsvp';

export { asEvent, asOverride, asParticipant, type EventRow, type Override, type Participant, ruleOf } from './event-rows';

export type Occurrence = {
  eventId: string;
  /** Data wystąpienia według reguły — klucz wystąpienia (także gdy przeniesione). */
  occurrenceDate: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  recurring: boolean;
  overrideId: string | null;
  groupId: string;
  groupName: string;
  line: number;
  concernsMe: boolean;
  /** Osoba odpowiedzialna w tym wystąpieniu (D66) i jej imię. */
  responsibleId: string | null;
  responsibleName: string | null;
  /** Miejsce serii (D115). */
  location: string | null;
  /** Rodzaj wpisu (D126). */
  kind: EventKind;
  /**
   * D127: lekcja planu dziecka, w której sam nie uczestniczę (dorosły) — „Moje sprawy” zwijają takie lekcje do jednego
   * wiersza na dziecko i dzień; bez przypomnień. `null` dla wszystkiego innego.
   */
  lessonFor: { memberId: string; name: string } | null;
};

const MOVE_WINDOW_DAYS = config.events.MOVE_WINDOW_DAYS;

/** Czy przeniesienie jednego wystąpienia mieści się w oknie (dalej — zniknęłoby z widoków; audyt 8.10.2026). */
export function moveTooFar(occurrenceDate: string, newDate: string): boolean {
  return Math.abs(toDayNumber(parseIsoDate(newDate)) - toDayNumber(parseIsoDate(occurrenceDate))) > MOVE_WINDOW_DAYS;
}

const alive = <T extends { deleted_at: string | null }>(x: T) => x.deleted_at === null;

/**
 * Wystąpienia w [from, to] z moich grup. Do „Moich spraw” trafia (D58): wydarzenie całej grupy, albo jestem uczestnikiem,
 * albo uczestnikiem jest dziecko z tej grupy, a ja jestem dorosłym (rodzic zawozi na zajęcia).
 */
export function expandEvents(t: Tables, userId: string, from: CivilDate, to: CivilDate): Occurrence[] {
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
    const child = e.kind === 'lesson' && !mine.some((m) => m?.member_id === g.me.member_id) ? mine.find((m) => m?.role === 'child' && m.deleted_at === null) : undefined;
    const lessonFor = child ? { memberId: child.member_id, name: child.display_name } : null;
    const byDate = new Map(overrides.filter((o) => o.event_id === e.id).map((o) => [o.occurrence_date, o]));
    for (const d of occurrences(parseIsoDate(e.start_date), rule, addDays(from, -MOVE_WINDOW_DAYS), addDays(to, MOVE_WINDOW_DAYS))) {
      const occ = formatIsoDate(d);
      const o = byDate.get(occ);
      if (o?.cancelled) continue;
      const date = o?.start_date ?? occ;
      if (date < isoFrom || date > isoTo) continue;
      const raw = o?.responsible_member_id ?? e.responsible_member_id;
      // D132: osoba usunięta z grupy już nie odpowiada — wydarzenie wraca do reguły „nikt konkretny”.
      const responsibleId = raw !== null && members.get(raw)?.deleted_at === null ? raw : null;
      out.push({
        eventId: e.id,
        occurrenceDate: occ,
        date,
        startTime: occurrenceTimes(o, e).start,
        endTime: occurrenceTimes(o, e).end,
        title: o?.title ?? e.title,
        recurring: rule !== null,
        overrideId: o?.id ?? null,
        groupId: g.id,
        groupName: g.name,
        line: g.line,
        concernsMe: responsibleId === null ? byRule : responsibleId === g.me.member_id || iParticipate,
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

const FEMININE = new Set([2, 5, 6]); // środa, sobota, niedziela

/** Opis reguły po polsku, np. „Co tydzień: pon., sob.”, „Co miesiąc, w ostatni piątek”, „Codziennie, do 31.12.2026”. */
export function describeRule(rule: Rule, start: CivilDate): string {
  const n = rule.interval;
  let text: string;
  switch (rule.freq) {
    case 'DAILY':
      text = n === 1 ? 'Codziennie' : `Co ${n} dni`;
      break;
    case 'WEEKLY': {
      const days = rule.byday.length ? [...new Set(rule.byday.map((b) => b.wd))].sort((a, b) => a - b) : null;
      text = `${n === 1 ? 'Co tydzień' : `Co ${n} ${plural(n, { one: 'tydzień', few: 'tygodnie', many: 'tygodni' })}`}${days ? `: ${days.map((d) => WEEKDAYS_ABBREVIATED[d]).join(', ')}` : ''}`;
      break;
    }
    case 'MONTHLY': {
      const base = n === 1 ? 'Co miesiąc' : `Co ${n} ${plural(n, { one: 'miesiąc', few: 'miesiące', many: 'miesięcy' })}`;
      const b = rule.byday[0];
      const md = rule.bymonthday[0];
      if (b && b.n === null) text = `${base}: ${[...new Set(rule.byday.map((x) => x.wd))].sort((x, y) => x - y).map((d) => WEEKDAYS_ABBREVIATED[d]).join(', ')}`;
      else if (b) {
        const last = b.n === -1 ? (FEMININE.has(b.wd) ? 'ostatnią' : 'ostatni') : `${b.n}.`;
        text = `${base}, w ${last} ${WEEKDAYS_ACCUSATIVE[b.wd]}`;
      } else if (md !== undefined) text = `${base}, ${md === -1 ? 'ostatniego' : `${md}.`} dnia`;
      else text = `${base}, ${start.d}. dnia`;
      break;
    }
    case 'YEARLY':
      text = n === 1 ? 'Co roku' : `Co ${n} ${plural(n, { one: 'rok', few: 'lata', many: 'lat' })}`;
      break;
  }
  if (rule.until) {
    const u = parseIsoDate(rule.until);
    text += `, do ${u.d}.${String(u.m).padStart(2, '0')}.${u.y}`;
  }
  if (rule.count !== null) text += `, ${rule.count} ${plural(rule.count, { one: 'raz', few: 'razy', many: 'razy' })}`;
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
  /** Żywe odpowiedzi o obecności (D124) — przy „to i następne” przechodzą do nowej serii. */
  rsvps: { id: string; occurrence_date: string; member_id: string; answer: string }[];
  canEdit: boolean;
};

export function eventDetail(t: Tables, userId: string, eventId: string): EventDetail | null {
  const raw = t.events?.[eventId];
  if (!raw) return null;
  const event = asEvent(raw);
  const g = groupsView(t, userId).find((x) => x.id === event.group_id);
  if (!g) return null;
  return {
    event,
    rule: ruleOf(event),
    groupName: g.name,
    line: g.line,
    members: rows(t, 'group_members', asMember).filter((m) => alive(m) && m.group_id === g.id),
    participants: rows(t, 'event_participants', asParticipant).filter((p) => p.event_id === eventId),
    overrides: rows(t, 'event_overrides', asOverride).filter((o) => alive(o) && o.event_id === eventId),
    rsvps: Object.values(t.event_rsvps ?? {})
      .filter((r) => r.event_id === eventId && r.deleted_at == null)
      .map((r) => ({ id: String(r.id), occurrence_date: String(r.occurrence_date), member_id: String(r.member_id), answer: String(r.answer) })),
    canEdit: event.deleted_at === null && myMemberships(t, userId).get(g.id)?.role !== 'child',
  };
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
};

const ruleText = (r: Rule | null, until: string | null) => (r === null ? null : formatRule({ ...r, count: null, until }));

/** Uczestnicy: dodanie nowych, przywrócenie usuniętych (unikalność event_id + member_id), usunięcie zbędnych. */
function participantOps(eventId: string, groupId: string, existing: Participant[], wanted: string[], newId: () => string): NewOp[] {
  const ops: NewOp[] = [];
  for (const m of wanted) {
    const p = existing.find((x) => x.member_id === m);
    if (!p) ops.push({ kind: 'create', entity: 'event_participants', id: newId(), group_id: groupId, set: { event_id: eventId, member_id: m } });
    else if (p.deleted_at !== null) ops.push({ kind: 'restore', entity: 'event_participants', id: p.id });
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
      set: { title: f.title, start_date: formatIsoDate(start), start_time: f.startTime, end_time: f.endTime, rrule: ruleText(f.rule, f.until), audience: f.audience, responsible_member_id: f.responsibleId, ...(f.location ? { location: f.location } : {}), ...(f.kind && f.kind !== 'event' ? { kind: f.kind } : {}) },
    },
    ...participantOps(id, groupId, [], f.audience === 'members' ? f.participantIds : [], newId),
  ];
  return { id, ops };
}

export type Scope = 'this' | 'following' | 'all';

/** Zmiana wydarzenia w wybranym zakresie (D57). Dla jednorazowego zakres nie ma znaczenia (= „all”). */
export function editEvent(d: EventDetail, occurrenceDate: string, scope: Scope, f: EventFields, newId: () => string): NewOp[] {
  const e = d.event;
  const effective: Scope = d.rule === null || (scope === 'following' && occurrenceDate === e.start_date) ? 'all' : scope;
  if (effective === 'this') {
    const o = d.overrides.find((x) => x.occurrence_date === occurrenceDate);
    const set = {
      start_date: f.date === occurrenceDate ? null : f.date,
      start_time: f.startTime,
      end_time: f.endTime,
      title: f.title === e.title ? null : f.title,
      responsible_member_id: f.responsibleId === e.responsible_member_id ? null : f.responsibleId,
      cancelled: false,
      // D136: bez godziny w serii z godziną — znacznik całodniowy (pole tylko, gdy coś zmienia: starsze dane bez niego).
      ...(f.startTime === null && e.start_time !== null ? { all_day: true } : o?.all_day ? { all_day: false } : {}),
    };
    return o
      ? [{ kind: 'patch', entity: 'event_overrides', id: o.id, set }]
      : [{ kind: 'create', entity: 'event_overrides', id: newId(), group_id: e.group_id, set: { ...set, event_id: e.id, occurrence_date: occurrenceDate } }];
  }
  if (effective === 'all') {
    const start = f.rule ? alignStart(parseIsoDate(d.rule === null ? f.date : e.start_date), f.rule) : parseIsoDate(f.date);
    return [
      {
        kind: 'patch',
        entity: 'events',
        id: e.id,
        set: {
          title: f.title,
          start_date: formatIsoDate(start),
          start_time: f.startTime,
          end_time: f.endTime,
          rrule: ruleText(f.rule, f.until),
          audience: f.audience,
          responsible_member_id: f.responsibleId,
          ...(f.location !== undefined && (f.location || null) !== e.location ? { location: f.location || null } : {}),
        },
      },
      ...participantOps(e.id, e.group_id, d.participants, f.audience === 'members' ? f.participantIds : [], newId),
    ];
  }
  // „To i następne”: stara seria kończy się dzień wcześniej, nowa zaczyna się od tego wystąpienia (z nowymi wartościami);
  // zmiany pojedynczych wystąpień od tego dnia przechodzą do nowej serii.
  const occ = parseIsoDate(occurrenceDate);
  // Nowa seria „to i następne” zostaje tym samym rodzajem (lekcja zostaje lekcją).
  const created = createEvent(e.group_id, { ...f, date: occurrenceDate, location: f.location === undefined ? e.location : f.location, kind: e.kind }, newId);
  const ops: NewOp[] = [{ kind: 'patch', entity: 'events', id: e.id, set: { rrule: formatRule(endBefore(d.rule!, occ)) } }, ...created.ops];
  for (const o of d.overrides.filter((x) => x.occurrence_date >= occurrenceDate)) {
    ops.push({ kind: 'delete', entity: 'event_overrides', id: o.id });
    ops.push({
      kind: 'create',
      entity: 'event_overrides',
      id: newId(),
      group_id: e.group_id,
      set: { event_id: created.id, occurrence_date: o.occurrence_date, cancelled: o.cancelled, start_date: o.start_date, start_time: o.start_time, end_time: o.end_time, title: o.title, responsible_member_id: o.responsible_member_id, ...(o.all_day ? { all_day: true } : {}) },
    });
  }
  // Odpowiedzi o obecności (D124) od tego dnia też przechodzą do nowej serii (audyt 8.10.2026).
  for (const r of d.rsvps.filter((x) => x.occurrence_date >= occurrenceDate)) {
    ops.push({ kind: 'delete', entity: 'event_rsvps', id: r.id });
    ops.push({ kind: 'create', entity: 'event_rsvps', id: rsvpId(created.id, r.occurrence_date, r.member_id), group_id: e.group_id, set: { event_id: created.id, occurrence_date: r.occurrence_date, member_id: r.member_id, answer: r.answer } });
  }
  return ops;
}

/** Odwołanie / usunięcie w zakresie: to wystąpienie, to i następne, cała seria. */
export function cancelEvent(d: EventDetail, occurrenceDate: string, scope: Scope, newId: () => string): NewOp[] {
  const e = d.event;
  if (d.rule === null || scope === 'all' || (scope === 'following' && occurrenceDate === e.start_date)) return [{ kind: 'delete', entity: 'events', id: e.id }];
  if (scope === 'following') return [{ kind: 'patch', entity: 'events', id: e.id, set: { rrule: formatRule(endBefore(d.rule, parseIsoDate(occurrenceDate))) } }];
  const o = d.overrides.find((x) => x.occurrence_date === occurrenceDate);
  return o
    ? [{ kind: 'patch', entity: 'event_overrides', id: o.id, set: { cancelled: true } }]
    : [{ kind: 'create', entity: 'event_overrides', id: newId(), group_id: e.group_id, set: { event_id: e.id, occurrence_date: occurrenceDate, cancelled: true } }];
}

/**
 * Wartości formularza dla wystąpienia w wybranym zakresie: „this” — to wystąpienie (z jego zmianami), „following” —
 * seria od tego dnia, „all” — cała seria od początku. Koniec serii zawsze jako data (COUNT → data ostatniego wystąpienia).
 */
export function fieldsOf(d: EventDetail, occurrenceDate: string, scope: Scope): EventFields {
  const e = d.event;
  const o = scope === 'this' ? d.overrides.find((x) => x.occurrence_date === occurrenceDate) : undefined;
  let until = d.rule?.until ?? null;
  if (d.rule && d.rule.count !== null) {
    const start = parseIsoDate(e.start_date);
    until = formatIsoDate(occurrences(start, d.rule, start, addDays(start, 366 * 100)).at(-1)!);
  }
  return {
    title: o?.title ?? e.title,
    date: scope === 'all' ? e.start_date : (o?.start_date ?? occurrenceDate),
    startTime: occurrenceTimes(o, e).start,
    endTime: occurrenceTimes(o, e).end,
    rule: d.rule ? { ...d.rule, count: null, until: null } : null,
    until,
    audience: e.audience,
    participantIds: d.participants.filter(alive).map((p) => p.member_id),
    responsibleId: o?.responsible_member_id ?? e.responsible_member_id,
    location: e.location,
  };
}

/** Wydarzenia, które dotyczą mnie dziś i jutro (do widoku „Moje sprawy”). */
export function todayEvents(t: Tables, userId: string, today: CivilDate): { today: Occurrence[]; tomorrow: Occurrence[] } {
  const all = expandEvents(t, userId, today, addDays(today, 1)).filter((x) => x.concernsMe);
  const iso = formatIsoDate(today);
  return { today: all.filter((x) => x.date === iso), tomorrow: all.filter((x) => x.date !== iso) };
}

/** Wszystkie wydarzenia z moich grup w [from, to], pogrupowane po dniu (kalendarz). */
export function eventsByDate(t: Tables, userId: string, from: CivilDate, to: CivilDate): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>();
  for (const x of expandEvents(t, userId, from, to)) out.set(x.date, [...(out.get(x.date) ?? []), x]);
  return out;
}

/** „18:00–19:00”, „18:00” albo `null` (cały dzień); serwer zwraca godziny z sekundami (typ time). */
export function timeLabel(start: string | null, end: string | null): string | null {
  if (start === null) return null;
  return end === null ? start.slice(0, 5) : `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** Długość do wiersza (D120), tylko gdy jest początek i koniec. */
export function lengthLabel(start: string | null, end: string | null): string | null {
  return start !== null && end !== null ? formatLength(start, end) : null;
}

export type SeriesItem = { id: string; title: string; summary: string; time: string | null; start: string; next: string | null };

/** Wydarzenia grupy (ekran grupy): opis powtarzania i najbliższy termin od dziś (w ciągu roku). */
export function groupSeries(t: Tables, userId: string, groupId: string, today: CivilDate): SeriesItem[] {
  if (!groupsView(t, userId).some((g) => g.id === groupId)) return [];
  const upcoming = expandEvents(t, userId, today, addDays(today, 366));
  return rows(t, 'events', asEvent)
    .filter((e) => alive(e) && e.group_id === groupId)
    .map((e) => {
      const rule = ruleOf(e);
      return {
        id: e.id,
        title: e.title,
        summary: rule ? describeRule(rule, parseIsoDate(e.start_date)) : formatLongDate(parseIsoDate(e.start_date), today),
        time: timeLabel(e.start_time, e.end_time),
        start: e.start_date,
        next: upcoming.find((x) => x.eventId === e.id)?.occurrenceDate ?? null,
      };
    })
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.title.localeCompare(b.title, 'pl') || a.id.localeCompare(b.id));
}
