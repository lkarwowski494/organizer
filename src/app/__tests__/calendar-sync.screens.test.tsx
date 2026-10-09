/** Kalendarz iPhone'a w obie strony (D95, D96): połączenie, moje wydarzenia w Kalendarzu i „Moich sprawach”, ustawienia. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { config } from '../../config';
import type { DeviceCalendarSync } from '../device-calendar';
import { RootStack } from '../navigation';
import { appStateEvents, put, sampleBase, setup } from './harness';

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
    updateCalendar: jest.fn(async () => {}),
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
    await waitFor(() => expect(sync.createEvent).toHaveBeenCalledWith('cal-1', expect.objectContaining({ title: 'Tańce', notes: 'Rodzina\n\nDodane przez aplikację Organizer' })));
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

  it('audyt 2 (N-21): zgoda włączona w Ustawieniach iPhone’a widoczna po powrocie do aplikacji, bez restartu', async () => {
    const app = appStateEvents();
    try {
      const sync = fakeSync({ status: jest.fn(async () => 'denied' as const) });
      await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarMirror: '1', calendarAsked: '1' }));
      await press(screen.getByLabelText('Ustawienia'));
      await press(await screen.findByTestId('settings-calendar'));
      await flush();
      expect(screen.queryByTestId('device-settings')).toBeNull();
      sync.status.mockResolvedValue('granted');
      await app.foreground();
      expect(await screen.findByTestId('device-settings')).toBeTruthy();
      expect(sync.listEvents).toHaveBeenCalled();
    } finally {
      app.restore();
    }
  });

  it('lista z przerwami (D122): moje wydarzenie z iPhone’a według godziny, przerwy wokół niego', async () => {
    await open(fakeSync({ status: jest.fn(async () => 'granted' as const) }), memoryPrefs({ welcomeSeen: '1', calendarRead: '1' }));
    await screen.findByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca');
    // teraz 10:00; Dentysta 16:00–17:00, korki 17:30, paczka 18:00.
    expect(screen.getAllByTestId(/^(today-gap|device-d|today-t-(korki|paczka))/).map((e) => e.props.testID)).toEqual(['today-gap-600-960', 'device-d|x1', 'today-gap-1020-1050', 'today-t-korki', 'today-gap-1050-1080', 'today-t-paczka']);
  });

  it('Ustawienia: wyłączenie odczytu chowa wydarzenia; wyłączenie lustra usuwa kalendarze grup', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    const { prefs, services } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarMirror: '1' }));
    services.local?.save('calendarMirror', JSON.stringify({ calendars: { gf: 'cal-9' }, events: {} }));
    expect(await screen.findByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca')).toBeTruthy();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const box = await screen.findByTestId('device-settings');
    await press(within(within(box).getByLabelText('Moje wydarzenia z iPhone’a w aplikacji')).getByLabelText(/^Wyłączone(,|$)/));
    expect(prefs.m.get('calendarRead')).toBe('0');
    await press(within(within(box).getByLabelText('Wydarzenia grup w kalendarzu iPhone’a')).getByLabelText(/^Wyłączone(,|$)/));
    await flush();
    expect(prefs.m.get('calendarMirror')).toBe('0');
    expect(sync.deleteCalendar).toHaveBeenCalledWith('cal-9');
    await press(within(within(box).getByLabelText('Moje wydarzenia z iPhone’a w aplikacji')).getByLabelText(/^Włączone(,|$)/));
    expect(prefs.m.get('calendarRead')).toBe('1');
  });

  it('dubel wpisu z aplikacji ukryty (D173) z licznikiem i podglądem; wybór kalendarzy w Ustawieniach (D106)', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const), listEvents: jest.fn(async () => [mine, { ...mine, id: 'x2', calendarId: 'home', calendarTitle: 'Dom', title: 'Szkoła', startMs: Date.UTC(2026, 9, 7, 6), endMs: Date.UTC(2026, 9, 7, 7) }]) });
    const base = sampleBase();
    put(base, 'tasks', 'dent', { ...base.tasks!['t-books']!, id: 'dent', title: 'dentysta!', deadline_mode: 'own', due_date: '2026-10-07', due_time: '16:15:00' });
    const prefs = memoryPrefs({ welcomeSeen: '1', calendarRead: '1' });
    const s = setup({ base, prefs, calendar: { add: jest.fn(async () => 'saved' as const), sync } });
    await s.renderApp(<RootStack />);
    await flush();
    expect(await screen.findByLabelText(/^Szkoła, 08:00–09:00/)).toBeTruthy();
    expect(screen.queryByTestId('device-d|x1')).toBeNull();
    // Audyt 2 (M-105): nic nie znika bez śladu — „Ukryto 1 dubel” i podgląd po dotknięciu (bez „Dodaj do grupy”).
    const hidden = screen.getByTestId('today-hidden-2026-10-07');
    expect(hidden.props.accessibilityLabel).toBe('Ukryto 1 dubel z iPhone’a, dotknij, by zobaczyć');
    await press(hidden);
    expect(within(screen.getByTestId('today-hidden-2026-10-07-list')).getByLabelText('Dentysta, 16:00–17:00, Kalendarz: Praca')).toBeTruthy();
    expect(screen.queryByTestId('device-copy-d|x1')).toBeNull();
    expect(screen.getByTestId('today-hidden-2026-10-07').props.accessibilityState).toMatchObject({ expanded: true });
    await press(screen.getByTestId('today-hidden-2026-10-07'));
    expect(screen.queryByTestId('today-hidden-2026-10-07-list')).toBeNull();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const box = await screen.findByTestId('device-calendars');
    expect(within(box).getByLabelText('Praca')).toBeTruthy();
    await press(within(within(box).getByLabelText('Dom')).getByLabelText(/^Wyłączone(,|$)/));
    expect(JSON.parse(prefs.m.get('calendarSkip')!)).toEqual(['home']);
    expect(within(within(box).getByLabelText('Dom')).getByLabelText(/^Wyłączone(,|$)/).props.accessibilityState.selected).toBe(true);
    await press(within(within(box).getByLabelText('Dom')).getByLabelText(/^Włączone(,|$)/));
    expect(JSON.parse(prefs.m.get('calendarSkip')!)).toEqual([]);
    await press(within(within(box).getByLabelText('Dom')).getByLabelText(/^Wyłączone(,|$)/));
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-settings');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-today');
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
    expect(account.reportError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'calendar-read', message: 'Error' }));
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getAllByLabelText('Kalendarz').at(-1)!);
    expect(screen.queryByTestId('device-calendar-card')).toBeNull();
  });

  it('audyt 2 (M-33): po „Nie teraz” Ustawienia → Kalendarz i dojazd mają „Połącz z kalendarzem”; odmowa — „Otwórz Ustawienia iPhone’a”', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const sync = fakeSync();
    const { prefs } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarAsked: '1' }));
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const access = await screen.findByTestId('device-access');
    expect(within(access).getByText(/Twoje wydarzenia zostają na telefonie/)).toBeTruthy();
    await press(within(access).getByTestId('settings-calendar-connect'));
    await flush();
    expect(sync.request).toHaveBeenCalled();
    expect(prefs.m.get('calendarMirror')).toBe('1');
    expect(screen.queryByTestId('device-access')).toBeNull();
    expect(screen.getByTestId('device-settings')).toBeTruthy();

    await open(fakeSync({ status: jest.fn(async () => 'denied' as const) }), memoryPrefs({ welcomeSeen: '1', calendarAsked: '1' }));
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    expect(within(await screen.findByTestId('device-access')).getByText(/Brak dostępu do kalendarza/)).toBeTruthy();
    await press(screen.getByTestId('settings-calendar-open'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('audyt 2 (M-217): zgoda tylko na dodawanie — karta proponuje „Połącz”; odmowa w oknie iOS — wskazówka i Ustawienia iPhone’a', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const sync = fakeSync({ status: jest.fn(async () => 'writeOnly' as const), request: jest.fn(async () => false) });
    await open(sync);
    await press(screen.getByLabelText('Kalendarz'));
    const card = await screen.findByTestId('device-calendar-card');
    expect(within(card).getByText(/może teraz tylko dodawać wydarzenia/)).toBeTruthy();
    await press(within(card).getByTestId('device-connect'));
    await flush();
    expect(sync.request).toHaveBeenCalled();
    expect(within(card).getByText(/Brak dostępu do kalendarza/)).toBeTruthy();
    await press(within(card).getByTestId('device-open-settings'));
    expect(openSettings).toHaveBeenCalled();
  });

  it('D174: wybór grup w lustrze (w bazie konta); wyłączona grupa — jej kalendarz znika', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    const { services } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1', calendarMirror: '1' }));
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const box = await screen.findByTestId('device-mirror-groups');
    expect(within(box).getByLabelText('Osobiste')).toBeTruthy();
    await press(within(within(box).getByLabelText('Klasa 2b')).getByLabelText(/^Wyłączone(,|$)/));
    expect(JSON.parse(services.local!.load('calendarMirrorSkip')!)).toEqual(['gk']);
    await press(within(within(box).getByLabelText('Klasa 2b')).getByLabelText(/^Włączone(,|$)/));
    expect(JSON.parse(services.local!.load('calendarMirrorSkip')!)).toEqual([]);
    services.local!.save('calendarMirror', JSON.stringify({ calendars: { gf: 'cal-9' }, events: {} }));
    await press(within(within(box).getByLabelText('Rodzina')).getByLabelText(/^Wyłączone(,|$)/));
    await waitFor(() => expect(sync.deleteCalendar).toHaveBeenCalledWith('cal-9'), { timeout: config.calendar.MIRROR_DEBOUNCE_MS + 3000 });
  }, 15000);

  it('PWD-2 (M-174): przy włączonym lustrze ekran wydarzenia mówi, w którym kalendarzu iPhone’a jest wydarzenie', async () => {
    const add = jest.fn(async () => 'saved' as const);
    const base = sampleBase();
    put(base, 'events', 'ev1', { id: 'ev1', group_id: 'gf', title: 'Tańce', start_date: '2026-10-09', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, location: 'Długa 5', deleted_at: null, version: 1 });
    const s = setup({ base, prefs: memoryPrefs({ welcomeSeen: '1', calendarMirror: '1' }), calendar: { add, sync: fakeSync({ status: jest.fn(async () => 'granted' as const) }) } });
    await s.renderApp(<RootStack />);
    await flush();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('day-2026-10-09'));
    await press(screen.getByTestId('cal-event-ev1-2026-10-09'));
    expect(await screen.findByText('Jest w kalendarzu iPhone’a „Organizer – Rodzina”.')).toBeTruthy();
    expect(screen.queryByTestId('event-calendar')).toBeNull();
  });

  it('bez lustra „Dodaj do kalendarza” zapisuje kopię ze znacznikiem Organizera i miejscem (D173)', async () => {
    const add = jest.fn(async () => 'saved' as const);
    const base = sampleBase();
    put(base, 'events', 'ev1', { id: 'ev1', group_id: 'gf', title: 'Tańce', start_date: '2026-10-09', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, location: 'Długa 5', deleted_at: null, version: 1 });
    const s = setup({ base, prefs: memoryPrefs({ welcomeSeen: '1' }), calendar: { add } });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('day-2026-10-09'));
    await press(screen.getByTestId('cal-event-ev1-2026-10-09'));
    await press(await screen.findByTestId('event-calendar'));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tańce', notes: 'Rodzina\n\nDodane przez aplikację Organizer', location: 'Długa 5' }));
  });

  it('PWD-33 (D200): „Dodaj do grupy” — formularz z nazwą, dniem, godzinami i miejscem; po zapisie oryginał ukryty jako dubel', async () => {
    const withPlace = { ...mine, location: 'Przychodnia, ul. Zdrowa 2' };
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const), listEvents: jest.fn(async () => [withPlace, { ...mine, id: 'all', title: 'Urlop', allDay: true as const, startDate: '2026-10-07', endDate: '2026-10-08' } as never]) });
    const { store } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1' }));
    await press(await screen.findByTestId('device-copy-d|x1'));
    expect(await screen.findByText(/Kopia wydarzenia z kalendarza iPhone’a/)).toBeTruthy();
    expect(screen.getByTestId('event-title').props.value).toBe('Dentysta');
    expect(screen.getByTestId('event-location').props.value).toBe('Przychodnia, ul. Zdrowa 2');
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await press(screen.getByTestId('event-save'));
    expect(store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')).toMatchObject({ group_id: 'gf', set: { title: 'Dentysta', start_date: '2026-10-07', start_time: '16:00', end_time: '17:00', location: 'Przychodnia, ul. Zdrowa 2' } });
    await screen.findByTestId('screen-today');
    expect(screen.queryByTestId('device-d|x1')).toBeNull();
    expect(screen.getByTestId('today-hidden-2026-10-07')).toBeTruthy();
    // Całodniowe: formularz „Cały dzień”.
    await press(screen.getByTestId('device-copy-d|all'));
    expect(within(await screen.findByLabelText('Pora')).getByLabelText('Cały dzień').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('audyt 2 (M-220): zmiana danych w trakcie przebiegu lustra — po nim drugi przebieg z nowymi danymi', async () => {
    let release: () => void = () => {};
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const) });
    sync.createEvent.mockImplementationOnce(() => new Promise<string>((r) => (release = () => r('ev-1'))));
    const { store } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarMirror: '1' }));
    await waitFor(() => expect(sync.createEvent).toHaveBeenCalledTimes(1), { timeout: config.calendar.MIRROR_DEBOUNCE_MS + 3000 });
    store.pull((b) => ({ ...b, events: { ...b.events, ev1: { ...b.events!.ev1!, title: 'Tańce towarzyskie' } } }));
    await act(async () => new Promise((r) => setTimeout(r, config.calendar.MIRROR_DEBOUNCE_MS + 200)));
    await act(async () => release());
    await waitFor(() => expect(sync.updateEvent).toHaveBeenCalledWith('ev-1', expect.objectContaining({ title: 'Tańce towarzyskie' })), { timeout: 3000 });
  }, 20000);
});

describe('D199: wielodniowe z iPhone’a — numer dnia zamiast „cd.” (audyt 2, M-253) i kopia do grupy', () => {
  const camp = { ...mine, id: 'camp', title: 'Urlop', allDay: true as const, startDate: '2026-10-07', endDate: '2026-10-10' } as never;
  // 22:00–06:00 w Warszawie (UTC+2).
  const night = { ...mine, id: 'night', title: 'Dyżur', startMs: Date.UTC(2026, 9, 7, 20, 0), endMs: Date.UTC(2026, 9, 8, 4, 0) };

  it('każdy dzień z numerem, kolejny dzień nocnego „do 06:00”; „Dodaj do grupy” z ostatnim dniem i końcem następnego dnia', async () => {
    const sync = fakeSync({ status: jest.fn(async () => 'granted' as const), listEvents: jest.fn(async () => [camp, night]) });
    const { store } = await open(sync, memoryPrefs({ welcomeSeen: '1', calendarRead: '1' }));
    expect(await screen.findByLabelText('Urlop, cały dzień, dzień 1 z 3, Kalendarz: Praca')).toBeTruthy();
    expect(screen.getByLabelText('Dyżur, 22:00–06:00, dzień 1 z 2, Kalendarz: Praca')).toBeTruthy();
    await press(screen.getByLabelText('Następny dzień'));
    expect(await screen.findByLabelText('Urlop, cały dzień, dzień 2 z 3, Kalendarz: Praca')).toBeTruthy();
    expect(screen.getByLabelText('Dyżur, do 06:00, dzień 2 z 2, Kalendarz: Praca')).toBeTruthy();
    // Kolejne dni nie mają „Dodaj do grupy” (kopiuje się całe wydarzenie z pierwszego dnia).
    expect(screen.queryByTestId('device-copy-d|camp')).toBeNull();
    await press(screen.getByLabelText('Poprzedni dzień'));
    await press(await screen.findByTestId('device-copy-d|camp'));
    expect((await screen.findByTestId('event-end-date')).props.accessibilityValue).toEqual({ text: '2026-10-09' });
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await press(screen.getByTestId('event-save'));
    expect(store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')).toMatchObject({ set: { title: 'Urlop', start_date: '2026-10-07', start_time: null, days: 3 } });
    await screen.findByTestId('screen-today');
    // Oryginał z iPhone'a jest teraz dublem w każdym dniu (także kolejnym).
    await press(screen.getByLabelText('Następny dzień'));
    expect(await screen.findByTestId('today-hidden-2026-10-08')).toBeTruthy();
    expect(screen.queryByLabelText('Urlop, cały dzień, dzień 2 z 3, Kalendarz: Praca')).toBeNull();
    await press(screen.getByLabelText('Poprzedni dzień'));
    await press(await screen.findByTestId('device-copy-d|night'));
    expect(await screen.findByText('Kończy się następnego dnia.')).toBeTruthy();
  });
});
