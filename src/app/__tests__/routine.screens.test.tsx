/** Rutyny z krokami (D113) i serie (D114). */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { nextId } from '../../domain/views/task-repeat';
import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

describe('rutyny (D113)', () => {
  it('z Kalendarza: nazwa, dni, godzina, osoba, kroki; zapis jako wydarzenie + stałe zadania; cofnięcie', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    await screen.findByTestId('screen-routine');
    await press(screen.getByTestId('routine-save'));
    expect(screen.getByText('Wpisz nazwę wydarzenia.')).toBeTruthy();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek Kuby');
    await fireEvent.changeText(screen.getByTestId('routine-start'), '07:00');
    await press(screen.getByTestId('routine-save'));
    expect(screen.getByText('Dodaj co najmniej jeden krok.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Zęby');
    await press(screen.getByTestId('routine-add-step'));
    await fireEvent.changeText(screen.getByTestId('routine-step-1'), 'Plecak');
    await press(screen.getByTestId('routine-add-step'));
    await press(screen.getAllByText('Usuń')[2]!);
    await press(screen.getByLabelText('Uczestnik: Kuba'));
    await press(screen.getByLabelText('W sobotę'));
    await press(screen.getByTestId('routine-save'));
    const ev = s.store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events');
    expect(ev).toMatchObject({ group_id: 'gf', set: { title: 'Poranek Kuby', start_time: '07:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA', audience: 'members' } });
    expect(s.store.dispatched.filter((o) => o.kind === 'create' && o.entity === 'event_task_series').map((o) => (o as unknown as { set: { title: string } }).set.title)).toEqual(['Zęby', 'Plecak']);
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Dodano rutynę: Poranek Kuby')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(s.store.dispatched.slice(-3).map((o) => [o.kind, (o as { entity: string }).entity])).toEqual([['delete', 'events'], ['delete', 'event_task_series'], ['delete', 'event_task_series']]);
  });

  it('seria zadania powtarzanego w „Moich sprawach” (D114)', async () => {
    const base = sampleBase();
    const t = { ...base.tasks!['t-books']!, deadline_mode: 'own', due_time: null, repeat: 'FREQ=DAILY' };
    put(base, 'tasks', 'r1', { ...t, id: 'r1', title: 'Bieganie', due_date: '2026-10-05', completed_at: '2026-10-05T08:00:00Z' });
    put(base, 'tasks', nextId('r1'), { ...t, id: nextId('r1'), title: 'Bieganie', due_date: '2026-10-06', completed_at: '2026-10-06T08:00:00Z' });
    put(base, 'tasks', nextId(nextId('r1')), { ...t, id: nextId(nextId('r1')), title: 'Bieganie', due_date: '2026-10-07', completed_at: null });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(within(screen.getByTestId(`today-${nextId(nextId('r1'))}`)).getByText(/seria: 2 z rzędu/)).toBeTruthy();
  });
});
