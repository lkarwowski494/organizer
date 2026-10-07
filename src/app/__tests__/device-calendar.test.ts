import { getDefaultCalendarSync, requestCalendarPermissions } from 'expo-calendar';

import { draftOf, expoDeviceCalendar } from '../device-calendar';

jest.mock('expo-calendar', () => ({ requestCalendarPermissions: jest.fn(), getDefaultCalendarSync: jest.fn() }));

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
    expect(draftOf({ title: 'T', date: '2026-12-31', startTime: null, endTime: null })).toMatchObject({ allDay: true, start: new Date(Date.UTC(2026, 11, 30, 23, 0)), end: new Date(Date.UTC(2026, 11, 31, 23, 0)) });
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
    expect(addEventWithForm).toHaveBeenCalledWith({ title: 'T', startDate: draft.start, endDate: draft.end, allDay: false, notes: undefined });
    addEventWithForm.mockResolvedValueOnce({ action: 'canceled', id: null });
    expect(await expoDeviceCalendar.add(draft)).toBe('canceled');
  });
});
