/**
 * D199 (audyt 2, M-99 / PW-53): wydarzenia przez kilka dni i przez północ — model (span.ts), rozwijanie po dniach,
 * zapis (utworzenie, „tylko to”, „wszystkie”, „to i następne”), widoki dnia, przypomnienia i lustro w iPhonie.
 * Oczekiwane dni w własności liczy niezależnie Date.UTC (nie civil-date).
 */
import * as fc from 'fast-check';

import { config } from '../../config';
import { parseIsoDate } from '../format';
import { coveredDays, dayWhen, daySpan, endsNextDay, isContinuation, lengthMinutes } from '../span';
import { applyOp, type NewOp, type Op, type Row } from '../sync-engine/client';
import { agenda } from '../views/agenda';
import { mirrorHash, mirrorItems } from '../views/calendar-sync';
import { occurrenceDays } from '../views/event-rows';
import { createEvent, editEvent, eventDetail, type EventFields, eventsByDate, expandEventDays, expandEvents, fieldsOf, groupSeries, lengthLabel, type RuleLabels, todayEvents } from '../views/events';
import { myDays } from '../views/my-days';
import { planReminders } from '../views/reminders';

const ME = 'u-me';
const TODAY = { y: 2026, m: 10, d: 7 };
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
let seq = 0;
const run = (t: T, ops: NewOp[]) => {
  for (const op of ops) applyOp(t, { ...op, seq: ++seq, op_id: `op${seq}` } as Op);
  return t;
};

function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  return t;
}
const event = (t: T, id: string, extra: Row) => put(t, 'events', id, { id, group_id: 'gf', title: id, start_date: '2026-10-07', start_time: null, end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, ...extra });
const days = (t: T, from: string, to: string) => expandEventDays(t, ME, parseIsoDate(from), parseIsoDate(to)).map((o) => `${o.date} ${o.eventId} ${o.part ? `${o.part.day}/${o.part.days}` : '-'}`);

describe('span.ts: model', () => {
  it('przez północ, doba i koniec o północy', () => {
    expect([endsNextDay('22:00', '06:00'), endsNextDay('08:00', '08:00'), endsNextDay('18:00', '19:00'), endsNextDay('18:00', null), endsNextDay(null, '06:00')]).toEqual([true, true, false, false, false]);
    expect([coveredDays('22:00:00', '06:00:00', 1), coveredDays('20:00', '00:00', 1), coveredDays('18:00', '19:00', 9), coveredDays(null, null, 5)]).toEqual([2, 1, 1, 5]);
    expect([lengthMinutes('22:00', '06:00'), lengthMinutes('08:00', '08:00'), lengthMinutes('17:00', '18:30'), lengthMinutes('20:00', '00:00'), lengthMinutes(null, '1:00'), lengthMinutes('1:00', null)]).toEqual([480, 1440, 90, 240, null, null]);
    expect([lengthLabel('22:00', '06:00'), lengthLabel('08:00:00', '08:00:00')]).toEqual(['8 h', '24 h']);
  });

  it('godziny dnia (plan dnia) i „kiedy” w wierszu', () => {
    expect(daySpan('18:00', '19:00', null)).toEqual({ start: '18:00', end: '19:00' });
    expect(daySpan('20:00', '00:00', null)).toEqual({ start: '20:00', end: '24:00' });
    expect(daySpan(null, null, { day: 2, days: 3 })).toEqual({ start: null, end: null });
    expect(daySpan('22:00', '06:00', { day: 1, days: 2 })).toEqual({ start: '22:00', end: '24:00' });
    expect(daySpan('22:00', '06:00', { day: 2, days: 2 })).toEqual({ start: '00:00', end: '06:00' });
    expect(daySpan('18:00', '16:00', { day: 2, days: 3 })).toEqual({ start: '00:00', end: '24:00' });
    expect(daySpan('18:00', null, { day: 2, days: 2 })).toEqual({ start: '00:00', end: '24:00' });
    expect(dayWhen(null, null, { day: 1, days: 5 })).toEqual({ kind: 'allDay' });
    expect(dayWhen('18:00:00', '19:00:00', null)).toEqual({ kind: 'time', start: '18:00', end: '19:00' });
    expect(dayWhen('18:00', null, null)).toEqual({ kind: 'time', start: '18:00', end: null });
    expect(dayWhen('22:00', '06:00', { day: 1, days: 2 })).toEqual({ kind: 'time', start: '22:00', end: '06:00' });
    expect(dayWhen('18:00', '20:00', { day: 1, days: 2 })).toEqual({ kind: 'from', start: '18:00' });
    expect(dayWhen('18:00', '16:00', { day: 1, days: 3 })).toEqual({ kind: 'from', start: '18:00' });
    expect(dayWhen('22:00', '06:00:00', { day: 2, days: 2 })).toEqual({ kind: 'until', end: '06:00' });
    expect(dayWhen('18:00', '16:00', { day: 2, days: 3 })).toEqual({ kind: 'allDay' });
    expect(dayWhen('18:00', null, { day: 2, days: 2 })).toEqual({ kind: 'allDay' });
    expect([isContinuation(null), isContinuation({ day: 1, days: 2 }), isContinuation({ day: 2, days: 2 })]).toEqual([false, false, true]);
  });

  it('własność: z godziną najwyżej 2 dni, długość w (0, 24 h], drugi dzień od północy do końca', () => {
    const hm = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    fc.assert(
      fc.property(hm, hm, (s, e) => {
        const n = coveredDays(s, e, 7);
        const len = lengthMinutes(s, e)!;
        expect(len).toBeGreaterThan(0);
        expect(len).toBeLessThanOrEqual(1440);
        // Dzień końca = dzień startu + 1, gdy start + długość przekracza północ (koniec wyłączny).
        const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
        expect(n).toBe(mins(s) + len > 1440 ? 2 : 1);
        // Drugi dzień (gdy jest) od północy do końca; przy jednym dniu sprawdzenie bez znaczenia (ten sam warunek po obu stronach).
        expect(n === 2 ? daySpan(s, e, { day: 2, days: 2 }) : { start: '00:00', end: e }).toEqual({ start: '00:00', end: e });
      }),
    );
  });
});

describe('wystąpienia po dniach', () => {
  it('obóz, nocny dyżur, wyjątek z inną długością, całodniowy termin serii z godziną', () => {
    const t = world();
    event(t, 'oboz', { start_date: '2026-10-05', days: 5 });
    event(t, 'dyzur', { start_date: '2026-10-07', start_time: '22:00:00', end_time: '06:00:00' });
    event(t, 'weekend', { start_date: '2026-10-02', days: 3, rrule: 'FREQ=WEEKLY;BYDAY=FR' });
    put(t, 'event_overrides', 'o1', { id: 'o1', event_id: 'weekend', occurrence_date: '2026-10-09', days: 2, cancelled: false, deleted_at: null });
    event(t, 'basen', { start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    put(t, 'event_overrides', 'o2', { id: 'o2', event_id: 'basen', occurrence_date: '2026-10-12', all_day: true, cancelled: false, deleted_at: null });
    const o = expandEvents(t, ME, parseIsoDate('2026-10-05'), parseIsoDate('2026-10-12'));
    expect(o.find((x) => x.eventId === 'oboz')).toMatchObject({ date: '2026-10-05', startDate: '2026-10-05', endDate: '2026-10-09', days: 5, part: { day: 1, days: 5 } });
    expect(o.find((x) => x.eventId === 'dyzur')).toMatchObject({ endDate: '2026-10-08', days: 2 });
    expect(o.filter((x) => x.eventId === 'weekend').map((x) => [x.date, x.days])).toEqual([['2026-10-09', 2]]);
    expect(o.filter((x) => x.eventId === 'basen').map((x) => [x.date, x.days, x.part])).toEqual([
      ['2026-10-05', 1, null],
      ['2026-10-12', 1, null],
    ]);
    // Wielodniowe w każdym dniu, także zaczęte przed oknem (weekend od 2.10, obóz od 5.10).
    expect(days(t, '2026-10-04', '2026-10-08')).toEqual([
      '2026-10-04 weekend 3/3',
      '2026-10-05 oboz 1/5',
      '2026-10-05 basen -',
      '2026-10-06 oboz 2/5',
      '2026-10-07 oboz 3/5',
      '2026-10-07 dyzur 1/2',
      '2026-10-08 oboz 4/5',
      // Kolejny dzień dyżuru stoi według godzin tego dnia (od 00:00).
      '2026-10-08 dyzur 2/2',
    ]);
    expect([...eventsByDate(t, ME, parseIsoDate('2026-10-09'), parseIsoDate('2026-10-11')).keys()]).toEqual(['2026-10-09', '2026-10-10']);
    expect(todayEvents(t, ME, TODAY).tomorrow.map((x) => `${x.eventId} ${x.part?.day}`)).toEqual(['oboz 4', 'dyzur 2']);
    // Ta sama nazwa i pora — po identyfikatorze.
    event(t, 'z2', { title: 'Taki sam', start_date: '2026-10-20' });
    event(t, 'a2', { title: 'Taki sam', start_date: '2026-10-20' });
    expect(days(t, '2026-10-20', '2026-10-20').map((x) => x.split(' ')[1])).toEqual(['a2', 'z2']);
    expect(occurrenceDays(undefined, { start_time: null, end_time: null, days: 4 })).toBe(4);
    expect(occurrenceDays({ all_day: true, start_time: null, end_time: null, days: null }, { start_time: '17:00', end_time: '18:00', days: 1 })).toBe(1);
  });

  it('własność: całodniowe przez N dni stoi w każdym swoim dniu okna, z kolejnym numerem dnia', () => {
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: config.events.MAX_DAYS }), fc.integer({ min: -40, max: 40 }), fc.integer({ min: 0, max: 20 }), (start, n, off, width) => {
        const day0 = Date.UTC(2026, 0, 1) + start * 86_400_000;
        const from = day0 + off * 86_400_000;
        const to = from + width * 86_400_000;
        const t = world();
        event(t, 'x', { start_date: iso(day0), days: n });
        const want: string[] = [];
        for (let i = 0; i < n; i++) {
          const d = day0 + i * 86_400_000;
          if (d >= from && d <= to) want.push(`${iso(d)} x ${n > 1 ? `${i + 1}/${n}` : '-'}`);
        }
        expect(days(t, iso(from), iso(to))).toEqual(want);
      }),
    );
  });

  it('plan dnia: kolejny dzień nocnego dyżuru przed sprawami z godziną; wielodniowe w Moich sprawach w każdym dniu tygodnia', () => {
    const t = world();
    event(t, 'dyzur', { start_date: '2026-10-07', start_time: '22:00', end_time: '06:00' });
    event(t, 'rano', { start_date: '2026-10-08', start_time: '05:00', end_time: '05:30' });
    event(t, 'oboz', { start_date: '2026-10-06', days: 3 });
    const d8 = expandEventDays(t, ME, parseIsoDate('2026-10-08'), parseIsoDate('2026-10-08'));
    expect(agenda([], d8).map((e) => e.key)).toEqual(['e-oboz-2026-10-06', 'e-dyzur-2026-10-07', 'e-rano-2026-10-08']);
    const week = myDays(t, ME, TODAY, 'week', TODAY, (s) => s.slice(0, 10));
    expect(week.days.map((d) => [d.date, d.entries.map((e) => (e.kind === 'event' ? `${e.event.eventId} ${e.event.part?.day ?? '-'}` : e.kind))])).toEqual([
      ['2026-10-06', ['oboz 1']],
      ['2026-10-07', ['oboz 2', 'dyzur 1']],
      ['2026-10-08', ['oboz 3', 'dyzur 2', 'rano -']],
    ]);
  });

  it('przypomnienia: raz, przed startem; kolejne dni bez przypomnienia i poza porannym podsumowaniem', () => {
    const t = world();
    event(t, 'dyzur', { start_date: '2026-10-07', start_time: '22:00', end_time: '06:00' });
    event(t, 'oboz', { start_date: '2026-10-07', days: 3 });
    const toMs = (l: { y: number; m: number; d: number; hh: number; mm: number }) => Date.UTC(l.y, l.m - 1, l.d, l.hh - 2, l.mm);
    const r = planReminders(t, ME, TODAY, toMs({ ...TODAY, hh: 7, mm: 0 }), { leadMin: 30, morning: '08:00' }, { days: 3, max: 40, toMs, localDate: (s) => s.slice(0, 10), label: { trip: (n) => n, morningTitle: 'Dziś', more: (n) => `+${n}`, summary: (n, o) => `${n}/${o}` } });
    expect(r.map((x) => [x.id, x.body])).toEqual([
      ['m|2026-10-07', '2/0: oboz, 22:00 dyzur'],
      ['e|dyzur|2026-10-07|2026-10-07', '22:00 · Rodzina'],
    ]);
  });
});

describe('zapis', () => {
  const base: EventFields = { title: 'Obóz', date: '2026-10-05', startTime: null, endTime: null, rule: null, until: null, audience: 'group', participantIds: [], responsibleId: null };
  const set = (op: NewOp) => (op as { set: Row }).set;

  it('utworzenie: długość tylko całodniowego i tylko, gdy dłuższe niż dzień', () => {
    const id = () => 'n';
    expect(set(createEvent('gf', { ...base, days: 5 }, id).ops[0]!)).toMatchObject({ days: 5 });
    expect(set(createEvent('gf', base, id).ops[0]!)).not.toHaveProperty('days');
    expect(set(createEvent('gf', { ...base, startTime: '22:00', endTime: '06:00', days: 5 }, id).ops[0]!)).not.toHaveProperty('days');
  });

  it('„wszystkie”, „tylko to”, „to i następne”, formularz z zapisanego', () => {
    const t = world();
    event(t, 'w', { start_date: '2026-10-02', days: 3, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR' });
    event(t, 'b', { start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    const d = eventDetail(t, ME, 'w')!;
    const f = fieldsOf(d, '2026-10-16', 'all');
    expect(f.days).toBe(3);
    expect(editEvent(d, '2026-10-02', 'all', f).map(set)[0]).not.toHaveProperty('days');
    expect(set(editEvent(d, '2026-10-02', 'all', { ...f, days: 2 })[0]!)).toMatchObject({ days: 2 });
    // Zmiana na „o godzinie” — długość 1.
    expect(set(editEvent(d, '2026-10-02', 'all', { ...f, startTime: '10:00', endTime: '12:00' })[0]!)).toMatchObject({ days: 1 });
    // Tylko ten termin krócej; ta sama długość co seria = bez wyjątku.
    expect(editEvent(d, '2026-10-16', 'this', fieldsOf(d, '2026-10-16', 'this'))).toEqual([]);
    const ops = editEvent(d, '2026-10-16', 'this', { ...fieldsOf(d, '2026-10-16', 'this'), days: 2 });
    expect(ops.map(set)).toEqual([expect.objectContaining({ days: 2 }), { days: 2 }]);
    run(t, ops);
    const d2 = eventDetail(t, ME, 'w')!;
    expect(fieldsOf(d2, '2026-10-16', 'this').days).toBe(2);
    expect(fieldsOf(d2, '2026-10-16', 'all').days).toBe(3);
    expect(expandEvents(t, ME, parseIsoDate('2026-10-16'), parseIsoDate('2026-10-16'))[0]).toMatchObject({ days: 2, endDate: '2026-10-17' });
    // Powrót do długości serii zeruje wyjątek.
    expect(editEvent(d2, '2026-10-16', 'this', { ...fieldsOf(d2, '2026-10-16', 'this'), days: 3 }).map(set)).toEqual([{ days: null }]);
    // Termin serii z godziną na cały dzień przez 2 dni.
    const db = eventDetail(t, ME, 'b')!;
    const allDay = editEvent(db, '2026-10-12', 'this', { ...fieldsOf(db, '2026-10-12', 'this'), startTime: null, endTime: null, days: 2 });
    expect(set(allDay[0]!)).toMatchObject({ all_day: true, days: 2 });
    expect(editEvent(db, '2026-10-12', 'this', { ...fieldsOf(db, '2026-10-12', 'this'), startTime: null, endTime: null }).map(set)[0]).not.toHaveProperty('days');
    // Nowa seria od tego terminu z długością w poleceniu.
    const split = editEvent(d, '2026-10-16', 'following', { ...fieldsOf(d, '2026-10-16', 'following'), days: 4 })[0] as unknown as { args: { set: Row } };
    expect(split.args.set.days).toBe(4);
    expect(fieldsOf(db, '2026-10-12', 'this').days).toBe(1);
  });

  it('ekran grupy: jednorazowe przez kilka dni z zakresem dni', () => {
    const t = world();
    event(t, 'oboz', { start_date: '2026-10-12', days: 5 });
    event(t, 'jeden', { start_date: '2026-10-12' });
    expect(groupSeries(t, ME, 'gf', TODAY, {} as RuleLabels).map((s) => s.summary)).toEqual(['Poniedziałek, 12 października', '12–16 października']);
  });
});

describe('lustro w iPhonie', () => {
  it('całodniowe wielodniowe jednym wpisem z długością; skrót jednodniowych bez zmian', () => {
    const t = world();
    event(t, 'oboz', { start_date: '2026-10-08', days: 3 });
    event(t, 'dyzur', { start_date: '2026-10-08', start_time: '22:00', end_time: '06:00' });
    const items = mirrorItems(t, ME, TODAY, 0, 7, new Set(), (n) => n);
    expect(items.map((i) => [i.key, i.days])).toEqual([
      ['oboz|2026-10-08', 3],
      ['dyzur|2026-10-08', 1],
    ]);
    const one = items[1]!;
    expect(mirrorHash(one)).toBe(JSON.stringify([one.title, one.date, one.startTime, one.endTime, one.notes, one.location]));
    expect(mirrorHash(items[0]!)).not.toBe(mirrorHash({ ...items[0]!, days: 1 }));
  });
});
