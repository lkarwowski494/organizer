/** Lustro grup w kalendarzu iPhone'a (D95) na atrapie kalendarza; zamiana wydarzeń iPhone'a na dni (toDeviceEvent). */
import type { Row } from '../../domain/sync-engine/client';
import { clearMirror, loadMirror, MIRROR_KEY, runMirror } from '../calendar-mirror';
import { type DeviceCalendarSync, toDeviceEvent } from '../device-calendar';

jest.mock('expo-calendar', () => ({}));

const ME = 'u-me';
type T = { [e: string]: { [id: string]: Row } };
const put = (t: T, e: string, k: string, r: Row) => ((t[e] ??= {})[k] = r);
const today = { y: 2026, m: 10, d: 8 };

function tables(): T {
  const t: T = {};
  put(t, 'groups', 'gf', { id: 'gf', name: 'Rodzina', kind: 'shared', created_at: '2026-02-01T00:00:00Z', deleted_at: null });
  put(t, 'group_members', 'mf', { member_id: 'mf', group_id: 'gf', user_id: ME, display_name: 'Łukasz', role: 'admin', deleted_at: null });
  put(t, 'events', 'e1', { id: 'e1', group_id: 'gf', title: 'Basen', start_date: '2026-10-09', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null });
  return t;
}

function fakeSync() {
  const calendars = new Set<string>();
  const events = new Map<string, { calendarId: string; title: string; start: Date }>();
  let n = 0;
  const sync = {
    status: jest.fn(async () => 'granted' as const),
    request: jest.fn(async () => true),
    listEvents: jest.fn(async () => []),
    createCalendar: jest.fn(async () => {
      const id = `cal-${++n}`;
      calendars.add(id);
      return id;
    }),
    hasCalendar: jest.fn(async (id: string) => calendars.has(id)),
    deleteCalendar: jest.fn(async (id: string) => {
      calendars.delete(id);
      for (const [k, e] of events) if (e.calendarId === id) events.delete(k);
    }),
    createEvent: jest.fn(async (calendarId: string, d: { title: string; start: Date }) => {
      const id = `ev-${++n}`;
      events.set(id, { calendarId, title: d.title, start: d.start });
      return id;
    }),
    updateEvent: jest.fn(async (id: string, d: { title: string; start: Date }) => {
      if (!events.has(id)) throw new Error('not found');
      events.set(id, { ...events.get(id)!, title: d.title, start: d.start });
    }),
    deleteEvent: jest.fn(async (id: string) => void events.delete(id)),
  } as unknown as jest.Mocked<DeviceCalendarSync>;
  return { sync, calendars, events };
}

function memLocal(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, load: (k: string) => m.get(k) ?? null, save: (k: string, v: string | null) => void (v === null ? m.delete(k) : m.set(k, v)) };
}

describe('lustro grup (D95)', () => {
  it('pierwsze przejście: kalendarz grupy w kolorze linii i wydarzenie; drugie: nic; zmiana: update', async () => {
    const { sync, events } = fakeSync();
    const local = memLocal();
    const t = tables();
    expect(await runMirror(sync, local, t, ME, today)).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(sync.createCalendar).toHaveBeenCalledWith('Organizer – Rodzina', expect.stringMatching(/^#[0-9A-F]{6}$/));
    expect([...events.values()]).toEqual([{ calendarId: 'cal-1', title: 'Basen', start: new Date(Date.UTC(2026, 9, 9, 15, 0)) }]);
    expect(await runMirror(sync, local, t, ME, today)).toEqual({ created: 0, updated: 0, removed: 0 });
    put(t, 'events', 'e1', { ...t.events!.e1!, title: 'Basen z Kubą' });
    expect(await runMirror(sync, local, t, ME, today)).toEqual({ created: 0, updated: 1, removed: 0 });
    expect([...events.values()][0]!.title).toBe('Basen z Kubą');
  });

  it('wydarzenie usunięte w aplikacji znika z iPhone’a; usunięte ręcznie w iPhonie — wraca; kalendarz usunięty ręcznie — nowy', async () => {
    const { sync, events, calendars } = fakeSync();
    const local = memLocal();
    const t = tables();
    await runMirror(sync, local, t, ME, today);
    events.clear();
    put(t, 'events', 'e1', { ...t.events!.e1!, title: 'Basen!' });
    expect(await runMirror(sync, local, t, ME, today)).toMatchObject({ updated: 1 });
    expect(events.size).toBe(1);
    calendars.clear();
    events.clear();
    await runMirror(sync, local, t, ME, today);
    expect(sync.createCalendar).toHaveBeenCalledTimes(2);
    expect(events.size).toBe(1);
    put(t, 'events', 'e1', { ...t.events!.e1!, deleted_at: '2026-10-08T10:00:00Z' });
    expect(await runMirror(sync, local, t, ME, today)).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(events.size).toBe(0);
  });

  it('wyjście z grupy: kalendarz usunięty; wyłączenie lustra usuwa kalendarze i stan', async () => {
    const { sync, calendars } = fakeSync();
    const local = memLocal();
    const t = tables();
    await runMirror(sync, local, t, ME, today);
    put(t, 'groups', 'gf', { ...t.groups!.gf!, deleted_at: '2026-10-08T10:00:00Z' });
    await runMirror(sync, local, t, ME, today);
    expect(calendars.size).toBe(0);
    expect(loadMirror(local)).toEqual({ calendars: {}, events: {} });
    await runMirror(sync, local, tables(), ME, today);
    expect(calendars.size).toBe(1);
    await clearMirror(sync, local);
    expect(calendars.size).toBe(0);
    expect(local.m.has(MIRROR_KEY)).toBe(false);
  });

  it('błędny albo obcy zapis stanu — zaczynamy od zera', () => {
    expect(loadMirror(memLocal({ [MIRROR_KEY]: 'nie json' }))).toEqual({ calendars: {}, events: {} });
    expect(loadMirror(memLocal({ [MIRROR_KEY]: '{"x":1}' }))).toEqual({ calendars: {}, events: {} });
  });
});

describe('wydarzenie iPhone’a → dni (D95)', () => {
  const base = { id: 'a', calendarId: 'c', title: 'Urlop' };
  it('z godziną: chwile; całodniowe: daty w strefie telefonu, koniec wyłączny', () => {
    expect(toDeviceEvent({ ...base, allDay: false, startDate: '2026-10-09T14:00:00.000Z', endDate: '2026-10-09T15:00:00.000Z' }, 'Praca')).toEqual({
      ...base, calendarTitle: 'Praca', allDay: false, startMs: Date.UTC(2026, 9, 9, 14), endMs: Date.UTC(2026, 9, 9, 15),
    });
    const local = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss);
    // Koniec jako północ dnia następnego albo 23:59:59 ostatniego dnia — ten sam wynik.
    expect(toDeviceEvent({ ...base, allDay: true, startDate: local(2026, 10, 8), endDate: local(2026, 10, 11) }, 'Dom')).toMatchObject({ allDay: true, startDate: '2026-10-08', endDate: '2026-10-11' });
    expect(toDeviceEvent({ ...base, allDay: true, startDate: local(2026, 10, 8), endDate: local(2026, 10, 10, 23, 59, 59) }, 'Dom')).toMatchObject({ startDate: '2026-10-08', endDate: '2026-10-11' });
    // Koniec równy początkowi — jeden dzień.
    expect(toDeviceEvent({ ...base, allDay: true, startDate: local(2026, 10, 8), endDate: local(2026, 10, 8) }, 'Dom')).toMatchObject({ startDate: '2026-10-08', endDate: '2026-10-09' });
  });
});
