/**
 * Usuwanie, kosz i cofanie (audyt 2, paczka P13): kosz list, zadań, pozycji, wydarzeń i osób (M-34, D151), jedna reguła
 * usuwania (M-121, D187), „Ostatnie zmiany” i pasek przy VoiceOverze (M-38, D194), paski po dodaniu (M-126, D189),
 * odrzucone zmiany (M-137, D190), przesuwanie wierszy (M-124, M-239, M-249), czerwone przyciski (M-241), usunięcie
 * zadania z jego ekranu (M-254).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Fragment } from 'react';
import { AccessibilityInfo, ScrollView } from 'react-native';

import { config } from '../../config';
import { palettes } from '../../config/theme';
import type { Row } from '../../domain/sync-engine/client';
import { RootStack } from '../navigation';
import { expectOps, answerAlert, pickDate, put, sampleBase, setTime, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const ago = (days: number) => new Date(Date.UTC(2026, 9, 7, 8, 0) - days * 86_400_000).toISOString();
const bar = () => screen.getByTestId('undo-bar');

async function open(base = sampleBase(), extra: Parameters<typeof setup>[0] = {}) {
  const s = setup({ base, ...extra });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

function event(base: ReturnType<typeof sampleBase>, id: string, extra: Row = {}) {
  put(base, 'events', id, { id, group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', deleted_at: null, version: 1, ...extra });
}

describe('kosz na ekranie Grupy (M-34, D151)', () => {
  function trashBase() {
    const base = sampleBase();
    put(base, 'lists', 'stara', { id: 'stara', group_id: 'gf', kind: 'tasks', name: 'Stara lista', visibility: 'group', owner_member_id: null, sort_key: 'a0', deleted_at: ago(1), version: 2 });
    put(base, 'tasks', 'w-starej', { ...base.tasks!['t-kwiaty']!, id: 'w-starej', list_id: 'stara', title: 'W starej', deleted_at: ago(1) });
    put(base, 'tasks', 'del', { ...base.tasks!['t-kwiaty']!, id: 'del', title: 'Usunięte zadanie', deleted_at: ago(2) });
    put(base, 'tasks', 'mleko', { ...base.tasks!['s-chleb']!, id: 'mleko', title: 'Mleko', deleted_at: ago(3) });
    put(base, 'tasks', 'szk', { ...base.tasks!['t-korki']!, id: 'szk', title: 'Szkolne', deleted_at: ago(1) });
    event(base, 'ev-del', { title: 'Wizyta', deleted_at: ago(4) });
    put(base, 'group_members', 'kasia', { member_id: 'kasia', group_id: 'gf', user_id: null, display_name: 'Kasia', role: 'child', created_at: '2026-01-01T00:00:00Z', deleted_at: ago(5), version: 2 });
    return base;
  }

  it('sekcje według rodzaju, „Przywróć” jako zwykła zmiana z „Cofnij”; dziecko w grupie nie widzi jej kosza', async () => {
    const base = trashBase();
    base.group_members!.mk = { ...base.group_members!.mk, role: 'child' };
    const { store } = await open(base);
    await press(screen.getByLabelText('Grupy'));
    const trash = await screen.findByTestId('trash');
    expect(within(trash).getByText(/czekają tu 30 dni/)).toBeTruthy();
    expect(within(screen.getByTestId('trash-list')).getByText('Rodzina · z 1 zadaniem · usunięcie za 29 dni')).toBeTruthy();
    expect(within(screen.getByTestId('trash-task')).getByText('Usunięte zadanie')).toBeTruthy();
    expect(within(screen.getByTestId('trash-task')).queryByText('W starej')).toBeNull(); // wróci z listą
    expect(within(screen.getByTestId('trash-task')).queryByText('Szkolne')).toBeNull(); // dziecko w „Klasie 2b”
    expect(within(screen.getByTestId('trash-item')).getByText('Rodzina · Zakupy na weekend · usunięcie za 27 dni')).toBeTruthy();
    expect(within(screen.getByTestId('trash-event')).getByText('Wizyta')).toBeTruthy();
    expect(within(screen.getByTestId('trash-member')).getByText('Kasia')).toBeTruthy();
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(expect.arrayContaining(['Listy', 'Zadania', 'Pozycje zakupów', 'Wydarzenia', 'Osoby']));
    await press(screen.getByLabelText('Przywróć: Usunięte zadanie'));
    expectOps(store, [{ kind: 'restore', entity: 'tasks', id: 'del' }]);
    expect(screen.queryByTestId('trash-del')).toBeNull();
    expect(within(bar()).getByText('Przywrócono: Usunięte zadanie')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 'del' }]);
    await press(screen.getByLabelText('Przywróć: Kasia'));
    expectOps(store, [{ kind: 'restore', entity: 'group_members', id: 'kasia' }]);
    await press(screen.getByLabelText('Przywróć: Wizyta'));
    expectOps(store, [{ kind: 'restore', entity: 'events', id: 'ev-del' }]);
  });

  it('długa sekcja: najnowsze config.TRASH_PREVIEW, „Pokaż wszystkie (N)” i „Pokaż mniej”; lista zakupów liczy pozycje', async () => {
    const base = sampleBase();
    for (let i = 0; i < config.TRASH_PREVIEW + 1; i++) put(base, 'tasks', `d${i}`, { ...base.tasks!['t-kwiaty']!, id: `d${i}`, title: `Usunięte ${i}`, deleted_at: ago(i + 1) });
    put(base, 'lists', 'lz', { ...base.lists!.lz!, deleted_at: ago(1) });
    put(base, 'tasks', 's-chleb', { ...base.tasks!['s-chleb']!, deleted_at: ago(1) });
    put(base, 'tasks', 's-maslo', { ...base.tasks!['s-maslo']!, deleted_at: ago(1) });
    await open(base);
    await press(screen.getByLabelText('Grupy'));
    expect(await screen.findByText('Rodzina · z 2 pozycjami · usunięcie za 29 dni')).toBeTruthy();
    expect(screen.queryByText(`Usunięte ${config.TRASH_PREVIEW}`)).toBeNull();
    await press(screen.getByLabelText(`Pokaż wszystkie (${config.TRASH_PREVIEW + 1})`));
    expect(screen.getByText(`Usunięte ${config.TRASH_PREVIEW}`)).toBeTruthy();
    await press(screen.getByLabelText('Pokaż mniej'));
    expect(screen.queryByText(`Usunięte ${config.TRASH_PREVIEW}`)).toBeNull();
  });

  it('pusto — bez sekcji kosza; „Ostatnie zmiany” są zawsze', async () => {
    await open();
    await press(screen.getByLabelText('Grupy'));
    await screen.findByTestId('screen-groups');
    expect(screen.queryByTestId('trash')).toBeNull();
    await press(screen.getByTestId('open-recent'));
    expect(await screen.findByText('Nie ma jeszcze zmian do cofnięcia.')).toBeTruthy();
  });
});

describe('Ostatnie zmiany (M-38, D194)', () => {
  it('„Cofnij” bez limitu czasu, najnowsze pierwsze; wejście też z treści paska', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Usuń: Przynieść korki na trening'));
    await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
    await press(within(bar()).getByTestId('undo-message'));
    await screen.findByTestId('screen-recent');
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    const entries = screen.getAllByTestId(/^recent-\d+$/);
    expect(within(entries[0]!).getByText('Usunięto zadanie: Odebrać paczkę')).toBeTruthy();
    expect(within(entries[1]!).getByText('Usunięto zadanie: Przynieść korki na trening')).toBeTruthy();
    expect(within(entries[1]!).getByText('dziś, 10:00')).toBeTruthy();
    await press(within(entries[1]!).getByLabelText('Cofnij: Usunięto zadanie: Przynieść korki na trening'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 't-korki' }, { kind: 'delete', entity: 'tasks', id: 't-paczka' }, { kind: 'restore', entity: 'tasks', id: 't-korki' }]);
    expect(within(entries[1]!).getByText('Cofnięto')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Cofnięto', { queue: true });
  });

  it('rzecz zmieniona od tamtej chwili (np. przywrócona na drugim telefonie) — nie cofamy, z listy i z paska', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
    // Drugi telefon przywrócił zadanie; serwer potwierdził też moje usunięcie wcześniej — kolejka pusta.
    await act(async () => {
      store.getSnapshot().state = { ...store.getSnapshot().state, pending: [] };
      store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, deleted_at: null, version: 5 } } }));
    });
    const n = store.dispatched.length;
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(store.dispatched).toHaveLength(n);
    expect(within(bar()).getByText('Nie cofnięto: Usunięto zadanie: Odebrać paczkę — to się w międzyczasie zmieniło')).toBeTruthy();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(await screen.findByText(/Nie cofnięto: to zmieniło się od tamtej chwili/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Cofnij: /)).toBeNull();
  });

  it('po serwerze (inny znacznik usunięcia, godzina z sekundami) cofnięcie dalej działa; po cofnięciu z paska wpis jest „Cofnięto”', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
    await act(async () => {
      store.getSnapshot().state = { ...store.getSnapshot().state, pending: [] };
      store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, deleted_at: '2026-10-07T08:00:02+00:00', version: 5 } } }));
    });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    await press(await screen.findByLabelText('Cofnij: Usunięto zadanie: Odebrać paczkę'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 't-paczka' }, { kind: 'restore', entity: 'tasks', id: 't-paczka' }]);
  });

  it('„Zmień” po szybkim dodaniu i „Zobacz” to nie zmiany do cofnięcia — nie trafiają na listę', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kupić mleko');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(bar()).getByLabelText('Zmień')).toBeTruthy();
    expect(within(bar()).getByTestId('undo-message').props.accessibilityRole).toBeUndefined();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(await screen.findByText('Nie ma jeszcze zmian do cofnięcia.')).toBeTruthy();
  });

  it(`pamięta najwyżej config.RECENT_MAX zmian`, async () => {
    const base = sampleBase();
    for (let i = 0; i <= config.RECENT_MAX; i++) put(base, 'tasks', `x${i}`, { ...base.tasks!['t-korki']!, id: `x${i}`, title: `Zadanie ${i}` });
    await open(base);
    for (let i = 0; i <= config.RECENT_MAX; i++) await press(screen.getByLabelText(`Usuń: Zadanie ${i}`));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(screen.getAllByTestId(/^recent-\d+$/)).toHaveLength(config.RECENT_MAX);
    expect(screen.queryByText('Usunięto zadanie: Zadanie 0')).toBeNull();
    // 31 usunięć na pełnym ekranie Moich spraw — przy obciążonej maszynie CI dłużej niż domyślne 5 s.
  }, 20_000);
});

/** Ponowne uruchomienie aplikacji: nowe drzewo (nowy UndoProvider) na tych samych usługach i tej samej bazie konta. */
async function restart(s: ReturnType<typeof setup>, r: Awaited<ReturnType<ReturnType<typeof setup>['renderApp']>>) {
  await act(async () => r.rerender(<Fragment key="po-restarcie">{s.wrap(<NavigationContainer><RootStack /></NavigationContainer>)}</Fragment>));
}

describe('Ostatnie zmiany w bazie konta (D194 b)', () => {
  it('po ponownym uruchomieniu: cofnięcie z operacji działa, zmiana przez serwer zostaje z wyjaśnieniem, cofnięte — „Cofnięto”', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    const s = setup({ base });
    const first = await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
    await press(screen.getByLabelText('Usuń: Przynieść korki na trening'));
    await press(within(bar()).getByLabelText('Cofnij'));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Usuń: Rodzina'));
    await answerAlert('Usuń grupę');
    await screen.findByText('Usunięto grupę: Rodzina');
    await restart(s, first);
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    const entries = await screen.findAllByTestId(/^recent-\d+$/);
    expect(entries).toHaveLength(3);
    expect(within(entries[0]!).getByText(/szła przez serwer/)).toBeTruthy();
    expect(within(entries[0]!).queryByLabelText(/^Cofnij: /)).toBeNull();
    expect(within(entries[1]!).getByText('Cofnięto')).toBeTruthy();
    await press(within(entries[2]!).getByLabelText('Cofnij: Usunięto zadanie: Odebrać paczkę'));
    expectOps(s.store, [{ kind: 'delete', entity: 'tasks', id: 't-paczka' }, { kind: 'delete', entity: 'tasks', id: 't-korki' }, { kind: 'restore', entity: 'tasks', id: 't-korki' }, { kind: 'restore', entity: 'tasks', id: 't-paczka' }]);
    expect(within(entries[2]!).getByText('Cofnięto')).toBeTruthy();
  });

  it('po ponownym uruchomieniu sprawdzenie zmian działa z zapisanym odciskiem; bez cofnięcia rzeczy zmienionej w międzyczasie', async () => {
    const s = setup();
    const first = await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
    await act(async () => {
      s.store.getSnapshot().state = { ...s.store.getSnapshot().state, pending: [] };
      s.store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, deleted_at: null, version: 5 } } }));
    });
    await restart(s, first);
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    const n = s.store.dispatched.length;
    await press(await screen.findByLabelText('Cofnij: Usunięto zadanie: Odebrać paczkę'));
    expect(s.store.dispatched).toHaveLength(n);
    expect(await screen.findByText(/Nie cofnięto: to zmieniło się od tamtej chwili/)).toBeTruthy();
  });

  it('uszkodzony zapis — pusta lista, bez błędu', async () => {
    const s = setup();
    s.services.local!.save('recent.changes', '{zły');
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(await screen.findByText('Nie ma jeszcze zmian do cofnięcia.')).toBeTruthy();
  });
});

describe('pasek przy VoiceOverze (M-38, D194)', () => {
  it('nie znika sam, dostaje fokus, ma „Zamknij”; po wyłączeniu VoiceOvera znika jak zwykle', async () => {
    const sr = AccessibilityInfo.isScreenReaderEnabled as jest.Mock;
    const listen = AccessibilityInfo.addEventListener as unknown as jest.Mock;
    const handlers: ((on: boolean) => void)[] = [];
    sr.mockResolvedValue(true);
    listen.mockImplementation((_e: string, fn: (on: boolean) => void) => (handlers.push(fn), { remove: jest.fn() }));
    jest.useFakeTimers();
    try {
      await open();
      await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
      await act(async () => jest.advanceTimersByTime(config.UNDO_MS * 3));
      expect(bar()).toBeTruthy();
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), 'focus');
      await press(within(bar()).getByTestId('undo-close'));
      expect(screen.queryByTestId('undo-bar')).toBeNull();
      await act(async () => handlers.forEach((h) => h(false)));
      await press(screen.getByLabelText('Usuń: Przynieść korki na trening'));
      expect(within(bar()).queryByTestId('undo-close')).toBeNull();
      await act(async () => jest.advanceTimersByTime(config.UNDO_MS));
      expect(screen.queryByTestId('undo-bar')).toBeNull();
    } finally {
      jest.useRealTimers();
      sr.mockResolvedValue(false);
      listen.mockImplementation(() => ({ remove: jest.fn() }));
    }
  });
});

describe('odrzucone zmiany (M-137, D190)', () => {
  it('jednorazowy pasek przy nowych odrzuceniach, nazwy rzeczy na liście, „Wyczyść listę”', async () => {
    const s = await open();
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    const rejected = [
      { op: { seq: 11, op_id: 'o11', kind: 'delete' as const, entity: 'tasks' as const, id: 't-kwiaty' }, code: 'forbidden' },
      { op: { seq: 12, op_id: 'o12', kind: 'patch' as const, entity: 'lists' as const, id: 'lf', set: { visibility: 'private' } }, code: 'forbidden' },
    ];
    await act(async () => {
      s.store.getSnapshot().state = { ...s.store.getSnapshot().state, rejected } as never;
      s.store.setIndicator({ state: 'synced', since: null });
    });
    expect(within(bar()).getByText('Serwer nie przyjął 2 zmian')).toBeTruthy();
    await press(within(bar()).getByLabelText('Zobacz'));
    await screen.findByTestId('screen-rejected');
    expect(screen.getByText('Usunięcie: „Kupić kwiaty”')).toBeTruthy();
    expect(screen.getByText('Zmiana: „Dom”')).toBeTruthy();
    // Ten sam stan po ponownym pobraniu — bez nowego paska.
    await act(async () => s.store.setIndicator({ state: 'synced', since: null }));
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    await press(screen.getByTestId('rejected-clear'));
    expect(screen.getByText('Serwer przyjął wszystkie Twoje zmiany.')).toBeTruthy();
    expect(screen.queryByTestId('rejected-clear')).toBeNull();
  });
});

describe('jedna reguła usuwania (M-121, D187) i przesuwanie (M-124, M-239)', () => {
  it('pusta lista — bez pytania; przesunięcie listy na ekranie List i w grupie', async () => {
    const base = sampleBase();
    put(base, 'lists', 'pusta', { ...base.lists!.lf!, id: 'pusta', name: 'Pusta' });
    const { store } = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Usuń: Pusta'));
    expectOps(store, [{ kind: 'delete', entity: 'lists', id: 'pusta' }]);
    expect(within(bar()).getByText('Usunięto listę: Pusta')).toBeTruthy();
    await press(screen.getByLabelText('Usuń: Dom'));
    await answerAlert('Anuluj');
    expectOps(store, []);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gk'));
    await press(await screen.findByLabelText('Usuń: Szkoła'));
    await answerAlert('Usuń listę');
    expectOps(store, [{ kind: 'delete', entity: 'lists', id: 'lk' }]);
  });

  it('osoba i seria w grupie, grupa na liście grup (właściciel) — przesunięciem, z „Cofnij”', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    base.group_members!.ala = { ...base.group_members!.ala, role: 'admin' };
    event(base, 'ev-co', { title: 'Basen', rrule: 'FREQ=WEEKLY;BYDAY=WE' });
    const s = await open(base);
    await press(screen.getByLabelText('Grupy'));
    // Grupa osobista i grupa, w której nie jestem właścicielem, nie przesuwają się.
    expect(screen.queryByLabelText('Usuń: Klasa 2b')).toBeNull();
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByLabelText('Usuń: Tymek'));
    expectOps(s.store, [{ kind: 'delete', entity: 'group_members', id: 'tymek' }]);
    expect(within(bar()).getByText('Usunięto z grupy: Tymek')).toBeTruthy();
    expect(screen.queryByLabelText('Usuń: Łukasz')).toBeNull(); // siebie nie
    await press(screen.getByLabelText('Usuń: Basen'));
    // Audyt 3 (N-3, N-150): cała seria jednym poleceniem i ten sam napis co na ekranie wydarzenia.
    expectOps(s.store, [{ kind: 'cmd', cmd: 'end_series', args: { event_id: 'ev-co', date: null, title: 'Basen' } }]);
    expect(within(bar()).getByText('Usunięto serię: Basen')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Usuń: Rodzina'));
    await answerAlert('Usuń grupę');
    expect(s.account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(await screen.findByText('Usunięto grupę: Rodzina')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(s.account.restoreGroup).toHaveBeenCalledWith('gf');
  });

  it('błąd usuwania grupy przesunięciem — komunikat, bez paska', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    const s = await open(base, { account: undefined });
    s.account.deleteGroup.mockRejectedValueOnce(new Error('Network request failed'));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Usuń: Rodzina'));
    await answerAlert('Usuń grupę');
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('wydarzenie w Moich sprawach i Kalendarzu: jednorazowe „Usuń”, termin serii „Odwołaj” (tylko ten); z zadaniami — pytanie D14', async () => {
    const base = sampleBase();
    event(base, 'ev-raz', { title: 'Wizyta' });
    event(base, 'ev-co', { title: 'Tańce', start_date: '2026-09-30', start_time: '19:00:00', end_time: '20:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE' });
    const { store } = await open(base);
    await press(screen.getByLabelText('Usuń: Wizyta'));
    expectOps(store, [{ kind: 'delete', entity: 'events', id: 'ev-raz' }]);
    expect(within(bar()).getByText('Usunięto wydarzenie: Wizyta')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'restore', entity: 'events', id: 'ev-raz' }]);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText('Odwołaj: Tańce'));
    expect(store.dispatched).toContainEqual(expect.objectContaining({ kind: 'create', entity: 'event_overrides', set: expect.objectContaining({ event_id: 'ev-co', occurrence_date: '2026-10-07' }) }));
    expectOps(store, [{ kind: 'create', entity: 'event_overrides', id: '385b2af4-eed5-5f85-9941-1fa1176e78b7', group_id: 'gf', set: { event_id: 'ev-co', occurrence_date: '2026-10-07', start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, cancelled: true } }, { kind: 'patch', entity: 'event_overrides', id: '385b2af4-eed5-5f85-9941-1fa1176e78b7', set: { cancelled: true } }]);
    expect(within(bar()).getByText('Odwołano: Tańce')).toBeTruthy();
  });

  it('termin z podpiętym zadaniem: przesunięcie otwiera wydarzenie z pytaniem, co z zadaniem', async () => {
    const base = sampleBase();
    event(base, 'ev-raz', { title: 'Wizyta' });
    put(base, 'tasks', 'zad', { ...base.tasks!['t-books']!, id: 'zad', list_id: 'lf', group_id: 'gf', title: 'Wziąć skierowanie', event_id: 'ev-raz', occurrence_date: '2026-10-07', deadline_mode: 'event' });
    const { store } = await open(base);
    const n = store.dispatched.length;
    await press(screen.getByLabelText('Usuń: Wizyta'));
    await screen.findByTestId('screen-event');
    expect(store.dispatched).toHaveLength(n);
    expect(screen.getByText(/1 zadanie jest podpięte do odwoływanych terminów/)).toBeTruthy();
    // Zadanie terminu też przesuwa się do usunięcia (M-124).
    await press(screen.getByLabelText('Usuń: Wziąć skierowanie'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 'zad' }]);
  });

  it('dziecko: wydarzeń i list nie przesuwa', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'child' };
    event(base, 'ev-raz', { title: 'Wizyta' });
    await open(base);
    expect(screen.queryByLabelText('Usuń: Wizyta')).toBeNull();
    await press(screen.getByLabelText('Listy'));
    await screen.findByTestId('screen-lists');
    expect(screen.queryByLabelText('Usuń: Dom')).toBeNull();
    expect(screen.getByLabelText('Usuń: Moje')).toBeTruthy();
  });

  it('podzadanie na ekranie zadania przesuwa się; „Usuń zadanie” — pasek „Cofnij” i powrót (M-254); usunięte gdzie indziej — „W koszu · Przywróć”', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'sub', { ...base.tasks!['t-kwiaty']!, id: 'sub', parent_id: 't-kwiaty', title: 'Wybrać tulipany', deadline_mode: 'inherit', due_date: null });
    put(base, 'tasks', 'gone', { ...base.tasks!['t-kwiaty']!, id: 'gone', title: 'Dawne', deleted_at: ago(1) });
    const { store } = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText(/^Kupić kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Usuń: Wybrać tulipany'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 'sub' }]);
    await press(screen.getByTestId('task-delete'));
    expect(await screen.findByTestId('screen-list')).toBeTruthy();
    expect(within(bar()).getByText('Usunięto zadanie: Kupić kwiaty')).toBeTruthy();
    // Zadanie usunięte na drugim telefonie, gdy mam je otwarte (albo link do usuniętego): ekran „Zadanie usunięte”.
    await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    await act(async () => store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, deleted_at: ago(0) } } })));
    // Audyt 3 (N-36): jak w koszu — „W koszu · usunięcie za …”, „Przywróć” i pasek „Przywrócono: … · Cofnij”.
    expect(screen.getByTestId('screen-task-trash')).toBeTruthy();
    expect(screen.getByText('W koszu · usunięcie za 30 dni')).toBeTruthy();
    await press(screen.getByLabelText('Przywróć: Odebrać paczkę'));
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 't-kwiaty' }, { kind: 'restore', entity: 'tasks', id: 't-paczka' }]);
    expect(within(bar()).getByText('Przywrócono: Odebrać paczkę')).toBeTruthy();
    expect(screen.getByTestId('screen-task')).toBeTruthy();
  });

  it('stała pozycja zakupów: usunięcie z „Cofnij” (wraca tym samym poleceniem co dodanie)', async () => {
    const base = sampleBase();
    put(base, 'lists', 'lz', { ...base.lists!.lz!, staples: ['Mydło'] });
    const { store } = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lz'));
    await press(await screen.findByTestId('staples-edit'));
    await press(screen.getByLabelText('Usuń ze stałych: Mydło'));
    expect(within(bar()).getByText('Usunięto ze stałych: Mydło')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mydło'] } }, { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Mydło' } }]);
  });
});

describe('ekran rzeczy w koszu — jedna reguła z koszem (audyt 3: N-36, N-131)', () => {
  const removeKwiaty = (store: Awaited<ReturnType<typeof open>>['store'], extra: Row = {}) =>
    act(async () => store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-kwiaty': { ...b.tasks!['t-kwiaty']!, deleted_at: ago(0), ...extra } } })));
  async function openKwiaty(base = sampleBase()) {
    const s = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText(/^Kupić kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    return s;
  }

  it('podzadanie usunięte z rodzicem (kosz go nie pokazuje — wraca z rodzicem) — „Tego zadania już nie ma”, bez przywracania', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'sub', { ...base.tasks!['t-kwiaty']!, id: 'sub', parent_id: 't-kwiaty', title: 'Wybrać tulipany', deadline_mode: 'inherit', due_date: null });
    const { store } = await openKwiaty(base);
    await press(screen.getByLabelText(/^Wybrać tulipany(,|$)/));
    await screen.findByTestId('screen-task');
    await act(async () => store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-kwiaty': { ...b.tasks!['t-kwiaty']!, deleted_at: ago(0) }, sub: { ...b.tasks!.sub!, deleted_at: ago(0) } } })));
    expect(screen.getByTestId('screen-task-missing')).toBeTruthy();
    expect(screen.getByText('Tego zadania już nie ma — ktoś je usunął albo nie masz już do niego dostępu.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Przywróć/ })).toBeNull();
  });

  it('dziecko (D34: nie przywraca) — „Tego zadania już nie ma”', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf!, role: 'child' };
    const { store } = await openKwiaty(base);
    await removeKwiaty(store);
    expect(screen.getByTestId('screen-task-missing')).toBeTruthy();
  });

  it('przeniesione na innym telefonie: „Przeniesiono do grupy …” i „Otwórz zadanie” (kopia)', async () => {
    const { store } = await openKwiaty();
    await act(async () =>
      store.pull((b) => ({
        ...b,
        tasks: { ...b.tasks, 't-kwiaty': { ...b.tasks!['t-kwiaty']!, deleted_at: ago(0), moved_to: 'kopia' }, kopia: { ...b.tasks!['t-korki']!, id: 'kopia', title: 'Kupić kwiaty' } },
      })),
    );
    expect(screen.getByTestId('screen-task-moved')).toBeTruthy();
    expect(screen.getByText('To zadanie przeniesiono do grupy „Klasa 2b”.')).toBeTruthy();
    await press(screen.getByLabelText('Otwórz zadanie'));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    expect(screen.getByText('Klasa 2b')).toBeTruthy();
    expect(screen.getByTestId('task-title').props.value).toBe('Kupić kwiaty');
  });

  it('kopia w grupie, do której nie należę — „przeniesiono do innej grupy”, bez przejścia', async () => {
    const { store } = await openKwiaty();
    await removeKwiaty(store, { moved_to: 'nieznana' });
    expect(screen.getByText('To zadanie przeniesiono do innej grupy.')).toBeTruthy();
    expect(screen.queryByTestId('task-open-moved')).toBeNull();
  });

  it('zrobione zadanie nie ma „Przenieś do grupy” (N-121)', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-kwiaty', { ...base.tasks!['t-kwiaty']!, completed_at: '2026-10-07T07:00:00Z' });
    await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText(/Zrobione/));
    await press(await screen.findByLabelText(/^Kupić kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByTestId('task-move')).toBeNull();
  });

  it('lista usunięta, gdy jest otwarta — „W koszu · Przywróć” z paskiem, jak w koszu', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    await act(async () => store.pull((b) => ({ ...b, lists: { ...b.lists, lf: { ...b.lists!.lf!, deleted_at: ago(0) } } })));
    expect(screen.getByTestId('screen-list-trash')).toBeTruthy();
    await press(screen.getByLabelText('Przywróć: Dom'));
    expect(within(bar()).getByText('Przywrócono: Dom')).toBeTruthy();
    expect(screen.getByTestId('screen-list')).toBeTruthy();
    expectOps(store, [{ kind: 'restore', entity: 'lists', id: 'lf' }]);
  });
});

describe('jeden otwarty wiersz (M-249)', () => {
  it('otwarcie drugiego zamyka pierwszy, przewinięcie ekranu zamyka otwarty, zamknięty nie jest zamykany drugi raz', async () => {
    await open();
    const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
    const swipe = (id: string, x: number) => fireEvent(screen.getByTestId(id), 'scrollEndDrag', { nativeEvent: { contentOffset: { x, y: 0 } } });
    const closed = () => scrollTo.mock.contexts.map((c) => (c as { props: { testID?: string } }).props.testID);
    scrollTo.mockClear();
    await swipe('swipe-today-t-korki', 96);
    await swipe('swipe-today-t-paczka', 96);
    expect(closed()).toEqual(['swipe-today-t-korki']);
    await fireEvent(screen.getByTestId('swipe-today-t-paczka'), 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 96, y: 0 } } });
    expect(closed()).toEqual(['swipe-today-t-korki']);
    await fireEvent(screen.getByTestId('screen-today'), 'scrollBeginDrag');
    expect(closed()).toEqual(['swipe-today-t-korki', 'swipe-today-t-paczka']);
    await swipe('swipe-today-t-korki', 0);
    await fireEvent(screen.getByTestId('screen-today'), 'scrollBeginDrag');
    expect(closed()).toHaveLength(2);
  });
});

describe('paski po dodaniu (M-126, D189)', () => {
  it('formularz zadania: „Dodano … · Cofnij” usuwa nowe zadanie', async () => {
    const { store } = await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Zadzwonić do mamy');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(screen.getByTestId('form-save'));
    await screen.findByTestId('screen-today');
    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks')!;
    expect(within(bar()).getByText('Dodano zadanie: Zadzwonić do mamy · Osobiste')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'Zadzwonić do mamy', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }, { kind: 'delete', entity: 'tasks', id: 'id' in created ? created.id : '' }]);
  });

  it('nowa lista i nowe wydarzenie z formularza — „Cofnij”; szybkie dodanie na liście zadań — „Zmień” otwiera zadanie', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await fireEvent.changeText(await screen.findByTestId('list-name'), 'Remont');
    await press(screen.getByTestId('create-list'));
    await screen.findByTestId('screen-list');
    expect(within(bar()).getByText('Dodano listę: Remont · Osobiste')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kupić farbę');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(bar()).getByText('Dodano zadanie: Kupić farbę · Remont')).toBeTruthy();
    await press(within(bar()).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    expect(store.dispatched.some((o) => o.kind === 'create' && o.entity === 'lists')).toBe(true);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Wróć'));
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('group-add-event'));
    await fireEvent.changeText(await screen.findByTestId('event-title'), 'Zebranie');
    await pickDate('event-date', '2026-10-09');
    await setTime('event-start-0', '19:00');
    await press(screen.getByTestId('event-save'));
    await screen.findByTestId('screen-group');
    const ev = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')!;
    expect(within(bar()).getByText('Dodano wydarzenie: Zebranie · Rodzina')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(store.dispatched).toContainEqual({ kind: 'delete', entity: 'events', id: 'id' in ev ? ev.id : '' });
  });
});

describe('czerwone przyciski (M-241)', () => {
  it('wylogowanie i „Wyczyść dane na telefonie” są czerwone; „Zmień ID grupy” też', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    await open(base, { resetLocal: jest.fn() });
    const red = (el: { props: Record<string, unknown> }) => (el.props.style as { borderColor?: string }).borderColor;
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-account'));
    expect(red(screen.getByTestId('sign-out'))).toBe(palettes.light.danger);
    expect(red(screen.getByTestId('reset-start'))).toBe(palettes.light.danger);
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(red(await screen.findByTestId('rotate-join-id'))).toBe(palettes.light.danger);
  });
});


describe('cofnięcie przez serwer (grupa) bez internetu (audyt 3, N-34)', () => {
  const owner = () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    return base;
  };
  const offline = () => new Error('Network request failed');
  const failBar = 'Nie cofnięto: Usunięto grupę: Rodzina. Coś poszło nie tak. Spróbuj jeszcze raz. Ta czynność wymaga internetu.';

  it('z „Ostatnich zmian”: „Cofanie…”, potem pasek błędu z „Spróbuj ponownie”, wpis znów z „Cofnij”; ponowienie — „Cofnięto”', async () => {
    const s = await open(owner());
    let fail: (e: Error) => void = () => {};
    s.account.restoreGroup.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Usuń: Rodzina'));
    await answerAlert('Usuń grupę');
    expect(await screen.findByText('Usunięto grupę: Rodzina')).toBeTruthy();
    await press(screen.getByTestId('open-recent'));
    await press(await screen.findByLabelText('Cofnij: Usunięto grupę: Rodzina'));
    expect(s.account.restoreGroup).toHaveBeenCalledWith('gf');
    // W toku: bez „Cofnięto” i bez drugiego „Cofnij”.
    expect(screen.getByText('Cofanie…')).toBeTruthy();
    expect(screen.queryByText('Cofnięto')).toBeNull();
    expect(screen.queryByLabelText('Cofnij: Usunięto grupę: Rodzina')).toBeNull();
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Cofanie…', { queue: true });
    await act(async () => fail(offline()));
    expect(within(bar()).getByText(failBar)).toBeTruthy();
    expect(screen.queryByText('Cofnięto')).toBeNull();
    expect(screen.getByLabelText('Cofnij: Usunięto grupę: Rodzina')).toBeTruthy();
    expect(s.store.refresh).toHaveBeenCalledTimes(1); // tylko po usunięciu
    // „Spróbuj ponownie” na pasku — ta sama ścieżka; teraz się udaje.
    await press(within(bar()).getByLabelText('Spróbuj ponownie'));
    await act(async () => {});
    expect(s.account.restoreGroup).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Cofnięto')).toBeTruthy();
    expect(s.store.refresh).toHaveBeenCalledTimes(2);
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith('Cofnięto', { queue: true });
  });

  it('z paska na ekranie grupy: ten sam pasek błędu; w „Ostatnich zmianach” dalej „Cofnij”', async () => {
    const s = await open(owner());
    s.account.restoreGroup.mockRejectedValueOnce(offline());
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('delete-group'));
    await answerAlert('Usuń grupę');
    await press(within(await screen.findByTestId('undo-bar')).getByLabelText('Cofnij'));
    await act(async () => {});
    expect(within(bar()).getByText(failBar)).toBeTruthy();
    await press(screen.getByTestId('open-recent'));
    expect(await screen.findByLabelText('Cofnij: Usunięto grupę: Rodzina')).toBeTruthy();
    expect(screen.queryByText('Cofnięto')).toBeNull();
  });

  it('kosz: „Cofnij” przywrócenia bez internetu — pasek błędu (nie napis w koszu), grupa dalej poza koszem, wpis do ponowienia', async () => {
    const base = owner();
    base.groups!.gf = { ...base.groups!.gf, deleted_at: '2026-10-06T08:00:00Z' };
    const s = await open(base);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Przywróć: Rodzina'));
    expect(within(await screen.findByTestId('undo-bar')).getByText('Przywrócono: Rodzina')).toBeTruthy();
    s.account.deleteGroup.mockRejectedValueOnce(offline());
    await press(within(bar()).getByLabelText('Cofnij'));
    await act(async () => {});
    expect(s.account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(within(bar()).getByText('Nie cofnięto: Przywrócono: Rodzina. Coś poszło nie tak. Spróbuj jeszcze raz. Ta czynność wymaga internetu.')).toBeTruthy();
    expect(screen.getAllByText(/Ta czynność wymaga internetu/)).toHaveLength(1);
    expect(screen.queryByTestId('trash-gf')).toBeNull();
    await press(within(bar()).getByLabelText('Spróbuj ponownie'));
    await act(async () => {});
    expect(s.account.deleteGroup).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId('trash-gf')).toBeTruthy();
    await press(screen.getByTestId('open-recent'));
    expect(await screen.findByText('Cofnięto')).toBeTruthy();
  });
});
