/** „Przenieś zaległe na dziś” (D111): zaległe z własnym terminem dostają dzisiejszy, z cofnięciem. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup, expectOps } from './harness';

describe('zaległe na dziś (D111)', () => {
  it('przycisk z liczbą, przeniesienie z godziną, cofnięcie; bez zaległych — brak przycisku', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'old', { ...base.tasks!['t-books']!, id: 'old', title: 'Zapłacić rachunek', deadline_mode: 'own', due_date: '2026-10-04', due_time: '09:00:00' });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getByText(/zaległe od 3 dni/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('move-overdue'));
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 'old', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: '09:00:00' } }]);
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Przeniesiono na dziś: 1 zadanie')).toBeTruthy();
    await fireEvent.press(within(bar).getByLabelText('Cofnij'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 'old', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: '09:00:00' } }, { kind: 'patch', entity: 'tasks', id: 'old', set: { deadline_mode: 'own', due_date: '2026-10-04', due_time: '09:00:00' } }]);
  });

  it('audyt 2 (T-11, P-56): „co miesiąc” liczy się raz; zaległe zakupy też się przenoszą; cofnięcie wszystkiego', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'czynsz', { ...base.tasks!['t-books']!, id: 'czynsz', title: 'Czynsz', deadline_mode: 'own', due_date: '2026-10-05', repeat: 'FREQ=MONTHLY' });
    put(base, 'lists', 'lz', { ...base.lists!.lz!, due_date: '2026-10-06', due_time: '18:00:00', responsible_member_id: 'mf' });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getByLabelText('Przenieś zaległe na dziś (2)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('move-overdue'));
    expect(s.store.dispatched).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: null } },
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=5' } },
      { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-07', due_time: '18:00:00', responsible_member_id: 'mf' } },
    ]);
    expect(screen.queryByText(/zaległe od/)).toBeNull();
    expect(screen.queryByTestId('move-overdue')).toBeNull();
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Przeniesiono na dziś: 2 zadania')).toBeTruthy();
    await fireEvent.press(within(bar).getByLabelText('Cofnij'));
    expect(s.store.dispatched.slice(3)).toEqual([
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { deadline_mode: 'own', due_date: '2026-10-05', due_time: null } },
      { kind: 'patch', entity: 'tasks', id: 'czynsz', set: { repeat: 'FREQ=MONTHLY' } },
      { kind: 'patch', entity: 'lists', id: 'lz', set: { due_date: '2026-10-06', due_time: '18:00:00', responsible_member_id: 'mf' } },
    ]);
  });

  it('decyzja właściciela z 8.10.2026: przenosi tylko moje — wspólne nieprzypisane i zadania dziecka zostają zaległe', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'moje', { ...base.tasks!['t-paczka']!, id: 'moje', title: 'Zapłacić za prąd', due_date: '2026-10-05', due_time: null });
    put(base, 'tasks', 'wspolne', { ...base.tasks!['t-kwiaty']!, id: 'wspolne', title: 'Wynieść karton', due_date: '2026-10-05' });
    put(base, 'tasks', 'tymka', { ...base.tasks!['t-kwiaty']!, id: 'tymka', title: 'Spakować plecak', due_date: '2026-10-05', assignee_member_id: 'tymek' });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getAllByText(/zaległe od 2 dni/)).toHaveLength(3);
    await fireEvent.press(screen.getByLabelText('Przenieś zaległe na dziś (1)'));
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 'moje', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: null } }]);
    expect(screen.getAllByText(/zaległe od 2 dni/)).toHaveLength(2);
    await fireEvent.press(within(screen.getByTestId('undo-bar')).getByLabelText('Cofnij'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 'moje', set: { deadline_mode: 'own', due_date: '2026-10-07', due_time: null } }, { kind: 'patch', entity: 'tasks', id: 'moje', set: { deadline_mode: 'own', due_date: '2026-10-05', due_time: null } }]);
  });

  it('audyt 2 (T-11): zaległe z grupy, w której jestem dzieckiem, zostają (serwer by odrzucił) — bez przycisku', async () => {
    const base = sampleBase();
    put(base, 'group_members', 'mk', { ...base.group_members!.mk!, role: 'child' });
    put(base, 'tasks', 't-korki', { ...base.tasks!['t-korki']!, due_date: '2026-10-05', assignee_member_id: 'mk' });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getByText(/zaległe od 2 dni/)).toBeTruthy();
    expect(screen.queryByTestId('move-overdue')).toBeNull();
  });

  it('bez zaległych nie ma przycisku', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.queryByTestId('move-overdue')).toBeNull();
  });
});
