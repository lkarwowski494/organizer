/** Lekcje dziecka jednym wierszem w Moich sprawach (D127): rozwinięcie do pojedynczych lekcji i powrót. */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

describe('lekcje dziecka (D127)', () => {
  it('jeden wiersz „Kuba: 2 lekcje”, dotknięcie rozwija i zwija; lekcja otwiera wydarzenie', async () => {
    const base = sampleBase();
    const lesson = (id: string, title: string, start: string, end: string) => {
      put(base, 'events', id, { id, group_id: 'gf', title, start_date: '2026-10-07', start_time: start, end_time: end, rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
      put(base, 'event_participants', `p-${id}`, { id: `p-${id}`, event_id: id, group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    };
    lesson('mat', 'Matematyka', '08:00:00', '08:45:00');
    lesson('pol', 'Polski', '12:00:00', '12:45:00');
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    // Audyt 2 (M-141): stan rozwinięcia i czynność w podpowiedzi VoiceOvera, znak ˅/˄ zamiast „›” i instrukcji w treści.
    const row = screen.getByLabelText('Kuba: 2 lekcje, 08:00–12:45, Rodzina');
    expect(row.props.accessibilityState).toEqual({ expanded: false });
    expect(row.props.accessibilityHint).toBe('Pokazuje lekcje');
    expect(within(row).getByText('˅')).toBeTruthy();
    expect(screen.queryByText(/dotknij/)).toBeNull();
    expect(screen.queryByText('Matematyka')).toBeNull();
    await press(row);
    expect(screen.getByText('Matematyka')).toBeTruthy();
    expect(screen.getByText('Polski')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Pokazano 2 lekcje', { queue: true });
    const open = screen.getByLabelText('Kuba: 2 lekcje, 08:00–12:45, Rodzina');
    expect(open.props.accessibilityState).toEqual({ expanded: true });
    expect(open.props.accessibilityHint).toBe('Chowa lekcje');
    await press(open);
    expect(screen.queryByText('Matematyka')).toBeNull();
    await press(screen.getByLabelText(/^Kuba: 2 lekcje/));
    await press(screen.getByText('Polski'));
    expect(await screen.findByTestId('screen-event')).toBeTruthy();
  });
});
