/** Kalendarz iPhone'a w obie strony (D95, D96): połączenie, moje wydarzenia w Kalendarzu i „Moich sprawach”, ustawienia. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { config } from '../../config';
import type { DeviceCalendarSync } from '../device-calendar';
import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

jest.mock('expo-calendar', () => ({}));

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}

// Harness: dziś 7.10.2026, 10:00 w Warszawie (UTC+2).
const mine = { id: 'x1', calendarId: 'work', calendarTitle: 'Praca', title: 'Dentysta', allDay: false as const, startMs: Date.UTC(2026, 9, 7, 14, 0), endMs: Date.UTC(2026, 9, 7, 15, 0) };

function fakeSync(over: Partial<DeviceCalendarSync> = {}): jest.Mocked<DeviceCalendarSync> {
  return {
    status: jest.fn(async () => 'undetermined' as const),
    request: jest.fn(async () => true),
    listEvents: jest.fn(async () => [mine]),
    createCalendar: jest.fn(async () => 'cal-1'),
    hasCalendar: jest.fn(async () => true),
    deleteCalendar: jest.fn(async () => {}),
    createEvent: jest.fn(async () => 'ev-1'),
    updateEvent: jest.fn(async () => {}),
    deleteEvent: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<DeviceCalendarSync>;
}

async function open(sync: jest.Mocked<DeviceCalendarSync>, prefs = memoryPrefs({ welcomeSeen: '1' })) {
  const base = sampleBase();
  put(base, 'events', 'ev1', { id: 'ev1', group_id: 'gf', title: 'Tańce', start_date: '2026-10-09', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
  const s = setup({ base, prefs, calendar: { add: jest.fn(async () => 'saved' as const), sync } });
  await s.renderApp(<RootStack />);
  await flush();
  return { ...s, prefs };
}

describe('kalendarz iPhone’a', () => {
  it('połączenie: zgoda, oba przełączniki włączone, moje wydarzenie w Kalendarzu i w „Moich sprawach”', async () => {
    const sync = fakeSync();
    const { prefs } = await open(sync);
    await press(screen.getByLabelText('Kalendarz'));
    const card = await screen.findByTestId('device-calendar-card');
    expect(within(card).getByText(/Twoje wydarzenia zostają na telefonie/)).toBeTruthy();
    await press(within(card).getByTestId('device-connect'));
    await flush();
    expect(sync.request).toHaveBeenCalled();
    expect(prefs.m.get('calendarRead')).toBe('1');
    expect(prefs.m.get('calendarMirror')).toBe('1');
    expect(prefs.m.get('calendarAsked')).toBe('1');
    expect(screen.queryByTestId('device-calendar-card')).toBeNull();
    expect(await screen.findByTestId('device-d|x1')).toBeTruthy();
    expect(screen.getByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca')).toBeTruthy();
    expect(screen.getByTestId('device-dot-2026-10-07')).toBeTruthy();
    await press(screen.getByLabelText('Dziś'));
    expect(await screen.findByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca')).toBeTruthy();
  });

  it('lustro po zmianie danych: kalendarz grupy i wydarzenia (z opóźnieniem)', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarMirror: '1' }));
    expect(sync.createCalendar).not.toHaveBeenCalled();
    await waitFor(() => expect(sync.createCalendar).toHaveBeenCalledWith('Organizer – Rodzina', expect.any(String)), { timeout: config.calendar.MIRROR_DEBOUNCE_MS + 3000 });
    await waitFor(() => expect(sync.createEvent).toHaveBeenCalledWith('cal-1', expect.objectContaining({ title: 'Tańce', notes: 'Rodzina' })));
  }, 15000);

  it('odmowa w iOS: wskazówka do Ustawień; „Nie teraz” chowa kartę na stałe', async () => {
    const sync = fakeSync({ request: jest.fn(async () => false) });
    const { prefs } = await open(sync);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('device-connect'));
    await flush();
    expect(screen.getByText(/Brak dostępu do kalendarza/)).toBeTruthy();
    expect(screen.queryByTestId('device-connect')).toBeNull();
    expect(prefs.m.get('calendarRead')).toBeUndefined();
    await press(screen.getByTestId('device-later'));
    expect(screen.queryByTestId('device-calendar-card')).toBeNull();
    expect(prefs.m.get('calendarAsked')).toBe('1');
  });

  it('lista z przerwami (D122): moje wydarzenie z iPhone’a według godziny, przerwy wokół niego', async () => {
    await open(fakeSync({ status: jest.fn(async () => 'granted' as const) }), memoryPrefs({ welcomeSeen: '1', calendarRead: '1' }));
    await screen.findByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca');
    // teraz 10:00; Dentysta 16:00–17:00, korki 17:30, paczka 18:00.
    expect(screen.getAllByTestId(/^(today-gap|device-|today-t-(korki|paczka))/).map((e) => e.props.testID)).toEqual(['today-gap-600-960', 'device-d|x1', 'today-gap-1020-1050', 'today-t-korki', 'today-gap-1050-1080', 'today-t-paczka']);
  });

  it('Ustawienia: wyłączenie odczytu chowa wydarzenia; wyłączenie lustra usuwa kalendarze grup', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    const { prefs, services } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarMirror: '1' }));
    services.local?.save('calendarMirror', JSON.stringify({ calendars: { gf: 'cal-9' }, events: {} }));
    expect(await screen.findByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca')).toBeTruthy();
    await press(screen.getByLabelText('Ustawienia'));
    const box = await screen.findByTestId('device-settings');
    await press(within(within(box).getByLabelText('Moje wydarzenia z iPhone’a w aplikacji')).getByLabelText('Wyłączone'));
    expect(prefs.m.get('calendarRead')).toBe('0');
    await press(within(within(box).getByLabelText('Wydarzenia grup w kalendarzu iPhone’a')).getByLabelText('Wyłączone'));
    await flush();
    expect(prefs.m.get('calendarMirror')).toBe('0');
    expect(sync.deleteCalendar).toHaveBeenCalledWith('cal-9');
    await press(within(within(box).getByLabelText('Moje wydarzenia z iPhone’a w aplikacji')).getByLabelText('Włączone'));
    expect(prefs.m.get('calendarRead')).toBe('1');
  });

  it('dubel wpisu z aplikacji ukryty (D107); wybór kalendarzy w Ustawieniach (D106)', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const), listEvents: jest.fn(async () => [mine, { ...mine, id: 'x2', calendarId: 'home', calendarTitle: 'Dom', title: 'Szkoła', startMs: Date.UTC(2026, 9, 7, 6), endMs: Date.UTC(2026, 9, 7, 7) }]) });
    const base = sampleBase();
    put(base, 'tasks', 'dent', { ...base.tasks!['t-books']!, id: 'dent', title: 'Wizyta - dentysta', deadline_mode: 'own', due_date: '2026-10-07', due_time: '16:15:00' });
    const prefs = memoryPrefs({ welcomeSeen: '1', calendarRead: '1' });
    const s = setup({ base, prefs, calendar: { add: jest.fn(async () => 'saved' as const), sync } });
    await s.renderApp(<RootStack />);
    await flush();
    expect(await screen.findByLabelText(/^Szkoła, 08:00–09:00/)).toBeTruthy();
    expect(screen.queryByTestId('device-d|x1')).toBeNull();
    await press(screen.getByLabelText('Ustawienia'));
    const box = await screen.findByTestId('device-calendars');
    expect(within(box).getByLabelText('Praca')).toBeTruthy();
    await press(within(within(box).getByLabelText('Dom')).getByLabelText('Wyłączone'));
    expect(JSON.parse(prefs.m.get('calendarSkip')!)).toEqual(['home']);
    expect(within(within(box).getByLabelText('Dom')).getByLabelText('Wyłączone').props.accessibilityState.selected).toBe(true);
    await press(within(within(box).getByLabelText('Dom')).getByLabelText('Włączone'));
    expect(JSON.parse(prefs.m.get('calendarSkip')!)).toEqual([]);
    await press(within(within(box).getByLabelText('Dom')).getByLabelText('Wyłączone'));
    await press(screen.getByLabelText('Wróć'));
    expect(screen.queryByLabelText(/^Szkoła, 08:00–09:00/)).toBeNull();
  });

  it('zapisany wybór kalendarzy wczytany; zepsuty zapis — wszystkie czytane', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarSkip: '["work"]' }));
    await flush();
    expect(screen.queryByLabelText(/^Dentysta/)).toBeNull();
    await open(fakeSync({ status: jest.fn(async () => 'granted' as const) }), memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarSkip: 'zepsute' }));
    expect(await screen.findByLabelText(/^Dentysta/)).toBeTruthy();
    await open(fakeSync({ status: jest.fn(async () => 'granted' as const) }), memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarSkip: '{"a":1}' }));
    expect(await screen.findByLabelText(/^Dentysta/)).toBeTruthy();
  });

  it('błąd odczytu — zgłoszony raz, aplikacja działa; bez wsparcia w telefonie — brak karty', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const), listEvents: jest.fn(async () => Promise.reject(new Error('EKError'))) });
    const { account } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1' }));
    await flush();
    expect(account.reportError).toHaveBeenCalledTimes(1);
    expect(account.reportError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'calendar-read', message: 'Error: EKError' }));
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getAllByLabelText('Kalendarz').at(-1)!);
    expect(screen.queryByTestId('device-calendar-card')).toBeNull();
  });
});
