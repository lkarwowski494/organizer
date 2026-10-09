/**
 * D199 (audyt 2, M-99 / PW-53): wydarzenia przez kilka dni (obóz) i przez północ (nocny dyżur) na ekranach —
 * formularz („Kończy się”, „Kończy się następnego dnia.”, błędy, szkic), Moje sprawy, Kalendarz i ekran wydarzenia.
 * Dziś w testach: środa 7.10.2026, 10:00.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import type { NewOp, Row } from '../../domain/sync-engine/client';
import { RootStack } from '../navigation';
import { pickDate, put, sampleBase, setTime, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const created = (ops: NewOp[]) => ops.filter((o) => o.kind === 'create' && o.entity === 'events') as Extract<NewOp, { kind: 'create' }>[];

function event(base: ReturnType<typeof sampleBase>, id: string, extra: Row) {
  put(base, 'events', id, { id, group_id: 'gf', title: id, note: null, start_date: '2026-10-07', start_time: null, end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1, ...extra });
}
async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
async function newEvent(title: string) {
  await press(screen.getByLabelText('Kalendarz'));
  await press(await screen.findByTestId('calendar-add-event'));
  await screen.findByTestId('screen-event-edit');
  await press(screen.getByLabelText('Rodzina'));
  await fireEvent.changeText(screen.getByTestId('event-title'), title);
}

describe('D199: formularz wydarzenia', () => {
  it('obóz: „Cały dzień” i „Kończy się” — jedno wydarzenie przez 5 dni; przesunięcie startu przesuwa koniec', async () => {
    const { store } = await open();
    await newEvent('Obóz');
    expect(screen.queryByTestId('event-end-date')).toBeNull();
    await press(screen.getByLabelText('Cały dzień'));
    // Domyślnie ten sam dzień.
    expect(screen.getByTestId('event-end-date').props.accessibilityLabel).toBe('Kończy się: Środa, 7 października');
    await pickDate('event-end-date', '2026-10-11');
    await pickDate('event-date', '2026-10-12');
    expect(screen.getByTestId('event-end-date').props.accessibilityValue).toEqual({ text: '2026-10-16' });
    await press(screen.getByTestId('event-save'));
    expect(created(store.dispatched).map((o) => o.set)).toEqual([expect.objectContaining({ title: 'Obóz', start_date: '2026-10-12', start_time: null, end_time: null, days: 5 })]);
  });

  it('błędy: koniec przed początkiem, ponad limit, nachodzące powtórzenia; seria — „Każde powtórzenie trwa tyle samo dni.”', async () => {
    const { store } = await open();
    await newEvent('Obóz');
    await press(screen.getByLabelText('Cały dzień'));
    await pickDate('event-end-date', '2026-10-05');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByRole('alert').props.children).toBe('Ostatni dzień wydarzenia nie może być przed pierwszym.');
    await pickDate('event-end-date', '2026-11-30');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByRole('alert').props.children).toBe('Wydarzenie może trwać najwyżej 31 dni.');
    await pickDate('event-end-date', '2026-10-08');
    await press(screen.getByLabelText('Codziennie'));
    expect(screen.getByText('Każde powtórzenie trwa tyle samo dni.')).toBeTruthy();
    await press(screen.getByTestId('event-save'));
    expect(screen.getByRole('alert').props.children).toBe('Wydarzenie trwa dłużej niż odstęp między powtórzeniami. Skróć je albo zmień powtarzanie.');
    expect(store.dispatched).toEqual([]);
  });

  it('nocny dyżur: koniec przed początkiem = następnego dnia, z widoczną informacją; szkic pamięta ostatni dzień', async () => {
    const { store } = await open();
    await newEvent('Dyżur');
    await setTime('event-start-0', '22:00');
    await setTime('event-end-0', '23:00');
    expect(screen.queryByText('Kończy się następnego dnia.')).toBeNull();
    await setTime('event-end-0', '06:00');
    expect(screen.getByText('Kończy się następnego dnia.')).toBeTruthy();
    // Koniec o północy nie wchodzi na następny dzień.
    await setTime('event-end-0', '00:00');
    expect(screen.queryByText('Kończy się następnego dnia.')).toBeNull();
    await setTime('event-end-0', '06:00');
    await press(screen.getByTestId('event-save'));
    expect(created(store.dispatched).map((o) => o.set)).toEqual([expect.objectContaining({ title: 'Dyżur', start_time: '22:00', end_time: '06:00' })]);
    expect(created(store.dispatched)[0]!.set).not.toHaveProperty('days');
    // Szkic (D179) obejmuje „Kończy się”.
    await newEvent('Obóz');
    await press(screen.getByLabelText('Cały dzień'));
    await pickDate('event-end-date', '2026-10-09');
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('calendar-add-event'));
    expect((await screen.findByTestId('event-end-date')).props.accessibilityValue).toEqual({ text: '2026-10-09' });
  });

  it('zmiana zapisanego obozu: formularz z ostatnim dniem, krótszy zapis', async () => {
    const base = sampleBase();
    event(base, 'oboz', { title: 'Obóz', days: 5 });
    const { store } = await open(base);
    await press(screen.getByTestId('today-event-oboz-2026-10-07'));
    await press(await screen.findByLabelText('Zmień'));
    expect((await screen.findByTestId('event-end-date')).props.accessibilityValue).toEqual({ text: '2026-10-11' });
    await pickDate('event-end-date', '2026-10-08');
    await press(screen.getByTestId('event-save'));
    expect(store.dispatched).toEqual([{ kind: 'patch', entity: 'events', id: 'oboz', set: expect.objectContaining({ days: 2 }) }]);
  });
});

describe('D199: wiersze i ekran wydarzenia', () => {
  function camp() {
    const base = sampleBase();
    event(base, 'oboz', { title: 'Obóz', start_date: '2026-10-05', days: 5 });
    event(base, 'dyzur', { title: 'Dyżur', start_time: '22:00:00', end_time: '06:00:00' });
    return base;
  }

  it('Moje sprawy: każdy dzień obozu z numerem; nocny dyżur dziś z godzinami, jutro „do 06:00”', async () => {
    await open(camp());
    expect(screen.getByTestId('today-event-oboz-2026-10-05').props.accessibilityLabel).toBe('Obóz, cały dzień, dzień 3 z 5, Rodzina');
    expect(screen.getByTestId('today-event-dyzur-2026-10-07').props.accessibilityLabel).toBe('Dyżur, 22:00–06:00, 8 h, dzień 1 z 2, Rodzina');
    await press(screen.getByLabelText('Następny dzień'));
    expect((await screen.findByTestId('today-event-dyzur-2026-10-07')).props.accessibilityLabel).toBe('Dyżur, do 06:00, dzień 2 z 2, Rodzina');
    expect(screen.getByText('dzień 4 z 5', { exact: false })).toBeTruthy();
  });

  it('Kalendarz: wydarzenie w każdym swoim dniu; ekran wydarzenia z zakresem dni i dniem końca', async () => {
    await open(camp());
    await press(screen.getByLabelText('Kalendarz'));
    expect(screen.getByTestId('day-2026-10-09').props.accessibilityLabel).toMatch(/1 wydarzenie/);
    await press(screen.getByTestId('day-2026-10-08'));
    expect(screen.getByTestId('cal-event-oboz-2026-10-05').props.accessibilityLabel).toBe('Obóz, cały dzień, dzień 4 z 5, Rodzina');
    expect(screen.getByTestId('cal-event-dyzur-2026-10-07').props.accessibilityLabel).toBe('Dyżur, do 06:00, dzień 2 z 2, Rodzina');
    await press(screen.getByTestId('cal-event-oboz-2026-10-05'));
    expect(await screen.findByText('5–9 października · 5 dni')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('cal-event-dyzur-2026-10-07'));
    expect(await screen.findByText('Środa, 7 października · 22:00–06:00 · 8 h')).toBeTruthy();
    expect(screen.getByText('Kończy się następnego dnia: Czwartek, 8 października')).toBeTruthy();
  });
});
