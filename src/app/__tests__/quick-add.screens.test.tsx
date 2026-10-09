/**
 * Szybkie dodawanie — audyt 2 (paczka P6): sam termin nie znika bez śladu (M-168), nierozpoznany dzień nie zgaduje
 * dnia z godziny (M-23), zakres godzin zapowiada wydarzenie (M-256), „Więcej” pyta o niejednoznaczne „@imię” (M-170),
 * lista zakupów nie czyta ilości jako terminu (M-20), przykłady w aplikacji działają (M-23).
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup } from './harness';

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
    expect(screen.queryByLabelText(/^o 15[^,]*, rozpoznane$/)).toBeNull();
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'dentysta w przyszły wtorek o 15', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    // Z zakresem godzin też bez zgadywania: zadanie, nie wydarzenie na dziś.
    await write('basen w następną sobotę 17–18');
    expect(screen.queryByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeNull();
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'basen w następną sobotę 17–18', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    // Dzień rozpoznany — bez podpowiedzi.
    await write('dentysta we wtorek o 15');
    expect(screen.queryByText(/Nie rozpoznano dnia/)).toBeNull();
    expect(screen.getByLabelText(/^we wtorek[^,]*, rozpoznane$/)).toBeTruthy();
  });

  it('zakres godzin zapowiada wydarzenie; odklikany zakres — zadanie, bez zapowiedzi (M-256)', async () => {
    await open();
    await write('basen jutro 17–18');
    expect(screen.getByText('Zakres godzin — dodasz wydarzenie, nie zadanie.')).toBeTruthy();
    await press(screen.getByLabelText(/^17–18[^,]*, rozpoznane$/));
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
    expect(within(panel).getByText('Popraw imię albo dodaj bez osoby („@Zosia” zostanie w nazwie). Siebie oznaczysz przez @ja.')).toBeTruthy();
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
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'rachunek za prąd', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-09', due_time: null } }]);
    await write('dentysta jutro o 17');
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'dentysta', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: '17:00' } }]);
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
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gk', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gk', set: { list_id: 'new-1', parent_id: null, title: 'Zebranie', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null, assignee_member_id: 'kala' } }]);
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
    for (const [i, text] of ['mąka 1.5 kg', 'pizza 18.00', 'sok na sobotę'].entries()) {
      await write(text);
      expect(screen.queryByLabelText(/, rozpoznane$/)).toBeNull();
      await add();
      expectOps(store, [{ kind: 'create', entity: 'tasks', id: `new-${i + 1}`, group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: text, sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
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
    await press(screen.getByLabelText(/^2\.5[^,]*, rozpoznane$/));
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'kupić 2.5 kg mąki', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    await write('pranie piątek o 18');
    expect(screen.getByText(/Nie rozpoznano dnia „piątek”/)).toBeTruthy();
    await write('jutro');
    await add();
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
    expect(screen.getByTestId('quick-add').props.value).toBe('jutro');
    await write('pranie w sobotę');
    expect(screen.queryByText('Wpisz, co jest do zrobienia.')).toBeNull();
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'pranie', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-10', due_time: null } }]);
  });
});

describe('grupa wpisu w Moich sprawach: chip, „#Grupa”, „@ja”, grupa domyślna (M-24, decyzja właściciela 8.10.2026)', () => {
  const chip = () => screen.getByTestId('quick-group');
  const pickGroup = async (name: string) => {
    await press(chip());
    await press(radio('Dodaj do grupy', name));
  };
  const openWith = async (local: Record<string, string> = {}, base = sampleBase()) => {
    const s = setup({ base });
    for (const [k, v] of Object.entries(local)) s.services.local!.save(k, v);
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    return s;
  };

  it('chip pokazuje, dokąd trafi wpis; zmiana chipem — wpis w tej grupie, chip zostaje („Ostatnio użyta”)', async () => {
    const { store, services } = await openWith();
    expect(chip().props.accessibilityLabel).toBe('Do: Osobiste');
    expect(within(chip()).getByText('Do: Osobiste')).toBeTruthy();
    await pickGroup('Rodzina');
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    expect(screen.queryByLabelText('Dodaj do grupy')).toBeNull();
    expect(services.local!.load('lastUsedGroup')).toBe('gf');
    await write('zebranie jutro');
    await add();
    const [list, task] = store.dispatched.slice(-2);
    expect(list).toMatchObject({ kind: 'create', entity: 'lists', group_id: 'gf', set: { name: 'Zadania' } });
    expect(task).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { title: 'zebranie', due_date: '2026-10-08' } });
    expect(screen.getByText('Dodano zadanie: zebranie · Rodzina')).toBeTruthy();
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
  });

  it('ostatnio użyta grupa z poprzedniego uruchomienia', async () => {
    await openWith({ lastUsedGroup: 'gk' });
    expect(within(chip()).getByText('Do: Klasa 2b')).toBeTruthy();
  });

  it('konkretna grupa domyślna — zmiana chipem tylko dla tego wpisu', async () => {
    const { store } = await openWith({ defaultGroup: 'gf', lastUsedGroup: 'gk' });
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    await pickGroup('Osobiste');
    await write('basen jutro');
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
  });

  it('„#Rodzina” wybiera grupę (chip ją pokazuje, nieaktywny) i zostaje ostatnio użytą; „@ja” — ja we wspólnej grupie', async () => {
    const { store } = await openWith();
    await write('basen jutro #Rodzina');
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    expect(chip().props.accessibilityState).toMatchObject({ disabled: true });
    await add();
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gf', set: { list_id: 'new-1', parent_id: null, title: 'basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    expect(chip().props.accessibilityState).toMatchObject({ disabled: false });
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    await write('pranie @ja');
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-3', group_id: 'gf', set: { list_id: 'new-1', parent_id: null, title: 'pranie', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null, assignee_member_id: 'mf' } }]);
    // „@Ala” z innej grupy niż chip — grupa Ali, ale nie zostaje ostatnio użytą.
    await pickGroup('Osobiste');
    await write('basen jutro @ala');
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    await add();
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-4', group_id: 'gf', set: { list_id: 'new-1', parent_id: null, title: 'basen', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null, assignee_member_id: 'ala' } }]);
    expect(within(chip()).getByText('Do: Osobiste')).toBeTruthy();
  });

  it('wspólna grupa bez osoby i terminu: zapis bez pytania, wcześniej napis, że nikt tego nie zobaczy (D68 po PW-18 b)', async () => {
    const { store } = await openWith({ lastUsedGroup: 'gf' });
    const unseen = 'Bez osoby i terminu nikt nie zobaczy tego w Moich sprawach — dopisz np. „@ja” albo „jutro”.';
    await write('kupić chleb');
    expect(screen.getByText(unseen)).toBeTruthy();
    await add();
    expect(screen.queryByTestId('addressee-ask')).toBeNull();
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gf', set: { list_id: 'new-1', parent_id: null, title: 'kupić chleb', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(store.dispatched.at(-1)).not.toHaveProperty('set.assignee_member_id');
    // Z osobą albo terminem — bez napisu; w osobistej też.
    for (const text of ['kupić chleb @ja', 'kupić chleb jutro', 'jutro']) {
      await write(text);
      expect(screen.queryByText(unseen)).toBeNull();
    }
    await press(screen.getByTestId('quick-group'));
    await press(radio('Dodaj do grupy', 'Osobiste'));
    await write('kupić chleb');
    expect(screen.queryByText(unseen)).toBeNull();
  });

  it('„#…” bez grupy — pytanie, „Dodaj do” zostawia „#…” w nazwie; kilka grup — wybór', async () => {
    const base = sampleBase();
    put(base, 'groups', 'gr', { id: 'gr', name: 'Rodzice', kind: 'shared', created_at: '2026-04-01T00:00:00Z', deleted_at: null, version: 1 });
    put(base, 'group_members', 'mr', { member_id: 'mr', group_id: 'gr', user_id: 'u-me', display_name: 'Łukasz', role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
    const { store } = await openWith({}, base);
    await write('bilety jutro #kino');
    await add();
    const unknown = screen.getByTestId('tag-unknown');
    expect(within(unknown).getByText('Nie ma grupy #kino')).toBeTruthy();
    expect(within(unknown).getByText('Popraw nazwę albo dodaj do grupy „Osobiste” („#kino” zostanie w nazwie).')).toBeTruthy();
    await press(within(unknown).getByText('Dodaj do: Osobiste'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'u-me', set: { list_id: 'lp', parent_id: null, title: 'bilety #kino', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    await write('zebranie jutro #rodz');
    await add();
    expect(screen.getByText('Którą grupę masz na myśli: #rodz?')).toBeTruthy();
    await press(within(screen.getByTestId('tag-choices')).getByText('Rodzice'));
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-2', group_id: 'gr', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-3', group_id: 'gr', set: { list_id: 'new-2', parent_id: null, title: 'zebranie', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    await write('zebranie jutro #rodz');
    await add();
    await press(within(screen.getByTestId('tag-choices')).getByText('Anuluj'));
    expect(screen.queryByTestId('tag-choices')).toBeNull();
  });

  it('„Więcej” — formularz w grupie z chipa; z zakresem godzin — wydarzenie w tej grupie', async () => {
    await openWith({ lastUsedGroup: 'gk' });
    await write('wycieczka jutro');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(radio('Grupa', 'Klasa 2b').props.accessibilityState.selected).toBe(true);
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-today');
    await write('zebranie jutro 17–18');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-event-edit');
    expect(radio('Grupa', 'Klasa 2b').props.accessibilityState.selected).toBe(true);
  });

  it('jedna grupa — bez chipa', async () => {
    const base = sampleBase();
    for (const g of ['gf', 'gk']) base.groups![g] = { ...base.groups![g]!, deleted_at: '2026-10-01T00:00:00Z' };
    await openWith({}, base);
    expect(screen.queryByTestId('quick-group')).toBeNull();
  });

  it('Ustawienia → Dodawanie: „Grupa domyślna” — „Ostatnio użyta” albo konkretna grupa; chip startuje od niej', async () => {
    const { services } = await openWith();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-adding'));
    const page = await screen.findByTestId('screen-settings-adding');
    expect(within(page).getByLabelText('Ostatnio użyta').props.accessibilityState.selected).toBe(true);
    expect(within(page).getByText(/„#Rodzina” wybiera grupę, a „@ja” przypisuje sprawę Tobie/)).toBeTruthy();
    await press(radio('Grupa domyślna', 'Klasa 2b'));
    expect(services.local!.load('defaultGroup')).toBe('gk');
    expect(radio('Grupa domyślna', 'Klasa 2b').props.accessibilityState.selected).toBe(true);
    await press(within(page).getByLabelText('Wróć'));
    await press(within(await screen.findByTestId('screen-settings')).getByLabelText('Wróć'));
    await screen.findByTestId('screen-today');
    expect(within(chip()).getByText('Do: Klasa 2b')).toBeTruthy();
  });

  it('ustawiona grupa, której już nie ma — Ustawienia i chip jak „Ostatnio użyta”', async () => {
    await openWith({ defaultGroup: 'stara', lastUsedGroup: 'gf' });
    expect(within(chip()).getByText('Do: Rodzina')).toBeTruthy();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-adding'));
    await screen.findByTestId('screen-settings-adding');
    expect(radio('Grupa domyślna', 'Ostatnio użyta').props.accessibilityState.selected).toBe(true);
  });
});

describe('podpowiedź „Na listę zakupów” (PW-3 wariant D)', () => {
  const shop = () => screen.queryByTestId('quick-shopping');
  const pickGroup = async (name: string) => {
    await press(screen.getByTestId('quick-group'));
    await press(radio('Dodaj do grupy', name));
  };
  const openIn = async (group: string, base = sampleBase()) => {
    const s = setup({ base });
    s.services.local!.save('lastUsedGroup', group);
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    return s;
  };

  it('cały wpis to produkt: podpowiedź listy grupy; dotknięcie dodaje na listę, pasek „Zmień” otwiera listę', async () => {
    const { store } = await openIn('gf');
    await write('mleko');
    expect(within(shop()!).getByText('Na listę: Zakupy na weekend')).toBeTruthy();
    expect(shop()!.props.accessibilityLabel).toBe('Na listę: Zakupy na weekend, mleko');
    await press(shop()!);
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'mleko', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(screen.getByTestId('quick-add').props.value).toBe('');
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Dodano produkt: mleko · Zakupy na weekend')).toBeTruthy();
    await press(within(bar).getByLabelText('Zmień'));
    expect(await screen.findByTestId('screen-list')).toBeTruthy();
  });

  it('z ilością dosłownie; z terminem — produkt bez terminu na liście; „+” zostawia zadanie z terminem', async () => {
    const { store } = await openIn('gf');
    await write('mąka 1.5 kg');
    await press(shop()!);
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'mąka 1.5 kg', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    await write('mleko jutro');
    expect(shop()).toBeTruthy();
    await add();
    const [list, task] = store.dispatched.slice(-2);
    expect(list).toMatchObject({ kind: 'create', entity: 'lists', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania' } });
    expect(task).toMatchObject({ entity: 'tasks', group_id: 'gf', set: { title: 'mleko', due_date: '2026-10-08' } });
    await write('chleb 2 szt. na jutro');
    await press(shop()!);
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-2', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } }, { kind: 'create', entity: 'tasks', id: 'new-3', group_id: 'gf', set: { list_id: 'new-2', parent_id: null, title: 'mleko', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }, { kind: 'create', entity: 'tasks', id: 'new-4', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'chleb 2 szt.', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
  });

  it('zdanie, osoba albo zakres godzin — bez podpowiedzi; grupa bez listy zakupów — informacja, zostaje zadanie', async () => {
    await openIn('gf');
    for (const text of ['kupić mleko dla babci', 'karmić kota', 'mleko @ala', 'mleko @ja', 'mleko jutro 17–18']) {
      await write(text);
      expect(shop()).toBeNull();
    }
    // Audyt 3 (N-45, Q14 B): grupa z chipa bez listy zakupów — lista innej grupy, z jej nazwą.
    await pickGroup('Osobiste');
    await write('mleko');
    expect(within(shop()!).getByText('Na listę: Zakupy na weekend (Rodzina)')).toBeTruthy();
    // Grupa wskazana tekstem zostaje — wtedy informacja, że listy nie ma, i zadanie.
    await write('#Osobiste mleko');
    expect(shop()).toBeNull();
    expect(screen.getByText('„mleko” to produkt? W grupie „Osobiste” nie ma listy zakupów, więc dodasz zadanie.')).toBeTruthy();
    // „#Rodzina” — podpowiedź listy tej grupy, jak chip.
    await write('#Rodzina mleko');
    expect(within(shop()!).getByText('Na listę: Zakupy na weekend')).toBeTruthy();
  });

  it('Q14 B: z „Osobistych” produkt trafia na listę zakupów innej grupy; pasek mówi, na którą', async () => {
    const { store } = await openIn('u-me');
    await write('masło');
    await press(shop()!);
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'masło', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(within(screen.getByTestId('undo-bar')).getByText('Dodano produkt: masło · Zakupy na weekend (Rodzina)')).toBeTruthy();
  });

  it('N-44 (Q6d A): dziecko z kontem — „#Rodzina szampon” to nie „Nie ma grupy”; produkt na listę zakupów tej grupy', async () => {
    const base = sampleBase();
    put(base, 'group_members', 'mf', { ...base.group_members!.mf!, role: 'child' });
    const { store } = await openIn('u-me', base);
    await write('#Rodzina szampon');
    await add();
    const panel = screen.getByTestId('tag-child');
    expect(within(panel).getByText('W grupie „Rodzina” dopisujesz tylko zakupy')).toBeTruthy();
    expect(within(panel).getByText('Zadania i wydarzenia dodaje tam dorosły. Produkt możesz dopisać do listy zakupów:')).toBeTruthy();
    expect(screen.queryByTestId('tag-unknown')).toBeNull();
    await press(within(panel).getByLabelText('Na listę: Zakupy na weekend (Rodzina)'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'szampon', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(screen.queryByTestId('tag-child')).toBeNull();
    expect(screen.getByTestId('quick-add').props.value).toBe('');
    // Bez listy zakupów — tylko wyjaśnienie i „Anuluj”.
    delete base.lists!.lz;
    delete base.tasks!['s-chleb'];
    delete base.tasks!['s-maslo'];
    await openIn('u-me', base);
    await write('#Rodzina szampon');
    await add();
    const none = screen.getByTestId('tag-child');
    expect(within(none).getByText('Zadania i wydarzenia dodaje tam dorosły — poproś go o to. Listy zakupów w tej grupie nie ma.')).toBeTruthy();
    expect(within(none).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Anuluj']);
    await press(within(none).getByLabelText('Anuluj'));
    expect(screen.queryByTestId('tag-child')).toBeNull();
  });

  it('kilka list zakupów — ta, której ostatnio używano', async () => {
    const base = sampleBase();
    put(base, 'lists', 'lz2', { ...base.lists!.lz!, id: 'lz2', name: 'Bazar', version: 2 });
    put(base, 'tasks', 's-ser', { ...base.tasks!['s-chleb']!, id: 's-ser', list_id: 'lz2', title: 'ser', version: 5 });
    await openIn('gf', base);
    await write('masło');
    expect(within(shop()!).getByText('Na listę: Bazar')).toBeTruthy();
  });

  it('jedna grupa — sama podpowiedź, bez chipa grupy', async () => {
    const solo = sampleBase();
    for (const g of ['gf', 'gk']) solo.groups![g] = { ...solo.groups![g]!, deleted_at: '2026-10-01T00:00:00Z' };
    put(solo, 'lists', 'lzp', { ...solo.lists!.lz!, id: 'lzp', group_id: 'u-me', name: 'Moje zakupy' });
    await openIn('u-me', solo);
    await write('masło');
    expect(screen.queryByTestId('quick-group')).toBeNull();
    expect(within(shop()!).getByText('Na listę: Moje zakupy')).toBeTruthy();
  });
});

describe('audyt 3: parser w polu dodawania', () => {
  it('N-28: „1/2 kostki masła” — pod polem pełna data z przyszłego roku; odklikane — bez ostrzeżenia; „jutro” wygrywa z liczbą', async () => {
    await open();
    await write('1/2 kostki masła');
    expect(screen.getByText('„1/2” to termin: poniedziałek, 1 lutego 2027. Jeśli to nie data, dotknij „1/2” wyżej.')).toBeTruthy();
    await press(screen.getByLabelText('1/2, rozpoznane'));
    expect(screen.queryByText(/to termin:/)).toBeNull();
    await write('raport 1.5 strony jutro');
    expect(screen.getByLabelText('jutro, rozpoznane')).toBeTruthy();
    expect(screen.queryByLabelText('1.5, rozpoznane')).toBeNull();
    expect(screen.queryByText(/to termin:/)).toBeNull();
  });
});
