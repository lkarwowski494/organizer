/** „Przenieś zaległe na dziś” (D111): zaległe z własnym terminem dostają dzisiejszy, z cofnięciem. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

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
    expect(s.store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'old', set: { deadline_mode: 'own', due_date: '2026-10-04', due_time: '09:00:00' } });
  });

  it('bez zaległych nie ma przycisku', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.queryByTestId('move-overdue')).toBeNull();
  });
});
