/**
 * Audyt 2, paczka P13 (Moje sprawy, Kalendarz, nawigacja): zakres Moich spraw w grupie (PW-2), filtr grup (PW-38),
 * Ustawienia na każdej zakładce (PW-28), „Zrobione dziś” i „Bez terminu” (PWD-7, PWD-13), wydarzenie dziecka u drugiego
 * rodzica (PWD-32 B), kolejność kart (PWD-31), Kalendarz (PWD-1 C, PWD-8, PWD-11, PWD-15, M-129), północ (M-203).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import * as Application from 'expo-application';

import { WHATS_NEW_SEEN } from '../../features/today/WhatsNew';
import { whatsNewEntries } from '../../i18n/whats-new.pl';
import { scopeRowId } from '../../domain/views/my-scope';
import { MY_SCOPE_KEY } from '../my-scope';
import { GROUP_FILTER_KEY } from '../group-filter';
import { RootStack } from '../navigation';
import { answerAlert, NOW, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase(), local: Record<string, string> = {}, extra: Parameters<typeof setup>[0] = {}) {
  const s = setup({ base, ...extra });
  for (const [k, v] of Object.entries(local)) s.services.local!.save(k, v);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('PW-28 A (M-127): Ustawienia na każdej zakładce, chip synchronizacji tylko informuje', () => {
  it('ikona „Ustawienia” w Moich sprawach, Listach, Kalendarzu i Grupach; chip to tekst ze stanem', async () => {
    await open();
    for (const tab of ['Today', 'Lists', 'Calendar', 'Groups']) {
      await press(screen.getByTestId(`tab-${tab}`));
      const screenId = { Today: 'screen-today', Lists: 'screen-lists', Calendar: 'screen-calendar', Groups: 'screen-groups' }[tab]!;
      const root = await screen.findByTestId(screenId);
      expect(within(root).getByTestId('sync-chip').props.accessibilityLabel).toBe('Stan synchronizacji: Zsynchronizowano');
      expect(within(root).getByTestId('sync-chip').props.accessibilityRole).toBe('text');
      await press(within(root).getByLabelText('Ustawienia'));
      expect(await screen.findByTestId('screen-settings')).toBeTruthy();
      await press(screen.getByLabelText('Wróć'));
    }
    // Dawny przycisk „Ustawienia” na ekranie Grup zniknął — jedno wejście.
    expect(within(screen.getByTestId('screen-groups')).getAllByLabelText('Ustawienia')).toHaveLength(1);
  });

  it('PWD-10 A (M-279): przeciągnięcie listy pobiera zmiany (zakładki i ekran listy)', async () => {
    const s = await open();
    const pull = async (id: string) => {
      const control = screen.getByTestId(id).props.refreshControl;
      await act(async () => control.props.onRefresh());
      expect(control.props.accessibilityLabel).toBe('Odśwież');
    };
    await pull('screen-today');
    expect(s.store.refresh).toHaveBeenCalledTimes(1);
    await press(screen.getByTestId('tab-Lists'));
    await pull('screen-lists');
    await press(await screen.findByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    await pull('screen-list');
    expect(s.store.refresh).toHaveBeenCalledTimes(3);
  });
});

describe('PW-2 A (M-35): zakres Moich spraw w grupie', () => {
  it('„Przypisane do mnie i wydarzenia” w Klasie: wspólne zadanie znika z Moich spraw; ustawienie zapamiętane na telefonie', async () => {
    const s = await open();
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    await press(screen.getByTestId('tab-Groups'));
    await press(await screen.findByTestId('group-gk'));
    const scope = await screen.findByLabelText('W Moich sprawach');
    expect(within(scope).getByLabelText('Wszystko').props.accessibilityState.selected).toBe(true);
    await press(within(scope).getByLabelText('Przypisane do mnie i wydarzenia'));
    // Zapis na koncie: wiersz zakresu przy moim członkostwie (widzi go tylko to konto).
    expect(s.store.dispatched.at(-1)).toEqual({ kind: 'create', entity: 'my_day_scopes', id: scopeRowId('mk'), group_id: 'gk', set: { member_id: 'mk', scope: 'mineAndEvents' } });
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByTestId('tab-Today'));
    expect(screen.queryByText('Przynieść korki na trening')).toBeNull();
    expect(screen.getByText('Odebrać paczkę')).toBeTruthy();
    // Grupa osobista nie ma tego ustawienia (wszystko w niej jest moje).
    await press(screen.getByTestId('tab-Groups'));
    await press(screen.getByTestId(`group-u-me`));
    await screen.findByTestId('screen-group');
    expect(screen.queryByLabelText('W Moich sprawach')).toBeNull();
  });

  it('zakres z konta (drugi telefon): wiersz pobrany z serwera działa od razu; dawny zapis telefonu przechodzi na konto raz', async () => {
    const base = sampleBase();
    put(base, 'my_day_scopes', scopeRowId('mk'), { id: scopeRowId('mk'), group_id: 'gk', member_id: 'mk', scope: 'mine', deleted_at: null, version: 2 });
    await open(base);
    expect(screen.queryByText('Przynieść korki na trening')).toBeNull();
    const s = await open(sampleBase(), { [MY_SCOPE_KEY]: '{"gk":"mineAndEvents","stara":"mine"}' });
    expect(s.store.dispatched).toEqual([{ kind: 'create', entity: 'my_day_scopes', id: scopeRowId('mk'), group_id: 'gk', set: { member_id: 'mk', scope: 'mineAndEvents' } }]);
    expect(s.services.local!.load(MY_SCOPE_KEY)).toBeNull();
    expect(screen.queryByText('Przynieść korki na trening')).toBeNull();
  });

  it('po dołączeniu do dużej grupy — podpowiedź; znika po wybraniu zakresu', async () => {
    const base = sampleBase();
    for (let i = 0; i < 9; i++) put(base, 'group_members', `k${i}`, { member_id: `k${i}`, group_id: 'gk', user_id: `u-${i}`, display_name: `Rodzic ${i}`, role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
    const s = setup({ base, account: undefined });
    s.account.joinGroup.mockResolvedValue({ groupId: 'gk' });
    await s.renderApp(<RootStack />);
    await press(await screen.findByTestId('tab-Groups'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await fireEvent.changeText(screen.getByTestId('invite-join-id'), '482913507');
    await fireEvent.changeText(screen.getByTestId('invite-code'), '731064');
    await press(screen.getByTestId('invite-accept'));
    expect((await screen.findByTestId('my-scope-hint')).props.children).toBe('Ta grupa ma 11 osób. Jeśli jej sprawy zaleją Moje sprawy, wybierz niżej „Przypisane do mnie i wydarzenia” albo „Tylko przypisane do mnie”.');
    await press(within(screen.getByLabelText('W Moich sprawach')).getByLabelText('Tylko przypisane do mnie'));
    expect(screen.queryByTestId('my-scope-hint')).toBeNull();
  });
});

describe('PW-38 A (M-119): chipy grup filtrują Moje sprawy i Kalendarz', () => {
  it('wybór grupy, znak „Filtr włączony”, jedno dotknięcie wyłącza; ten sam filtr w Kalendarzu; zapamiętany', async () => {
    const s = await open();
    const chip = screen.getByTestId('today-filter-gf');
    expect(chip.props.accessibilityState.selected).toBe(false);
    await press(chip);
    expect(screen.getByTestId('today-filter-gf').props.accessibilityState.selected).toBe(true);
    expect(within(screen.getByTestId('today-filter-on')).getByText('Filtr włączony: Rodzina')).toBeTruthy();
    expect(screen.queryByText('Przynieść korki na trening')).toBeNull();
    expect(screen.queryByText('Oddać książki do biblioteki')).toBeNull();
    expect(screen.getByText('Odebrać paczkę')).toBeTruthy();
    expect(s.services.local!.load(GROUP_FILTER_KEY)).toBe('["gf"]');
    await press(screen.getByTestId('tab-Calendar'));
    await screen.findByTestId('screen-calendar');
    expect(within(screen.getByTestId('calendar-filter-on')).getByText('Filtr włączony: Rodzina')).toBeTruthy();
    expect(screen.queryByText('Przynieść korki na trening')).toBeNull();
    expect(screen.getByText('Odebrać paczkę')).toBeTruthy();
    await press(screen.getByLabelText('Wyłącz filtr, pokaż wszystkie grupy'));
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    expect(s.services.local!.load(GROUP_FILTER_KEY)).toBeNull();
    await press(screen.getByTestId('tab-Today'));
    expect(screen.queryByTestId('today-filter-on')).toBeNull();
  });

  it('zapamiętany filtr wraca po ponownym otwarciu; grupa, której już nie mam, nie filtruje', async () => {
    await open(sampleBase(), { [GROUP_FILTER_KEY]: '["gk","stara"]' });
    expect(within(screen.getByTestId('today-filter-on')).getByText('Filtr włączony: Klasa 2b')).toBeTruthy();
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    expect(screen.queryByText('Odebrać paczkę')).toBeNull();
  });
});

describe('Moje sprawy: „Zrobione dziś”, „Bez terminu”, kolejność kart, wydarzenie dziecka', () => {
  it('PWD-7 A (M-276): odhaczone dziś w zwiniętej sekcji „Zrobione dziś (1)” — da się je odznaczyć', async () => {
    const s = await open();
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    await answerAlert('Zrobione');
    const done = screen.getByTestId('today-done');
    expect(within(done).getByLabelText('Zrobione dziś (1), pokaż')).toBeTruthy();
    expect(within(done).queryByText('Odebrać paczkę')).toBeNull();
    await press(within(done).getByLabelText('Zrobione dziś (1), pokaż'));
    expect(within(done).getByLabelText('Zrobione dziś (1), schowaj').props.accessibilityState.expanded).toBe(true);
    await press(within(done).getByLabelText('Oznacz jako niezrobione: Odebrać paczkę'));
    expect(s.store.dispatched.at(-1)).toMatchObject({ kind: 'patch', id: 't-paczka', set: { completed_at: null } });
    expect(screen.queryByTestId('today-done')).toBeNull();
  });

  it('PWD-13 A (M-282): „Bez terminu” w dniu jako sekcja, w tygodniu i miesiącu — zwinięta na górze', async () => {
    await open();
    expect(screen.getByText('Bez terminu')).toBeTruthy();
    await press(within(screen.getByLabelText('Zakres')).getByLabelText('Tydzień'));
    const pinned = screen.getByTestId('today-pinned');
    expect(within(pinned).queryByText('Oddać książki do biblioteki')).toBeNull();
    await press(within(pinned).getByLabelText('Bez terminu (1), pokaż'));
    expect(within(pinned).getByText('Oddać książki do biblioteki')).toBeTruthy();
    // Tydzień bez dzisiejszego dnia — bez sekcji (bez terminu = na teraz).
    await press(screen.getByLabelText('Następny tydzień'));
    expect(screen.queryByTestId('today-pinned')).toBeNull();
  });

  it('PWD-31 A (M-300): „Do potwierdzenia” nad kartami informacyjnymi', async () => {
    const base = sampleBase();
    put(base, 'handoffs', 'h1', { id: 'h1', group_id: 'gf', entity: 'tasks', entity_id: 't-ala', occurrence_date: null, from_member: 'ala', to_member: 'mf', status: 'pending', closed: false, created_at: '2026-10-07T07:00:00Z', deleted_at: null, version: 1 });
    // „Co nowego” po aktualizacji (jak whats-new.screens.test.tsx): poprzedni build zapamiętany, bieżący — najnowszy wpis.
    const newest = whatsNewEntries[0]!;
    (Application as { nativeBuildVersion: string | null }).nativeBuildVersion = String(newest.fromBuild);
    const m = new Map([['welcomeSeen', '1'], ['nameAsked', '1'], [WHATS_NEW_SEEN, String(newest.fromBuild - 1)]]);
    await open(base, {}, { prefs: { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) } });
    await screen.findByTestId('whats-new');
    // Kolejność w drzewie ekranu: karta przekazań przed „Co nowego”, prośbą o powiadomienia i planem dnia.
    const order = screen.getAllByTestId(/^(handoff-inbox|whats-new|push-prompt|today-day-.*)$/).map((n) => n.props.testID as string);
    const at = (id: string) => order.indexOf(id);
    expect(at('handoff-inbox')).toBeGreaterThan(-1);
    expect(at('handoff-inbox')).toBeLessThan(at('whats-new'));
    expect(at('handoff-inbox')).toBeLessThan(at('today-day-2026-10-07'));
    (Application as { nativeBuildVersion: string | null }).nativeBuildVersion = '13';
  });

  it('PWD-32 B (M-301): wydarzenie dziecka, które prowadzi Ala — wyszarzone „Kuba: Basen” z osobą odpowiedzialną, bez „Wyjdź o”', async () => {
    const base = sampleBase();
    put(base, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen', start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'members', responsible_member_id: 'ala', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'pk', { id: 'pk', event_id: 'basen', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    await open(base);
    expect(screen.getByLabelText(/^Kuba: Basen, 17:00–18:00, 1 h, Rodzina, odpowiada: Ala$/)).toBeTruthy();
    expect(within(screen.getByTestId('today-event-basen-2026-10-07')).getByText('Kuba: Basen')).toBeTruthy();
  });
});

describe('Kalendarz jak Moje sprawy (M-129) i decyzje PWD', () => {
  async function calendar(base = sampleBase()) {
    const s = await open(base);
    await press(screen.getByTestId('tab-Calendar'));
    await screen.findByTestId('screen-calendar');
    return s;
  }

  it('PWD-8 A (M-277): „Dziś” wraca do bieżącego miesiąca i dnia; na nim wyszarzony', async () => {
    await calendar();
    const today = () => screen.getByTestId('calendar-go-today');
    expect(today().props.accessibilityState.disabled).toBe(true);
    await press(screen.getByLabelText('Następny miesiąc'));
    await press(screen.getByLabelText('Następny miesiąc'));
    expect(screen.getByTestId('calendar-month').props.children).toBe('Grudzień 2026');
    expect(today().props.accessibilityState.disabled).toBe(false);
    await press(today());
    expect(screen.getByTestId('calendar-month').props.children).toBe('Październik 2026');
    expect(screen.getByText('Odebrać paczkę')).toBeTruthy();
  });

  it('M-128, M-129: w liście dnia sama godzina; zaległe i „minęło”; PWD-1 C: zrobione w dniu terminu z dniem odhaczenia', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'stare', { ...base.tasks!['t-books']!, id: 'stare', title: 'Zapłacić rachunek', deadline_mode: 'own', due_date: '2026-10-05', due_time: null });
    put(base, 'tasks', 'minelo', { ...base.tasks!['t-books']!, id: 'minelo', title: 'Kartka urodzinowa', deadline_mode: 'own', due_date: '2026-10-05', rollover: false });
    put(base, 'tasks', 'zrob', { ...base.tasks!['t-books']!, id: 'zrob', title: 'Wynieść śmieci', deadline_mode: 'own', due_date: '2026-10-05', completed_at: '2026-10-06T10:00:00Z' });
    await calendar(base);
    expect(within(screen.getByTestId('cal-t-paczka')).getByText('18:00')).toBeTruthy();
    await press(screen.getByTestId('day-2026-10-05'));
    expect(within(screen.getByTestId('cal-stare')).getByText('zaległe od 2 dni')).toBeTruthy();
    expect(within(screen.getByTestId('cal-minelo')).getByText('minęło')).toBeTruthy();
    expect(screen.getByLabelText(/^Otwórz: Wynieść śmieci, Osobiste, zrobione wczoraj$/)).toBeTruthy();
  });

  it('PWD-15 A (M-284): blade kolejne terminy zadania powtarzanego — bez odhaczania, otwierają zadanie', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'smieci', { ...base.tasks!['t-books']!, id: 'smieci', title: 'Śmieci', deadline_mode: 'own', due_date: '2026-10-07', repeat: 'FREQ=WEEKLY;BYDAY=WE' });
    await calendar(base);
    await press(screen.getByTestId('day-2026-10-14'));
    const next = screen.getByTestId('cal-next-smieci-2026-10-14');
    expect(within(next).queryByRole('checkbox')).toBeNull();
    expect(within(next).getByText(/kolejny termin/)).toBeTruthy();
    await press(screen.getByLabelText(/^Kolejny termin: Śmieci\. Otwórz zadanie/));
    expect(await screen.findByTestId('screen-task')).toBeTruthy();
  });

  it('PWD-11 A (M-280): zrobione zakupy przekreślone w dniu planu, bez pola odhaczania', async () => {
    const base = sampleBase();
    put(base, 'shopping_trips', 'tr1', { id: 'tr1', group_id: 'gf', list_id: 'lz', planned_date: '2026-10-06', done_at: '2026-10-07T07:00:00Z', deleted_at: null, version: 1 });
    await calendar(base);
    await press(screen.getByTestId('day-2026-10-06'));
    const row = screen.getByTestId('cal-trip-done-tr1');
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(within(row).getByText('Zakupy na weekend').props.style.textDecorationLine).toBe('line-through');
    expect(within(row).getByText(/zrobione dziś/)).toBeTruthy();
  });
});

describe('M-203: zegar dnia', () => {
  afterEach(() => jest.useRealTimers());
  it('23:59 → 00:01: Moje sprawy pokazują nowy dzień bez zmiany danych', async () => {
    jest.useFakeTimers();
    const clock = { at: { ...NOW, hh: 23, mm: 59 }, ms: Date.UTC(2026, 9, 7, 21, 59) };
    const s = setup({ clock });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getByTestId('today-range-label').props.children).toBe('Środa, 7 października');
    clock.at = { y: 2026, m: 10, d: 8, hh: 0, mm: 1 };
    clock.ms = Date.UTC(2026, 9, 7, 22, 1);
    await act(async () => jest.advanceTimersByTime(2 * 60_000));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Czwartek, 8 października');
  });

  it('czekanie najwyżej godzinę i liczenie od nowa (bez założeń o zmianie czasu): wieczorem bez zmiany, po północy — nowy dzień', async () => {
    jest.useFakeTimers();
    const clock = { at: { ...NOW, hh: 21, mm: 0 }, ms: Date.UTC(2026, 9, 7, 19, 0) };
    const s = setup({ clock });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    clock.at = { ...NOW, hh: 22, mm: 1 };
    clock.ms += 61 * 60_000;
    await act(async () => jest.advanceTimersByTime(61 * 60_000));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Środa, 7 października');
    clock.at = { y: 2026, m: 10, d: 8, hh: 0, mm: 30 };
    await act(async () => jest.advanceTimersByTime(61 * 60_000));
    expect(screen.getByTestId('today-range-label').props.children).toBe('Czwartek, 8 października');
  });
});
