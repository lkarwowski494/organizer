/** Miejsce, „Nawiguj” i „Wyjdź o” (D115–D117) na atrapie usługi dojazdu. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { TravelService } from '../travel-service';
import { RootStack } from '../navigation';
import { put, sampleBase, setup, setTime } from './harness';

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
    await waitFor(() => expect(screen.getByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy());
    expect(within(screen.getByTestId('today-event-kino-2026-10-07')).queryByText(/Wyjdź o/)).toBeNull();
    expect(s.account.reportError).toHaveBeenCalledTimes(1);
  });

  it('„Moje sprawy”: „Wyjdź o 16:30 · 25 min autem”; ekran wydarzenia: adres, nawigacja, zmiana środka tylko u mnie', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { travel, prefs } = await open();
    await waitFor(() => expect(screen.getByText(/Wyjdź o 16:30 · 25 min autem/)).toBeTruthy());
    expect(travel.geocode).toHaveBeenCalledWith('Basen Delfin, ul. Wodna 1');
    expect(travel.eta).toHaveBeenCalledWith({ lat: 50.06, lng: 19.94 }, { lat: 50.07, lng: 19.9 }, 'driving', expect.any(Number));
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    const box = await screen.findByTestId('travel-box');
    expect(within(box).getByText('Basen Delfin, ul. Wodna 1')).toBeTruthy();
    await press(within(box).getByTestId('navigate'));
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining('Basen%20Delfin%2C%20ul.%20Wodna%201'));
    await press(radio('Jak tam dotrę (tylko u mnie)', 'Pieszo'));
    await waitFor(() => expect(travel.eta).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'walking', expect.any(Number)));
    await press(within(box).getByTestId('navigate'));
    expect(openUrl).toHaveBeenLastCalledWith(expect.stringMatching(/mode=walking|dirflg=w/));
    await press(radio('Jak tam dotrę (tylko u mnie)', 'Autem'));
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
    await press(within(within(box).getByLabelText('Czas dojazdu do dzisiejszych wydarzeń')).getByLabelText('Włączony'));
    await flush();
    expect(travel.request).toHaveBeenCalled();
    expect(screen.getByText(/Brak dostępu do lokalizacji/)).toBeTruthy();
    expect(prefs.m.get('travelEnabled')).toBeUndefined();
    travel.request.mockResolvedValueOnce(true);
    await press(within(within(box).getByLabelText('Czas dojazdu do dzisiejszych wydarzeń')).getByLabelText('Włączony'));
    await flush();
    expect(prefs.m.get('travelEnabled')).toBe('1');
    await press(within(within(box).getByLabelText('Zwykle jadę')).getByLabelText('Komunikacją'));
    expect(prefs.m.get('travelMode')).toBe('transit');
    await press(within(within(box).getByLabelText('Nawiguj w')).getByLabelText('Google Maps'));
    expect(prefs.m.get('navApp')).toBe('google');
    await press(within(within(box).getByLabelText('Czas dojazdu do dzisiejszych wydarzeń')).getByLabelText('Wyłączony'));
    expect(prefs.m.get('travelEnabled')).toBe('0');
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
    expect(store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')).toMatchObject({ set: { title: 'Dentysta', location: 'Przychodnia, ul. Zdrowa 2' } });
  });
});
