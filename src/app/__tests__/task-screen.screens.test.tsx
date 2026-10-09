/** Ekran zadania — audyt 2, paczka ekranu zadania (M-81, M-86, M-87, M-89, M-116, M-146, M-202, M-204, M-206, M-244, M-245, M-251). */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { expectOps, answerAlert, pickDate, put, sampleBase, setTime, setup } from './harness';
import { strings } from '../../i18n/strings.pl';

const CHIP = strings['quick.chipA11y'];

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

/** Zadanie z listy „Dom” w Rodzinie. */
async function openTask(title: string, base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await press(screen.getByLabelText('Listy'));
  await press(await screen.findByTestId('list-lf'));
  await press(await screen.findByLabelText(new RegExp(`^${title}(,|$)`)));
  await screen.findByTestId('screen-task');
  return s;
}

const withSub = (extra: Record<string, unknown> = {}) => {
  const base = sampleBase();
  put(base, 'tasks', 's-1', { ...base.tasks!['t-kwiaty']!, id: 's-1', parent_id: 't-kwiaty', title: 'Wybrać tulipany', deadline_mode: 'inherit', due_date: null, ...extra });
  return base;
};

describe('ekran zadania: nagłówek i pola (M-146, M-202, M-116)', () => {
  it('nagłówek dla VoiceOvera to nazwa zadania; pole odhaczenia mówi, co odhacza; opis „Dla kogo” a „Przekaż”', async () => {
    await openTask('Kupić kwiaty');
    expect(screen.getByRole('header', { name: /^Kupić kwiaty, Rodzina, Dom/ })).toBeTruthy();
    expect(screen.getByLabelText('Oznacz jako zrobione: Kupić kwiaty')).toBeTruthy();
    expect(screen.getByText('Zmiana osoby działa od razu. „Przekaż zadanie” (przy Twoim zadaniu) prosi drugą osobę o przyjęcie.')).toBeTruthy();
  });

  it('pusty tytuł: pole wraca do zapisanego, komunikat do następnej zmiany, bez zapisu', async () => {
    const s = await openTask('Kupić kwiaty');
    await fireEvent.changeText(screen.getByTestId('task-title'), '  ');
    await fireEvent(screen.getByTestId('task-title'), 'blur');
    expect(screen.getByTestId('task-title').props.value).toBe('Kupić kwiaty');
    expect(screen.getByRole('alert').props.children).toBe('Wpisz, co jest do zrobienia.');
    expect(s.store.dispatched).toEqual([]);
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Kupić róże');
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent(screen.getByTestId('task-title'), 'submitEditing');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { title: 'Kupić róże' } }]);
  });

  it('pusta notatka = bez notatki', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-kwiaty', { ...base.tasks!['t-kwiaty']!, note: 'tulipany' });
    const s = await openTask('Kupić kwiaty', base);
    await fireEvent.changeText(screen.getByTestId('task-note'), ' ');
    await fireEvent(screen.getByTestId('task-note'), 'blur');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { note: null } }]);
  });
});

describe('termin (M-89, M-206, M-245)', () => {
  it('jeden kształt: Dziś · Jutro · Inny dzień · Bez terminu; „Inny dzień” rozwija kalendarz', async () => {
    const s = await openTask('Kupić kwiaty');
    const options = within(screen.getByLabelText('Kiedy')).getAllByRole('button').map((r) => r.props.accessibilityLabel);
    expect(options).toEqual(['Dziś', 'Jutro', 'Inny dzień', 'Bez terminu']);
    expect(radio('Kiedy', 'Jutro').props.accessibilityState.selected).toBe(true);
    await press(radio('Kiedy', 'Dziś'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'own', due_date: '2026-10-07' } }]);
    await press(radio('Kiedy', 'Inny dzień'));
    expect(screen.getByTestId('task-date-calendar')).toBeTruthy();
  });

  it('bez dnia godzina jest nieaktywna z wyjaśnieniem (wcześniej wybrana znikała bez słowa)', async () => {
    await openTask('Kupić kwiaty');
    await press(radio('Kiedy', 'Bez terminu'));
    const time = screen.getByTestId('task-time');
    expect(time.props.accessibilityState.disabled).toBe(true);
    // Audyt 3 (N-199): powód czyta widoczna notka pod polem — podpowiedź go nie powtarza.
    expect(time.props.accessibilityHint).toBeUndefined();
    expect(screen.getByText('Najpierw wybierz dzień.')).toBeTruthy();
    await press(time);
    expect(screen.queryByTestId('task-time-panel')).toBeNull();
  });

  it('ręczna godzina: w trakcie pisania bez błędu, pełna zapisuje się, niepełna po wyjściu z pola — komunikat', async () => {
    const s = await openTask('Kupić kwiaty');
    await setTime('task-time', '1');
    await setTime('task-time', '19:');
    expect(screen.queryByText('Sprawdź godzinę (GG:MM).')).toBeNull();
    expect(s.store.dispatched).toEqual([]);
    await fireEvent(screen.getByTestId('task-time-manual'), 'blur');
    expect(screen.getByText('Sprawdź godzinę (GG:MM).')).toBeTruthy();
    await setTime('task-time', '19:30');
    expect(screen.queryByText('Sprawdź godzinę (GG:MM).')).toBeNull();
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { due_time: '19:30' } }]);
    // Kafelek po wpisywaniu ręcznym: pole pokazuje kafelek, nie stary wpis.
    await setTime('task-time', '0');
    await press(screen.getByTestId('task-time-h-08'));
    expect(screen.getByTestId('task-time-manual').props.value).toBe('08:30');
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { due_time: '08:30' } }]);
  });
});

describe('podzadanie (M-81, M-204, M-251, M-244)', () => {
  it('„jak nadrzędne”: bez przełącznika „Gdy nie zrobisz w terminie”, z opisem; własny dzień i powrót do „Jak zadanie nadrzędne”', async () => {
    const s = await openTask('Kupić kwiaty', withSub());
    await press(screen.getByLabelText(/^Wybrać tulipany(,|$)/));
    await screen.findByText('Gdy nie zrobisz w terminie: jak zadanie nadrzędne.');
    expect(screen.queryByLabelText('Gdy nie zrobisz w terminie')).toBeNull();
    expect(radio('Kiedy', 'Jak zadanie nadrzędne').props.accessibilityState.selected).toBe(true);
    await press(radio('Kiedy', 'Dziś'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 's-1', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: null } }]);
    expect(screen.getByLabelText('Gdy nie zrobisz w terminie')).toBeTruthy();
    await press(radio('Kiedy', 'Jak zadanie nadrzędne'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 's-1', set: { deadline_mode: 'inherit', due_date: null, due_time: null, repeat: null } }]);
    await press(radio('Kiedy', 'Jak zadanie nadrzędne'));
    expectOps(s.store, []);
    // Zadanie główne nie ma tej opcji.
    await press(screen.getByLabelText('Wróć'));
    expect(within(await screen.findByLabelText('Kiedy')).queryByLabelText('Jak zadanie nadrzędne')).toBeNull();
  });

  it('wiersze podzadań jak na liście: termin, osoba, „czeka na wysłanie”', async () => {
    await openTask('Kupić kwiaty', withSub({ deadline_mode: 'own', due_date: '2026-10-07', assignee_member_id: 'ala' }));
    expect(screen.getByLabelText(/^Wybrać tulipany, .*dziś.*Ala/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'wstążka');
    await press(screen.getByLabelText('Dodaj'));
    expect(within(screen.getByLabelText(/^wstążka/)).getByText(/czeka na wysłanie/)).toBeTruthy();
  });

  it('dodawanie jak szybkie dodawanie: „jutro” to chip (termin); odklikany zostaje w nazwie; sam termin — komunikat', async () => {
    const s = await openTask('Kupić kwiaty');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'wstążka jutro');
    await press(screen.getByLabelText(CHIP('jutro')));
    await press(screen.getByLabelText('Dodaj'));
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lf', parent_id: 't-kwiaty', title: 'wstążka jutro', sort_key: 'a0', deadline_mode: 'inherit', due_date: null, due_time: null } }]);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'kokarda jutro');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gf', set: { list_id: 'lf', parent_id: 't-kwiaty', title: 'kokarda', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null } }]);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'jutro');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
  });
});

describe('powtarzanie: zmiana dnia i ostatni dzień miesiąca (D181, PWD-37)', () => {
  const repeating = (repeat: string, due = '2026-10-12') => {
    const base = sampleBase();
    put(base, 'tasks', 't-kwiaty', { ...base.tasks!['t-kwiaty']!, due_date: due, repeat });
    return base;
  };

  it('co tydzień: inny dzień tygodnia pyta „Tylko ten raz / Też kolejne”', async () => {
    const s = await openTask('Kupić kwiaty', repeating('FREQ=WEEKLY;BYDAY=MO'));
    await press(radio('Kiedy', 'Jutro')); // czwartek 8.10
    expect(screen.getByText('Zmienić też kolejne terminy?')).toBeTruthy();
    expect(s.store.dispatched).toEqual([]);
    await press(within(screen.getByTestId('cycle-ask')).getByLabelText('Tylko ten raz'));
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'own', due_date: '2026-10-08' } }]);
    expect(screen.queryByTestId('cycle-ask')).toBeNull();
  });

  it('„Też kolejne” przestawia cykl; „Anuluj” nic nie zmienia; ten sam dzień tygodnia — bez pytania', async () => {
    const s = await openTask('Kupić kwiaty', repeating('FREQ=WEEKLY;BYDAY=MO'));
    await press(radio('Kiedy', 'Jutro'));
    await press(within(screen.getByTestId('cycle-ask')).getByLabelText('Anuluj'));
    expect(s.store.dispatched).toEqual([]);
    await press(radio('Kiedy', 'Jutro'));
    await press(within(screen.getByTestId('cycle-ask')).getByLabelText('Też kolejne'));
    expect(s.store.dispatched).toEqual([
      { kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'own', due_date: '2026-10-08' } },
      { kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { repeat: 'FREQ=WEEKLY;BYDAY=TH' } },
    ]);
  });

  it('co miesiąc (zapis bez dnia): „Tylko ten raz” zapisuje dzień cyklu (D137)', async () => {
    const s = await openTask('Kupić kwiaty', repeating('FREQ=MONTHLY', '2026-10-15'));
    await press(radio('Kiedy', 'Jutro'));
    await press(within(screen.getByTestId('cycle-ask')).getByLabelText('Tylko ten raz'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'own', due_date: '2026-10-08' } }, { kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=15' } }]);
  });

  it('co miesiąc 31.: „ostatniego dnia miesiąca” albo napis o pominiętych miesiącach', async () => {
    const s = await openTask('Kupić kwiaty', repeating('FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31'));
    expect(screen.getByText('Miesiące bez 31. dnia zostaną pominięte.')).toBeTruthy();
    expect(radio('Który dzień miesiąca', '31. dnia').props.accessibilityState.selected).toBe(true);
    await press(radio('Który dzień miesiąca', 'ostatniego dnia miesiąca'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=-1' } }]);
    expect(screen.queryByText('Miesiące bez 31. dnia zostaną pominięte.')).toBeNull();
    await press(radio('Który dzień miesiąca', '31. dnia'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=31' } }]);
  });

  it('termin w środku miesiąca: bez wyboru dnia; odhaczenie „ostatniego dnia” daje koniec następnego miesiąca', async () => {
    const s = await openTask('Kupić kwiaty', repeating('FREQ=MONTHLY;BYMONTHDAY=15', '2026-10-15'));
    expect(screen.queryByLabelText('Który dzień miesiąca')).toBeNull();
    await act(async () => s.store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-kwiaty': { ...b.tasks!['t-kwiaty']!, due_date: '2026-10-31', repeat: 'FREQ=MONTHLY;BYMONTHDAY=-1' } } })));
    expect(radio('Który dzień miesiąca', 'ostatniego dnia miesiąca').props.accessibilityState.selected).toBe(true);
    await press(screen.getByLabelText('Oznacz jako zrobione: Kupić kwiaty'));
    await answerAlert('Zrobione');
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { completed_at: '2026-10-07T08:00:00.000Z' } }, { kind: 'create', entity: 'tasks', id: '303b9615-ee92-546d-8d39-47a90f8fc973', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'Kupić kwiaty', note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'own', due_date: '2026-11-30', due_time: null, rollover: true, repeat: 'FREQ=MONTHLY;BYMONTHDAY=-1' } }]);
  });
});

describe('pole dodawania na liście zadań: „@imię”, „@ja”, „#…” (spójnie z Moimi sprawami)', () => {
  async function openList(base = sampleBase()) {
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    return s;
  }
  const add = async (text: string) => {
    await fireEvent.changeText(screen.getByTestId('quick-add'), text);
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
  };

  it('„@Ala” przypisuje osobę, „@ja” — mnie; „@” znika z nazwy', async () => {
    const s = await openList();
    await add('odkurzyć jutro @Ala');
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'odkurzyć', sort_key: 'a0', deadline_mode: 'own', due_date: '2026-10-08', due_time: null, assignee_member_id: 'ala' } }]);
    await add('zmyć @ja');
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'zmyć', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null, assignee_member_id: 'mf' } }]);
  });

  it('kilka osób — pytanie; nikt o tym imieniu nie widzi listy — „Dodaj bez osoby” zostawia „@…” w nazwie', async () => {
    const base = sampleBase();
    put(base, 'group_members', 'alek', { member_id: 'alek', group_id: 'gf', user_id: 'u-alek', display_name: 'Alek', role: 'member', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 });
    const s = await openList(base);
    await add('zebranie @al');
    expect(s.store.dispatched).toEqual([]);
    await press(within(screen.getByTestId('mention-choices')).getByLabelText('Alek'));
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'zebranie', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null, assignee_member_id: 'alek' } }]);
    expect(screen.getByTestId('quick-add').props.value).toBe('');
    await add('basen @Zosia');
    expect(screen.getByText('Nikt o imieniu @Zosia nie widzi tej listy')).toBeTruthy();
    await press(screen.getByLabelText('Dodaj bez osoby'));
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-2', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'basen @Zosia', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect((s.store.dispatched.at(-1) as { set: object }).set).not.toHaveProperty('assignee_member_id');
  });

  it('„#Grupa” nie zmienia grupy listy — podpowiedź, zostaje w nazwie; sam „@ja” — komunikat', async () => {
    const s = await openList();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'zebranie #Klasa');
    expect(screen.getByText('Na liście „#Klasa” nie zmienia grupy — zostanie w nazwie.')).toBeTruthy();
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expectOps(s.store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'zebranie #Klasa', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    await add('@ja');
    expect(screen.getByText('Wpisz, co jest do zrobienia.')).toBeTruthy();
  });
});

describe('wydarzenie: ostatni dzień miesiąca (PWD-37)', () => {
  it('start 31.10, co miesiąc: „ostatniego dnia miesiąca” → BYMONTHDAY=-1; „31. dnia” z napisem o pominiętych miesiącach', async () => {
    const s = setup({ base: sampleBase() });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Czynsz');
    await pickDate('event-date', '2026-10-31');
    await press(radio('Pora', 'Cały dzień'));
    await press(radio('Powtarzanie', 'Co miesiąc'));
    expect(screen.getByText('Miesiące bez 31. dnia zostaną pominięte.')).toBeTruthy();
    await press(radio('Który dzień miesiąca', 'ostatniego dnia miesiąca'));
    expect(screen.queryByText('Miesiące bez 31. dnia zostaną pominięte.')).toBeNull();
    await press(screen.getByTestId('event-save'));
    expectOps(s.store, [{ kind: 'create', entity: 'events', id: 'new-1', group_id: 'u-me', set: { title: 'Czynsz', start_date: '2026-10-31', start_time: null, end_time: null, rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1', audience: 'group', responsible_member_id: null } }]);
  });
});
