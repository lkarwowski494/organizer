/** Miejsce, „Nawiguj” i „Wyjdź o” (D115–D117) na atrapie usługi dojazdu. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { TravelService } from '../travel-service';
import { RootStack } from '../navigation';
import { expectOps, appStateEvents, put, sampleBase, setTime, setup } from './harness';

/** Przełącznik iOS w wierszu Ustawień (M-308, PWD-39 A). */
const toggle = async (el: ReturnType<typeof screen.getByLabelText>, on: boolean) => {
  expect(el.props.accessibilityRole).toBe('switch');
  await fireEvent(el, 'valueChange', on);
};

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}
function fakeTravel(over: Partial<TravelService> = {}): jest.Mocked<TravelService> {
  return {
    status: jest.fn(async () => 'granted' as const),
    request: jest.fn(async () => true),
    position: jest.fn(async () => ({ lat: 50.06, lng: 19.94 })),
    geocode: jest.fn(async () => ({ lat: 50.07, lng: 19.9 })),
    eta: jest.fn(async () => 25 * 60),
    ...over,
  } as jest.Mocked<TravelService>;
}
// Harness: dziś 7.10.2026, 10:00 w Warszawie.
function base() {
  const b = sampleBase();
  put(b, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, location: 'Basen Delfin, ul. Wodna 1', deleted_at: null, version: 1 });
  return b;
}
async function open(travel = fakeTravel(), prefs = memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' })) {
  const s = setup({ base: base(), prefs, travel });
  await s.renderApp(<RootStack />);
  await flush();
  return { ...s, prefs, travel };
}

describe('dojazd (D115–D117)', () => {
  it('audyt 8.10.2026: błąd jednego wydarzenia nie kasuje „Wyjdź o” pozostałych; zgłoszony raz', async () => {
    const b = base();
    put(b, 'events', 'kino', { ...b.events!.basen!, id: 'kino', title: 'Kino', start_time: '19:00:00', end_time: '21:00:00', location: 'Kino Pod Baranami' });
    const travel = fakeTravel({ geocode: jest.fn(async (q: string) => (q.startsWith('Kino') ? Promise.reject(new Error('MKError')) : { lat: 50.07, lng: 19.9 })) });
    const s = setup({ base: b, prefs: memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' }), travel });
    await s.renderApp(<RootStack />);
    await flush();
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    expect(within(screen.getByTestId('today-event-kino-2026-10-07')).queryByText(/Wyjdź o/)).toBeNull();
    expect(s.account.reportError).toHaveBeenCalledTimes(1);
  });

  it('„Moje sprawy”: „Wyjdź o 16:30 · 25 min autem”; ekran wydarzenia: adres, nawigacja, zmiana środka tylko u mnie', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { travel, prefs } = await open();
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    expect(travel.geocode).toHaveBeenCalledWith('Basen Delfin, ul. Wodna 1');
    expect(travel.eta).toHaveBeenCalledWith({ lat: 50.06, lng: 19.94 }, { lat: 50.07, lng: 19.9 }, 'driving', expect.any(Number));
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    const box = await screen.findByTestId('travel-box');
    expect(within(box).getByText('Basen Delfin, ul. Wodna 1')).toBeTruthy();
    await press(within(box).getByTestId('navigate'));
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining('Basen%20Delfin%2C%20ul.%20Wodna%201'));
    await press(radio('Twój dojazd (widzisz tylko Ty)', 'Pieszo'));
    await waitFor(() => expect(travel.eta).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'walking', expect.any(Number)));
    await press(within(box).getByTestId('navigate'));
    expect(openUrl).toHaveBeenLastCalledWith(expect.stringMatching(/mode=walking|dirflg=w/));
    await press(radio('Twój dojazd (widzisz tylko Ty)', 'Autem'));
    // Adres zapamiętany — bez drugiego geokodowania.
    expect(travel.geocode).toHaveBeenCalledTimes(1);
    expect(prefs.m.get('travelMode')).toBeUndefined();
  });

  it('Ustawienia: włączenie prosi o zgodę; odmowa — wskazówka; środek domyślny i aplikacja nawigacji', async () => {
    const travel = fakeTravel({ status: jest.fn(async () => 'undetermined' as const), request: jest.fn(async () => false) });
    const { prefs } = await open(travel, memoryPrefs({ welcomeSeen: '1' }));
    expect(screen.queryByText(/Wyjdź o/)).toBeNull();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const box = await screen.findByTestId('travel-settings');
    await toggle(within(box).getByLabelText('Czas dojazdu do najbliższych wydarzeń'), true);
    await flush();
    expect(travel.request).toHaveBeenCalled();
    expect(screen.getByText(/Brak dostępu do lokalizacji/)).toBeTruthy();
    expect(prefs.m.get('travelEnabled')).toBeUndefined();
    travel.request.mockResolvedValueOnce(true);
    await toggle(within(box).getByLabelText('Czas dojazdu do najbliższych wydarzeń'), true);
    await flush();
    expect(prefs.m.get('travelEnabled')).toBe('1');
    await press(within(within(box).getByLabelText('Domyślny dojazd')).getByLabelText('Komunikacją'));
    expect(prefs.m.get('travelMode')).toBe('transit');
    await press(within(within(box).getByLabelText('Nawiguj w')).getByLabelText('Google Maps'));
    expect(prefs.m.get('navApp')).toBe('google');
    await toggle(within(box).getByLabelText('Czas dojazdu do najbliższych wydarzeń'), false);
    expect(prefs.m.get('travelEnabled')).toBe('0');
  });

  it('PW-23 (decyzja właściciela): moje „Nie będę” — bez „Wyjdź o” i bez liczenia dojazdu; zmiana zdania przywraca', async () => {
    const { store, travel } = await open();
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    const calls = travel.eta.mock.calls.length;
    const rsvp = { id: 'r-basen', group_id: 'gf', event_id: 'basen', occurrence_date: '2026-10-07', member_id: 'mf', answer: 'no', deleted_at: null, version: 1 };
    await act(async () => store.pull((b) => ({ ...b, event_rsvps: { 'r-basen': rsvp } })));
    await waitFor(() => expect(screen.queryByText(/Wyjdź o/)).toBeNull());
    expect(screen.getByLabelText(/^Basen, 17:00–18:00/)).toBeTruthy(); // wiersz zostaje (D129)
    expect(travel.eta.mock.calls.length).toBe(calls);
    await act(async () => store.pull((b) => ({ ...b, event_rsvps: { 'r-basen': { ...rsvp, answer: 'yes' } } })));
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
  });

  it('D160 (koordynator): wydarzenie tylko przez dziecko, dziecko „nie będzie” — bez „Wyjdź o” i bez liczenia dojazdu', async () => {
    const b = base();
    b.events!.basen = { ...b.events!.basen!, audience: 'members' };
    put(b, 'event_participants', 'p-tymek', { id: 'p-tymek', event_id: 'basen', member_id: 'tymek', deleted_at: null, version: 1 });
    const travel = fakeTravel();
    const s = setup({ base: b, prefs: memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' }), travel });
    await s.renderApp(<RootStack />);
    await flush();
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    const calls = travel.eta.mock.calls.length;
    await act(async () => s.store.pull((x) => ({ ...x, event_rsvps: { r: { id: 'r', group_id: 'gf', event_id: 'basen', occurrence_date: '2026-10-07', member_id: 'tymek', answer: 'no', deleted_at: null, version: 1 } } })));
    await waitFor(() => expect(screen.queryByText(/Wyjdź o/)).toBeNull());
    expect(travel.eta.mock.calls.length).toBe(calls);
  });

  it('D159: ostatni wynik dojazdu zapisany na telefonie — z niego „Czas wyjść” w tle (to samo miejsce i środek)', async () => {
    const { services } = await open();
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    expect(JSON.parse(services.local!.load('travelResults')!)).toEqual({ 'basen|2026-10-07': { seconds: 25 * 60, mode: 'driving', location: 'Basen Delfin, ul. Wodna 1' } });
  });

  it('audyt 2 (N-21): zgoda na lokalizację włączona w Ustawieniach iPhone’a — po powrocie do aplikacji dojazd się liczy', async () => {
    const app = appStateEvents();
    try {
      const travel = fakeTravel({ status: jest.fn(async () => 'denied' as const) });
      await open(travel);
      expect(screen.queryByText(/Wyjdź o/)).toBeNull();
      expect(travel.position).not.toHaveBeenCalled();
      travel.status.mockResolvedValue('granted');
      await app.foreground();
      await flush();
      expect(travel.position).toHaveBeenCalled();
      expect(await screen.findByText(/Wyjdź o/)).toBeTruthy();
    } finally {
      app.restore();
    }
  });

  it('zapisane ustawienia wczytane; Google Maps; nieznany adres — bez czasu; błąd — zgłoszony raz', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const travel = fakeTravel({ geocode: jest.fn(async () => null) });
    await open(travel, memoryPrefs({ welcomeSeen: '1', travelEnabled: '1', travelMode: 'transit', navApp: 'google' }));
    await flush();
    expect(screen.queryByText(/Wyjdź o/)).toBeNull();
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    await press(await screen.findByTestId('navigate'));
    expect(openUrl).toHaveBeenLastCalledWith('https://www.google.com/maps/dir/?api=1&destination=Basen%20Delfin%2C%20ul.%20Wodna%201&travelmode=transit');
    const broken = fakeTravel({ position: jest.fn(async () => Promise.reject(new Error('kCLErrorDomain'))) });
    const s = await open(broken);
    await flush();
    expect(s.account.reportError).toHaveBeenCalledTimes(1);
    expect(s.account.reportError).toHaveBeenCalledWith(expect.objectContaining({ screen: 'travel' }));
  });

  it('formularz: miejsce zapisane z wydarzeniem', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await fireEvent.changeText(await screen.findByTestId('event-title'), 'Dentysta');
    await setTime('event-start-0', '15:00');
    await fireEvent.changeText(screen.getByTestId('event-location'), ' Przychodnia, ul. Zdrowa 2 ');
    await press(screen.getByTestId('event-save'));
    expectOps(store, [{ kind: 'create', entity: 'events', id: 'new-1', group_id: 'u-me', set: { title: 'Dentysta', start_date: '2026-10-07', start_time: '15:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, location: 'Przychodnia, ul. Zdrowa 2' } }]);
  });

  it('audyt 2 (M-106): odjazd o porze wyjścia, nie „teraz”; nieznany adres — komunikat, zapamiętany z datą', async () => {
    const travel = fakeTravel();
    const { services } = await open(travel);
    expect(await screen.findByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy();
    // Pierwsze pytanie — teraz (10:00), drugie — o porze wyjścia z pierwszego wyniku (17:00 − 25 min − zapas = 16:30).
    expect(travel.eta.mock.calls.map((c) => c[3])).toEqual([Date.UTC(2026, 9, 7, 8, 0), Date.UTC(2026, 9, 7, 14, 30)]);
    const geo = JSON.parse(services.local!.load('travelGeo')!);
    expect(geo['Basen Delfin, ul. Wodna 1']).toEqual({ c: { lat: 50.07, lng: 19.9 }, at: Date.UTC(2026, 9, 7, 8, 0) });

    const lost = fakeTravel({ geocode: jest.fn(async () => null) });
    const s = await open(lost);
    await flush();
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    expect(within(await screen.findByTestId('travel-box')).getByText(/Nie znaleźliśmy tego adresu w Mapach/)).toBeTruthy();
    expect(JSON.parse(s.services.local!.load('travelGeo')!)['Basen Delfin, ul. Wodna 1']).toEqual({ c: null, at: Date.UTC(2026, 9, 7, 8, 0) });
  });

  it('audyt 2 (M-211): wieczorem wydarzenie po północy też ma „Wyjdź o”', async () => {
    const b = base();
    put(b, 'events', 'noc', { ...b.events!.basen!, id: 'noc', title: 'Lotnisko', start_date: '2026-10-08', start_time: '00:30:00', end_time: null, location: 'Balice' });
    const travel = fakeTravel();
    const s = setup({ base: b, prefs: memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' }), travel });
    // 23:00 w Warszawie: Lotnisko jutro o 0:30 mieści się w oknie AHEAD_HOURS.
    s.services.nowMs = () => Date.UTC(2026, 9, 7, 21, 0);
    s.services.now = () => ({ y: 2026, m: 10, d: 7, hh: 23, mm: 0 });
    await s.renderApp(<RootStack />);
    await flush();
    await waitFor(() => expect(travel.geocode).toHaveBeenCalledWith('Balice'));
    expect(travel.geocode).not.toHaveBeenCalledWith('Basen Delfin, ul. Wodna 1'); // dzisiejszy basen już minął
  });

  it('PWD-3 (M-175): wyłączony dojazd — „Pokaż, kiedy wyjść →” włącza go i pyta o zgodę; M-218: wygasła zgoda — „Zezwól”', async () => {
    const travel = fakeTravel({ status: jest.fn(async () => 'undetermined' as const) });
    const { prefs } = await open(travel, memoryPrefs({ welcomeSeen: '1' }));
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    const box = await screen.findByTestId('travel-box');
    await press(within(box).getByTestId('travel-suggest'));
    await flush();
    expect(travel.request).toHaveBeenCalledTimes(1);
    expect(prefs.m.get('travelEnabled')).toBe('1');
    expect(within(box).queryByTestId('travel-suggest')).toBeNull();
    await waitFor(() => expect(within(box).getByText(/Wyjdź o 16:30/)).toBeTruthy());

    // „Pozwól raz” wygasło: przy następnym uruchomieniu dojazd jest włączony, a zgody nie ma.
    const once = fakeTravel({ status: jest.fn(async () => 'undetermined' as const), request: jest.fn(async () => false) });
    await open(once, memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' }));
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    const box2 = await screen.findByTestId('travel-box');
    expect(within(box2).getByText('Czas dojazdu jest włączony, ale potrzebuje zgody na lokalizację.')).toBeTruthy();
    once.status.mockResolvedValue('denied');
    await press(within(box2).getByTestId('travel-allow'));
    await flush();
    expect(once.request).toHaveBeenCalled();
    expect(within(box2).getByText(/Brak dostępu do lokalizacji/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    expect(screen.queryByTestId('travel-permission')).toBeNull(); // odmowa — tylko wskazówka do Ustawień iPhone'a
  });

  it('M-218 w Ustawieniach: włączony dojazd bez zgody — „Zezwól na lokalizację”; wydarzenie minione — bez podpowiedzi', async () => {
    const travel = fakeTravel({ status: jest.fn(async () => 'undetermined' as const) });
    await open(travel, memoryPrefs({ welcomeSeen: '1', travelEnabled: '1' }));
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    await press(await screen.findByTestId('settings-travel-allow'));
    await flush();
    expect(screen.queryByTestId('travel-permission')).toBeNull();
    expect(travel.request).toHaveBeenCalledTimes(1);
  });
});
