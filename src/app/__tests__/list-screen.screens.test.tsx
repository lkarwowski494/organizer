/**
 * Ekran listy i zakupy (audyt 2, paczka „Listy i zakupy”): podzadania zrobionego rodzica i minione (M-82), jeden licznik
 * listy (M-83), zakupy osoby usuniętej z grupy (M-22), błąd „Dodaj do stałych” z panelu pozycji (M-224), „Cofnij” po
 * „Zakupy zrobione” i po „Zakończ: …” (M-225), nazwa pola rodzaju listy (M-237), limity długości pól (M-228),
 * odrzucone polecenia stałych zakupów (M-111).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { palettes } from '../../config/theme';
import type { Row } from '../../domain/sync-engine/client';
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
    task(b, 'odk', { title: 'Odkurzyć', parent_id: 'sprz', deadline_mode: 'inherit' });
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

describe('zakupy (M-22, M-224, M-225)', () => {
  it('M-22: zakupy osoby usuniętej z grupy są w Moich sprawach jak bez osoby; w edytorze „Nikt konkretny”', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, due_date: '2026-10-07', responsible_member_id: 'ala' });
    put(b, 'group_members', 'ala', { ...b.group_members!.ala!, deleted_at: '2026-10-07T07:00:00Z' });
    await open(b);
    expect(screen.getByTestId('today-trip-lz')).toBeTruthy();
    await openList('lz');
    expect(within(screen.getByTestId('trip')).getByText(/ktokolwiek/)).toBeTruthy();
    await press(screen.getByTestId('trip-change'));
    expect(screen.getByRole('radio', { name: 'Nikt konkretny' }).props.accessibilityState.selected).toBe(true);
    expect(screen.queryByRole('radio', { name: 'Ala' })).toBeNull();
  });

  it('M-224: „Dodaj do stałych” z panelu pozycji przy pełnej liście — komunikat, panel zostaje', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, staples: Array.from({ length: 50 }, (_, i) => `p${i}`) });
    const { store } = await open(b);
    await openList('lz');
    await press(screen.getByLabelText(/^Zmień dział: Chleb żytni(,|$)/));
    const n = store.dispatched.length;
    await press(screen.getByText('Dodaj do stałych'));
    expect(store.dispatched).toHaveLength(n);
    expect(within(screen.getByTestId('category-picker')).getByText('Lista stałych jest pełna (50 pozycji).')).toBeTruthy();
    // Zamknięcie panelu czyści komunikat.
    await press(within(screen.getByTestId('category-picker')).getByText('Anuluj'));
    await press(screen.getByLabelText(/^Zmień dział: Chleb żytni(,|$)/));
    expect(screen.queryByText(/Lista stałych jest pełna/)).toBeNull();
  });

  it('M-224: za długa nazwa pozycji — komunikat z limitem', async () => {
    const b = sampleBase();
    put(b, 'tasks', 's-dluga', { ...b.tasks!['s-chleb']!, id: 's-dluga', title: 'x'.repeat(250) });
    const { store } = await open(b);
    await openList('lz');
    await press(screen.getByLabelText(new RegExp(`^Zmień dział: ${'x'.repeat(250)}(,|$)`)));
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
    expect(store.dispatched.slice(-2)).toEqual([
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
