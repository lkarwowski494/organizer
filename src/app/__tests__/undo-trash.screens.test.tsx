/**
 * Usuwanie, kosz i cofanie (audyt 2, paczka P13): kosz list, zadań, pozycji, wydarzeń i osób (M-34, D151), jedna reguła
 * usuwania (M-121, D187), „Ostatnie zmiany” i pasek przy VoiceOverze (M-38, D194), paski po dodaniu (M-126, D189),
 * odrzucone zmiany (M-137, D190), przesuwanie wierszy (M-124, M-239, M-249), czerwone przyciski (M-241), usunięcie
 * zadania z jego ekranu (M-254).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, ScrollView } from 'react-native';

import { config } from '../../config';
import { palettes } from '../../config/theme';
import type { Row } from '../../domain/sync-engine/client';
import { RootStack } from '../navigation';
import { answerAlert, pickDate, put, sampleBase, setTime, setup } from './harness';

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
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'tasks', id: 'del' });
    expect(screen.queryByTestId('trash-del')).toBeNull();
    expect(within(bar()).getByText('Przywrócono: Usunięte zadanie')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'tasks', id: 'del' });
    await press(screen.getByLabelText('Przywróć: Kasia'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'group_members', id: 'kasia' });
    await press(screen.getByLabelText('Przywróć: Wizyta'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'events', id: 'ev-del' });
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
    expect(await screen.findByText('Od uruchomienia aplikacji nie było zmian do cofnięcia.')).toBeTruthy();
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
    expect(within(entries[0]!).getByText('Usunięto: Odebrać paczkę')).toBeTruthy();
    expect(within(entries[1]!).getByText('Usunięto: Przynieść korki na trening')).toBeTruthy();
    expect(within(entries[1]!).getByText('dziś, 10:00')).toBeTruthy();
    await press(within(entries[1]!).getByLabelText('Cofnij: Usunięto: Przynieść korki na trening'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'tasks', id: 't-korki' });
    expect(within(entries[1]!).getByText('Cofnięto')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Cofnięto');
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
    expect(within(bar()).getByText('Nie cofnięto: Usunięto: Odebrać paczkę — to się w międzyczasie zmieniło')).toBeTruthy();
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
    await press(await screen.findByLabelText('Cofnij: Usunięto: Odebrać paczkę'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'tasks', id: 't-paczka' });
  });

  it('„Zmień” po szybkim dodaniu i „Zobacz” to nie zmiany do cofnięcia — nie trafiają na listę', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kupić mleko');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(bar()).getByLabelText('Zmień')).toBeTruthy();
    expect(within(bar()).getByTestId('undo-message').props.accessibilityRole).toBeUndefined();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(await screen.findByText('Od uruchomienia aplikacji nie było zmian do cofnięcia.')).toBeTruthy();
  });

  it(`pamięta najwyżej config.RECENT_MAX zmian`, async () => {
    const base = sampleBase();
    for (let i = 0; i <= config.RECENT_MAX; i++) put(base, 'tasks', `x${i}`, { ...base.tasks!['t-korki']!, id: `x${i}`, title: `Zadanie ${i}` });
    await open(base);
    for (let i = 0; i <= config.RECENT_MAX; i++) await press(screen.getByLabelText(`Usuń: Zadanie ${i}`));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    expect(screen.getAllByTestId(/^recent-\d+$/)).toHaveLength(config.RECENT_MAX);
    expect(screen.queryByText('Usunięto: Zadanie 0')).toBeNull();
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
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'lists', id: 'pusta' });
    expect(within(bar()).getByText('Usunięto listę: Pusta')).toBeTruthy();
    await press(screen.getByLabelText('Usuń: Dom'));
    await answerAlert('Anuluj');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'lists', id: 'pusta' });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gk'));
    await press(await screen.findByLabelText('Usuń: Szkoła'));
    await answerAlert('Usuń listę');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'lists', id: 'lk' });
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
    await press(await screen.findByLabelText('Usuń: Kuba'));
    expect(s.store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'group_members', id: 'kuba' });
    expect(within(bar()).getByText('Usunięto z grupy: Kuba')).toBeTruthy();
    expect(screen.queryByLabelText('Usuń: Łukasz')).toBeNull(); // siebie nie
    await press(screen.getByLabelText('Usuń: Basen'));
    expect(s.store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'events', id: 'ev-co' });
    expect(within(bar()).getByText('Usunięto: Basen')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Usuń: Rodzina'));
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
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('wydarzenie w Moich sprawach i Kalendarzu: jednorazowe „Usuń”, termin serii „Odwołaj” (tylko ten); z zadaniami — pytanie D14', async () => {
    const base = sampleBase();
    event(base, 'ev-raz', { title: 'Wizyta' });
    event(base, 'ev-co', { title: 'Tańce', start_date: '2026-09-30', start_time: '19:00:00', end_time: '20:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE' });
    const { store } = await open(base);
    await press(screen.getByLabelText('Usuń: Wizyta'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'events', id: 'ev-raz' });
    expect(within(bar()).getByText('Usunięto: Wizyta')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'events', id: 'ev-raz' });
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText('Odwołaj: Tańce'));
    expect(store.dispatched).toContainEqual(expect.objectContaining({ kind: 'create', entity: 'event_overrides', set: expect.objectContaining({ event_id: 'ev-co', occurrence_date: '2026-10-07' }) }));
    expect(store.dispatched.at(-1)).toMatchObject({ entity: 'event_overrides', set: { cancelled: true } });
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
    expect(screen.getByText(/1 zadanie jest podpięte do odwoływanych wydarzeń/)).toBeTruthy();
    // Zadanie terminu też przesuwa się do usunięcia (M-124).
    await press(screen.getByLabelText('Usuń: Wziąć skierowanie'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'tasks', id: 'zad' });
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

  it('podzadanie na ekranie zadania przesuwa się; „Usuń zadanie” — pasek „Cofnij” i powrót (M-254); usunięte gdzie indziej — „Zadanie usunięte”', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'sub', { ...base.tasks!['t-kwiaty']!, id: 'sub', parent_id: 't-kwiaty', title: 'Wybrać tulipany', deadline_mode: 'inherit', due_date: null });
    put(base, 'tasks', 'gone', { ...base.tasks!['t-kwiaty']!, id: 'gone', title: 'Dawne', deleted_at: ago(1) });
    const { store } = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText(/^Otwórz: Kupić kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Usuń: Wybrać tulipany'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'tasks', id: 'sub' });
    await press(screen.getByTestId('task-delete'));
    expect(await screen.findByTestId('screen-list')).toBeTruthy();
    expect(within(bar()).getByText('Usunięto: Kupić kwiaty')).toBeTruthy();
    // Zadanie usunięte na drugim telefonie, gdy mam je otwarte (albo link do usuniętego): ekran „Zadanie usunięte”.
    await press(screen.getByLabelText(/^Otwórz: Odebrać paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    await act(async () => store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, deleted_at: ago(0) } } })));
    expect(screen.getByTestId('screen-task-deleted')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij usunięcie'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'tasks', id: 't-paczka' });
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
    expect(store.dispatched.at(-1)).toEqual({ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Mydło' } });
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
    expect(within(bar()).getByText('Dodano: Zadzwonić do mamy · Osobiste')).toBeTruthy();
    await press(within(bar()).getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'tasks', id: 'id' in created ? created.id : '' });
  });

  it('nowa lista i nowe wydarzenie z formularza — „Cofnij”; szybkie dodanie na liście zadań — „Zmień” otwiera formularz', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await fireEvent.changeText(await screen.findByTestId('list-name'), 'Remont');
    await press(screen.getByTestId('create-list'));
    await screen.findByTestId('screen-list');
    expect(within(bar()).getByText('Dodano listę: Remont · Osobiste')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kupić farbę');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(bar()).getByText('Dodano: Kupić farbę · Remont')).toBeTruthy();
    await press(within(bar()).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-add-task')).toBeTruthy();
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

