/** Przekazanie odpowiedzialności z potwierdzeniem (D70): zadanie, wydarzenie (termin / seria), „Do potwierdzenia”, plakietka. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';
import { strings } from '../../i18n/strings.pl';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const handoff = (id: string, extra: Record<string, unknown>) => ({
  id, group_id: 'gf', entity: 'tasks', entity_id: 't-ala', occurrence_date: null, from_member: 'ala', to_member: 'mf', status: 'pending', closed: false, decided_at: null, version: 1, created_at: '2026-10-07T07:00:00Z', deleted_at: null, ...extra,
});
const tance = (extra: Record<string, unknown> = {}) => ({ id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', responsible_member_id: 'mf', deleted_at: null, version: 1, ...extra });

describe('przekazanie zadania', () => {
  it('moje zadanie: wybór dorosłego z kontem, „czeka na przyjęcie”, anulowanie', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Otwórz: Odebrać paczkę'));
    await screen.findByTestId('screen-task');
    await press(screen.getByTestId('handoff-start'));
    const picker = screen.getByTestId('handoff-picker');
    // Kuba (dziecko bez konta) i ja nie jesteśmy na liście.
    expect(within(picker).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Przekaż: Ala', 'Anuluj']);
    await press(within(picker).getByLabelText('Anuluj'));
    expect(screen.queryByTestId('handoff-picker')).toBeNull();
    await press(screen.getByTestId('handoff-start'));
    await press(screen.getByLabelText('Przekaż: Ala'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'create', entity: 'handoffs', id: 'new-1', group_id: 'gf', set: { entity: 'tasks', entity_id: 't-paczka', occurrence_date: null, to_member: 'ala' } });
    expect(screen.getByText('Czeka na przyjęcie: Ala')).toBeTruthy();
    expect(screen.queryByTestId('handoff-start')).toBeNull();
    await press(screen.getByTestId('handoff-cancel'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'new-1', set: { status: 'cancelled' } });
    expect(screen.getByTestId('handoff-start')).toBeTruthy();
  });

  it('zadanie nie na mnie albo w grupie bez innych dorosłych', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-solo', { ...base.tasks!['t-books']!, id: 't-solo', title: 'Moje osobiste', assignee_member_id: 'u-me' });
    await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText('Otwórz: Zadanie Ali'));
    await screen.findByTestId('screen-task');
    expect(screen.queryByTestId('handoff-start')).toBeNull();
  });

  it('grupa osobista: nie ma komu przekazać', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-books', { ...base.tasks!['t-books']!, assignee_member_id: 'u-me' });
    await open(base);
    await press(screen.getByLabelText('Otwórz: Oddać książki do biblioteki'));
    await press(await screen.findByTestId('handoff-start'));
    expect(within(screen.getByTestId('handoff-picker')).getByText('W tej grupie nie ma innego dorosłego z kontem.')).toBeTruthy();
  });
});

describe('przekazanie wydarzenia', () => {
  it('seria, za którą odpowiadam: ten termin albo cała seria', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', tance());
    const { store } = await open(base);
    await press(await screen.findByTestId('today-event-ev-2026-10-07'));
    await screen.findByTestId('screen-event');
    await press(screen.getByTestId('handoff-start'));
    await press(screen.getByLabelText('Przekaż: Ala'));
    expect(store.dispatched.at(-1)).toMatchObject({ entity: 'handoffs', set: { entity: 'events', entity_id: 'ev', occurrence_date: '2026-10-07', to_member: 'ala' } });
    expect(screen.getByText('Czeka na przyjęcie: Ala')).toBeTruthy();
    await press(screen.getByTestId('handoff-cancel'));
    await press(screen.getByTestId('handoff-start'));
    await press(screen.getByLabelText('Całą serię'));
    await press(screen.getByLabelText('Przekaż: Ala'));
    expect(store.dispatched.at(-1)).toMatchObject({ entity: 'handoffs', set: { entity: 'events', entity_id: 'ev', occurrence_date: null } });
    expect(screen.getByText('Czeka na przyjęcie: Ala')).toBeTruthy();
  });

  it('jednorazowe: bez wyboru zakresu; cudze: bez przycisku', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', tance({ rrule: null }));
    put(base, 'events', 'ev2', tance({ id: 'ev2', title: 'Basen', start_time: '19:00:00', end_time: null, rrule: null, responsible_member_id: 'ala' }));
    const { store } = await open(base);
    await press(await screen.findByTestId('today-event-ev-2026-10-07'));
    await press(await screen.findByTestId('handoff-start'));
    expect(screen.queryByLabelText('Całą serię')).toBeNull();
    await press(screen.getByLabelText('Przekaż: Ala'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { entity_id: 'ev', occurrence_date: null } });
    await press(screen.getByLabelText(strings['common.back']));
    // Cudze wydarzenie nie jest na „Dotyczy mnie” (D66) — otwieram z kalendarza.
    await press(await screen.findByTestId('tab-Calendar'));
    await press(await screen.findByTestId('cal-event-ev2-2026-10-07'));
    await screen.findByTestId('screen-event');
    expect(screen.queryByTestId('handoff-start')).toBeNull();
  });
});

describe('„Do potwierdzenia” i plakietka', () => {
  it('przyjęcie i odrzucenie przekazań do mnie; plakietka liczy oczekujące', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', tance({ responsible_member_id: 'ala' }));
    put(base, 'handoffs', 'h1', handoff('h1', {}));
    put(base, 'handoffs', 'h2', handoff('h2', { entity: 'events', entity_id: 'ev', occurrence_date: '2026-10-14' }));
    const { store } = await open(base);
    const inbox = screen.getByTestId('handoff-inbox');
    expect(within(inbox).getByText('Ala przekazuje Ci: Zadanie Ali')).toBeTruthy();
    expect(within(inbox).getByText(/^Ala przekazuje Ci: Tańce \(/)).toBeTruthy();
    expect(screen.getByTestId('tab-Today').props.accessibilityLabel).toBe('Dziś, 2 do potwierdzenia');
    expect(within(screen.getByTestId('tab-badge')).getByText('2')).toBeTruthy();
    await press(screen.getByTestId('handoff-accept-h1'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'h1', set: { status: 'accepted' } });
    expect(screen.queryByTestId('handoff-h1')).toBeNull();
    expect(screen.getByTestId('tab-Today').props.accessibilityLabel).toBe('Dziś, 1 do potwierdzenia');
    await press(screen.getByTestId('handoff-decline-h2'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'h2', set: { status: 'declined' } });
    expect(screen.queryByTestId('handoff-inbox')).toBeNull();
    expect(screen.queryByTestId('tab-badge')).toBeNull();
    expect(screen.getByTestId('tab-Today').props.accessibilityLabel).toBe('Dziś');
  });

  it('nadawca widzi odrzucenie z informacją, „OK” ją zamyka', async () => {
    const base = sampleBase();
    put(base, 'handoffs', 'h3', handoff('h3', { entity_id: 't-paczka', from_member: 'mf', to_member: 'ala', status: 'declined' }));
    put(base, 'handoffs', 'h4', handoff('h4', { from_member: 'ala', to_member: 'mf', status: 'accepted' }));
    const { store } = await open(base);
    expect(screen.getByText('Nie przyjęto przekazania: Odebrać paczkę (Ala). Odpowiedzialność została u Ciebie.')).toBeTruthy();
    expect(screen.queryByTestId('tab-badge')).toBeNull();
    await press(screen.getByTestId('handoff-ok-h3'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'handoffs', id: 'h3', set: { closed: true } });
    expect(screen.queryByTestId('handoff-inbox')).toBeNull();
  });
});
