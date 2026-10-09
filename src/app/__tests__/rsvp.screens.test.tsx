/** Potwierdzanie obecności (D124): odpowiedź za siebie i za dziecko bez konta, podsumowanie, licznik w wierszu. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { rsvpId } from '../../domain/views/rsvp';
import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const ev = { note: null, start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 };

function base() {
  const b = sampleBase();
  put(b, 'events', 'ev1', { ...ev, id: 'ev1', group_id: 'gf', title: 'Basen', start_date: '2026-10-07' });
  put(b, 'events', 'evOld', { ...ev, id: 'evOld', group_id: 'gf', title: 'Stare', start_date: '2026-10-06' });
  put(b, 'events', 'evMe', { ...ev, id: 'evMe', group_id: 'u-me', title: 'Fryzjer', start_date: '2026-10-07' });
  return b;
}

describe('obecność (D124)', () => {
  it('odpowiadam za siebie i za Kubę; podsumowanie; licznik w „Moich sprawach”', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText(/^Basen, 17:00/));
    const box = await screen.findByTestId('rsvp');
    expect(within(box).getByText('Bez odpowiedzi: 3')).toBeTruthy();
    expect(within(box).queryByLabelText('Ala')).toBeNull(); // za dorosłego nie
    await press(within(within(box).getByLabelText('Twoja odpowiedź')).getByLabelText('Będę'));
    // Audyt 2 (E-25): nowy wiersz — utworzenie, przywrócenie (gdyby serwer miał go w koszu) i zmiana.
    expect(s.store.dispatched.map((o) => o.kind)).toEqual(['create', 'restore', 'patch']);
    expectOps(s.store, [{ kind: 'create', entity: 'event_rsvps', id: '8254b737-1fee-5bf5-86a2-c7cf56b320d9', group_id: 'gf', set: { event_id: 'ev1', occurrence_date: '2026-10-07', member_id: 'mf', answer: 'yes' } }, { kind: 'restore', entity: 'event_rsvps', id: '8254b737-1fee-5bf5-86a2-c7cf56b320d9' }, { kind: 'patch', entity: 'event_rsvps', id: '8254b737-1fee-5bf5-86a2-c7cf56b320d9', set: { answer: 'yes' } }]);
    await press(within(within(box).getByLabelText('Kuba')).getByLabelText('Nie będzie'));
    expect(within(box).getByText('Tak: Ty')).toBeTruthy();
    expect(within(box).getByText('Nie: Kuba')).toBeTruthy();
    expect(within(box).getByText('Bez odpowiedzi: 1')).toBeTruthy();
    await press(within(within(box).getByLabelText('Twoja odpowiedź')).getByLabelText('Może'));
    const kuba = rsvpId('ev1', '2026-10-07', 'kuba');
    expectOps(s.store, [
      { kind: 'create', entity: 'event_rsvps', id: kuba, group_id: 'gf', set: { event_id: 'ev1', occurrence_date: '2026-10-07', member_id: 'kuba', answer: 'no' } },
      { kind: 'restore', entity: 'event_rsvps', id: kuba },
      { kind: 'patch', entity: 'event_rsvps', id: kuba, set: { answer: 'no' } },
      { kind: 'patch', entity: 'event_rsvps', id: rsvpId('ev1', '2026-10-07', 'mf'), set: { answer: 'maybe' } },
    ]);
    expect(within(box).getByText('Może: Ty')).toBeTruthy();
    expect(within(within(box).getByLabelText('Twoja odpowiedź')).getByLabelText('Może').props.accessibilityState).toMatchObject({ selected: true });
    await press(screen.getByLabelText('Wróć'));
    expect(within(await screen.findByTestId('today-event-ev1-2026-10-07')).getByText(/1 może, 1 nie/)).toBeTruthy();
    await press(screen.getByLabelText('Kalendarz'));
    expect(within(await screen.findByTestId('cal-event-ev1-2026-10-07')).getByText(/1 może, 1 nie/)).toBeTruthy();
  });

  it('bez obecności: miniony termin i grupa osobista', async () => {
    const s = setup({ base: base() });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText(/^Fryzjer/));
    await screen.findByTestId('screen-event');
    expect(screen.queryByTestId('rsvp')).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Poprzedni dzień'));
    await press(await screen.findByLabelText(/^Stare/));
    await screen.findByTestId('screen-event');
    expect(screen.queryByTestId('rsvp')).toBeNull();
  });
});
