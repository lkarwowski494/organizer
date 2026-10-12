/** Push o przekazaniach (D70): prośba o zgodę na „Moje sprawy”, rejestracja tokenu, prośba o powiadomienie. */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { RootStack } from '../navigation';
import { appStateEvents, fakeAccount, fakePush, put, sampleBase, setup } from './harness';

/** Przełącznik iOS w wierszu Ustawień (M-308, PWD-39 A). */
const toggle = async (el: ReturnType<typeof screen.getByLabelText>, on: boolean) => {
  expect(el.props.accessibilityRole).toBe('switch');
  await fireEvent(el, 'valueChange', on);
};

/** Ustawienia konta (D175) w pamięci; wprowadzenie i „Co nowego” obejrzane (nie zasłaniają „Moich spraw”). */
function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries({ welcomeSeen: '1', whatsNewBuild: String(Number.MAX_SAFE_INTEGER), ...initial }));
  return { m, get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}
const settingsOf = (prefs: ReturnType<typeof memoryPrefs>) => JSON.parse(prefs.m.get('reminderSettings')!);

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flush = () => act(async () => {});

async function open(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await flush();
  return s;
}

describe('prośba o powiadomienia', () => {
  it('„Włącz” pyta system i rejestruje token', async () => {
    const push = fakePush();
    const { account } = await open({ push });
    expect(screen.getByText('Przypomnienia i powiadomienia')).toBeTruthy();
    push.status.mockResolvedValue('granted');
    await press(screen.getByTestId('push-enable'));
    await flush();
    expect(push.request).toHaveBeenCalled();
    expect(account.registerPushToken).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });

  it('odmowa w oknie systemowym — bez rejestracji; „Nie teraz” zapamiętane', async () => {
    const push = fakePush({ request: jest.fn(async () => false) });
    const { account } = await open({ push });
    await press(screen.getByTestId('push-enable'));
    await flush();
    expect(account.registerPushToken).not.toHaveBeenCalled();
    const prefs = memoryPrefs();
    await open({ push: fakePush(), prefs });
    await press(screen.getAllByTestId('push-later').at(-1)!);
    expect(prefs.m.get('pushPromptDismissed')).toBe('1');
  });

  it('nie pyta: już zdecydowane, „Nie teraz” wcześniej, brak push; pyta też bez wspólnej grupy (przypomnienia)', async () => {
    await open({ push: fakePush({ status: jest.fn(async () => 'denied' as const) }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await open({ push: fakePush(), prefs: memoryPrefs({ pushPromptDismissed: '1' }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    const base = sampleBase();
    for (const g of ['gf', 'gk']) put(base, 'groups', g, { ...base.groups![g]!, deleted_at: 'x' });
    await open({ base, push: fakePush() });
    expect(screen.getAllByTestId('push-prompt').length).toBeGreaterThan(0);
    await open();
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });
});

describe('powiadomienie drugiej strony', () => {
  it('ze zgodą rejestruje token przy starcie; prosi o push dla mojego potwierdzonego przekazania raz', async () => {
    const base = sampleBase();
    const created = new Date(Date.UTC(2026, 9, 7, 7, 30)).toISOString();
    put(base, 'handoffs', 'h1', { id: 'h1', group_id: 'gf', entity: 'tasks', entity_id: 't-paczka', occurrence_date: null, from_member: 'mf', to_member: 'ala', status: 'pending', closed: false, created_at: created, push_sent_status: null, version: 1 });
    const account = fakeAccount({ notifyHandoff: jest.fn(async () => Promise.reject(new Error('offline'))) });
    const push = fakePush({ status: jest.fn(async () => 'granted' as const) });
    const { store } = await open({ base, account, push });
    expect(account.registerPushToken).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    expect(account.notifyHandoff).toHaveBeenCalledWith('h1');
    // Kolejna zmiana stanu nie powtarza prośby w tym uruchomieniu.
    await act(async () => store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kupić róże' } }));
    await flush();
    expect(account.notifyHandoff).toHaveBeenCalledTimes(1);
  });
});

describe('przypomnienia (D75)', () => {
  it('ze zgodą planuje przypomnienia z danych; ustawienia zmieniają plan i są zapamiętane', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const push = fakePush({ status: jest.fn(async () => 'granted' as const) });
      const prefs = memoryPrefs();
      await open({ push, prefs });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      const first = push.replaceReminders.mock.calls.at(-1)![0];
      // Odebrać paczkę dziś 18:00 → 17:30; Przynieść korki 17:30 → 17:00 (czas warszawski).
      expect(first.map((r) => [r.title, r.body])).toEqual(expect.arrayContaining([['Odebrać paczkę', '18:00 · Rodzina'], ['Przynieść korki na trening', '17:30 · Klasa 2b']]));
      await press(screen.getByLabelText('Ustawienia'));
      await press(await screen.findByTestId('settings-notifications'));
      await screen.findByTestId('screen-settings-notifications');
      await press(within(screen.getByLabelText('Przed sprawą z godziną')).getByLabelText(/^Wyłączone(,|$)/));
      expect(settingsOf(prefs)).toEqual({ leadMin: 0, morning: '08:00', leave: true });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      expect(push.replaceReminders.mock.calls.at(-1)![0].filter((r) => !r.id.startsWith('m|'))).toEqual([]);
      await press(screen.getByLabelText('09:00'));
      expect(settingsOf(prefs)).toEqual({ leadMin: 0, morning: '09:00', leave: true });
      // PWD-17 (decyzja właściciela): „Czas wyjść” osobno.
      await toggle(screen.getByLabelText('Czas wyjść'), false);
      expect(settingsOf(prefs)).toEqual({ leadMin: 0, morning: '09:00', leave: false });
      expect(screen.getByLabelText('Czas wyjść').props.value).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bez zgody nie planuje; zapamiętane ustawienia wczytane; bez push brak sekcji w Ustawieniach', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const push = fakePush();
      await open({ push, prefs: memoryPrefs({ reminderSettings: '{"leadMin":60,"morning":"off"}' }) });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      expect(push.replaceReminders).not.toHaveBeenCalled();
      await press(screen.getByLabelText('Ustawienia'));
      await press(await screen.findByTestId('settings-notifications'));
      await screen.findByTestId('screen-settings-notifications');
      expect(screen.getByLabelText('1 h').props.accessibilityState.selected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
    await open();
    await press(screen.getAllByLabelText('Ustawienia').at(-1)!);
    await press(await screen.findByTestId('settings-notifications'));
    expect(await screen.findByText('Powiadomienia nie są dostępne na tym urządzeniu.')).toBeTruthy();
    expect(screen.queryByText('Przed sprawą z godziną')).toBeNull();
  });
});

describe('przypisania (D81)', () => {
  it('moje przypisanie z serwera → prośba o powiadomienie, raz', async () => {
    const base = sampleBase();
    put(base, 'activity', 'a1', { id: 'a1', group_id: 'gf', entity: 'tasks', entity_id: 't-ala', actor_member_id: 'mf', changes: { assignee_member_id: [null, 'ala'] }, created_at: new Date(Date.UTC(2026, 9, 7, 7, 30)).toISOString(), version: 1 });
    const account = fakeAccount({ notifyAssignment: jest.fn(async () => Promise.reject(new Error('offline'))) });
    const { store } = await open({ base, account });
    expect(account.notifyAssignment).toHaveBeenCalledWith('a1');
    await act(async () => store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Róże' } }));
    await flush();
    expect(account.notifyAssignment).toHaveBeenCalledTimes(1);
  });

  it('Ustawienia: wyciszanie grup wspólnych; błąd zmiany cofa przełącznik', async () => {
    const account = fakeAccount({ getPushMutes: jest.fn(async () => ['gk']) });
    await open({ account, push: fakePush() });
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-notifications'));
    await screen.findByTestId('screen-settings-notifications');
    await flush();
    const box = screen.getByTestId('mute-settings');
    // PWD-18 (decyzja właściciela): sekcja mówi, czego dotyczy wyciszenie, a czego nie.
    expect(within(box).getByText('Powiadomienia o przypisaniach')).toBeTruthy();
    expect(within(box).getByText(/Przypomnienia i przekazania \(do przyjęcia\) przychodzą zawsze\.$/)).toBeTruthy();
    expect(within(box).getByLabelText('Klasa 2b').props.value).toBe(false);
    await toggle(within(box).getByLabelText('Rodzina'), false);
    expect(account.setPushMute).toHaveBeenLastCalledWith('gf', true);
    account.setPushMute.mockRejectedValueOnce(new Error('offline'));
    await toggle(within(box).getByLabelText('Klasa 2b'), true);
    await flush();
    expect(within(box).getByLabelText('Klasa 2b').props.value).toBe(false);
    expect(screen.getByText('Nie udało się zmienić ustawień — sprawdź internet.')).toBeTruthy();
  });

  it('bez internetu przy odczycie — komunikat; bez grup wspólnych — brak sekcji', async () => {
    await open({ account: fakeAccount({ getPushMutes: jest.fn(async () => Promise.reject(new Error('offline'))) }), push: fakePush() });
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-notifications'));
    await screen.findByTestId('screen-settings-notifications');
    await flush();
    expect(screen.getByText('Nie udało się zmienić ustawień — sprawdź internet.')).toBeTruthy();
    const base = sampleBase();
    for (const g of ['gf', 'gk']) put(base, 'groups', g, { ...base.groups![g]!, deleted_at: 'x' });
    await open({ base, push: fakePush() });
    await press(screen.getAllByLabelText('Ustawienia').at(-1)!);
    await press(await screen.findByTestId('settings-notifications'));
    await screen.findByTestId('screen-settings-notifications');
    await flush();
    expect(screen.queryByTestId('mute-settings')).toBeNull();
  });
});

let app: ReturnType<typeof appStateEvents>;
beforeEach(() => {
  app = appStateEvents();
});
afterEach(() => app.restore());
const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
async function openNotificationSettings() {
  await press(screen.getByLabelText('Ustawienia'));
  await press(await screen.findByTestId('settings-notifications'));
  await screen.findByTestId('screen-settings-notifications');
  await flush();
}

describe('zgoda na powiadomienia po „Nie teraz” i po odmowie (audyt 2: N-8, N-10, P-5)', () => {
  afterEach(() => jest.useRealTimers());

  it('„Nie teraz”, potem Ustawienia → Powiadomienia: „Włącz powiadomienia” pyta system, rejestruje token i od razu planuje', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const push = fakePush();
    const { account } = await open({ push, prefs: memoryPrefs({ pushPromptDismissed: '1' }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await openNotificationSettings();
    const box = screen.getByTestId('push-access');
    expect(within(box).getByText('Powiadomienia są wyłączone, więc nie przypomnimy o sprawach ani nie damy znać o przekazaniach.')).toBeTruthy();
    push.status.mockResolvedValue('granted');
    await press(within(box).getByRole('button', { name: 'Włącz powiadomienia' }));
    await flush();
    expect(push.request).toHaveBeenCalled();
    expect(account.registerPushToken).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    expect(screen.queryByTestId('push-access')).toBeNull();
    // Bez zmiany danych — plan po zgodzie.
    await tick(2000);
    await flush();
    expect(push.replaceReminders).toHaveBeenCalled();
  });

  it('odmowa wcześniej: „Otwórz Ustawienia iPhone’a”; zgoda włączona tam — po powrocie do aplikacji plan i token bez restartu', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValueOnce(undefined);
    const push = fakePush({ status: jest.fn(async () => 'denied' as const) });
    const { account } = await open({ push });
    await openNotificationSettings();
    const box = screen.getByTestId('push-access');
    expect(within(box).getByText('Powiadomienia są wyłączone. Włączysz je w Ustawieniach iPhone’a → Organizer → Powiadomienia.')).toBeTruthy();
    await press(within(box).getByRole('button', { name: 'Otwórz Ustawienia iPhone’a' }));
    expect(settings).toHaveBeenCalled();
    expect(push.request).not.toHaveBeenCalled();
    await tick(2000);
    expect(push.replaceReminders).not.toHaveBeenCalled();
    expect(account.registerPushToken).not.toHaveBeenCalled();
    // Użytkownik włącza powiadomienia w Ustawieniach iPhone'a i wraca.
    push.status.mockResolvedValue('granted');
    await app.background();
    await app.foreground();
    await flush();
    expect(screen.queryByTestId('push-access')).toBeNull();
    expect(account.registerPushToken).toHaveBeenCalledWith('ab'.repeat(32), 'production');
    await tick(2000);
    await flush();
    expect(push.replaceReminders).toHaveBeenCalled();
  });

  it('zgoda z karty na „Moich sprawach” planuje od razu, bez czekania na zmianę danych (N-10)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const push = fakePush();
    await open({ push });
    await tick(2000);
    expect(push.replaceReminders).not.toHaveBeenCalled();
    push.status.mockResolvedValue('granted');
    await press(screen.getByTestId('push-enable'));
    await flush();
    await tick(2000);
    await flush();
    expect(push.replaceReminders).toHaveBeenCalled();
  });

  it('błąd planowania zgłoszony raz na uruchomienie (N-7)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const push = fakePush({ status: jest.fn(async () => 'granted' as const), replaceReminders: jest.fn(async () => Promise.reject(new Error('timeInterval'))) });
    const { account, store } = await open({ push });
    await tick(2000);
    await flush();
    await act(async () => store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kupić róże' } }));
    await tick(2000);
    await flush();
    expect(push.replaceReminders).toHaveBeenCalledTimes(2);
    expect(account.reportError).toHaveBeenCalledTimes(1);
    expect(account.reportError.mock.calls[0]![0]).toMatchObject({ kind: 'error', screen: 'reminders' });
  });

  it('zgłoszenie błędu planowania bez treści komunikatu (audyt 3, N-77: komunikat może zawierać tytuł przypomnienia)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const push = fakePush({ status: jest.fn(async () => 'granted' as const), replaceReminders: jest.fn(async () => Promise.reject(new Error('Kupić róże: invalid trigger'))) });
    const { account } = await open({ push });
    await tick(2000);
    await flush();
    expect(account.reportError).toHaveBeenCalledTimes(1);
    const sent = account.reportError.mock.calls[0]![0];
    expect(sent.message).toBe('Error');
    expect(JSON.stringify(sent)).not.toContain('róże');
  });
});

describe('token i ponowienia (audyt 2: N-11, N-15, N-36)', () => {
  it('token zmieniony przez APNs w trakcie działania — od razu na serwer; po powrocie do aplikacji rejestracja jeszcze raz', async () => {
    const push = fakePush({ status: jest.fn(async () => 'granted' as const) });
    const { account } = await open({ push });
    expect(account.registerPushToken).toHaveBeenCalledTimes(1);
    const listener = (push.onToken as jest.Mock).mock.calls[0]![0] as (t: string) => void;
    await act(async () => listener('ef'.repeat(32)));
    expect(account.registerPushToken).toHaveBeenLastCalledWith('ef'.repeat(32), 'production');
    expect(push.token).toHaveBeenCalledTimes(1); // bez getDevicePushTokenAsync w nasłuchu
    await app.foreground();
    await flush();
    expect(account.registerPushToken).toHaveBeenCalledTimes(3);
  });

  it('nieudana prośba o powiadomienie: bez ponawiania przy każdej zmianie danych, ponowienie po powrocie do aplikacji', async () => {
    const base = sampleBase();
    put(base, 'handoffs', 'h1', { id: 'h1', group_id: 'gf', entity: 'tasks', entity_id: 't-paczka', occurrence_date: null, from_member: 'mf', to_member: 'ala', status: 'pending', closed: false, created_at: new Date(Date.UTC(2026, 9, 7, 7, 30)).toISOString(), push_sent_status: null, version: 1 });
    put(base, 'activity', 'a1', { id: 'a1', group_id: 'gf', entity: 'tasks', entity_id: 't-ala', actor_member_id: 'mf', changes: { assignee_member_id: [null, 'ala'] }, created_at: new Date(Date.UTC(2026, 9, 7, 7, 30)).toISOString(), version: 1 });
    const account = fakeAccount({ notifyHandoff: jest.fn(async () => Promise.reject(new Error('apns_failed'))), notifyAssignment: jest.fn(async () => {}) });
    const { store } = await open({ base, account });
    expect(account.notifyHandoff).toHaveBeenCalledTimes(1);
    await act(async () => store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kupić róże' } }));
    await flush();
    expect(account.notifyHandoff).toHaveBeenCalledTimes(1);
    await app.foreground();
    await flush();
    // Nieudane — jeszcze raz; udane (przypisanie) — nie.
    expect(account.notifyHandoff).toHaveBeenCalledTimes(2);
    expect(account.notifyAssignment).toHaveBeenCalledTimes(1);
  });
});

describe('dotknięcie powiadomienia otwiera sprawę (PWD-16, decyzja właściciela 8.10.2026)', () => {
  function opener() {
    let tap!: (path: string) => void;
    const push = fakePush({ onOpen: jest.fn((fn: (path: string) => void) => ((tap = fn), () => {})) });
    return { push, tap: (path: string) => act(async () => tap(path)) };
  }
  const withSeries = () => {
    const base = sampleBase();
    put(base, 'events', 'ev-basen', { id: 'ev-basen', group_id: 'gf', title: 'Basen', start_date: '2026-09-02', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
    return base;
  };

  it('zadanie, lista zakupów, termin wydarzenia, „Moje sprawy”', async () => {
    const { push, tap } = opener();
    await open({ push, base: withSeries() });
    await tap('task/t-paczka');
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    expect(screen.getByDisplayValue('Odebrać paczkę')).toBeTruthy();
    await tap('list/lz');
    expect(await screen.findByTestId('screen-list')).toBeTruthy();
    await tap('event/ev-basen/2026-10-14');
    expect(await screen.findByTestId('screen-event')).toBeTruthy();
    expect(screen.getByText(/^Środa, 14 października · 17:00–18:00/)).toBeTruthy();
    await tap('today');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('cała seria (bez dnia) — najbliższy termin od dziś; sprawy już nie ma — zwykły ekran „nie ma”', async () => {
    const { push, tap } = opener();
    await open({ push, base: withSeries() });
    await tap('event/ev-basen');
    expect(await screen.findByTestId('screen-event')).toBeTruthy();
    // Dziś środa 7.10 — dzisiejszy termin.
    expect(screen.getByText(/^Środa, 7 października · 17:00–18:00/)).toBeTruthy();
    await tap('task/nie-ma');
    expect(await screen.findByTestId('screen-task-missing')).toBeTruthy();
  });

  it('uruchomienie aplikacji z powiadomienia — od razu na sprawie', async () => {
    const push = fakePush({ onOpen: jest.fn((fn: (path: string) => void) => (fn('task/t-kwiaty'), () => {})) });
    const s = setup({ push });
    await s.renderApp(<RootStack />);
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    expect(screen.getByDisplayValue('Kupić kwiaty')).toBeTruthy();
  });
});
