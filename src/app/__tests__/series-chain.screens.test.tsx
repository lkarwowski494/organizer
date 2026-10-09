/**
 * Audyt 3, PK-05: seria po „to i następne” (dwie części: śr. 17:00 do 20.10, od 21.10 o 18:00) to dla użytkownika jedna
 * seria — na ekranie grupy jeden wiersz (N-116), przesunięcie i „Usuń całą serię” usuwają obie części z jednym napisem
 * „Usunięto serię” i „Cofnij” (N-3, A3-V3-2, N-150), opis serii bez dnia podziału (N-21).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { splitId } from '../../domain/event-split';
import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const bar = () => screen.getByTestId('undo-bar');
const NEW = splitId('chor', '2026-10-21');

function chain() {
  const base = sampleBase();
  const row = { group_id: 'gf', title: 'Chór', note: null, audience: 'group', responsible_member_id: null, location: null, days: 1, duration_min: null, kind: 'event', version: 1 };
  put(base, 'events', 'chor', { ...row, id: 'chor', start_date: '2026-09-30', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20261020', split_from: null, deleted_at: null });
  put(base, 'events', NEW, { ...row, id: NEW, start_date: '2026-10-21', start_time: '18:00:00', end_time: '19:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', split_from: 'chor', deleted_at: null });
  return base;
}

async function open() {
  const s = setup({ base: chain() });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('seria po „to i następne” (PK-05)', () => {
  it('ekran grupy: jeden wiersz; przesunięcie usuwa całą serię (obie części) z „Usunięto serię” i „Cofnij”', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(screen.getAllByLabelText('Usuń: Chór')).toHaveLength(1);
    expect(screen.queryByTestId(`series-${NEW}`)).toBeNull();
    await press(screen.getByLabelText('Usuń: Chór'));
    expectOps(store, [{ kind: 'cmd', cmd: 'end_series', args: { event_id: 'chor', date: null, title: 'Chór' } }]);
    expect(within(bar()).getByText('Usunięto serię: Chór')).toBeTruthy();
    expect(screen.queryByLabelText('Usuń: Chór')).toBeNull();
    await press(within(bar()).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'cmd', cmd: 'restore_series', args: { event_id: 'chor', title: 'Chór', events: ['chor', NEW], parts: [], overrides: [], rsvps: [] } }]);
    expect(await screen.findByLabelText('Usuń: Chór')).toBeTruthy();
  });

  it('ekran wydarzenia na terminie starej części: opis bez dnia podziału; „Usuń całą serię” — obie części', async () => {
    const { store } = await open();
    await press(screen.getByTestId('today-event-chor-2026-10-07'));
    await screen.findByTestId('screen-event');
    expect(screen.queryByText(/do 20/)).toBeNull();
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-all'));
    expectOps(store, [{ kind: 'cmd', cmd: 'end_series', args: { event_id: 'chor', date: null, title: 'Chór' } }]);
    expect(within(bar()).getByText('Usunięto serię: Chór')).toBeTruthy();
  });

  it('„Odwołaj ten i następne” z terminu starej części: druga część też znika — „Odwołano”', async () => {
    const { store } = await open();
    await press(screen.getByTestId('today-event-chor-2026-10-07'));
    await screen.findByTestId('screen-event');
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-following'));
    expectOps(store, [{ kind: 'cmd', cmd: 'end_series', args: { event_id: 'chor', date: '2026-10-07', title: 'Chór' } }]);
    expect(within(bar()).getByText('Odwołano: Chór')).toBeTruthy();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(screen.getByTestId('series-chor')).toBeTruthy();
    expect(screen.queryByTestId(`series-${NEW}`)).toBeNull();
    expect(screen.queryByText(/najbliżej/)).toBeNull();
  });

  it('odrzucone polecenia końca serii i cofnięcia — z nazwą serii', async () => {
    const s = setup({ base: chain() });
    const rejected = [
      { op: { seq: 3, op_id: 'o3', kind: 'cmd' as const, cmd: 'end_series', args: { event_id: 'chor', date: null, title: 'Chór' } }, code: 'deleted' },
      { op: { seq: 4, op_id: 'o4', kind: 'cmd' as const, cmd: 'restore_series', args: { event_id: 'chor', title: 'Chór', events: [] } }, code: 'deleted' },
    ];
    await act(async () => {
      s.store.getSnapshot().state = { ...s.store.getSnapshot().state, rejected } as never;
    });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-account'));
    await press(await screen.findByTestId('open-rejected'));
    expect(await screen.findByText('Odwołanie serii: „Chór”')).toBeTruthy();
    expect(screen.getByText('Cofnięcie odwołania serii: „Chór”')).toBeTruthy();
  });
});
