/** Push o przekazaniach (D70): prośba o zgodę na „Dotyczy mnie”, rejestracja tokenu, prośba o powiadomienie. */
import { act, fireEvent, screen } from '@testing-library/react-native';

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
    expect(screen.getByText('Powiadomienia o przekazaniach')).toBeTruthy();
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

  it('nie pyta: już zdecydowane, „Nie teraz” wcześniej, brak wspólnej grupy, brak push', async () => {
    await open({ push: fakePush({ status: jest.fn(async () => 'denied' as const) }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    await open({ push: fakePush({ dismissed: jest.fn(async () => true) }) });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    const base = sampleBase();
    for (const g of ['gf', 'gk']) put(base, 'groups', g, { ...base.groups![g]!, deleted_at: 'x' });
    await open({ base, push: fakePush() });
    expect(screen.queryByTestId('push-prompt')).toBeNull();
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
