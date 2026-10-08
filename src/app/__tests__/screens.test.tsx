/**
 * Ekrany przez prawdziwą nawigację (RootStack): użytkownik dotyka, pisze i widzi skutek.
 * Stan to ten sam silnik co w aplikacji (mutate + materialize), więc zmiana offline widać od razu.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';

import { parseJoin } from '../../domain/invite-link';
import { RootStack } from '../navigation';
import { answerAlert, fakeAccount, lastAlert, ME, sampleBase, setup , pickDate } from './harness';

async function open(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const type = (el: Parameters<typeof fireEvent.changeText>[0], text: string) => fireEvent.changeText(el, text);

describe('Moje sprawy', () => {
  it('dzień: przypięte, moje sprawy z grup, bez cudzych przypisanych; jutro strzałką, powrót „Dziś”; tydzień', async () => {
    await open();
    expect(screen.getByTestId('today-range-label').props.children).toBe('Środa, 7 października');
    expect(screen.getByText('Przypięte')).toBeTruthy();
    expect(screen.getByText('Oddać książki do biblioteki')).toBeTruthy();
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    expect(screen.queryByText('Kupić kwiaty')).toBeNull();
    expect(screen.queryByText('Zadanie Ali')).toBeNull();
    expect(within(screen.getByTestId('today-t-paczka')).getByText(/dziś · 18:00/)).toBeTruthy();
    expect(screen.getAllByLabelText('Dziś', { exact: true })).toHaveLength(2); // zakładka + powrót
    // D101: „Dziś” zawsze na swoim miejscu, na bieżącym dniu wyszarzony.
    expect(screen.getByTestId('go-today').props.accessibilityState).toMatchObject({ disabled: true });
    await press(screen.getByLabelText('Następny dzień'));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Czwartek, 8 października');
    expect(screen.getByText('Kupić kwiaty')).toBeTruthy();
    expect(screen.queryByText('Przypięte')).toBeNull();
    expect(screen.getByTestId('go-today').props.accessibilityState).toMatchObject({ disabled: false });
    await press(screen.getByTestId('go-today'));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Środa, 7 października');
    await press(screen.getByLabelText('Tydzień'));
    expect(screen.getByTestId('today-range-label').props.children).toBe('5–11 października');
    expect(screen.getByText('Dziś · Środa, 7 października')).toBeTruthy();
    expect(screen.getByText('Czwartek, 8 października')).toBeTruthy();
    await press(screen.getByLabelText('Następny tydzień'));
    expect(screen.getByText('Nic tu nie ma.')).toBeTruthy();
    await press(screen.getByLabelText('Miesiąc'));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Październik 2026');
    await press(screen.getByLabelText('Poprzedni miesiąc'));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Wrzesień 2026');
  });

  it('szybkie dodawanie: chip terminu, odklikanie zostawia słowo w tytule, nowa lista w grupie osobistej gdy brak', async () => {
    const base = sampleBase();
    delete base.lists!.lp;
    delete base.tasks!['t-books'];
    const { store } = await open({ base });
    await type(screen.getByTestId('quick-add'), 'mleko jutro');
    expect(screen.getByLabelText(/Rozpoznano: jutro/)).toBeTruthy();
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched.map((o) => o.kind)).toEqual(['create', 'create']);
    expect(store.dispatched[0]).toMatchObject({ entity: 'lists', group_id: ME, set: { name: 'Moje zadania' } });
    await press(screen.getByLabelText('Następny dzień'));
    expect(await screen.findByText('mleko')).toBeTruthy();
    await type(screen.getByTestId('quick-add'), 'wtorek jutro');
    await press(screen.getByLabelText(/Rozpoznano: jutro/));
    expect(screen.queryByLabelText(/Rozpoznano: jutro/)).toBeNull();
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { title: 'wtorek jutro', deadline_mode: 'none' } });
  });

  it('pusty tekst nic nie dodaje; odhaczenie znika z widoku', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched).toHaveLength(0);
    // D59: odhaczenie dopiero po potwierdzeniu; „Anuluj” nic nie zmienia.
    await press(screen.getByLabelText('Następny dzień'));
    await press(screen.getByLabelText('Oznacz jako zrobione: Kupić kwiaty'));
    expect(lastAlert()).toMatchObject({ title: 'Zrobione?', message: 'Kupić kwiaty' });
    await answerAlert('Anuluj');
    expect(store.dispatched).toHaveLength(0);
    expect(screen.getByText('Kupić kwiaty')).toBeTruthy();
    await press(screen.getByLabelText('Oznacz jako zrobione: Kupić kwiaty'));
    await answerAlert('Zrobione');
    expect(store.dispatched[0]).toMatchObject({ kind: 'patch', id: 't-kwiaty', set: { completed_at: '2026-10-07T08:00:00.000Z' } });
    expect(screen.queryByText('Kupić kwiaty')).toBeNull();
  });

  it('pusty dzień: zachęta; wskaźnik offline z liczbą zmian', async () => {
    const base = sampleBase();
    base.tasks = {};
    await open({ base, indicator: { state: 'offline', pending: 2 } });
    expect(screen.getByText(/^Na dziś nic. Dodaj coś polem powyżej/)).toBeTruthy();
    expect(screen.getByLabelText('Stan synchronizacji: Offline · 2 zmiany czekają')).toBeTruthy();
  });
});

describe('Listy i zadania', () => {
  it('lista zakupów: odhaczenie przenosi do „W koszyku”, dodanie produktu, nowa pozycja czeka na wysłanie', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lz'));
    expect(await screen.findByText('Zakupy na weekend')).toBeTruthy();
    expect(screen.getByText('W koszyku')).toBeTruthy();
    await press(screen.getByLabelText('Włóż do koszyka: Chleb żytni'));
    expect(lastAlert().title).toBe('Do koszyka?');
    await answerAlert('Do koszyka');
    expect(screen.getByLabelText('Wyjmij z koszyka: Chleb żytni')).toBeTruthy();
    // Wyjęcie z koszyka bez pytania (cofnięcie niczego nie ukrywa).
    const n = (Alert.alert as unknown as jest.Mock).mock.calls.length;
    await press(screen.getByLabelText('Wyjmij z koszyka: Chleb żytni'));
    expect((Alert.alert as unknown as jest.Mock).mock.calls).toHaveLength(n);
    expect(screen.getByLabelText('Włóż do koszyka: Chleb żytni')).toBeTruthy();
    await type(screen.getByTestId('quick-add'), 'jabłka');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: 'lz', title: 'jabłka' } });
    expect(within(screen.getByTestId(`task-${(store.dispatched.at(-1) as { id: string }).id}`)).getByText(/czeka na wysłanie/)).toBeTruthy();
  });

  it('zadanie: edycja tytułu, terminu z walidacją, osoby, podzadanie, usunięcie i cofnięcie', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Następny dzień'));
    await press(screen.getByLabelText('Otwórz: Kupić kwiaty'));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    await type(screen.getByTestId('task-title'), 'Kupić kwiaty dla babci');
    await pickDate('task-date', '2026-10-09');
    await type(screen.getByTestId('task-time'), '25:00');
    await press(screen.getByTestId('task-save'));
    expect(screen.getByText('Wpisz godzinę jako GG:MM, np. 17:30')).toBeTruthy();
    await press(screen.getByLabelText('Ala'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { assignee_member_id: 'ala' } });
    await press(screen.getByLabelText('Dla każdego'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { assignee_member_id: null } });
    await type(screen.getByTestId('task-sub'), 'wstążka');
    await press(screen.getAllByLabelText('Dodaj podzadanie').at(-1)!);
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', set: { parent_id: 't-kwiaty', deadline_mode: 'inherit' } });
    expect(await screen.findByText('wstążka')).toBeTruthy();
    await type(screen.getByTestId('task-time'), '17:30');
    await type(screen.getByTestId('task-note'), 'tulipany');
    await press(screen.getByTestId('task-save'));
    const titles = store.dispatched.filter((o) => o.kind === 'patch').map((o) => ('set' in o ? o.set : {}));
    expect(titles).toEqual(expect.arrayContaining([{ title: 'Kupić kwiaty dla babci' }, { note: 'tulipany' }, { deadline_mode: 'own', due_date: '2026-10-09', due_time: '17:30' }]));
    // Termin 9.10 to inny dzień niż oglądany (jutro), więc zadanie znika z widoku — otwieramy je z listy.
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(screen.queryByText('Kupić kwiaty dla babci')).toBeNull();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    expect((await screen.findAllByText(/pt\. 9 paź · 17:30/)).length).toBe(2); // zadanie i dziedziczące podzadanie
    await press(screen.getByLabelText('Otwórz: Kupić kwiaty dla babci'));
    await press(await screen.findByLabelText('Usuń zadanie'));
    expect(await screen.findByText('Zadanie usunięte')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij usunięcie'));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
    // D68: we wspólnej grupie bez osoby nie da się zdjąć terminu.
    const before = store.dispatched.length;
    await press(screen.getByLabelText('Usuń termin'));
    expect(screen.getByText(/musi mieć osobę albo termin/)).toBeTruthy();
    expect(store.dispatched).toHaveLength(before);
    await press(screen.getByLabelText('Ala'));
    await press(screen.getByLabelText('Usuń termin'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { deadline_mode: 'none', due_date: null } });
    // Teraz bez terminu, więc „Dla każdego” też jest zablokowane.
    const n = store.dispatched.length;
    await press(screen.getByLabelText('Dla każdego'));
    expect(store.dispatched).toHaveLength(n);
  });

  it('nowa lista prywatna w grupie wspólnej i usunięcie listy', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    expect(screen.getByLabelText('Utwórz listę').props.accessibilityState.disabled).toBe(true);
    await type(screen.getByTestId('list-name'), 'Prezenty');
    await press(screen.getByLabelText('Rodzina'));
    await press(screen.getByLabelText('Tylko ja'));
    await press(screen.getByTestId('create-list'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'lists', group_id: 'gf', set: { name: 'Prezenty', kind: 'tasks', visibility: 'private' } });
    expect(await screen.findByText(/^Lista jest pusta./)).toBeTruthy();
    await press(screen.getByLabelText('Usuń listę'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'delete', entity: 'lists' });
  });
});

describe('Kalendarz', () => {
  it('miesiąc, święto, zadania dnia, nawigacja po miesiącach', async () => {
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    expect(await screen.findByText('Październik 2026')).toBeTruthy();
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    await press(screen.getByTestId('day-2026-10-08'));
    expect(screen.getByText('Kupić kwiaty')).toBeTruthy();
    await press(screen.getByTestId('day-2026-10-09'));
    expect(screen.getByText('Tego dnia nic nie ma.')).toBeTruthy();
    await press(screen.getByLabelText('Następny miesiąc'));
    expect(screen.getByText('Listopad 2026')).toBeTruthy();
    expect(screen.getByLabelText('Niedziela, 1 listopada, Wszystkich Świętych')).toBeTruthy();
    for (let i = 0; i < 2; i++) await press(screen.getByLabelText('Następny miesiąc'));
    expect(screen.getByText('Styczeń 2027')).toBeTruthy();
    for (let i = 0; i < 3; i++) await press(screen.getByLabelText('Poprzedni miesiąc'));
    expect(screen.getByText('Październik 2026')).toBeTruthy();
  });
});

describe('Grupy', () => {
  it('lista grup, szczegóły, zaproszenie z udostępnieniem i unieważnieniem, dziecko, zmiana nazwy', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { store, account } = await open();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(await screen.findByText('Rodzina')).toBeTruthy();
    expect(screen.getByLabelText('Ala, właściciel')).toBeTruthy();
    expect(screen.queryByLabelText('Zaproś jako admina')).toBeNull();
    await press(screen.getByTestId('invite'));
    // D92–D94: ID grupy + 6-cyfrowy kod na 24 h, link https w wiadomości.
    expect(account.createJoinCode).toHaveBeenCalledWith('gf', 'member');
    expect(await screen.findByText('ID grupy: 482 913 507')).toBeTruthy();
    expect(screen.getByTestId('join-code').props.children).toBe('Kod: 731 064');
    expect(screen.getByText('Ważny do: jutro · 10:00. Działa dla najwyżej 50 osób. Wystarczy link albo ID grupy z kodem.')).toBeTruthy();
    await press(screen.getByLabelText('Wyślij zaproszenie'));
    const msg = (share.mock.calls[0]![0] as { message: string }).message;
    expect(msg).toMatch(/^Zapraszam Cię do grupy „Rodzina” w Organizerze\./);
    expect(msg).toContain('Dotknij linku: https://lkarwowski494.github.io/j/?g=482913507&c=731064');
    expect(msg).toContain('Grupy → „Dołącz do grupy”');
    expect(msg).toContain('Kod: 731 064 (ważny do: jutro · 10:00)');
    expect(parseJoin(msg)).toEqual({ joinId: '482913507', code: '731064' });
    await press(screen.getByLabelText('Unieważnij kod'));
    expect(account.revokeInvite).toHaveBeenCalledWith('inv-2');
    await type(screen.getByTestId('child-name'), 'Zosia');
    await press(screen.getByLabelText('Dodaj dziecko (bez konta)'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'group_members', group_id: 'gf', set: { display_name: 'Zosia', role: 'child' } });
    expect(await screen.findByLabelText('Zosia, dziecko')).toBeTruthy();
    await type(screen.getByTestId('group-rename'), 'Rodzina K.');
    await press(screen.getByLabelText('Zmień nazwę grupy'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'groups', id: 'gf', set: { name: 'Rodzina K.' } });
    share.mockRestore();
  });

  it('błąd serwera przy zaproszeniu: komunikat; wyjście z grupy z potwierdzeniem', async () => {
    const account = fakeAccount({ createJoinCode: jest.fn(async () => Promise.reject(new Error('offline'))) });
    const { store } = await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('invite'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    await press(screen.getByTestId('leave'));
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('leave'));
    await press(screen.getByTestId('leave-confirm'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'group_members', id: 'mf' });
    expect(await screen.findByTestId('screen-groups')).toBeTruthy();
    expect(screen.queryByTestId('group-gf')).toBeNull();
  });

  it('owner: zaprasza admina, nie może wyjść; grupa osobista bez zaproszeń', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    const { account } = await open({ base });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByLabelText('Zaproś jako admina'));
    expect(account.createJoinCode).toHaveBeenCalledWith('gf', 'admin');
    // Owner może zmienić ID grupy (z potwierdzeniem); kod znika, bo przestał działać.
    expect(screen.getByTestId('invite-ready')).toBeTruthy();
    await press(screen.getByTestId('rotate-join-id'));
    await answerAlert('Anuluj');
    expect(account.rotateJoinId).not.toHaveBeenCalled();
    await press(screen.getByTestId('rotate-join-id'));
    await answerAlert('Zmień ID grupy');
    expect(account.rotateJoinId).toHaveBeenCalledWith('gf');
    expect(screen.queryByTestId('invite-ready')).toBeNull();
    expect(screen.getByText(/Właściciel nie wychodzi z grupy/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId(`group-${ME}`));
    expect(await screen.findByText('Osobiste')).toBeTruthy();
    expect(screen.queryByTestId('invite')).toBeNull();
    expect(screen.queryByTestId('leave')).toBeNull();
  });

  it('nowa grupa przez serwer; błąd sieci pokazuje komunikat', async () => {
    let fail = true;
    const account = fakeAccount({ createGroup: jest.fn(async () => (fail ? Promise.reject(new Error('x')) : undefined)) });
    const { store } = await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Nowa grupa'));
    await type(screen.getByTestId('group-name'), 'Znajomi');
    await press(screen.getByTestId('create-group'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    fail = false;
    await press(screen.getByTestId('create-group'));
    expect(account.createGroup).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Znajomi', displayName: 'Łukasz' }));
    expect(store.refresh).toHaveBeenCalled();
  });

  it('dołączenie ID + kodem: błędy serwera po kolei, potem sukces', async () => {
    const errors = ['invite_invalid', 'invite_expired', 'rate_limited', 'network', ''];
    const account = fakeAccount({ joinGroup: jest.fn(async () => { const e = errors.shift(); return e ? Promise.reject(new Error(e)) : { groupId: 'gf' }; }) });
    const { store } = await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    expect(screen.getByTestId('invite-accept').props.accessibilityState.disabled).toBe(true);
    await type(screen.getByTestId('invite-join-id'), '482 913 507');
    await type(screen.getByTestId('invite-code'), '731-064');
    await press(screen.getByTestId('invite-accept'));
    expect(account.joinGroup).toHaveBeenLastCalledWith('482913507', '731064', 'Łukasz');
    expect(await screen.findByText('Nieprawidłowe ID grupy albo kod. Sprawdź cyfry albo poproś o nowe zaproszenie.')).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText('Ten kod wygasł. Poproś o nowe zaproszenie.')).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText('Za dużo nieudanych prób. Spróbuj ponownie za godzinę.')).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(store.refresh).toHaveBeenCalled();
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
  });

  it('wklejona wiadomość wypełnia ID i kod; stary 64-znakowy kod nadal działa', async () => {
    const tok = 'ab'.repeat(32);
    const account = fakeAccount();
    await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await type(screen.getByTestId('invite-input'), 'Dotknij linku: https://lkarwowski494.github.io/j/?g=482913507&c=731064');
    expect(screen.getByTestId('invite-join-id').props.value).toBe('482 913 507');
    expect(screen.getByTestId('invite-code').props.value).toBe('731 064');
    await type(screen.getByTestId('invite-input'), `Wklej kod:\n${tok}`);
    await press(screen.getByTestId('invite-accept'));
    expect(account.acceptInvite).toHaveBeenLastCalledWith(tok, 'Łukasz');
    expect(account.joinGroup).not.toHaveBeenCalled();
  });
});

describe('Edycja grup (D54–D56)', () => {
  const asOwner = () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
    base.group_members!.ala = { ...base.group_members!.ala, role: 'admin' };
    return base;
  };

  it('właściciel: kolor linii, automatyczny, usunięcie do kosza z potwierdzeniem', async () => {
    const { store, account } = await open({ base: asOwner() });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByLabelText('Kolor: teal'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'groups', id: 'gf', set: { color: 'teal' } });
    expect(screen.getByLabelText('Kolor: teal').props.accessibilityState.selected).toBe(true);
    await press(screen.getByLabelText('Automatyczny'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'groups', id: 'gf', set: { color: null } });
    await press(screen.getByTestId('delete-group'));
    expect(screen.getByText(/Przez 30 dni możesz ją przywrócić/)).toBeTruthy();
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('delete-group'));
    await press(screen.getByTestId('delete-group-confirm'));
    expect(account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(store.refresh).toHaveBeenCalled();
    expect(await screen.findByTestId('screen-groups')).toBeTruthy();
  });

  it('błąd usuwania grupy pokazany; admin nie widzi koloru ani usuwania', async () => {
    const account = fakeAccount({ deleteGroup: jest.fn(async () => Promise.reject(new Error('x'))) });
    await open({ base: asOwner(), account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('delete-group'));
    await press(screen.getByTestId('delete-group-confirm'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
  });

  it('admin (domyślne dane): bez koloru i bez usuwania grupy', async () => {
    await open();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
    expect(screen.queryByLabelText('Kolor: teal')).toBeNull();
    expect(screen.queryByTestId('delete-group')).toBeNull();
  });

  it('kosz: grupa z liczbą dni i przywrócenie', async () => {
    const base = asOwner();
    base.groups!.gf = { ...base.groups!.gf, deleted_at: '2026-10-06T08:00:00Z' };
    const { account, store } = await open({ base });
    await press(screen.getByLabelText('Grupy'));
    expect(screen.queryByTestId('group-gf')).toBeNull();
    await press(await screen.findByTestId('trash-gf'));
    expect(screen.getByText('usunięcie za 29 dni')).toBeTruthy();
    expect(account.restoreGroup).toHaveBeenCalledWith('gf');
    await waitFor(() => expect(store.refresh).toHaveBeenCalled());
  });

  it('osoba: rola admin/członek, imię dziecka, usunięcie, przekazanie własności', async () => {
    const { store, account } = await open({ base: asOwner() });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('member-ala'));
    expect(await screen.findByTestId('screen-member')).toBeTruthy();
    await press(screen.getByLabelText('członek'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'group_members', id: 'ala', set: { role: 'member' } });
    await press(screen.getByTestId('make-owner'));
    expect(screen.getByText(/Ala zostanie właścicielem grupy/)).toBeTruthy();
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('make-owner'));
    await press(screen.getByTestId('make-owner-confirm'));
    expect(account.transferOwnership).toHaveBeenCalledWith('gf', 'ala');
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
    await press(screen.getByTestId('member-kuba'));
    expect(screen.queryByTestId('make-owner')).toBeNull();
    expect(screen.queryByLabelText('członek')).toBeNull();
    await type(screen.getByTestId('member-name'), 'Jakub');
    await press(screen.getByLabelText('Zapisz imię'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'group_members', id: 'kuba', set: { display_name: 'Jakub' } });
    await press(screen.getByTestId('remove-member'));
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('remove-member'));
    await press(screen.getByTestId('remove-confirm'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'group_members', id: 'kuba' });
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
  });

  it('przekazanie własności bez sieci: komunikat; osoba, której już nie ma: błąd zamiast awarii', async () => {
    const account = fakeAccount({ transferOwnership: jest.fn(async () => Promise.reject(new Error('x'))) });
    await open({ base: asOwner(), account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    await press(await screen.findByTestId('member-ala'));
    await press(await screen.findByTestId('make-owner'));
    await press(screen.getByTestId('make-owner-confirm'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
  });
});

describe('Ustawienia', () => {
  it('odrzucone zmiany z opisem; usunięcie konta po wpisaniu słowa; wylogowanie', async () => {
    const base = sampleBase();
    const s = setup({ base });
    const rejected = [
      { op: { seq: 3, op_id: 'o3', kind: 'patch' as const, entity: 'tasks' as const, id: 't', set: { title: 'Pranie' } }, code: 'forbidden:child' },
      { op: { seq: 4, op_id: 'o4', kind: 'cmd' as const, cmd: 'move_task', args: {} }, code: 'cycle' },
      { op: { seq: 5, op_id: 'o5', kind: 'delete' as const, entity: 'lists' as const, id: 'l' }, code: 'not_found' },
      { op: { seq: 6, op_id: 'o6', kind: 'create' as const, entity: 'tasks' as const, id: 'x', group_id: 'g', set: { title: 'Głęboko' } }, code: 'depth_exceeded' },
      { op: { seq: 7, op_id: 'o7', kind: 'restore' as const, entity: 'tasks' as const, id: 'y' }, code: 'coś_innego' },
    ];
    await act(async () => {
      s.store.getSnapshot().state = { ...s.store.getSnapshot().state, rejected } as never;
    });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Ustawienia'));
    expect(await screen.findByText('5 zmian')).toBeTruthy();
    await press(screen.getByTestId('open-rejected'));
    expect(await screen.findByText('Zmiana: „Pranie”')).toBeTruthy();
    expect(screen.getByText('Brak uprawnień')).toBeTruthy();
    expect(screen.getByText('Polecenie: move_task')).toBeTruthy();
    expect(screen.getByText('Przeniesienie utworzyłoby pętlę zadań')).toBeTruthy();
    expect(screen.getByText('Element został w międzyczasie usunięty')).toBeTruthy();
    expect(screen.getByText('Za głębokie zagnieżdżenie podzadań')).toBeTruthy();
    expect(screen.getByText('Przywrócenie')).toBeTruthy();
    expect(screen.getByText('Zmiana niezgodna z danymi na serwerze')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    expect(screen.getByText(/trafi do kosza na 30 dni/)).toBeTruthy();
    await press(screen.getByTestId('delete-start'));
    await type(screen.getByTestId('delete-word'), 'usun');
    expect(screen.getByTestId('delete-confirm').props.accessibilityState.disabled).toBe(true);
    await type(screen.getByTestId('delete-word'), 'usuń');
    await press(screen.getByTestId('delete-confirm'));
    expect(s.account.deleteAccount).toHaveBeenCalled();
    await press(screen.getByTestId('sign-out'));
    expect(s.account.signOut).toHaveBeenCalled();
  });

  it('błąd usuwania konta: komunikat; anulowanie czyści pole', async () => {
    const account = fakeAccount({ deleteAccount: jest.fn(async () => Promise.reject(new Error('x'))) });
    await open({ account });
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('delete-start'));
    await type(screen.getByTestId('delete-word'), 'USUŃ');
    await press(screen.getByTestId('delete-confirm'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    await press(screen.getByLabelText('Anuluj'));
    expect(screen.queryByTestId('delete-word')).toBeNull();
    await press(screen.getByLabelText('Odrzucone zmiany, 0 zmian'));
    expect(await screen.findByText('Serwer przyjął wszystkie Twoje zmiany.')).toBeTruthy();
  });
});
