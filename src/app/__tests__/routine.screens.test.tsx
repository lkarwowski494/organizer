/** Rutyny z krokami (D113) i serie (D114). */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { nextId } from '../../domain/views/task-repeat';
import { RootStack } from '../navigation';
import { put, sampleBase, setup, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

describe('wejścia do rutyny i planu lekcji (audyt 2, PWD-26)', () => {
  it('„Więcej” → Rodzaj: Rutyna (nazwa i grupa przechodzą); z rutyny do zadania i do wydarzenia', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Poranek');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(radio('Grupa', 'Rodzina'));
    await press(radio('Rodzaj', 'Rutyna'));
    await screen.findByTestId('screen-routine');
    expect(screen.getByTestId('routine-title').props.value).toBe('Poranek');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
    expect(radio('Rodzaj', 'Rutyna').props.accessibilityState.selected).toBe(true);
    await press(radio('Rodzaj', 'Rutyna'));
    expect(screen.getByTestId('screen-routine')).toBeTruthy();
    await press(radio('Rodzaj', 'Wydarzenie'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByTestId('event-title').props.value).toBe('Poranek');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
    await press(radio('Rodzaj', 'Rutyna'));
    await screen.findByTestId('screen-routine');
    await press(radio('Rodzaj', 'Zadanie'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByTestId('form-title').props.value).toBe('Poranek');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
  });

  it('ekran grupy: „Dodaj rutynę” z tą grupą i plan lekcji każdego dziecka', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Rodzina, 3 osoby · administrator'));
    await press(await screen.findByTestId('group-timetable-kuba'));
    expect(await screen.findByText('Plan lekcji — Kuba')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('group-add-routine'));
    await screen.findByTestId('screen-routine');
    expect(radio('Grupa', 'Rodzina').props.accessibilityState.selected).toBe(true);
  });
});

describe('rutyny (D113)', () => {
  it('z Kalendarza: nazwa, dni, godzina, osoba, kroki; zapis jako wydarzenie + stałe zadania; cofnięcie', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    await screen.findByTestId('screen-routine');
    await press(screen.getByTestId('routine-save'));
    expect(screen.getByText('Wpisz nazwę rutyny.')).toBeTruthy();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek Kuby');
    await setTime('routine-start', '07:00');
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
    // Audyt 2 (E-3): definicje kroków, wydarzenie i nowa (pusta) lista; kopie kroków też, jeśli już powstały.
    expect(s.store.dispatched.slice(-4).map((o) => [o.kind, (o as { entity: string }).entity])).toEqual([['delete', 'event_task_series'], ['delete', 'event_task_series'], ['delete', 'events'], ['delete', 'lists']]);
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
    expect(within(screen.getByTestId(`today-${nextId(nextId('r1'))}`)).getByText(/2 razy z rzędu/)).toBeTruthy();
  });
});
