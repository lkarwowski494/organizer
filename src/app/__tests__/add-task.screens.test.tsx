/** Szybkie i pełne dodawanie (D90, D91): „Więcej”, pasek „Dodano · Zmień”, przeniesienie do grupy z osobą, „@imię”. */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { parseQuickAdd } from '../../domain/quickadd';
import { createTask } from '../../domain/views/commands';
import { RootStack } from '../navigation';
import { expectOps, NOW, put, sampleBase, setup, pickDate, setTime } from './harness';

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

describe('szybkie dodanie i „Zmień” (D178: jeden ekran zmiany zadania)', () => {
  it('basen jutro 19.00 → Osobiste; „Zmień” otwiera ekran zadania; „Przenieś do grupy” → Rodzina z podzadaniami, z „Cofnij”', async () => {
    const { store } = await open();
    await type('Basen jutro 19.00');
    const created = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'tasks') as { id: string };
    expect(created).toMatchObject({ group_id: 'u-me', set: { title: 'Basen', due_date: '2026-10-08', due_time: '19:00' } });
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Dodano: Basen · Osobiste')).toBeTruthy();
    // W tej chwili ktoś dodaje podzadania (np. drugi ekran) — przeniesienie bierze je ze sobą (audyt 2: T-33).
    await act(async () => store.dispatch([0, 1].map((i) => createTask({ id: `sub-${i}`, groupId: 'u-me', listId: 'lp', parentId: created.id, parsed: parseQuickAdd(`czepek ${i}`, NOW) }))));
    await press(within(bar).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    expect(screen.getByTestId('task-title').props.value).toBe('Basen');
    expect(screen.queryByTestId('screen-add-task')).toBeNull();
    await press(screen.getByTestId('task-move'));
    const panel = screen.getByTestId('move-groups');
    expect(within(panel).queryByLabelText('Osobiste')).toBeNull(); // już tam jest
    expect(within(panel).getByLabelText('Klasa 2b')).toBeTruthy();
    const before = store.dispatched.length;
    await press(within(panel).getByLabelText('Rodzina'));
    // D97: ogólna lista „Zadania” grupy — powstaje, bo jej nie było; kopia zadania i obu podzadań, oryginał do kosza.
    const moved = store.dispatched.slice(before);
    expect(moved.map((o) => [o.kind, (o as { entity: string }).entity])).toEqual([['create', 'lists'], ['create', 'tasks'], ['create', 'tasks'], ['create', 'tasks'], ['delete', 'tasks']]);
    expect(moved[1]).toMatchObject({ group_id: 'gf', set: { list_id: (moved[0] as { id: string }).id, title: 'Basen', due_date: '2026-10-08', due_time: '19:00', parent_id: null } });
    expect(moved[2]).toMatchObject({ group_id: 'gf', set: { title: 'czepek 0', parent_id: (moved[1] as { id: string }).id } });
    expect(moved[4]).toEqual({ kind: 'delete', entity: 'tasks', id: created.id });
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(within(screen.getByTestId('undo-bar')).getByText('Przeniesiono do „Rodzina”: Basen')).toBeTruthy();
    await press(within(screen.getByTestId('undo-bar')).getByLabelText('Cofnij'));
    // Utworzenie, podzadania z drugiego ekranu, przeniesienie (lista, kopie, oryginał do kosza) i cofnięcie (oryginał wraca, kopie i lista do kosza).
    expectOps(store, [
      { kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'Basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: '19:00' } },
      { kind: 'create', entity: 'tasks', id: 'sub-0', group_id: 'u-me', set: { list_id: 'lp', parent_id: 'new-1', title: 'czepek 0', sort_key: 'a0', deadline_mode: 'inherit', due_date: null, due_time: null } },
      { kind: 'create', entity: 'tasks', id: 'sub-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: 'new-1', title: 'czepek 1', sort_key: 'a0', deadline_mode: 'inherit', due_date: null, due_time: null } },
      { kind: 'create', entity: 'lists', id: 'new-2', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } },
      { kind: 'create', entity: 'tasks', id: 'new-3', group_id: 'gf', set: { list_id: 'new-2', parent_id: null, title: 'Basen', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-10-08', due_time: '19:00', rollover: true } },
      { kind: 'create', entity: 'tasks', id: 'new-4', group_id: 'gf', set: { list_id: 'new-2', parent_id: 'new-3', title: 'czepek 0', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true } },
      { kind: 'create', entity: 'tasks', id: 'new-5', group_id: 'gf', set: { list_id: 'new-2', parent_id: 'new-3', title: 'czepek 1', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'inherit', due_date: null, due_time: null, rollover: true } },
      { kind: 'delete', entity: 'tasks', id: 'new-1' },
      { kind: 'restore', entity: 'tasks', id: 'new-1' },
      { kind: 'delete', entity: 'tasks', id: 'new-5' },
      { kind: 'delete', entity: 'tasks', id: 'new-4' },
      { kind: 'delete', entity: 'tasks', id: 'new-3' },
      { kind: 'delete', entity: 'lists', id: 'new-2' },
    ]);
  });

  it('podzadanie i zadanie w trakcie przekazania nie mają „Przenieś do grupy”', async () => {
    const base = sampleBase();
    put(base, 'tasks', 's-1', { ...base.tasks!['t-paczka']!, id: 's-1', parent_id: 't-paczka', title: 'Kod odbioru', deadline_mode: 'inherit', due_date: null, due_time: null });
    put(base, 'handoffs', 'h1', { id: 'h1', group_id: 'gf', entity: 'tasks', entity_id: 't-paczka', occurrence_date: null, from_member_id: 'mf', to_member_id: 'ala', status: 'pending', created_at: '2026-10-07T07:00:00Z', deleted_at: null, version: 1 });
    await open(base);
    await press(screen.getByLabelText(/^Otwórz: Odebrać paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByTestId('task-move')).toBeNull();
    await press(screen.getByLabelText(/^Otwórz: Kod odbioru(,|$)/));
    expect(screen.queryByTestId('task-move')).toBeNull();
  });
});

describe('„Więcej” — pełny formularz', () => {
  it('wypełniony tym, co wpisałem; jutro, osoba, powtarzanie co tydzień; bez wyboru listy; zapis nowego zadania', async () => {
    const base = sampleBase();
    put(base, 'lists', 'lk2', { ...base.lists!.lk!, id: 'lk2', name: 'Zadania' });
    const { store } = await open(base);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Trening w piątek o 17');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Nowe zadanie')).toBeTruthy();
    expect(screen.getByTestId('form-title').props.value).toBe('Trening');
    expect(screen.getByTestId('form-date').props.accessibilityValue.text).toBe('2026-10-09');
    expect(radio('Kiedy', 'pt. 9 paź').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByLabelText('Lista')).toBeNull();
    await press(radio('Grupa', 'Klasa 2b'));
    await press(radio('Kiedy', 'Jutro'));
    await press(radio('Powtarzaj', 'Co tydzień'));
    await press(radio('Dla kogo', 'Pani Ewa'));
    await press(screen.getByTestId('form-save'));
    const tail = store.dispatched.slice(-2);
    expect(tail[0]).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gk', set: { list_id: 'lk2', title: 'Trening', due_date: '2026-10-08', due_time: '17:00', assignee_member_id: 'kx' } });
    expect(tail[1]).toMatchObject({ kind: 'patch', set: { repeat: 'FREQ=WEEKLY;BYDAY=TH' } });
    expect(screen.getByTestId('quick-add').props.value).toBe('');
  });

  it('błędy: pusta nazwa, zła godzina; wspólna grupa bez osoby i terminu — dopisek (PW-18 b); „Bez terminu” czyści dzień; bez „Anuluj”', async () => {
    const { store } = await open();
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Ustaw termin, żeby zadanie mogło się powtarzać.')).toBeTruthy();
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Zebranie');
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    await press(radio('Grupa', 'Rodzina'));
    expect(screen.getByTestId('form-no-addressee')).toBeTruthy();
    await press(radio('Kiedy', 'Dziś'));
    expect(screen.queryByTestId('form-no-addressee')).toBeNull();
    await setTime('form-time', '25:00');
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText('Wpisz godzinę jako GG:MM, np. 17:30')).toBeTruthy();
    await press(radio('Kiedy', 'Bez terminu'));
    expect(screen.getByTestId('form-date').props.accessibilityValue.text).toBe('');
    expect(screen.getByTestId('form-time').props.accessibilityValue.text).toBe('');
    // PWD-6: bez „Anuluj” — wystarczą gest i „Wróć” (wpisane zostaje w szkicu, D179).
    expect(screen.queryByText('Anuluj')).toBeNull();
    const before = store.dispatched.length;
    await press(screen.getByLabelText('Wróć'));
    expect(store.dispatched.length).toBe(before);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('grupa bez ogólnej listy: zapis tworzy listę „Zadania”', async () => {
    const base = sampleBase();
    put(base, 'lists', 'lk', { ...base.lists!.lk!, deleted_at: '2026-10-01T00:00:00Z' });
    const { store } = await open(base);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Wycieczka jutro');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(radio('Grupa', 'Klasa 2b'));
    await press(screen.getByTestId('form-save'));
    expect(store.dispatched.slice(-2).map((o) => [o.kind, (o as { entity: string }).entity])).toEqual([['create', 'lists'], ['create', 'tasks']]);
  });
});

describe('@imię', () => {
  it('jedno dopasowanie: grupa i osoba z tekstu, pasek z nazwą grupy', async () => {
    const { store } = await open();
    await type('Basen jutro 19.00 @ala');
    const [list, task] = store.dispatched.slice(-2);
    expect(list).toMatchObject({ kind: 'create', entity: 'lists', group_id: 'gf', set: { name: 'Zadania' } });
    expect(task).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: (list as { id: string }).id, title: 'Basen', due_time: '19:00', assignee_member_id: 'ala' } });
    expect(screen.getByText('Dodano: Basen · Rodzina')).toBeTruthy();
  });

  it('kilka dopasowań: pytanie, wybór osoby i grupy; anuluj nic nie dodaje; brak dopasowania — pytanie, czy bez osoby', async () => {
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
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gk', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gk', set: { list_id: 'new-1', parent_id: null, title: 'Zebranie', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null, assignee_member_id: 'kala' } }]);
    // Audyt 2 (M-169): nieznane „@zenek” nie trafia po cichu do Osobistych — pytanie; „Dodaj bez osoby” zostawia je w nazwie.
    const n = store.dispatched.length;
    await type('Zebranie jutro @zenek');
    expect(screen.getByText('Nie ma @zenek w Twoich grupach')).toBeTruthy();
    expect(store.dispatched.length).toBe(n);
    await press(screen.getByText('Dodaj bez osoby'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-3', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'Zebranie @zenek', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    expect(screen.queryByTestId('mention-unknown')).toBeNull();
    // Zmiana tekstu chowa pytanie.
    await type('x @al');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'x');
    expect(screen.queryByTestId('mention-choices')).toBeNull();
  });
});

describe('zadanie albo wydarzenie (D98, D99)', () => {
  it('przełącznik w formularzu zadania: wpisane przechodzi do wydarzenia i z powrotem', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Basen jutro 19.00 @ala');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(radio('Rodzaj', 'Wydarzenie'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByTestId('event-title').props.value).toBe('Basen');
    expect(screen.getByTestId('event-date').props.accessibilityValue.text).toBe('2026-10-08');
    expect(screen.getByTestId('event-start-0').props.accessibilityValue.text).toBe('19:00');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
    expect(radio('Osoba odpowiedzialna', 'Ala').props.accessibilityState.selected).toBe(true);
    await setTime('event-start-0', '18:00');
    await press(radio('Rodzaj', 'Zadanie'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByTestId('form-title').props.value).toBe('Basen');
    expect(screen.getByTestId('form-time').props.accessibilityValue.text).toBe('18:00');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
    // Bez daty w zadaniu — wydarzenie na dziś; dziecko nie zostaje osobą odpowiedzialną, tylko uczestnikiem (M-255).
    await press(radio('Kiedy', 'Bez terminu'));
    await press(radio('Dla kogo', 'Kuba'));
    expect(radio('Rodzaj', 'Wydarzenie').props.accessibilityHint).toBe('Otwiera formularz wydarzenia, wpisane dane zostają');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await press(radio('Rodzaj', 'Wydarzenie'));
    await screen.findByTestId('screen-event-edit');
    expect(announce).toHaveBeenCalledWith('Nowe wydarzenie');
    expect(screen.getByTestId('event-date').props.accessibilityValue.text).toBe('2026-10-07');
    expect(radio('Osoba odpowiedzialna', 'Nikt konkretny').props.accessibilityState.selected).toBe(true);
    expect(radio('Kogo dotyczy', 'Wybrane osoby').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Uczestnik: Kuba').props.accessibilityState).toMatchObject({ checked: true });
    // Całodniowe — do zadania bez godziny; dzień z kalendarza przechodzi.
    await press(radio('Pora', 'Cały dzień'));
    await pickDate('event-date', '2026-10-09');
    await press(radio('Rodzaj', 'Zadanie'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByTestId('form-time').props.accessibilityValue.text).toBe('');
    expect(screen.getByTestId('form-date').props.accessibilityValue.text).toBe('2026-10-09');
    // Przycisk „Zadanie” w formularzu zadania niczego nie zmienia.
    await press(radio('Rodzaj', 'Zadanie'));
    expect(screen.getByTestId('screen-add-task')).toBeTruthy();
  });

  it('szybkie dodanie z zakresem godzin tworzy wydarzenie; „Zmień” otwiera edycję wydarzenia; odklikany zakres — zadanie', async () => {
    const { store } = await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Basen jutro 17–18');
    expect(screen.getByLabelText(/17–18/)).toBeTruthy();
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expectOps(store, [{ kind: 'create', entity: 'events', id: 'new-1', group_id: 'u-me', set: { title: 'Basen', start_date: '2026-10-08', start_time: '17:00', end_time: '18:00', rrule: null, audience: 'group', responsible_member_id: null } }]);
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Dodano wydarzenie: Basen · Osobiste')).toBeTruthy();
    // D189: „Zmień” przy wydarzeniu otwiera od razu jego edycję.
    await press(within(bar).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-event-edit')).toBeTruthy();
    expect(screen.getByTestId('event-title').props.value).toBe('Basen');
  });

  it('odklikany zakres — zwykłe zadanie; @imię z zakresem — wydarzenie w grupie z osobą odpowiedzialną', async () => {
    const { store } = await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Basen 17-18');
    await press(screen.getByLabelText(/17-18/));
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'Basen 17-18', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    await type('Zebranie jutro od 17 do 18 @ala');
    expectOps(store, [{ kind: 'create', entity: 'events', id: 'new-2', group_id: 'gf', set: { title: 'Zebranie', start_date: '2026-10-08', start_time: '17:00', end_time: '18:00', rrule: null, audience: 'group', responsible_member_id: 'ala' } }]);
    expect(screen.getByText('Dodano wydarzenie: Zebranie · Rodzina')).toBeTruthy();
  });

  it('„Więcej” z zakresem godzin otwiera formularz wydarzenia', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Basen jutro 17–18:30 @ala');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByTestId('event-title').props.value).toBe('Basen');
    expect(screen.getByTestId('event-start-0').props.accessibilityValue.text).toBe('17:00');
    expect(screen.getByTestId('event-end-0').props.accessibilityValue.text).toBe('18:30');
    expect(radio('Osoba odpowiedzialna', 'Ala').props.accessibilityState.selected).toBe(true);
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Basen z Kubą');
    expect(screen.getByTestId('event-title').props.value).toBe('Basen z Kubą');
  });
});
