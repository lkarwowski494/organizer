/**
 * ADR 0049 (K7, Q3 a): odwołany termin serii widać tylko w Kalendarzu (wyszarzony wiersz z „Przywróć”) i tylko dorosłym
 * grupy. Moje sprawy, przypomnienia, lustro w kalendarzu iPhone’a, dojazd i stałe zadania serii dalej go nie biorą —
 * wszystkie liczą z expandEvents / expandEventDays, które odwołanych nie zwracają.
 */
import type { CivilDate } from '../civil-date';
import { parseIsoDate } from '../format';
import type { Row } from '../sync-engine/client';
import { mirrorItems } from '../views/calendar-sync';
import { cancelledEventDays, eventsByDate, expandEventDays, expandEvents, todayEvents } from '../views/events';
import { myDays } from '../views/my-days';
import { planReminders } from '../views/reminders';

const ME = 'u-me';
const TODAY: CivilDate = { y: 2026, m: 10, d: 7 }; // środa
const D = parseIsoDate;
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);

/** Basen co środę 17:00–18:00 w Rodzinie (ja dorosły), odwołany 7 i 14 października; Klasa — jestem w niej dzieckiem. */
function world(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'groups', 'gk', { id: 'gk', name: 'Klasa', kind: 'shared', created_at: '2026-03-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mk', { member_id: 'mk', group_id: 'gk', user_id: ME, display_name: 'Łukasz', role: 'child', created_at: '2026-01-01T00:00:00Z', deleted_at: null });
  put(t, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen', start_date: '2026-09-30', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', responsible_member_id: 'mf', deleted_at: null });
  put(t, 'event_overrides', 'o7', { id: 'o7', event_id: 'basen', group_id: 'gf', occurrence_date: '2026-10-07', cancelled: true, deleted_at: null });
  put(t, 'event_overrides', 'o14', { id: 'o14', event_id: 'basen', group_id: 'gf', occurrence_date: '2026-10-14', cancelled: true, deleted_at: null });
  put(t, 'events', 'wycieczka', { id: 'wycieczka', group_id: 'gk', title: 'Wycieczka', start_date: '2026-10-07', start_time: '09:00:00', end_time: '12:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', responsible_member_id: null, deleted_at: null });
  put(t, 'event_overrides', 'ok', { id: 'ok', event_id: 'wycieczka', group_id: 'gk', occurrence_date: '2026-10-07', cancelled: true, deleted_at: null });
  return t;
}
const keys = (xs: { eventId: string; occurrenceDate: string; date: string }[]) => xs.map((x) => `${x.eventId}|${x.occurrenceDate}@${x.date}`);
/** Tylko basen (w Klasie żywe terminy wycieczki widzę jako dziecko — to inny przypadek). */
const pool = (xs: { eventId: string; occurrenceDate: string; date: string }[]) => keys(xs.filter((x) => x.eventId === 'basen'));

describe('cancelledEventDays (ADR 0049, K7)', () => {
  it('odwołane terminy w zakresie, w dniu, w którym by stały; tylko grupy, w których jestem dorosłym', () => {
    const t = world();
    expect(keys(cancelledEventDays(t, ME, D('2026-10-05'), D('2026-10-18')))).toEqual(['basen|2026-10-07@2026-10-07', 'basen|2026-10-14@2026-10-14']);
    expect(keys(cancelledEventDays(t, ME, D('2026-10-08'), D('2026-10-13')))).toEqual([]);
    const [o] = cancelledEventDays(t, ME, D('2026-10-07'), D('2026-10-07'));
    expect(o).toMatchObject({ title: 'Basen', startTime: '17:00:00', endTime: '18:00:00', groupId: 'gf', groupName: 'Rodzina', recurring: true, overrideId: 'o7' });
  });

  it('aktywne terminy (także w Kalendarzu) bez odwołanych — i odwrotnie', () => {
    const t = world();
    expect(pool(expandEvents(t, ME, D('2026-10-05'), D('2026-10-18')))).toEqual([]);
    expect(pool(expandEventDays(t, ME, D('2026-09-28'), D('2026-10-25')))).toEqual(['basen|2026-09-30@2026-09-30', 'basen|2026-10-21@2026-10-21']);
    expect([...eventsByDate(t, ME, D('2026-10-05'), D('2026-10-18')).values()].flat().map((x) => x.eventId)).toEqual(['wycieczka']);
    expect(todayEvents(t, ME, TODAY)).toEqual({ today: [], tomorrow: [] });
  });

  it('przywrócony termin (cancelled: false) i wyjątek w koszu — znowu zwykły termin, nie odwołany', () => {
    const t = world();
    put(t, 'event_overrides', 'o7', { ...t.event_overrides!.o7!, cancelled: false });
    put(t, 'event_overrides', 'o14', { ...t.event_overrides!.o14!, deleted_at: '2026-10-07T08:00:00Z' });
    expect(keys(cancelledEventDays(t, ME, D('2026-10-05'), D('2026-10-18')))).toEqual([]);
    expect(pool(expandEvents(t, ME, D('2026-10-05'), D('2026-10-18')))).toEqual(['basen|2026-10-07@2026-10-07', 'basen|2026-10-14@2026-10-14']);
  });

  it('termin przeniesiony, a potem odwołany — stoi w dniu po przeniesieniu; wielodniowy — w każdym swoim dniu', () => {
    const t = world();
    put(t, 'event_overrides', 'o14', { ...t.event_overrides!.o14!, start_date: '2026-10-16' });
    put(t, 'events', 'oboz', { id: 'oboz', group_id: 'gf', title: 'Obóz', start_date: '2026-10-09', start_time: null, end_time: null, all_day: true, days: 3, rrule: 'FREQ=WEEKLY', audience: 'group', responsible_member_id: null, deleted_at: null });
    put(t, 'event_overrides', 'ob', { id: 'ob', event_id: 'oboz', group_id: 'gf', occurrence_date: '2026-10-09', cancelled: true, deleted_at: null });
    expect(keys(cancelledEventDays(t, ME, D('2026-10-08'), D('2026-10-18')))).toEqual(['oboz|2026-10-09@2026-10-09', 'oboz|2026-10-09@2026-10-10', 'oboz|2026-10-09@2026-10-11', 'basen|2026-10-14@2026-10-16']);
    expect(cancelledEventDays(t, ME, D('2026-10-10'), D('2026-10-10'))[0]!.part).toEqual({ day: 2, days: 3 });
    // Wydarzenie usunięte (w koszu) — jego odwołanych terminów też nie ma.
    put(t, 'events', 'oboz', { ...t.events!.oboz!, deleted_at: '2026-10-07T08:00:00Z' });
    expect(keys(cancelledEventDays(t, ME, D('2026-10-08'), D('2026-10-12')))).toEqual([]);
  });

  it('Moje sprawy, przypomnienia i lustro w kalendarzu iPhone’a nie biorą odwołanych terminów', () => {
    const t = world();
    // Sprawdzenie danych: ten sam termin bez odwołania jest w każdym z tych widoków.
    const active = world();
    put(active, 'event_overrides', 'o7', { ...active.event_overrides!.o7!, cancelled: false });
    const local = (iso: string) => iso.slice(0, 10);
    const day = (x: T) => JSON.stringify(myDays(x, ME, TODAY, 'day', TODAY, local));
    expect(day(active)).toContain('Basen');
    expect(day(t)).not.toContain('Basen');
    const toMs = (l: { y: number; m: number; d: number; hh: number; mm: number }) => Date.UTC(l.y, l.m - 1, l.d, l.hh - 2, l.mm);
    const opts = { days: 3, max: 40, toMs, localDate: local, label: { trip: (n: string) => n, morningTitle: 'Dziś', more: (n: number) => `+${n}`, summary: (n: number) => `${n}` } };
    const settings = { leadMin: 30, morning: 'off' };
    const now = toMs({ ...TODAY, hh: 10, mm: 0 });
    expect(planReminders(active, ME, TODAY, now, settings, opts).some((r) => r.title.includes('Basen'))).toBe(true);
    expect(planReminders(t, ME, TODAY, now, settings, opts).some((r) => r.title.includes('Basen'))).toBe(false);
    const titles = { lessons: (name: string) => name, responsible: (title: string) => title };
    expect(mirrorItems(active, ME, TODAY, 7, 14, new Set(), titles).map((i) => i.key)).toContain('basen|2026-10-07');
    expect(mirrorItems(t, ME, TODAY, 7, 14, new Set(), titles).map((i) => i.key).filter((k) => k.startsWith('basen'))).toEqual(['basen|2026-09-30', 'basen|2026-10-21']);
  });
});
