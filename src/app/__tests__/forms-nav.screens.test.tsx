/**
 * Audyt 2, paczka P13 (formularze i nawigacja): grupa domyślna w formularzach (PW-37), brak obiektu (M-131), „Następne
 * kroki” (M-117), wybór osoby w dużej grupie (PWD-30), walidacja po naciśnięciu (PWD-5), ekran imienia (M-242), zadania
 * na ekranie wydarzenia (M-130, PWD-7), wiersz wydarzenia z iPhone'a (M-253).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { DEFAULT_GROUP_KEY, LAST_USED_GROUP_KEY } from '../default-group';
import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const selected = (group: string, name: string) => within(screen.getByLabelText(group)).getByLabelText(name).props.accessibilityState.selected;

async function open(base = sampleBase(), local: Record<string, string> = {}) {
  const s = setup({ base });
  for (const [k, v] of Object.entries(local)) s.services.local!.save(k, v);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('PW-37 A (M-118): formularze wydarzenia, rutyny i listy startują z „Grupy domyślnej”', () => {
  it('ustawiona grupa — Rodzina w wydarzeniu, rutynie i liście; zapis zapamiętuje ostatnio użytą', async () => {
    const s = await open(sampleBase(), { [DEFAULT_GROUP_KEY]: 'gf' });
    await press(screen.getByTestId('tab-Calendar'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    expect(selected('Grupa', 'Rodzina')).toBe(true);
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByTestId('calendar-add-routine'));
    await screen.findByTestId('screen-routine');
    expect(selected('Grupa', 'Rodzina')).toBe(true);
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByTestId('tab-Lists'));
    await press(await screen.findByLabelText('Nowa lista'));
    expect(selected('Grupa', 'Rodzina')).toBe(true);
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Klasa 2b'));
    await fireEvent.changeText(screen.getByTestId('list-name'), 'Wycieczka');
    await press(screen.getByTestId('create-list'));
    expect(s.services.local!.load(LAST_USED_GROUP_KEY)).toBe('gk');
  });

  it('„Ostatnio użyta”: wydarzenie startuje z ostatnio użytej grupy (także „Dodaj wydarzenie” bez grupy)', async () => {
    await open(sampleBase(), { [LAST_USED_GROUP_KEY]: 'gk' });
    await press(screen.getByTestId('tab-Calendar'));
    await press(await screen.findByTestId('calendar-add-event'));
    expect(selected('Grupa', 'Klasa 2b')).toBe(true);
  });
});

describe('M-131: rzeczy, której nie ma — powód zamiast „Spróbuj jeszcze raz”', () => {
  it('zadanie i lista znikają z danych (np. utrata dostępu) — ekran mówi, co się stało', async () => {
    const s = await open();
    await press(screen.getByLabelText(/^Odebrać paczkę,/));
    await screen.findByTestId('screen-task');
    await act(async () =>
      s.store.pull((b) => {
        const tasks = { ...b.tasks };
        delete tasks['t-paczka'];
        return { ...b, tasks };
      }),
    );
    expect(await screen.findByText('Tego zadania już nie ma — ktoś je usunął albo nie masz już do niego dostępu.')).toBeTruthy();
    expect(screen.queryByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByTestId('tab-Lists'));
    await press(await screen.findByTestId('list-lf'));
    await act(async () =>
      s.store.pull((b) => {
        const lists = { ...b.lists };
        delete lists.lf;
        return { ...b, lists };
      }),
    );
    expect(await screen.findByText('Tej listy już nie ma — ktoś ją usunął albo nie masz już do niej dostępu.')).toBeTruthy();
  });
});

describe('ekran grupy: „Następne kroki”, dziecko, puste listy', () => {
  it('M-117: grupa bez listy zakupów — „Utwórz listę zakupów” otwiera nową listę zakupów w tej grupie', async () => {
    const prefsMap = new Map([['welcomeSeen', '1'], ['nextSteps.gk', '1']]);
    const s = setup({ base: sampleBase(), prefs: { get: async (k) => prefsMap.get(k) ?? null, set: async (k, v) => void prefsMap.set(k, v) } });
    await s.renderApp(<RootStack />);
    await press(await screen.findByTestId('tab-Groups'));
    await press(await screen.findByTestId('group-gk'));
    await screen.findByTestId('screen-group');
    // W Klasie jestem członkiem — karta pokazuje się tylko tym, którzy zapraszają.
    expect(screen.queryByTestId('next-steps')).toBeNull();
    await act(async () => s.store.pull((b) => ({ ...b, group_members: { ...b.group_members, mk: { ...b.group_members!.mk!, role: 'admin' } } })));
    expect(await screen.findByTestId('next-steps')).toBeTruthy();
    await press(screen.getByTestId('next-new-shopping'));
    expect(await screen.findByText('Nowa lista zakupów')).toBeTruthy();
    expect(selected('Grupa', 'Klasa 2b')).toBe(true);
  });

  it('PWD-5 A (M-274), M-243: „Dodaj dziecko” aktywne — bez imienia komunikat przy polu; Return dodaje; M-250: lista grup pusta ma tekst', async () => {
    const base = sampleBase();
    delete base.lists!.lk;
    const s = await open(base);
    await press(screen.getByTestId('tab-Groups'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('add-child'));
    expect(screen.getByTestId('child-error').props.children).toBe('Wpisz imię dziecka.');
    expect(s.store.dispatched).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('child-name'), 'Ola');
    expect(screen.queryByTestId('child-error')).toBeNull();
    await fireEvent(screen.getByTestId('child-name'), 'submitEditing');
    expectOps(s.store, [{ kind: 'create', entity: 'group_members', id: 'new-1', group_id: 'gf', set: { member_id: 'new-1', display_name: 'Ola', role: 'child' } }]);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('group-gk'));
    expect(await screen.findByText('Brak list. Dodaj listę zakupów albo zadań.')).toBeTruthy();
  });
});

describe('PWD-30 A (M-299): wybór osoby w dużej grupie z wyszukiwaniem', () => {
  it('od progu osób: wybrana osoba z „Zmień”, wyszukiwanie bez polskich znaków, „Nikt konkretny” zawsze widoczny', async () => {
    const base = sampleBase();
    ['Żaneta', 'Łucja', 'Marek', 'Ewa', 'Ola', 'Piotr'].forEach((n, i) => put(base, 'group_members', `p${i}`, { member_id: `p${i}`, group_id: 'gk', user_id: `u-p${i}`, display_name: n, role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 }));
    const s = await open(base);
    await press(screen.getByLabelText(/^Przynieść korki na trening,/));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Dla kogo: Nikt konkretny. Zmień'));
    await fireEvent.changeText(screen.getByLabelText('Szukaj osoby'), 'lucj');
    const group = screen.getByLabelText('Dla kogo');
    expect(within(group).getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual(['Nikt konkretny', 'Łucja']);
    await press(within(group).getByLabelText('Łucja'));
    expect(s.store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 't-korki', set: { assignee_member_id: 'p1' } });
    expect(screen.getByLabelText('Dla kogo: Łucja. Zmień')).toBeTruthy();
    await press(screen.getByLabelText('Dla kogo: Łucja. Zmień'));
    await fireEvent.changeText(screen.getByLabelText('Szukaj osoby'), 'xyz');
    expect(screen.getByText('Nikt o takim imieniu.')).toBeTruthy();
  });
});

describe('PWD-30 A: wyszukiwanie także przy wielu osobach i przy przekazaniu; M-252: linia grupy na ekranie osoby', () => {
  const crowd = () => {
    const base = sampleBase();
    ['Żaneta', 'Łucja', 'Marek', 'Ewa', 'Ola', 'Piotr'].forEach((n, i) => put(base, 'group_members', `p${i}`, { member_id: `p${i}`, group_id: 'gk', user_id: `u-p${i}`, display_name: n, role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 }));
    return base;
  };
  it('uczestnicy wydarzenia: szukanie zawęża, zaznaczeni zostają widoczni', async () => {
    await open(crowd(), { [DEFAULT_GROUP_KEY]: 'gk' });
    await press(screen.getByTestId('tab-Calendar'));
    await press(await screen.findByTestId('calendar-add-event'));
    await press(within(screen.getByLabelText('Kogo dotyczy')).getByLabelText('Wybrane osoby'));
    await fireEvent.changeText(screen.getByLabelText('Szukaj osoby'), 'ewa');
    const who = () => screen.getByLabelText('Kto');
    const labels = () => within(who()).getAllByRole('checkbox').map((x) => x.props.accessibilityLabel);
    expect(labels()).toEqual(['Uczestnik: Pani Ewa', 'Uczestnik: Ewa']);
    await press(within(who()).getByLabelText('Uczestnik: Ewa'));
    await fireEvent.changeText(screen.getByLabelText('Szukaj osoby'), 'marek');
    expect([...labels()].sort()).toEqual(['Uczestnik: Ewa', 'Uczestnik: Marek']);
    await fireEvent.changeText(screen.getByLabelText('Szukaj osoby'), 'xyz');
    expect(within(who()).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('przekazanie zadania: szukanie w dużej grupie', async () => {
    const base = crowd();
    put(base, 'tasks', 't-korki', { ...base.tasks!['t-korki']!, assignee_member_id: 'mk' });
    await open(base);
    await press(screen.getByLabelText(/^Przynieść korki na trening,/));
    await press(await screen.findByTestId('handoff-start'));
    await fireEvent.changeText(screen.getByTestId('handoff-search'), 'luc');
    const picker = screen.getByTestId('handoff-picker');
    expect(within(picker).getByLabelText('Przekaż: Łucja')).toBeTruthy();
    expect(within(picker).queryByLabelText('Przekaż: Marek')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('handoff-search'), 'xyz');
    expect(within(picker).getByText('Nikt o takim imieniu.')).toBeTruthy();
  });

  it('ekran osoby: grupa w jej kolorze z rolą nad imieniem', async () => {
    await open();
    await press(screen.getByTestId('tab-Groups'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('member-ala'));
    expect(await screen.findByText('Rodzina')).toBeTruthy();
  });
});

describe('M-242: ekran imienia', () => {
  it('z Ustawień ma „Wróć”', async () => {
    await open();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-account'));
    await press(await screen.findByTestId('open-name'));
    await screen.findByTestId('screen-name');
    await press(screen.getByLabelText('Wróć'));
    expect(screen.queryByTestId('screen-name')).toBeNull();
  });
});

describe('M-130, PWD-7 A: zadania na ekranie wydarzenia', () => {
  it('wiersz jak w Moich sprawach (godzina, osoba), zrobione zwinięte, stan pusty', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
    const task = (id: string, title: string, extra: object) => put(base, 'tasks', id, { ...base.tasks!['t-books']!, id, title, group_id: 'gf', list_id: 'lf', deadline_mode: 'event', event_id: 'ev', occurrence_date: '2026-10-07', ...extra });
    task('stroj', 'Spakować strój', { assignee_member_id: 'ala' });
    task('woda', 'Woda', { completed_at: '2026-10-07T07:00:00Z' });
    await open(base);
    await press(screen.getByTestId('today-event-ev-2026-10-07'));
    await screen.findByTestId('screen-event');
    expect(screen.getByLabelText('Spakować strój, 17:00, dla: Ala')).toBeTruthy();
    const done = screen.getByTestId('event-tasks-done');
    await press(within(done).getByLabelText('Zrobione (1), pokaż'));
    expect(within(done).getByLabelText('Oznacz jako niezrobione: Woda')).toBeTruthy();
    expect(screen.queryByText('Brak zadań. Dodaj, co trzeba przygotować.')).toBeNull();
  });
});
