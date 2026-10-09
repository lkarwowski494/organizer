/**
 * Ekran listy i zakupy (audyt 2, paczka „Listy i zakupy”): podzadania zrobionego rodzica i minione (M-82), jeden licznik
 * listy (M-83), zakupy osoby usuniętej z grupy (M-22), błąd „Dodaj do stałych” z panelu pozycji (M-224), „Cofnij” po
 * „Zakupy zrobione” i po „Zakończ: …” (M-225), nazwa pola rodzaju listy (M-237), limity długości pól (M-228),
 * odrzucone polecenia stałych zakupów (M-111); decyzje właściciela z 8.10.2026: do koszyka bez pytania (M-109, PW-15 A),
 * nazwa listy, edycja pozycji zakupów i „Tylko ja” (M-107, PW-17 B), wyjątki od D68 (M-108, PW-18 A + b), zwinięte
 * minione kopie zadania powtarzanego (M-283, PWD-14 A).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { palettes } from '../../config/theme';
import type { Row } from '../../domain/sync-engine/client';
import { nextId } from '../../domain/views/task-repeat';
import { RootStack } from '../navigation';
import { answerAlert, lastAlert, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
async function openList(id: string) {
  await press(screen.getByLabelText('Listy'));
  await press(await screen.findByTestId(`list-${id}`));
  return screen.findByTestId('screen-list');
}
const task = (b: ReturnType<typeof sampleBase>, id: string, extra: Row) => put(b, 'tasks', id, { ...b.tasks!['t-books']!, id, ...extra });

describe('wiersze listy (M-82)', () => {
  it('niezrobione podzadanie zrobionego rodzica stoi w otwartych z dopiskiem; minione bez ptaszka, dotknięcie pyta „Zrobione?”', async () => {
    const b = sampleBase();
    task(b, 'sprz', { title: 'Sprzątanie', deadline_mode: 'own', due_date: '2026-10-05', completed_at: '2026-10-05T10:00:00Z' });
    task(b, 'odk', { title: 'Odkurzyć', parent_id: 'sprz' });
    task(b, 'kurz', { title: 'Zetrzeć kurze', parent_id: 'sprz', deadline_mode: 'inherit' });
    task(b, 'zmyc', { title: 'Zmyć', parent_id: 'sprz', deadline_mode: 'inherit', completed_at: '2026-10-05T10:00:00Z' });
    task(b, 'kartka', { title: 'Kartka dla babci', deadline_mode: 'own', due_date: '2026-10-05', rollover: false });
    await open(b);
    await openList('lp');
    // Otwarte: książki i odkurzanie (z dopiskiem rodzica, bez wcięcia, z polem do odhaczenia).
    expect(screen.getByText(/2 otwarte/)).toBeTruthy();
    const odk = screen.getByTestId('task-odk');
    expect(within(odk).getByText(/↳ Sprzątanie/)).toBeTruthy();
    expect(within(odk).getByLabelText('Oznacz jako zrobione: Odkurzyć')).toBeTruthy();
    expect(odk.props.style.marginLeft).toBe(0);
    // W „Zrobione” podzadanie nie stoi drugi raz; zrobione podzadanie — pod rodzicem, odhaczone.
    expect(screen.getAllByTestId('task-odk')).toHaveLength(1);
    expect(within(screen.getByTestId('task-zmyc')).getByLabelText('Oznacz jako niezrobione: Zmyć')).toBeTruthy();
    expect(screen.getByTestId('task-zmyc').props.style.marginLeft).toBe(22);
    // Podzadanie z minionym, dziedziczonym terminem zrobionego rodzica minęło (T-13) — pod rodzicem, bez ptaszka.
    expect(within(screen.getByTestId('task-kurz')).getByText(/minęło/)).toBeTruthy();
    expect(within(screen.getByTestId('task-kurz')).getByLabelText('Oznacz jako zrobione: Zetrzeć kurze')).toBeTruthy();
    // Minione: dopisek „minęło”, pole bez ptaszka — dotknięcie odhacza z pytaniem (D59), jak każde niezrobione.
    const kartka = screen.getByTestId('task-kartka');
    expect(within(kartka).getByText(/minęło/)).toBeTruthy();
    await press(within(kartka).getByLabelText('Oznacz jako zrobione: Kartka dla babci'));
    expect(lastAlert().title).toBe('Zrobione?');
  });
});

describe('licznik listy (M-83)', () => {
  it('ten sam licznik na Listach, w grupie i w nagłówku listy; przy zakupach „do kupienia”', async () => {
    const b = sampleBase();
    put(b, 'tasks', 'kw1', { ...b.tasks!['t-kwiaty']!, id: 'kw1', title: 'Kupić doniczkę', parent_id: 't-kwiaty', deadline_mode: 'inherit', due_date: null });
    put(b, 'tasks', 'minelo', { ...b.tasks!['t-kwiaty']!, id: 'minelo', title: 'Zadzwonić', due_date: '2026-10-05', rollover: false });
    put(b, 'tasks', 'pozniej', { ...b.tasks!['t-kwiaty']!, id: 'pozniej', title: 'Opony', deadline_mode: 'none', due_date: null, start_date: '2026-10-20' });
    await open(b);
    await press(screen.getByLabelText('Listy'));
    expect(await screen.findByLabelText('Dom, Rodzina · Zadania · 3 otwarte')).toBeTruthy();
    expect(screen.getByLabelText('Zakupy na weekend, Rodzina · Zakupy · 1 do kupienia')).toBeTruthy();
    await press(screen.getByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    expect(screen.getByText(/3 otwarte/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('list-lz'));
    await screen.findByTestId('screen-list');
    expect(screen.getByText(/1 do kupienia/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(await screen.findByLabelText('Dom, 3 otwarte')).toBeTruthy();
    expect(screen.getByLabelText('Zakupy na weekend, 1 do kupienia')).toBeTruthy();
  });
});

describe('zakupy (M-22, M-109, M-224, M-225)', () => {
  it('M-109: do koszyka bez pytania, z paskiem „Cofnij” (zmiana D59); odhaczenie zadania dalej pyta', async () => {
    const { store } = await open();
    await openList('lz');
    const alerts = () => (Alert.alert as unknown as jest.Mock).mock.calls.length;
    const n = alerts();
    await press(screen.getByLabelText('Włóż do koszyka: Chleb żytni'));
    expect(alerts()).toBe(n);
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 's-chleb', set: { completed_at: '2026-10-07T08:00:00.000Z' } });
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('W koszyku: Chleb żytni')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 's-chleb', set: { completed_at: null } });
    expect(screen.getByLabelText('Włóż do koszyka: Chleb żytni')).toBeTruthy();
    // Zadanie na liście zadań — dalej z pytaniem „Zrobione?” (D59).
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText('Oznacz jako zrobione: Kupić kwiaty'));
    expect(lastAlert().title).toBe('Zrobione?');
  });

  it('M-22: zakupy osoby usuniętej z grupy są w Moich sprawach jak bez osoby; w edytorze „Nikt konkretny”', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, due_date: '2026-10-07', responsible_member_id: 'ala' });
    put(b, 'group_members', 'ala', { ...b.group_members!.ala!, deleted_at: '2026-10-07T07:00:00Z' });
    await open(b);
    expect(screen.getByTestId('today-trip-lz')).toBeTruthy();
    await openList('lz');
    expect(within(screen.getByTestId('trip')).getByText(/nikt konkretny/)).toBeTruthy();
    await press(screen.getByTestId('trip-change'));
    expect(screen.getByRole('radio', { name: 'Nikt konkretny' }).props.accessibilityState.selected).toBe(true);
    expect(screen.queryByRole('radio', { name: 'Ala' })).toBeNull();
  });

  it('M-224: „Dodaj do stałych” z panelu pozycji przy pełnej liście — komunikat, panel zostaje', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, staples: Array.from({ length: 50 }, (_, i) => `p${i}`) });
    const { store } = await open(b);
    await openList('lz');
    await press(screen.getByLabelText(/^Zmień pozycję: Chleb żytni(,|$)/));
    const n = store.dispatched.length;
    await press(screen.getByText('Dodaj do stałych'));
    expect(store.dispatched).toHaveLength(n);
    expect(within(screen.getByTestId('item-panel')).getByText('Lista stałych jest pełna (50 pozycji).')).toBeTruthy();
    // Zamknięcie panelu czyści komunikat.
    await press(within(screen.getByTestId('item-panel')).getByText('Gotowe'));
    await press(screen.getByLabelText(/^Zmień pozycję: Chleb żytni(,|$)/));
    expect(screen.queryByText(/Lista stałych jest pełna/)).toBeNull();
  });

  it('M-224: za długa nazwa pozycji — komunikat z limitem', async () => {
    const b = sampleBase();
    put(b, 'tasks', 's-dluga', { ...b.tasks!['s-chleb']!, id: 's-dluga', title: 'x'.repeat(250) });
    const { store } = await open(b);
    await openList('lz');
    await press(screen.getByLabelText(new RegExp(`^Zmień pozycję: ${'x'.repeat(250)}(,|$)`)));
    const n = store.dispatched.length;
    await press(screen.getByText('Dodaj do stałych'));
    expect(store.dispatched).toHaveLength(n);
    expect(screen.getByText('Za długa nazwa (najwyżej 200 znaków).')).toBeTruthy();
  });

  it('M-225: po „Zakupy zrobione” pasek „Cofnij” przywraca kupione pozycje, dzień i osobę', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, due_date: '2026-10-07', responsible_member_id: 'mf' });
    const { store } = await open(b);
    await openList('lz');
    await press(screen.getByTestId('trip-done'));
    await answerAlert('Zostaw na następne zakupy');
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Zakupy zrobione: Zakupy na weekend')).toBeTruthy();
    expect(screen.getByTestId('trip-plan')).toBeTruthy();
    expect(screen.queryByText('Masło')).toBeNull();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(store.dispatched.slice(-3)).toEqual([
      // PWD-11 A: wiersz zrobionych zakupów wraca do kosza (nie ma go w Kalendarzu).
      { kind: 'delete', entity: 'shopping_trips', id: 'new-1' },
      { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-07', due_time: null, responsible_member_id: 'mf' } },
      { kind: 'restore', entity: 'tasks', id: 's-maslo' },
    ]);
    expect(screen.getByTestId('trip-done')).toBeTruthy();
    expect(screen.getByText('Masło')).toBeTruthy();
  });

  it('M-225: „Zakończ: …” stałego zadania serii jest czerwony i ma „Cofnij”', async () => {
    const b = sampleBase();
    put(b, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
    put(b, 'event_task_series', 'ser', { id: 'ser', group_id: 'gf', event_id: 'ev', list_id: 'lf', title: 'Spakować strój', deleted_at: null, version: 1 });
    const { store } = await open(b);
    await press(screen.getByTestId('today-event-ev-2026-10-07'));
    await screen.findByTestId('screen-event');
    const stop = screen.getByLabelText('Zakończ: Spakować strój');
    expect(within(stop).getByText('Zakończ: Spakować strój').props.style.color).toBe(palettes.light.danger);
    const n = store.dispatched.length;
    await press(stop);
    const ops = store.dispatched.slice(n);
    expect(ops[0]).toEqual({ kind: 'delete', entity: 'event_task_series', id: 'ser' });
    expect(ops.length).toBeGreaterThan(1);
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Zakończono: Spakować strój')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    const back = store.dispatched.slice(n + ops.length);
    expect(back).toEqual([...ops].reverse().map((o) => ({ kind: 'restore', entity: (o as { entity: string }).entity, id: (o as { id: string }).id })));
    expect(await screen.findByLabelText('Zakończ: Spakować strój')).toBeTruthy();
  });
});

describe('nowa lista (M-237)', () => {
  it('pole rodzaju listy nazywa się „Rodzaj listy”', async () => {
    await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await screen.findByTestId('screen-new-list');
    expect(screen.getByLabelText('Rodzaj listy').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Zadania' }).props.accessibilityState.selected).toBe(true);
  });
});

describe('limity długości (M-228)', () => {
  it('pola nazw i szybkie dodawanie nie przyjmą więcej niż serwer i mówią o tym przy limicie', async () => {
    await open();
    // Szybkie dodawanie (tytuł zadania i pozycji zakupów: 500 znaków).
    const quick = screen.getByTestId('quick-add');
    expect(quick.props.maxLength).toBe(500);
    expect(screen.queryByText('Najwyżej 500 znaków.')).toBeNull();
    await fireEvent.changeText(quick, 'x'.repeat(500));
    expect(screen.getByText('Najwyżej 500 znaków.')).toBeTruthy();
    await fireEvent.changeText(quick, '');
    // Nazwa listy (200).
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    const name = await screen.findByTestId('list-name');
    expect(name.props.maxLength).toBe(200);
    await fireEvent.changeText(name, 'x'.repeat(199));
    expect(screen.queryByText('Najwyżej 200 znaków.')).toBeNull();
    await fireEvent.changeText(name, 'x'.repeat(200));
    expect(screen.getByText('Najwyżej 200 znaków.')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    // Stała pozycja (200).
    await press(await screen.findByTestId('list-lz'));
    await press(await screen.findByTestId('staples-edit'));
    expect(screen.getByTestId('staple-name').props.maxLength).toBe(200);
    await press(screen.getByLabelText('Wróć'));
    // Grupa: nazwa (200), imię dziecka (100), imię osoby (100).
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect((await screen.findByTestId('group-rename')).props.maxLength).toBe(200);
    expect(screen.getByTestId('child-name').props.maxLength).toBe(100);
    await press(screen.getByTestId('member-kuba'));
    expect((await screen.findByTestId('member-name')).props.maxLength).toBe(100);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Wróć'));
    // Nowa grupa (nazwa 200, moje imię 100) i dołączenie (moje imię 100).
    await press(await screen.findByLabelText('Nowa grupa'));
    expect((await screen.findByTestId('group-name')).props.maxLength).toBe(200);
    expect(screen.getByTestId('group-my-name').props.maxLength).toBe(100);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    expect((await screen.findByTestId('invite-name')).props.maxLength).toBe(100);
  });
});

describe('odrzucone polecenia stałych zakupów (M-111)', () => {
  it('opisane po ludzku w „Odrzucone zmiany”; inne nieznane polecenie — „Polecenie”', async () => {
    const s = setup();
    const rejected = [
      { op: { seq: 3, op_id: 'o3', kind: 'cmd' as const, cmd: 'staple_add', args: { list_id: 'lz', name: 'Mleko' } }, code: 'invalid:23514' },
      { op: { seq: 4, op_id: 'o4', kind: 'cmd' as const, cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mleko', 'mleko 2'] } }, code: 'deleted' },
      { op: { seq: 5, op_id: 'o5', kind: 'cmd' as const, cmd: 'grant_scope', args: {} }, code: 'forbidden' },
    ];
    await act(async () => {
      s.store.getSnapshot().state = { ...s.store.getSnapshot().state, rejected } as never;
    });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-account'));
    await press(await screen.findByTestId('open-rejected'));
    expect(await screen.findByText('Dodanie do stałych zakupów: „Mleko”')).toBeTruthy();
    expect(screen.getByText('Usunięcie ze stałych zakupów: „Mleko, mleko 2”')).toBeTruthy();
    expect(screen.getByText('Polecenie')).toBeTruthy();
  });
});

const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

describe('nazwa listy i edycja pozycji zakupów (M-107, PW-17 B)', () => {
  it('nazwa listy zapisuje się po wyjściu z pola i przy wyjściu z ekranu (D130); pusta zostawia starą', async () => {
    const { store } = await open();
    await openList('lf');
    const field = screen.getByTestId('list-rename');
    expect(field.props.value).toBe('Dom');
    expect(field.props.maxLength).toBe(200);
    await fireEvent.changeText(field, '   ');
    await fireEvent(field, 'blur');
    expect(store.dispatched).toHaveLength(0);
    expect(screen.getByTestId('list-rename').props.value).toBe('Dom');
    await fireEvent.changeText(screen.getByTestId('list-rename'), ' Dom i ogród ');
    await fireEvent(screen.getByTestId('list-rename'), 'blur');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lf', set: { name: 'Dom i ogród' } });
    expect(screen.getAllByText('Dom i ogród').length).toBeGreaterThan(0);
    // Bez wyjścia z pola: zapis przy opuszczeniu ekranu.
    await fireEvent.changeText(screen.getByTestId('list-rename'), 'Dom 2');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-lists');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lf', set: { name: 'Dom 2' } });
    expect(screen.getByLabelText('Dom 2, Rodzina · Zadania · 3 otwarte')).toBeTruthy();
  });

  it('dziecko nie zmienia nazwy listy', async () => {
    const b = sampleBase();
    put(b, 'group_members', 'mf', { ...b.group_members!.mf!, role: 'child' });
    await open(b);
    await openList('lf');
    expect(screen.queryByTestId('list-rename')).toBeNull();
  });

  it('pozycja zakupów: nazwa i ilość w panelu pozycji, zapis od razu; zamknięcie panelu też zapisuje', async () => {
    const { store } = await open();
    await openList('lz');
    await press(screen.getByLabelText(/^Zmień pozycję: Chleb żytni(,|$)/));
    const panel = screen.getByTestId('item-panel');
    const name = within(panel).getByTestId('item-name');
    expect(name.props.value).toBe('Chleb żytni');
    expect(name.props.maxLength).toBe(500);
    await fireEvent.changeText(name, 'Chleb żytni 2');
    await fireEvent(name, 'submitEditing');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 's-chleb', set: { title: 'Chleb żytni 2' } });
    expect(within(screen.getByTestId('task-s-chleb')).getByText(/^2 · czeka na wysłanie$/)).toBeTruthy();
    // Zmiana bez zatwierdzenia, potem „Gotowe” — panel się zamyka i zapisuje.
    await fireEvent.changeText(within(screen.getByTestId('item-panel')).getByTestId('item-name'), 'Chleb razowy 1 szt.');
    await press(within(screen.getByTestId('item-panel')).getByLabelText('Gotowe'));
    expect(screen.queryByTestId('item-panel')).toBeNull();
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 's-chleb', set: { title: 'Chleb razowy 1 szt.' } });
    expect(screen.getByLabelText(/^Zmień pozycję: Chleb razowy(,|$)/)).toBeTruthy();
    // Zmiana nazwy, potem wybór działu (panel się zamyka) — oba zapisane.
    await press(screen.getByLabelText(/^Zmień pozycję: Chleb razowy(,|$)/));
    await fireEvent.changeText(within(screen.getByTestId('item-panel')).getByTestId('item-name'), 'Bułki');
    await press(within(screen.getByTestId('item-panel')).getByRole('radio', { name: 'Pieczywo' }));
    expect(store.dispatched.slice(-2)).toEqual([
      { kind: 'patch', entity: 'tasks', id: 's-chleb', set: { category: 'bakery' } },
      { kind: 'patch', entity: 'tasks', id: 's-chleb', set: { title: 'Bułki' } },
    ]);
  });

  it('„Tylko ja” przy liście prywatnej: na Listach, w grupie i w nagłówku listy', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lprv', { ...b.lists!.lf!, id: 'lprv', name: 'Prezenty', visibility: 'private', owner_member_id: 'mf' });
    await open(b);
    await press(screen.getByLabelText('Listy'));
    expect(await screen.findByLabelText('Prezenty, Rodzina · Zadania · Tylko ja · 0 otwartych')).toBeTruthy();
    expect(screen.getByLabelText('Dom, Rodzina · Zadania · 3 otwarte')).toBeTruthy();
    await press(screen.getByTestId('list-lprv'));
    await screen.findByTestId('screen-list');
    // Domyślne porównanie tekstu w RNTL zwija spacje („  ·  ” → „ · ”).
    expect(screen.getByText('Rodzina · Tylko ja · 0 otwartych')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(await screen.findByLabelText('Prezenty, Tylko ja · 0 otwartych')).toBeTruthy();
  });
});

describe('wyjątki od D68 (M-108, PW-18 A + b)', () => {
  it('b: w zadaniu można zdjąć termin i osobę — zostaje dopisek, że nikt tego nie widzi', async () => {
    const { store } = await open();
    await openList('lf');
    await press(screen.getByLabelText(/^Otwórz: Kupić kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByTestId('task-no-addressee')).toBeNull();
    await press(radio('Kiedy', 'Bez terminu'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'none', due_date: null } });
    expect(await screen.findByTestId('task-no-addressee')).toBeTruthy();
    expect(screen.queryByText(/Najpierw ustaw/)).toBeNull();
    // Osoba, a potem znowu „Nikt konkretny” — też bez blokady.
    await press(radio('Dla kogo', 'Ala'));
    expect(screen.queryByTestId('task-no-addressee')).toBeNull();
    await press(radio('Dla kogo', 'Nikt konkretny'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { assignee_member_id: null } });
    expect(screen.getByTestId('task-no-addressee')).toBeTruthy();
  });

  it('b: pełny formularz we wspólnej grupie bez osoby i terminu zapisuje z dopiskiem', async () => {
    const { store } = await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'nowy odkurzacz');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.queryByTestId('form-no-addressee')).toBeNull();
    await press(radio('Grupa', 'Rodzina'));
    expect(screen.getByTestId('form-no-addressee').props.children).toBe('Nikt nie widzi tego zadania w Moich sprawach. Wybierz osobę („Dla kogo”) albo ustaw termin.');
    await press(screen.getByTestId('form-save'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { title: 'nowy odkurzacz', deadline_mode: 'none' } });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('A: lista „Tylko ja” — bez dopisku, a zadanie bez osoby jest w moich Moich sprawach', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lprv', { ...b.lists!.lf!, id: 'lprv', name: 'Prezenty', visibility: 'private', owner_member_id: 'mf' });
    put(b, 'tasks', 'p-szalik', { ...b.tasks!['t-kwiaty']!, id: 'p-szalik', list_id: 'lprv', title: 'Szalik dla Ali', deadline_mode: 'none', due_date: null });
    const { store } = await open(b);
    expect(screen.getByLabelText(/^Otwórz: Szalik dla Ali(,|$)/)).toBeTruthy();
    await openList('lprv');
    expect(within(screen.getByTestId('task-p-szalik')).queryByText(/nikt tego nie widzi/)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'książka');
    await press(screen.getByLabelText('Dodaj'));
    const created = store.dispatched.at(-1) as { id: string };
    expect(created).toMatchObject({ kind: 'create', set: { list_id: 'lprv', title: 'książka' } });
    expect(within(await screen.findByTestId(`task-${created.id}`)).queryByText(/nikt tego nie widzi/)).toBeNull();
  });

  it('A: zakupy na liście „Tylko ja” bez dnia i osoby — jak w grupie osobistej (zapis bez blokady)', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lzp', { ...b.lists!.lz!, id: 'lzp', name: 'Prezenty do kupienia', visibility: 'private', owner_member_id: 'mf' });
    const { store } = await open(b);
    await openList('lzp');
    await press(screen.getByTestId('trip-plan'));
    expect(screen.queryByText(/We wspólnej grupie wybierz osobę albo dzień/)).toBeNull();
    expect(screen.getByTestId('trip-save').props.accessibilityState.disabled).toBe(false);
    await press(screen.getByTestId('trip-save'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lzp', set: { due_date: null, due_time: null, responsible_member_id: null } });
  });
});

describe('minione kopie zadania powtarzanego (M-283, PWD-14 A)', () => {
  it('w „Zrobione” jeden wiersz „N razy minęło”; dotknięcie rozwija i zwija', async () => {
    const b = sampleBase();
    let id = 'leki';
    const ids: string[] = [];
    for (const d of ['03', '04', '05', '06', '07']) {
      task(b, id, { title: 'Leki', deadline_mode: 'own', due_date: `2026-10-${d}`, rollover: false, repeat: 'FREQ=DAILY' });
      ids.push(id);
      id = nextId(id);
    }
    await open(b);
    await openList('lp');
    // Dzisiejsza kopia (7.10) jest w otwartych; cztery minione — zwinięte.
    expect(screen.getByTestId(`task-${ids[4]}`)).toBeTruthy();
    for (const x of ids.slice(0, 4)) expect(screen.queryByTestId(`task-${x}`)).toBeNull();
    const run = screen.getByLabelText('Leki, 4 razy minęło, dotknij, by zobaczyć');
    expect(run.props.accessibilityState.expanded).toBe(false);
    await press(run);
    expect(screen.getByLabelText('Leki, 4 razy minęło, dotknij, by zwinąć').props.accessibilityState.expanded).toBe(true);
    for (const x of ids.slice(0, 4)) expect(within(screen.getByTestId(`task-${x}`)).getByText(/minęło/)).toBeTruthy();
    expect(screen.getByTestId(`task-${ids[0]}`).props.style.marginLeft).toBe(22);
    await press(screen.getByLabelText('Leki, 4 razy minęło, dotknij, by zwinąć'));
    expect(screen.queryByTestId(`task-${ids[0]}`)).toBeNull();
  });
});

