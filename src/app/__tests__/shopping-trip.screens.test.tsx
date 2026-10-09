/** Zakupy na liście zakupów (D73): tworzenie z dniem i osobą, „Moje sprawy”, odhaczenie z pytaniem, planowanie, przekazanie. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { expectOps, answerAlert, lastAlert, put, sampleBase, setup , pickDate, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const planned = (extra: Record<string, unknown> = {}) => {
  const base = sampleBase();
  put(base, 'lists', 'lz', { ...base.lists!.lz!, due_date: '2026-10-07', due_time: '17:00:00', responsible_member_id: 'mf', ...extra });
  return base;
};

describe('nowa lista zakupów', () => {
  it('audyt 2 (R-3): lista „Tylko ja” — zakupy robię ja albo nikt; wybrana wcześniej inna osoba spada', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await screen.findByTestId('screen-new-list');
    await fireEvent.changeText(screen.getByTestId('list-name'), 'Prezent dla Ali');
    await press(screen.getByLabelText('Zakupy'));
    await press(screen.getByLabelText('Rodzina'));
    await press(within(screen.getByLabelText('Kto robi zakupy')).getByLabelText('Ala'));
    await press(screen.getByLabelText('Tylko ja'));
    const who = screen.getByLabelText('Kto robi zakupy');
    expect(within(who).queryByLabelText('Ala')).toBeNull();
    await press(within(who).getByLabelText('Łukasz'));
    await press(screen.getByTestId('create-list'));
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gf', set: { kind: 'shopping', name: 'Prezent dla Ali', visibility: 'private', due_date: null, due_time: null, responsible_member_id: 'mf' } }]);
  });


  it('we wspólnej grupie bez dnia i osoby nie da się utworzyć; z osobą — tak', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await screen.findByTestId('screen-new-list');
    await fireEvent.changeText(screen.getByTestId('list-name'), 'Biedronka');
    await press(screen.getByLabelText('Zakupy'));
    await press(screen.getByLabelText('Rodzina'));
    expect(screen.getByText(/We wspólnej grupie wybierz osobę albo dzień zakupów/)).toBeTruthy();
    // PWD-5 A (M-274): przycisk aktywny — po naciśnięciu komunikat zamiast utworzenia.
    await press(screen.getByTestId('create-list'));
    expect(screen.getByTestId('list-error').props.children).toMatch(/^We wspólnej grupie wybierz osobę albo dzień zakupów/);
    expect(store.dispatched).toEqual([]);
    // Dzieci nie robią zakupów.
    const who = screen.getByLabelText('Kto robi zakupy');
    expect(within(who).queryByLabelText('Tymek')).toBeNull();
    await press(within(who).getByLabelText('Ala'));
    await press(screen.getByLabelText('Jutro'));
    await setTime('trip-time', '18:30');
    await press(screen.getByTestId('create-list'));
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gf', set: { kind: 'shopping', name: 'Biedronka', visibility: 'group', due_date: '2026-10-08', due_time: '18:30', responsible_member_id: 'ala' } }]);
  });

  it('dzień z kalendarza; „Bez terminu” czyści dzień; grupa osobista bez wymogu', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    await fireEvent.changeText(await screen.findByTestId('list-name'), 'Apteka');
    await press(screen.getByLabelText('Zakupy'));
    await press(screen.getByLabelText('Rodzina'));
    await pickDate('trip-date', '2026-10-12');
    expect(screen.getByTestId('trip-date').props.accessibilityValue.text).toBe('Poniedziałek, 12 października');
    await press(screen.getByLabelText('Bez terminu'));
    // M-89, M-245: bez dnia godzina jest nieaktywna z wyjaśnieniem (jak w zadaniu).
    expect(screen.getByTestId('trip-time').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Najpierw wybierz dzień.')).toBeTruthy();
    await press(screen.getByLabelText('Osobiste'));
    await press(screen.getByTestId('create-list'));
    expectOps(store, [{ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'u-me', set: { kind: 'shopping', name: 'Apteka', visibility: 'group', due_date: null, due_time: null, responsible_member_id: null } }]);
  });
});

describe('zakupy na „Moje sprawy”', () => {
  it('wpis „Zakupy: …” z liczbą pozycji; odhaczenie pyta o niekupione', async () => {
    const { store } = await open(planned());
    const row = await screen.findByTestId('today-trip-lz');
    expect(within(row).getByText('Zakupy na weekend')).toBeTruthy();
    expect(within(row).getByText(/1 do kupienia/)).toBeTruthy();
    await press(screen.getByLabelText('Oznacz jako zrobione: Zakupy na weekend'));
    expect(lastAlert()).toMatchObject({ title: 'Zakupy zrobione?', message: 'Na liście została 1 niekupiona pozycja.' });
    await answerAlert('Anuluj');
    expect(store.dispatched).toEqual([]);
    await press(screen.getByLabelText('Oznacz jako zrobione: Zakupy na weekend'));
    await answerAlert('Zostaw na następne zakupy');
    expect(store.dispatched).toEqual([
      { kind: 'delete', entity: 'tasks', id: 's-maslo' },
      { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: null, due_time: null, responsible_member_id: null } },
      // PWD-11 A: zrobione zakupy do Kalendarza.
      { kind: 'create', entity: 'shopping_trips', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', planned_date: '2026-10-07', done_at: '2026-10-07T08:00:00.000Z' } },
    ]);
    expect(screen.queryByTestId('today-trip-lz')).toBeNull();
  });

  it('„Oznacz wszystko jako kupione”; pusta lista pyta tylko „Zrobione”; dotknięcie otwiera listę', async () => {
    const base = planned();
    const { store } = await open(base);
    await press(screen.getByLabelText('Oznacz jako zrobione: Zakupy na weekend'));
    await answerAlert('Oznacz wszystko jako kupione');
    expect(store.dispatched.map((o) => `${o.kind}:${(o as { id: string }).id}`)).toEqual(['patch:s-chleb', 'delete:s-maslo', 'delete:s-chleb', 'patch:lz', 'create:new-1']);

    const empty = planned();
    delete empty.tasks!['s-chleb'];
    const s2 = await open(empty);
    await press(screen.getAllByLabelText('Oznacz jako zrobione: Zakupy na weekend').at(-1)!);
    expect(lastAlert()).toMatchObject({ message: 'Zakupy na weekend' });
    await answerAlert('Zrobione');
    expect(s2.store.dispatched.map((o) => `${o.kind}:${(o as { id: string }).id}`)).toEqual(['delete:s-maslo', 'patch:lz', 'create:new-1']);
  });

  it('dotknięcie wpisu otwiera listę', async () => {
    await open(planned());
    await press(screen.getByLabelText(/^Zakupy\ na\ weekend(,|$)/));
    await screen.findByTestId('screen-list');
    expect(screen.getByTestId('trip')).toBeTruthy();
  });

  it('cudze zakupy bez dnia nie są u mnie', async () => {
    await open(planned({ due_date: null, due_time: null, responsible_member_id: 'ala' }));
    expect(screen.queryByTestId('today-trip-lz')).toBeNull();
  });
});

describe('zakupy na liście', () => {
  it('zaplanuj, zmień, zrobione, przekaż', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lz'));
    const trip = await screen.findByTestId('trip');
    expect(within(trip).getByText('Bez zaplanowanych zakupów. Zaplanuj dzień albo osobę, żeby lista pojawiła się w Moich sprawach.')).toBeTruthy();
    await press(screen.getByTestId('trip-plan'));
    await press(screen.getByTestId('trip-save'));
    expect(screen.getByTestId('trip-error').props.children).toMatch(/^We wspólnej grupie wybierz osobę albo dzień zakupów/);
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('trip-plan'));
    await press(screen.getByLabelText('Dziś'));
    await press(within(screen.getByLabelText('Kto robi zakupy')).getByLabelText('Łukasz'));
    await press(screen.getByTestId('trip-save'));
    expectOps(store, [{ kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-07', due_time: null, responsible_member_id: 'mf' } }]);
    expect(screen.getByText('dziś · dla Ciebie')).toBeTruthy();
    await press(screen.getByTestId('trip-change'));
    await press(within(screen.getByLabelText('Kto robi zakupy')).getByLabelText('Nikt konkretny'));
    await press(screen.getByTestId('trip-save'));
    expect(screen.getByText('dziś · nikt konkretny')).toBeTruthy();
    await press(screen.getByTestId('trip-change'));
    await press(within(screen.getByLabelText('Kto robi zakupy')).getByLabelText('Łukasz'));
    await press(screen.getByTestId('trip-save'));
    await press(screen.getByTestId('handoff-start'));
    await press(within(screen.getByTestId('handoff-picker')).getByLabelText('Anuluj'));
    await press(screen.getByTestId('handoff-start'));
    await press(screen.getByLabelText('Przekaż: Ala'));
    expectOps(store, [{ kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-07', due_time: null, responsible_member_id: null } }, { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-07', due_time: null, responsible_member_id: 'mf' } }, { kind: 'create', entity: 'handoffs', id: 'new-1', group_id: 'gf', set: { entity: 'lists', entity_id: 'lz', occurrence_date: null, to_member: 'ala' } }]);
    expect(screen.getByText('Czeka na przyjęcie: Ala')).toBeTruthy();
    await press(screen.getByTestId('handoff-cancel'));
    expectOps(store, [{ kind: 'patch', entity: 'handoffs', id: 'new-1', set: { status: 'cancelled' } }]);
    await press(screen.getByTestId('trip-done'));
    await answerAlert('Zostaw na następne zakupy');
    // Kupione (Masło) znika z listy, plan zakupów się zeruje, zostaje wiersz zrobionych zakupów (PWD-11 A); niekupione zostają.
    expectOps(store, [{ kind: 'delete', entity: 'tasks', id: 's-maslo' }, { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: null, due_time: null, responsible_member_id: null } }, { kind: 'create', entity: 'shopping_trips', id: 'new-2', group_id: 'gf', set: { list_id: 'lz', planned_date: '2026-10-07', done_at: '2026-10-07T08:00:00.000Z' } }]);
    expect(within(screen.getByTestId('trip')).getByText('Bez zaplanowanych zakupów. Zaplanuj dzień albo osobę, żeby lista pojawiła się w Moich sprawach.')).toBeTruthy();
  });

  it('przekazanie zakupów do mnie: „Do potwierdzenia” z tytułem „Zakupy: …”', async () => {
    const base = planned({ responsible_member_id: 'ala' });
    put(base, 'handoffs', 'h', { id: 'h', group_id: 'gf', entity: 'lists', entity_id: 'lz', occurrence_date: null, from_member: 'ala', to_member: 'mf', status: 'pending', closed: false, version: 1 });
    await open(base);
    expect(within(screen.getByTestId('handoff-inbox')).getByText('Ala przekazuje Ci: Zakupy na weekend')).toBeTruthy();
  });

  it('lista zadań nie ma zakupów', async () => {
    await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    expect(screen.queryByTestId('trip')).toBeNull();
  });
});

describe('ilości i Kalendarz (D77, O-053)', () => {
  it('lista zakupów: ilość obok nazwy; Kalendarz: zaplanowane zakupy z odhaczeniem i otwarciem listy', async () => {
    const base = planned({ due_date: '2026-10-07', due_time: null });
    put(base, 'tasks', 's-mleko', { ...base.tasks!['s-chleb']!, id: 's-mleko', title: 'mleko 2' });
    const { store } = await open(base);
    await press(screen.getByLabelText('Kalendarz'));
    const row = await screen.findByTestId('cal-trip-lz');
    expect(within(row).getByText('Zakupy na weekend')).toBeTruthy();
    expect(within(row).getByText(/2 do kupienia/)).toBeTruthy();
    expect(within(row).getByText(/dla Ciebie/)).toBeTruthy();
    await press(within(row).getByLabelText('Oznacz jako zrobione: Zakupy na weekend'));
    await answerAlert('Anuluj');
    expect(store.dispatched).toEqual([]);
    await press(within(row).getByLabelText(/^Zakupy\ na\ weekend(,|$)/));
    const item = await screen.findByTestId('task-s-mleko');
    expect(within(item).getByText('mleko')).toBeTruthy();
    expect(within(item).getByText(/2/)).toBeTruthy();
  });
});
