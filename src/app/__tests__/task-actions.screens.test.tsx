/**
 * Odhaczanie z potwierdzeniem (D59), usuwanie przesunięciem z „Cofnij” (D60) i kolejność dnia
 * (całodniowe na górze, potem godziny — wydarzenia przemieszane z zadaniami).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { Alert } from 'react-native';

import { config } from '../../config';
import { RootStack } from '../navigation';
import { answerAlert, lastAlert, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const ids = (prefix: RegExp) => screen.getAllByTestId(prefix).map((e) => e.props.testID as string);

describe('kolejność dnia', () => {
  it('Dotyczy mnie: całodniowe na górze, potem godziny po kolei, wydarzenia między zadaniami', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev17', { id: 'ev17', group_id: 'gf', title: 'Tańce', start_date: '2026-10-07', start_time: '17:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
    put(base, 'events', 'evAll', { id: 'evAll', group_id: 'gf', title: 'Dzień nauczyciela', start_date: '2026-10-07', start_time: null, end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
    put(base, 'events', 'ev19', { id: 'ev19', group_id: 'gf', title: 'Kolacja', start_date: '2026-10-07', start_time: '19:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
    put(base, 'tasks', 't-all', { ...base.tasks!['t-kwiaty']!, id: 't-all', title: 'Podlać kwiaty', due_date: '2026-10-07', due_time: null });
    await open(base);
    const today = ids(/^today-(event-)?(ev|t-)/).filter((id) => !id.includes('t-kwiaty') && !id.includes('t-books'));
    expect(today).toEqual(['today-event-evAll-2026-10-07', 'today-t-all', 'today-event-ev17-2026-10-07', 'today-t-korki', 'today-t-paczka', 'today-event-ev19-2026-10-07']);
    // Kalendarz: ten sam porządek dnia.
    await press(screen.getByLabelText('Kalendarz'));
    await screen.findByTestId('screen-calendar');
    expect(ids(/^cal-/)).toEqual(['cal-event-evAll-2026-10-07', 'cal-t-all', 'cal-t-ala', 'cal-event-ev17-2026-10-07', 'cal-t-korki', 'cal-t-paczka', 'cal-event-ev19-2026-10-07']);
  });
});

describe('odhaczanie z potwierdzeniem (D59)', () => {
  it('kalendarz i zadanie (także podzadanie): okno „Zrobione?”, cofnięcie odhaczenia bez pytania', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'sub', { ...base.tasks!['t-kwiaty']!, id: 'sub', parent_id: 't-kwiaty', title: 'Wybrać tulipany', deadline_mode: 'inherit', due_date: null });
    const { store } = await open(base);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    expect(lastAlert()).toMatchObject({ title: 'Zrobione?', message: 'Odebrać paczkę' });
    await answerAlert('Zrobione');
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'patch', id: 't-paczka', set: { completed_at: '2026-10-07T08:00:00.000Z' } });
    await press(screen.getByLabelText('Dziś'));
    await press(await screen.findByLabelText('Otwórz: Kupić kwiaty'));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Oznacz jako zrobione: Wybrać tulipany'));
    await answerAlert('Anuluj');
    await press(screen.getByLabelText('Oznacz jako zrobione'));
    expect(lastAlert().message).toBe('Kupić kwiaty');
    await answerAlert('Zrobione');
    expect(store.dispatched.at(-1)).toMatchObject({ id: 't-kwiaty', set: { completed_at: expect.any(String) } });
    const n = (Alert.alert as unknown as jest.Mock).mock.calls.length;
    await press(screen.getByLabelText('Oznacz jako niezrobione'));
    expect((Alert.alert as unknown as jest.Mock).mock.calls).toHaveLength(n); // cofnięcie bez okna
    expect(store.dispatched.at(-1)).toMatchObject({ id: 't-kwiaty', set: { completed_at: null } });
  });
});

describe('usuwanie przesunięciem z „Cofnij” (D60)', () => {
  it('lista: „Usuń” w odsłoniętym miejscu usuwa, pasek „Cofnij” przywraca', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await screen.findByTestId('screen-list');
    expect(screen.getByTestId('swipe-t-kwiaty').props.horizontal).toBe(true);
    await press(screen.getByLabelText('Usuń: Kupić kwiaty'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'delete', entity: 'tasks', id: 't-kwiaty' });
    expect(screen.queryByTestId('task-t-kwiaty')).toBeNull();
    expect(within(screen.getByTestId('undo-bar')).getByText('Usunięto: Kupić kwiaty')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'tasks', id: 't-kwiaty' });
    expect(screen.getByTestId('task-t-kwiaty')).toBeTruthy();
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('pasek znika sam po czasie; nowy zastępuje poprzedni', async () => {
    jest.useFakeTimers();
    try {
      await open();
      await press(screen.getByLabelText('Usuń: Kupić kwiaty'));
      await press(screen.getByLabelText('Usuń: Odebrać paczkę'));
      expect(screen.getAllByTestId('undo-bar')).toHaveLength(1);
      expect(screen.getByText('Usunięto: Odebrać paczkę')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(config.UNDO_MS - 1));
      expect(screen.getByTestId('undo-bar')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(1));
      expect(screen.queryByTestId('undo-bar')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('usunięcie listy też ma „Cofnij”', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText('Usuń listę'));
    expect(await screen.findByText('Usunięto listę: Dom')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'lists', id: 'lf' });
  });

  it('dziecko w grupie nie dostaje usuwania (D34); kalendarz ma usuwanie', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'child' };
    await open(base);
    expect(screen.queryByLabelText('Usuń: Odebrać paczkę')).toBeNull();
    expect(screen.getByLabelText('Usuń: Przynieść korki na trening')).toBeTruthy();
    await press(screen.getByLabelText('Kalendarz'));
    await screen.findByTestId('screen-calendar');
    expect(screen.queryByLabelText('Usuń: Odebrać paczkę')).toBeNull();
    await press(screen.getByLabelText('Usuń: Przynieść korki na trening'));
    expect(screen.queryByTestId('cal-t-korki')).toBeNull();
  });
});
