/** Podzadania pod rodzicem (D104): zadania wystąpienia pod wydarzeniem, podzadania pod zadaniem, dopisek bez rodzica. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

function base() {
  const b = sampleBase();
  put(b, 'events', 'ev1', { id: 'ev1', group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
  const t = { group_id: 'gf', list_id: 'lf', note: null, sort_key: 'a0', start_date: null, completed_at: null, deleted_at: null, version: 1, due_date: null, due_time: null, rollover: true, series_id: null };
  put(b, 'tasks', 'k1', { ...t, id: 'k1', parent_id: null, title: 'Spakować strój', assignee_member_id: 'mf', deadline_mode: 'event', event_id: 'ev1', occurrence_date: '2026-10-07' });
  put(b, 'tasks', 'k2', { ...t, id: 'k2', parent_id: null, title: 'Karta', assignee_member_id: 'ala', deadline_mode: 'event', event_id: 'ev1', occurrence_date: '2026-10-07', completed_at: '2026-10-07T07:00:00Z' });
  put(b, 'tasks', 'c1', { ...t, id: 'c1', parent_id: 't-paczka', title: 'Wziąć awizo', assignee_member_id: 'mf', deadline_mode: 'inherit', event_id: null, occurrence_date: null });
  // Rodzic cudzy (Ali) — podzadanie samo, z dopiskiem.
  put(b, 'tasks', 'c2', { ...t, id: 'c2', parent_id: 't-ala', title: 'Kupić bilet', assignee_member_id: 'mf', deadline_mode: 'inherit', event_id: null, occurrence_date: null });
  return b;
}

const order = () => screen.getAllByTestId(/^today-(event-ev1|k1|c1|c2|t-paczka)/).map((e) => e.props.testID);

describe('podzadania w „Moich sprawach” (D104)', () => {
  it('zadania wystąpienia pod wydarzeniem z licznikiem; podzadanie pod zadaniem; cudzy rodzic — dopisek', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    // c2 dziedziczy termin bez godziny po cudzym rodzicu — jak każde zadanie całodniowe na początku dnia.
    expect(order()).toEqual(['today-c2', 'today-event-ev1-2026-10-07', 'today-k1', 'today-t-paczka', 'today-c1']);
    expect(screen.getByLabelText(/^Basen, 17:00–18:00/)).toBeTruthy();
    expect(within(screen.getByTestId('today-event-ev1-2026-10-07')).getByText(/1\/2 zrobione/)).toBeTruthy();
    expect(screen.getByTestId('today-k1').props.style).toMatchObject({ marginLeft: 22 });
    expect(screen.getByTestId('today-c1').props.style).toMatchObject({ marginLeft: 22 });
    expect(within(screen.getByTestId('today-t-paczka')).getByText(/0\/1 zrobione/)).toBeTruthy();
    expect(screen.getByTestId('today-c2').props.style).toMatchObject({ marginLeft: 0 });
    expect(within(screen.getByTestId('today-c2')).getByText(/↳ Zadanie Ali/)).toBeTruthy();
  });

  it('Kalendarz: ten sam układ dnia', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    expect(await screen.findByTestId('cal-k1')).toBeTruthy();
    expect(screen.getByTestId('cal-k1').props.style).toMatchObject({ marginLeft: 22 });
    expect(within(screen.getByTestId('cal-event-ev1-2026-10-07')).getByText(/1\/2 zrobione/)).toBeTruthy();
  });
});
