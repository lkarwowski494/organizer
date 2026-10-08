/** Szybkie i pełne dodawanie (D90, D91): „Więcej”, pasek „Dodano · Zmień”, przeniesienie do grupy z osobą, „@imię”. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const type = async (text: string) => {
  await fireEvent.changeText(screen.getByTestId('quick-add'), text);
  await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
};
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

describe('szybkie dodanie i „Zmień”', () => {
  it('basen jutro 19.00 → Osobiste; „Zmień” → Rodzina, Ala odpowiedzialna: kopia w Rodzinie, oryginał do kosza', async () => {
    const { store } = await open();
    await type('Basen jutro 19.00');
    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks');
    expect(created).toMatchObject({ group_id: 'u-me', set: { title: 'Basen', due_date: '2026-10-08', due_time: '19:00' } });
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Dodano: Basen · Osobiste')).toBeTruthy();
    await press(within(bar).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-add-task')).toBeTruthy();
    expect(screen.getByText('Zmień zadanie')).toBeTruthy();
    expect(screen.getByTestId('form-title').props.value).toBe('Basen');
    expect(screen.getByTestId('form-time').props.value).toBe('19:00');
    await press(radio('Grupa', 'Rodzina'));
    expect(screen.getByText(/powstanie tam kopia/)).toBeTruthy();
    await press(radio('Dla kogo', 'Ala'));
    await press(screen.getByTestId('form-save'));
    const tail = store.dispatched.slice(-2);
    expect(tail[0]).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: 'lf', title: 'Basen', due_date: '2026-10-08', due_time: '19:00', assignee_member_id: 'ala' } });
    expect(tail[1]).toEqual({ kind: 'delete', entity: 'tasks', id: (created as { id: string }).id });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });
});

describe('„Więcej” — pełny formularz', () => {
  it('wypełniony tym, co wpisałem; jutro, lista, osoba, powtarzanie co tydzień; zapis nowego zadania', async () => {
    const { store } = await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Trening w piątek o 17');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Nowe zadanie')).toBeTruthy();
    expect(screen.getByTestId('form-title').props.value).toBe('Trening');
    expect(screen.getByTestId('form-date').props.value).toBe('2026-10-09');
    expect(radio('Termin', '2026-10-09').props.accessibilityState.selected).toBe(true);
    await press(radio('Grupa', 'Klasa 2b'));
    await press(radio('Termin', 'Jutro'));
    await press(radio('Powtarzaj', 'Co tydzień'));
    await press(radio('Dla kogo', 'Pani Ewa'));
    await press(screen.getByTestId('form-save'));
    const tail = store.dispatched.slice(-2);
    expect(tail[0]).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gk', set: { list_id: 'lk', title: 'Trening', due_date: '2026-10-08', due_time: '17:00', assignee_member_id: 'kx' } });
    expect(tail[1]).toMatchObject({ kind: 'patch', set: { repeat: 'FREQ=WEEKLY;BYDAY=TH' } });
    expect(screen.getByTestId('quick-add').props.value).toBe('');
  });

  it('błędy: pusta nazwa, wspólna grupa bez osoby i terminu, zła godzina; „Bez terminu” czyści dzień; anuluj', async () => {
    const { store } = await open();
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Ustaw termin, żeby zadanie mogło się powtarzać.')).toBeTruthy();
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Zebranie');
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    await press(radio('Grupa', 'Rodzina'));
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText(/zadanie musi mieć osobę albo termin/)).toBeTruthy();
    await press(radio('Termin', 'Dziś'));
    await fireEvent.changeText(screen.getByTestId('form-time'), '25:00');
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText('Wpisz godzinę jako GG:MM, np. 17:30')).toBeTruthy();
    await press(radio('Termin', 'Bez terminu'));
    expect(screen.getByTestId('form-date').props.value).toBe('');
    expect(screen.getByTestId('form-time').props.value).toBe('');
    const before = store.dispatched.length;
    await press(screen.getByText('Anuluj'));
    expect(store.dispatched.length).toBe(before);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('grupa bez listy zadań: „Nowa lista „Zadania”” i zapis tworzy listę', async () => {
    const base = sampleBase();
    put(base, 'lists', 'lk', { ...base.lists!.lk!, deleted_at: '2026-10-01T00:00:00Z' });
    const { store } = await open(base);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Wycieczka jutro');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(radio('Grupa', 'Klasa 2b'));
    expect(radio('Lista', 'Nowa lista „Zadania”')).toBeTruthy();
    await press(screen.getByTestId('form-save'));
    expect(store.dispatched.slice(-2).map((o) => [o.kind, (o as { entity: string }).entity])).toEqual([['create', 'lists'], ['create', 'tasks']]);
  });
});

describe('@imię', () => {
  it('jedno dopasowanie: grupa i osoba z tekstu, pasek z nazwą grupy', async () => {
    const { store } = await open();
    await type('Basen jutro 19.00 @ala');
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: 'lf', title: 'Basen', due_time: '19:00', assignee_member_id: 'ala' } });
    expect(screen.getByText('Dodano: Basen · Rodzina')).toBeTruthy();
  });

  it('kilka dopasowań: pytanie, wybór osoby i grupy; anuluj nic nie dodaje; brak dopasowania — zwykły tekst', async () => {
    const base = sampleBase();
    put(base, 'group_members', 'kala', { member_id: 'kala', group_id: 'gk', user_id: 'u-kala', display_name: 'Alicja', role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
    const { store } = await open(base);
    const before = store.dispatched.length;
    await type('Zebranie jutro @al');
    expect(screen.getByText('Kogo masz na myśli: @al?')).toBeTruthy();
    await press(screen.getByText('Anuluj'));
    expect(screen.queryByTestId('mention-choices')).toBeNull();
    expect(store.dispatched.length).toBe(before);
    await type('Zebranie jutro @al');
    await press(screen.getByText('Alicja · Klasa 2b'));
    expect(store.dispatched.at(-1)).toMatchObject({ group_id: 'gk', set: { title: 'Zebranie', assignee_member_id: 'kala' } });
    await type('Zebranie jutro @zenek');
    expect(store.dispatched.at(-1)).toMatchObject({ group_id: 'u-me', set: { title: 'Zebranie @zenek' } });
    // Zmiana tekstu chowa pytanie.
    await type('x @al');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'x');
    expect(screen.queryByTestId('mention-choices')).toBeNull();
  });
});
