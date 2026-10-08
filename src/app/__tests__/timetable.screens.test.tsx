/** Plan lekcji z tygodniami A/B (D112): z ekranu osoby, lekcje jako wydarzenia cykliczne z dzieckiem jako uczestnikiem. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { setup, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

async function openTimetable() {
  const s = setup();
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
});
