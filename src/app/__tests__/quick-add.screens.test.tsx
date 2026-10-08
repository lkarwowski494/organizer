/**
 * Szybkie dodawanie — audyt 2 (paczka P6): sam termin nie znika bez śladu (M-168), nierozpoznany dzień nie zgaduje
 * dnia z godziny (M-23), zakres godzin zapowiada wydarzenie (M-256), „Więcej” pyta o niejednoznaczne „@imię” (M-170),
 * lista zakupów nie czyta ilości jako terminu (M-20), przykłady w aplikacji działają (M-23).
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const write = (text: string) => fireEvent.changeText(screen.getByTestId('quick-add'), text);
const add = () => fireEvent(screen.getByTestId('quick-add'), 'submitEditing');

describe('Moje sprawy: pole szybkiego dodawania', () => {
  it('sam termin albo samo „@Ala”: komunikat, tekst zostaje, nic nie powstaje; pisanie chowa komunikat (M-168)', async () => {
    const { store } = await open();
    for (const text of ['jutro', '@Ala', 'jutro 17–18', 'jutro @al']) {
      await write(text);
      await add();
      expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
      expect(screen.getByTestId('quick-add').props.value).toBe(text);
    }
    expect(store.dispatched).toHaveLength(0);
    await write('jutro basen');
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    // Puste pole — bez komunikatu i bez zapisu.
    await write('  ');
    await add();
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    expect(store.dispatched).toHaveLength(0);
  });

  it('bez żadnej grupy (przed pierwszym pobraniem) tekst zostaje z komunikatem błędu', async () => {
    const { store } = await open({});
    await write('basen jutro');
    await add();
    expect(screen.getByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
    expect(screen.getByTestId('quick-add').props.value).toBe('basen jutro');
    expect(store.dispatched).toHaveLength(0);
  });

  it('„dentysta w przyszły wtorek o 15”: nie dziś 15:00 — podpowiedź przed dodaniem, zadanie bez terminu z całym tekstem (M-23)', async () => {
    const { store } = await open();
    await write('dentysta w przyszły wtorek o 15');
    expect(screen.getByText('Nie rozpoznano dnia „przyszły wtorek”, więc zadanie będzie bez terminu. Napisz np. „w piątek”, „jutro” albo „15.10”.')).toBeTruthy();
    expect(screen.queryByLabelText(/Rozpoznano: o 15/)).toBeNull();
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'u-me', set: { title: 'dentysta w przyszły wtorek o 15', deadline_mode: 'none', due_date: null, due_time: null } });
    // Z zakresem godzin też bez zgadywania: zadanie, nie wydarzenie na dziś.
    await write('basen w następną sobotę 17–18');
    expect(screen.queryByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeNull();
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', set: { title: 'basen w następną sobotę 17–18', deadline_mode: 'none' } });
    // Dzień rozpoznany — bez podpowiedzi.
    await write('dentysta we wtorek o 15');
    expect(screen.queryByText(/Nie rozpoznano dnia/)).toBeNull();
    expect(screen.getByLabelText(/Rozpoznano: we wtorek/)).toBeTruthy();
  });

  it('zakres godzin zapowiada wydarzenie; odklikany zakres — zadanie, bez zapowiedzi (M-256)', async () => {
    await open();
    await write('basen jutro 17–18');
    expect(screen.getByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeTruthy();
    await press(screen.getByLabelText(/Rozpoznano: 17–18/));
    expect(screen.queryByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeNull();
    await write('basen jutro o 17');
    expect(screen.queryByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeNull();
  });

  it('nieznane „@Zosia”: pytanie; „Anuluj” zostawia tekst bez zapisu (M-169)', async () => {
    const { store } = await open();
    await write('kupić bilety @Zosia');
    await add();
    const panel = screen.getByTestId('mention-unknown');
    expect(within(panel).getByText('Nie ma @Zosia w Twoich grupach')).toBeTruthy();
    expect(within(panel).getByText('Popraw imię albo dodaj bez osoby („@Zosia” zostanie w nazwie).')).toBeTruthy();
    await press(within(panel).getByText('Anuluj'));
    expect(screen.queryByTestId('mention-unknown')).toBeNull();
    expect(screen.getByTestId('quick-add').props.value).toBe('kupić bilety @Zosia');
    expect(store.dispatched).toHaveLength(0);
  });

  it('przykłady z pustego dnia i podpowiedzi pola rozpoznaje parser — to zadania z terminem (M-23)', async () => {
    const base = sampleBase();
    base.tasks = {};
    const { store } = await open(base);
    expect(screen.getByText('Na dziś nic. Dodaj coś polem powyżej, np. „rachunek za prąd w piątek” albo „dentysta jutro o 17”.')).toBeTruthy();
    expect(screen.getByTestId('quick-add').props.placeholder).toBe('np. „dentysta jutro o 17”');
    await write('rachunek za prąd w piątek');
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ set: { title: 'rachunek za prąd', due_date: '2026-10-09', due_time: null } });
    await write('dentysta jutro o 17');
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ set: { title: 'dentysta', due_date: '2026-10-08', due_time: '17:00' } });
  });
});

describe('„Więcej” z niejednoznacznym „@imię” (M-170)', () => {
  const twoAlas = () => {
    const base = sampleBase();
    put(base, 'group_members', 'kala', { member_id: 'kala', group_id: 'gk', user_id: 'u-kala', display_name: 'Alicja', role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
    return base;
  };

  it('formularz pyta, kogo chodzi; wybór ustawia grupę i osobę, „@al” znika z nazwy; zapis w tej grupie', async () => {
    const { store } = await open(twoAlas());
    await write('Zebranie jutro @al');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Kogo masz na myśli: @al?')).toBeTruthy();
    expect(screen.getByTestId('form-title').props.value).toBe('Zebranie @al');
    await press(screen.getByText('Alicja · Klasa 2b'));
    expect(screen.queryByTestId('mention-choices')).toBeNull();
    expect(screen.getByTestId('form-title').props.value).toBe('Zebranie');
    expect(radio('Grupa', 'Klasa 2b').props.accessibilityState.selected).toBe(true);
    expect(radio('Dla kogo', 'Alicja').props.accessibilityState.selected).toBe(true);
    await press(screen.getByTestId('form-save'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gk', set: { title: 'Zebranie', due_date: '2026-10-08', assignee_member_id: 'kala' } });
  });

  it('„Anuluj” chowa pytanie, „@al” zostaje w nazwie — nic nie znika po cichu', async () => {
    await open(twoAlas());
    await write('Zebranie jutro @al');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(within(screen.getByTestId('mention-choices')).getByText('Anuluj'));
    expect(screen.queryByTestId('mention-choices')).toBeNull();
    expect(screen.getByTestId('form-title').props.value).toBe('Zebranie @al');
    expect(radio('Grupa', 'Osobiste').props.accessibilityState.selected).toBe(true);
  });
});

describe('dodawanie na liście', () => {
  const openList = async (listId: string, base = sampleBase()) => {
    const s = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId(`list-${listId}`));
    await screen.findByTestId('screen-list');
    return s;
  };

  it('zakupy: „mąka 1.5 kg” zostaje nazwą z ilością, bez terminu i bez chipów (M-20)', async () => {
    const { store } = await openList('lz');
    for (const text of ['mąka 1.5 kg', 'pizza 18.00', 'sok na sobotę']) {
      await write(text);
      expect(screen.queryByLabelText(/^Rozpoznano/)).toBeNull();
      await add();
      expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: 'lz', title: text, deadline_mode: 'none', due_date: null } });
    }
    // Ilość czyta wyświetlanie (D77): nazwa „mąka”, obok „1,5 kg”.
    expect(within(screen.getByTestId(`task-${(store.dispatched.at(-3) as { id: string }).id}`)).getByText(/1,5 kg/)).toBeTruthy();
  });

  it('pusta lista zakupów nie obiecuje rozpoznawania terminu', async () => {
    const base = sampleBase();
    delete base.tasks!['s-chleb'];
    delete base.tasks!['s-maslo'];
    await openList('lz', base);
    expect(screen.getByText('Lista jest pusta. Dopisz pierwszy produkt polem powyżej.')).toBeTruthy();
    expect(screen.queryByText(/termin rozpoznamy/)).toBeNull();
  });

  it('lista zadań: chip terminu do odklikania (jak w Moich sprawach), nierozpoznany dzień, sam termin — komunikat', async () => {
    const { store } = await openList('lp');
    await write('kupić 2.5 kg mąki');
    // „2.5” czytane jako 2 maja — chip pozwala to odkliknąć (ADR 0003).
    await press(screen.getByLabelText(/Rozpoznano: 2\.5/));
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ set: { list_id: 'lp', title: 'kupić 2.5 kg mąki', deadline_mode: 'none' } });
    await write('pranie piątek o 18');
    expect(screen.getByText(/Nie rozpoznano dnia „piątek”/)).toBeTruthy();
    await write('jutro');
    await add();
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
    expect(screen.getByTestId('quick-add').props.value).toBe('jutro');
    await write('pranie w sobotę');
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    await add();
    expect(store.dispatched.at(-1)).toMatchObject({ set: { title: 'pranie', due_date: '2026-10-10' } });
  });
});
