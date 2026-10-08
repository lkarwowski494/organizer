/** Plan lekcji z tygodniami A/B (D112): z ekranu osoby, lekcje jako wydarzenia cykliczne z dzieckiem jako uczestnikiem. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

async function openTimetable(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await press(screen.getByLabelText('Grupy'));
  await press(await screen.findByLabelText('Rodzina, 3 osoby · admin'));
  await press(await screen.findByLabelText('Kuba, dziecko'));
  await press(await screen.findByTestId('open-timetable'));
  await screen.findByTestId('screen-timetable');
  return s;
}

describe('plan lekcji (D112)', () => {
  it('ten tydzień to B: lekcja z tygodnia B od tego tygodnia', async () => {
    const { store } = await openTimetable();
    await press(radio('Ten tydzień (5–11 października) to', 'Tydzień B'));
    await press(screen.getByTestId('lesson-add-4'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Basen');
    await setTime('lesson-end-0', '09:00');
    await press(within(screen.getByLabelText('Kiedy')).getByLabelText('Tydzień B'));
    await press(screen.getByTestId('timetable-save'));
    expect(store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')).toMatchObject({ set: { title: 'Basen', start_date: '2026-10-09' } });
  });

  it('lekcje co tydzień i w tygodniu B; zapis jako serie z Kubą; cofnięcie usuwa serie', async () => {
    const { store } = await openTimetable();
    expect(screen.getByText('Plan lekcji – Kuba')).toBeTruthy();
    await press(screen.getByTestId('timetable-save'));
    expect(screen.getByText('Dodaj co najmniej jedną lekcję.')).toBeTruthy();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await press(screen.getByTestId('lesson-add-0'));
    expect(screen.getByTestId('lesson-start-1').props.accessibilityValue.text).toBe('08:45');
    await fireEvent.changeText(screen.getByTestId('lesson-title-1'), 'Plastyka');
    await setTime('lesson-end-1', '08:00');
    await press(screen.getByTestId('timetable-save'));
    expect(screen.getByText(/Koniec musi być/)).toBeTruthy();
    await setTime('lesson-end-1', '09:30');
    await press(within(screen.getAllByLabelText('Kiedy')[1]!).getByLabelText('Tydzień B'));
    await press(screen.getByTestId('lesson-add-2'));
    await press(screen.getAllByText('Usuń lekcję')[2]!);
    await press(screen.getByTestId('timetable-save'));
    const events = store.dispatched.filter((o) => o.kind === 'create' && o.entity === 'events');
    expect(events.map((o) => (o as unknown as { set: { title: string; rrule: string; start_date: string } }).set)).toEqual([
      expect.objectContaining({ title: 'Matematyka', rrule: 'FREQ=WEEKLY;BYDAY=MO', start_date: '2026-10-05' }),
      // Ten tydzień to A, więc lekcja z tygodnia B zaczyna się w przyszły poniedziałek.
      expect.objectContaining({ title: 'Plastyka', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', start_date: '2026-10-12' }),
    ]);
    expect(store.dispatched.filter((o) => o.kind === 'create' && o.entity === 'event_participants').every((o) => (o as unknown as { set: { member_id: string } }).set.member_id === 'kuba')).toBe(true);
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Dodano plan: 2 serie wydarzeń')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(store.dispatched.slice(-2).map((o) => o.kind)).toEqual(['delete', 'delete']);
  });

  it('D128: ekran z obecnym planem; zapis kończy stary od dziś i dodaje nowy; cofnięcie przywraca', async () => {
    const base = sampleBase();
    put(base, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-mat', { id: 'p-mat', event_id: 'mat', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    const { store } = await openTimetable(base);
    expect(screen.getByTestId('lesson-title-0').props.value).toBe('Matematyka');
    expect(screen.getByTestId('lesson-end-0').props.accessibilityValue.text).toBe('08:45');
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka rozszerzona');
    await press(screen.getByTestId('timetable-save'));
    expect(store.dispatched[0]).toEqual({ kind: 'patch', entity: 'events', id: 'mat', set: { rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261006' } });
    expect(store.dispatched.find((o) => o.kind === 'create' && o.entity === 'events')).toMatchObject({ set: { title: 'Matematyka rozszerzona', start_date: '2026-10-12', kind: 'lesson' } });
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Zapisano zmiany w planie lekcji (od dziś)')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(store.dispatched.slice(-2)).toEqual([expect.objectContaining({ kind: 'delete', entity: 'events' }), { kind: 'patch', entity: 'events', id: 'mat', set: { rrule: 'FREQ=WEEKLY;BYDAY=MO' } }]);
  });

  it('D128: przycisk planu tylko przy dziecku', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Rodzina, 3 osoby · admin'));
    await press(await screen.findByLabelText(/^Ala, /));
    await screen.findByTestId('screen-member');
    expect(screen.queryByTestId('open-timetable')).toBeNull();
  });
});
