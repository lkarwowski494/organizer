import { createCalendar, ExpoCalendar, getCalendarPermissions, getDefaultCalendarSync, getSourcesSync, requestCalendarPermissions } from 'expo-calendar';
import { deleteEventAsync, getEventAsync, updateEventAsync } from 'expo-calendar/legacy';

import { draftOf, expoDeviceCalendar } from '../device-calendar';

jest.mock('expo-calendar', () => ({ requestCalendarPermissions: jest.fn(), getCalendarPermissions: jest.fn(), getDefaultCalendarSync: jest.fn(), getSourcesSync: jest.fn(), createCalendar: jest.fn(), EntityTypes: { EVENT: 'event' }, ExpoCalendar: { get: jest.fn() } }));
jest.mock('expo-calendar/legacy', () => ({ Availability: { BUSY: 'busy' }, getEventAsync: jest.fn(), updateEventAsync: jest.fn(), deleteEventAsync: jest.fn() }));

describe('kalendarz iPhone’a (D7)', () => {
  it('szkic: godziny w czasie warszawskim, bez końca = 60 min, cały dzień', () => {
    expect(draftOf({ title: 'Tańce', date: '2026-10-12', startTime: '18:00:00', endTime: '19:30' }, 'Rodzina')).toEqual({
      title: 'Tańce',
      start: new Date(Date.UTC(2026, 9, 12, 16, 0)),
      end: new Date(Date.UTC(2026, 9, 12, 17, 30)),
      allDay: false,
      notes: 'Rodzina',
    });
    expect(draftOf({ title: 'T', date: '2026-12-05', startTime: '12:00', endTime: null })).toMatchObject({ start: new Date(Date.UTC(2026, 11, 5, 11, 0)), end: new Date(Date.UTC(2026, 11, 5, 12, 0)) });
    expect(draftOf({ title: 'T', date: '2026-12-31', startTime: null, endTime: null })).toMatchObject({ allDay: true, start: new Date(2026, 11, 31), end: new Date(2027, 0, 1) });
    expect(draftOf({ title: 'T', date: '2026-12-31', startTime: '10:00', endTime: '11:00', location: 'Wodna 1' })).toMatchObject({ location: 'Wodna 1' });
    // D199: koniec równy początkowi = doba (dyżur 8:00–8:00), koniec przed początkiem = następnego dnia (przez północ).
    expect(draftOf({ title: 'T', date: '2026-12-31', startTime: '10:00', endTime: '10:00' })).toMatchObject({ end: new Date(Date.UTC(2027, 0, 1, 9, 0)) });
    expect(draftOf({ title: 'T', date: '2026-10-12', startTime: '22:00', endTime: '06:00' })).toMatchObject({ allDay: false, start: new Date(Date.UTC(2026, 9, 12, 20, 0)), end: new Date(Date.UTC(2026, 9, 13, 4, 0)) });
    expect(draftOf({ title: 'T', date: '2026-10-12', startTime: '20:00', endTime: '00:00' })).toMatchObject({ end: new Date(Date.UTC(2026, 9, 12, 22, 0)) });
    // Wyjazd pt. 18:00 – nd. 16:00 (46 h, D199 cz. 2).
    expect(draftOf({ title: 'T', date: '2026-10-09', startTime: '18:00', endTime: '16:00', durationMin: 46 * 60 })).toMatchObject({ start: new Date(Date.UTC(2026, 9, 9, 16, 0)), end: new Date(Date.UTC(2026, 9, 11, 14, 0)) });
    // Obóz 1–14 lipca: koniec wyłączny 15 lipca (RFC 5545 §3.6.1).
    expect(draftOf({ title: 'T', date: '2026-07-01', startTime: null, endTime: null, days: 14 })).toMatchObject({ allDay: true, start: new Date(2026, 6, 1), end: new Date(2026, 6, 15) });
  });

  it('audyt 2 (M-219): całodniowe od północy telefonu w każdej strefie; wiosenna zmiana czasu — koniec po początku', () => {
    // Strefa procesu testów (CI: UTC; przebieg z TZ=America/New_York daje to samo): północ telefonu, nie Warszawy.
    // process.env w Jest jest kopią, więc strefy nie da się tu zmienić w trakcie testu.
    const d = draftOf({ title: 'Urodziny', date: '2026-10-20', startTime: null, endTime: null });
    expect([d.start.getDate(), d.start.getHours(), d.start.getMinutes(), d.end.getDate(), d.end.getHours()]).toEqual([20, 0, 0, 21, 0]);
    // Godziny zostają według Warszawy (R2) w każdej strefie telefonu: 18:00 w Warszawie = 16:00 UTC.
    expect(draftOf({ title: 'T', date: '2026-10-20', startTime: '18:00', endTime: null }).start).toEqual(new Date(Date.UTC(2026, 9, 20, 16, 0)));
    // 29.03.2026: 2:00–2:59 nie istnieje w Warszawie — początek 3:30, koniec nie przed nim (ta sama długość).
    const spring = draftOf({ title: 'T', date: '2026-03-29', startTime: '02:30', endTime: '03:00' });
    expect(spring.end.getTime() - spring.start.getTime()).toBe(30 * 60_000);
    expect(spring.start).toEqual(new Date(Date.UTC(2026, 2, 29, 1, 30)));
  });

  it('audyt 2 (M-217): zgoda tylko na dodawanie rozpoznana; pełna, nieustalona, odmowa', async () => {
    const sync = expoDeviceCalendar.sync!;
    const perm = getCalendarPermissions as jest.Mock;
    perm.mockResolvedValueOnce({ granted: true });
    expect(await sync.status()).toBe('granted');
    perm.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    expect(await sync.status()).toBe('undetermined');
    perm.mockResolvedValueOnce({ granted: false, canAskAgain: false }).mockResolvedValueOnce({ granted: true });
    expect(await sync.status()).toBe('writeOnly');
    expect(perm).toHaveBeenLastCalledWith(true);
    perm.mockResolvedValueOnce({ granted: false, canAskAgain: false }).mockResolvedValueOnce({ granted: false });
    expect(await sync.status()).toBe('denied');
  });

  it('nazwa i kolor kalendarza; zmiana wydarzenia przez legacy (usunięte miejsce = pusty tekst, „Zajęty”)', async () => {
    const sync = expoDeviceCalendar.sync!;
    const update = jest.fn(async () => {});
    (ExpoCalendar.get as jest.Mock).mockResolvedValue({ update, createEvent: jest.fn(async () => ({ id: 'e1' })) });
    await sync.updateCalendar('c1', 'Organizer – Dom', '#123456');
    expect(update).toHaveBeenCalledWith({ title: 'Organizer – Dom', color: '#123456' });
    const d = draftOf({ title: 'T', date: '2026-10-12', startTime: '18:00', endTime: null });
    await sync.updateEvent('e1', d);
    expect(updateEventAsync).toHaveBeenCalledWith('e1', { title: 'T', startDate: d.start, endDate: d.end, allDay: false, notes: '', location: '', availability: 'busy' });
    await sync.updateEvent('e1', { ...d, notes: 'Rodzina', location: 'Wodna 1' });
    expect(updateEventAsync).toHaveBeenLastCalledWith('e1', expect.objectContaining({ notes: 'Rodzina', location: 'Wodna 1' }));
    expect(await sync.createEvent('c1', { ...d, location: 'Wodna 1' })).toBe('e1');
  });

  it('audyt 3 (N-5): usunięcie i sprawdzenie wydarzenia tym samym identyfikatorem (legacy); „nie ma” ≠ inny błąd', async () => {
    const sync = expoDeviceCalendar.sync!;
    await sync.deleteEvent('e1');
    expect(deleteEventAsync).toHaveBeenCalledWith('e1');
    (getEventAsync as jest.Mock).mockResolvedValueOnce({ id: 'e1' });
    expect(await sync.hasEvent('e1')).toBe(true);
    (getEventAsync as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Event with id e1 could not be found'), { code: 'ERR_EVENT_NOT_FOUND' }));
    expect(await sync.hasEvent('e1')).toBe(false);
    (getEventAsync as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('brak zgody'), { code: 'ERR_MISSION_PERMISSIONS' }));
    await expect(sync.hasEvent('e1')).rejects.toThrow('brak zgody');
    (getEventAsync as jest.Mock).mockRejectedValueOnce(null);
    await expect(sync.hasEvent('e1')).rejects.toBeNull();
  });

  it('audyt 3 (N-58): kalendarz lustra na koncie domyślnym, a gdy się nie da — iCloud, potem „Na moim iPhonie”', async () => {
    const sync = expoDeviceCalendar.sync!;
    const gmail = { id: 's-g', type: 'caldav', name: 'Gmail' };
    const icloud = { id: 's-i', type: 'caldav', name: 'iCloud' };
    const phone = { id: 's-l', type: 'local', name: 'Default' };
    (getDefaultCalendarSync as jest.Mock).mockReturnValue({ source: gmail });
    (getSourcesSync as jest.Mock).mockReturnValue([phone, gmail, icloud]);
    const make = createCalendar as jest.Mock;
    make.mockResolvedValueOnce({ id: 'cal-1' });
    expect(await sync.createCalendar('Organizer – Dom', '#123456')).toBe('cal-1');
    expect(make).toHaveBeenLastCalledWith({ title: 'Organizer – Dom', color: '#123456', entityType: 'event', source: gmail, sourceId: 's-g', name: 'Organizer – Dom' });
    make.mockClear().mockRejectedValueOnce(new Error('gmail')).mockResolvedValueOnce({ id: 'cal-2' });
    expect(await sync.createCalendar('Organizer – Dom', '#123456')).toBe('cal-2');
    expect(make.mock.calls.map((c) => c[0].sourceId)).toEqual(['s-g', 's-i']);
    make.mockClear().mockRejectedValueOnce(new Error('gmail')).mockRejectedValueOnce(new Error('icloud')).mockRejectedValueOnce(new Error('lokalne'));
    await expect(sync.createCalendar('Organizer – Dom', '#123456')).rejects.toThrow('lokalne');
    expect(make.mock.calls.map((c) => c[0].sourceId)).toEqual(['s-g', 's-i', 's-l']);
    // Bez kalendarza domyślnego — od iCloud; bez żadnego konta — błąd.
    (getDefaultCalendarSync as jest.Mock).mockImplementation(() => {
      throw new Error('brak');
    });
    make.mockClear().mockResolvedValueOnce({ id: 'cal-3' });
    expect(await sync.createCalendar('Organizer – Dom', '#123456')).toBe('cal-3');
    expect(make.mock.calls.map((c) => c[0].sourceId)).toEqual(['s-i']);
    (getSourcesSync as jest.Mock).mockReturnValue([]);
    await expect(sync.createCalendar('Organizer – Dom', '#123456')).rejects.toThrow('NoCalendarSource');
    (getDefaultCalendarSync as jest.Mock).mockReset();
  });

  it('zgoda tylko na zapis; brak zgody, zapis, rezygnacja', async () => {
    const addEventWithForm = jest.fn(async (): Promise<{ action: string; id: string | null }> => ({ action: 'saved', id: 'x' }));
    (getDefaultCalendarSync as jest.Mock).mockReturnValue({ addEventWithForm });
    const draft = draftOf({ title: 'T', date: '2026-10-12', startTime: '18:00', endTime: null });
    (requestCalendarPermissions as jest.Mock).mockResolvedValueOnce({ granted: false });
    expect(await expoDeviceCalendar.add(draft)).toBe('denied');
    expect(requestCalendarPermissions).toHaveBeenCalledWith(true);
    expect(addEventWithForm).not.toHaveBeenCalled();
    (requestCalendarPermissions as jest.Mock).mockResolvedValue({ granted: true });
    expect(await expoDeviceCalendar.add(draft)).toBe('saved');
    expect(addEventWithForm).toHaveBeenCalledWith({ title: 'T', startDate: draft.start, endDate: draft.end, allDay: false, notes: undefined, location: undefined, url: undefined });
    // Audyt 3 (N-183): adres terminu w kopii.
    await expoDeviceCalendar.add({ ...draft, url: 'x://event/e1/2026-10-12' });
    expect(addEventWithForm).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'x://event/e1/2026-10-12' }));
    addEventWithForm.mockResolvedValueOnce({ action: 'canceled', id: null });
    expect(await expoDeviceCalendar.add(draft)).toBe('canceled');
  });
});
