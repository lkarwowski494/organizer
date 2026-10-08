/** Push o przekazaniach (D70): prośba o zgodę na „Moje sprawy”, rejestracja tokenu, prośba o powiadomienie. */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { fakeAccount, fakePush, put, sampleBase, setup } from './harness';

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
    const p2 = fakePush();
    await open({ push: p2 });
    await press(screen.getAllByTestId('push-later').at(-1)!);
    expect(p2.dismiss).toHaveBeenCalled();
  });

  it('nie pyta: już zdecydowane, „Nie teraz” wcześniej, brak push; pyta też bez wspólnej grupy (przypomnienia)', async () => {
    await open({ push: fakePush({ status: jest.fn(async () => 'denied' as const) }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await open({ push: fakePush({ dismissed: jest.fn(async () => true) }) });
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
    store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kupić róże' } });
    await flush();
    expect(account.notifyHandoff).toHaveBeenCalledTimes(1);
  });
});

describe('przypomnienia (D75)', () => {
  it('ze zgodą planuje przypomnienia z danych; ustawienia zmieniają plan i są zapamiętane', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const push = fakePush({ status: jest.fn(async () => 'granted' as const) });
      await open({ push });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      const first = push.replaceReminders.mock.calls.at(-1)![0];
      // Odebrać paczkę dziś 18:00 → 17:30; Przynieść korki 17:30 → 17:00 (czas warszawski).
      expect(first.map((r) => [r.title, r.body])).toEqual(expect.arrayContaining([['Odebrać paczkę', '18:00 · Rodzina'], ['Przynieść korki na trening', '17:30 · Klasa 2b']]));
      await press(screen.getByLabelText('Ustawienia'));
      await screen.findByTestId('screen-settings');
      await press(within(screen.getByLabelText('Przed sprawą z godziną')).getByLabelText('Wyłączone'));
      expect(push.saveReminderSettings).toHaveBeenLastCalledWith({ leadMin: 0, morning: '08:00' });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      expect(push.replaceReminders.mock.calls.at(-1)![0].filter((r) => !r.id.startsWith('m|'))).toEqual([]);
      await press(screen.getByLabelText('9:00'));
      expect(push.saveReminderSettings).toHaveBeenLastCalledWith({ leadMin: 0, morning: '09:00' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('bez zgody nie planuje; zapamiętane ustawienia wczytane; bez push brak sekcji w Ustawieniach', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const push = fakePush({ reminderSettings: jest.fn(async () => ({ leadMin: 60, morning: 'off' })) });
      await open({ push });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      await flush();
      expect(push.replaceReminders).not.toHaveBeenCalled();
      await press(screen.getByLabelText('Ustawienia'));
      await screen.findByTestId('screen-settings');
      expect(screen.getByLabelText('1 godz.').props.accessibilityState.selected).toBe(true);
    } finally {
      jest.useRealTimers();
    }
    await open();
    await press(screen.getAllByLabelText('Ustawienia').at(-1)!);
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
    store.dispatch({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Róże' } });
    await flush();
    expect(account.notifyAssignment).toHaveBeenCalledTimes(1);
  });

  it('Ustawienia: wyciszanie grup wspólnych; błąd zmiany cofa przełącznik', async () => {
    const account = fakeAccount({ getPushMutes: jest.fn(async () => ['gk']) });
    await open({ account, push: fakePush() });
    await press(screen.getByLabelText('Ustawienia'));
    await screen.findByTestId('screen-settings');
    await flush();
    const box = screen.getByTestId('mute-settings');
    expect(within(within(box).getByLabelText('Klasa 2b')).getByLabelText('Wyciszone').props.accessibilityState.selected).toBe(true);
    await press(within(within(box).getByLabelText('Rodzina')).getByLabelText('Wyciszone'));
    expect(account.setPushMute).toHaveBeenLastCalledWith('gf', true);
    account.setPushMute.mockRejectedValueOnce(new Error('offline'));
    await press(within(within(box).getByLabelText('Klasa 2b')).getByLabelText('Włączone'));
    await flush();
    expect(within(within(box).getByLabelText('Klasa 2b')).getByLabelText('Wyciszone').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Nie udało się zmienić ustawień — sprawdź internet.')).toBeTruthy();
  });

  it('bez internetu przy odczycie — komunikat; bez grup wspólnych — brak sekcji', async () => {
    await open({ account: fakeAccount({ getPushMutes: jest.fn(async () => Promise.reject(new Error('offline'))) }), push: fakePush() });
    await press(screen.getByLabelText('Ustawienia'));
    await screen.findByTestId('screen-settings');
    await flush();
    expect(screen.getByText('Nie udało się zmienić ustawień — sprawdź internet.')).toBeTruthy();
    const base = sampleBase();
    for (const g of ['gf', 'gk']) put(base, 'groups', g, { ...base.groups![g]!, deleted_at: 'x' });
    await open({ base, push: fakePush() });
    await press(screen.getAllByLabelText('Ustawienia').at(-1)!);
    await flush();
    expect(screen.queryByTestId('mute-settings')).toBeNull();
  });
});
