/** Plan lekcji z tygodniami A/B (D112): z ekranu osoby, lekcje jako wydarzenia cykliczne z dzieckiem jako uczestnikiem. */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const radio = (group: string, option: string) => within(screen.getByLabelText(group)).getByLabelText(option);

async function openTimetable(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await press(screen.getByLabelText('Grupy'));
  await press(await screen.findByLabelText('Rodzina, 3 osoby · administrator'));
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
    await press(radio('Kiedy, lekcja 1, piątek', 'Tydzień B'));
    await press(screen.getByTestId('timetable-save'));
    expectOps(store, [{ kind: 'create', entity: 'events', id: 'new-1', group_id: 'gf', set: { title: 'Basen', start_date: '2026-10-09', start_time: '08:00', end_time: '09:00', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', audience: 'members', responsible_member_id: null, kind: 'lesson' } }, { kind: 'create', entity: 'event_participants', id: 'new-2', group_id: 'gf', set: { event_id: 'new-1', member_id: 'kuba' } }, { kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-09-28' } }]);
  });

  it('lekcje co tydzień i w tygodniu B; zapis jako serie z Kubą; cofnięcie usuwa serie', async () => {
    const { store } = await openTimetable();
    expect(screen.getByText('Plan lekcji — Kuba')).toBeTruthy();
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
    // Audyt 2 (M-39, A-21): błąd w karcie lekcji i przy „Zapisz” — której lekcji dotyczy.
    expect(within(screen.getByTestId('timetable-day-0')).getByText(/^Koniec musi być/)).toBeTruthy();
    expect(screen.getByText(/^Popraw lekcję 2, poniedziałek: Koniec musi być/)).toBeTruthy();
    await setTime('lesson-end-1', '09:30');
    await press(radio('Kiedy, lekcja 2, poniedziałek', 'Tydzień B'));
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
    expect(within(bar).getByText('Dodano plan lekcji: 2 lekcje w tygodniu')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    // Serie do kosza; kotwica tygodnia A (zapisana przy lekcji z tygodnia B, D171) wraca do pustej.
    expectOps(store, [
      { kind: 'create', entity: 'events', id: 'new-1', group_id: 'gf', set: { title: 'Matematyka', start_date: '2026-10-05', start_time: '08:00', end_time: '08:45', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', responsible_member_id: null, kind: 'lesson' } },
      { kind: 'create', entity: 'event_participants', id: 'new-2', group_id: 'gf', set: { event_id: 'new-1', member_id: 'kuba' } },
      { kind: 'create', entity: 'events', id: 'new-3', group_id: 'gf', set: { title: 'Plastyka', start_date: '2026-10-12', start_time: '08:45', end_time: '09:30', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', audience: 'members', responsible_member_id: null, kind: 'lesson' } },
      { kind: 'create', entity: 'event_participants', id: 'new-4', group_id: 'gf', set: { event_id: 'new-3', member_id: 'kuba' } },
      { kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-10-05' } },
      { kind: 'delete', entity: 'events', id: 'new-1' },
      { kind: 'delete', entity: 'events', id: 'new-3' },
      { kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: null } },
    ]);
  });

  it('D128, M-14: ekran z obecnym planem; zmieniona lekcja od jutra tym samym poleceniem co „to i następne”; cofnięcie', async () => {
    const base = sampleBase();
    put(base, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-mat', { id: 'p-mat', event_id: 'mat', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    const { store } = await openTimetable(base);
    expect(screen.getByTestId('lesson-title-0').props.value).toBe('Matematyka');
    expect(screen.getByTestId('lesson-end-0').props.accessibilityValue.text).toBe('08:45');
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka rozszerzona');
    await press(screen.getByTestId('timetable-save'));
    expect(store.dispatched).toEqual([
      expect.objectContaining({ kind: 'cmd', cmd: 'split_event', args: expect.objectContaining({ event_id: 'mat', date: '2026-10-08', set: expect.objectContaining({ title: 'Matematyka rozszerzona', start_date: '2026-10-12' }) }) }),
    ]);
    const bar = await screen.findByTestId('undo-bar');
    expect(within(bar).getByText('Zapisano zmiany w planie lekcji (od jutra)')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expectOps(store, [{ kind: 'cmd', cmd: 'split_event', args: { id: 'a945fdc2-e2fe-5610-9b27-9ca40786f5f4', event_id: 'mat', date: '2026-10-08', set: { title: 'Matematyka rozszerzona', start_date: '2026-10-12', start_time: '08:00', end_time: '08:45', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', responsible_member_id: null, location: null }, participants: [{ id: '47871a90-951a-58a8-af61-a0695de712c6', member_id: 'kuba' }], drop_overrides: [], tasks: [] } }, { kind: 'patch', entity: 'events', id: 'a945fdc2-e2fe-5610-9b27-9ca40786f5f4', set: { title: 'Matematyka', start_time: '08:00:00', end_time: '08:45:00', start_date: '2026-10-12', rrule: 'FREQ=WEEKLY;BYDAY=MO' } }]);
  });

  it('M-14: zapis, który zmienia zadania i odwołania — ten sam podgląd co „to i następne”, z wyborem dla zadań', async () => {
    const base = sampleBase();
    put(base, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-mat', { id: 'p-mat', event_id: 'mat', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    put(base, 'event_overrides', 'wolne', { id: 'wolne', group_id: 'gf', event_id: 'mat', occurrence_date: '2026-11-02', cancelled: true, start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, deleted_at: null, version: 1 });
    put(base, 'tasks', 'zeszyt', { ...base.tasks!['t-paczka']!, id: 'zeszyt', title: 'Kupić zeszyt', deadline_mode: 'event', due_date: null, due_time: null, assignee_member_id: null, event_id: 'mat', occurrence_date: '2026-10-12' });
    const { store } = await openTimetable(base);
    // Lekcja z poniedziałku na wtorek.
    await press(screen.getByLabelText('Usuń lekcję 1, poniedziałek'));
    await press(screen.getByTestId('lesson-add-1'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await press(screen.getByTestId('timetable-save'));
    await screen.findByTestId('screen-timetable-preview');
    expect(store.dispatched).toEqual([]);
    expect(screen.getByText('Podgląd zmian')).toBeTruthy();
    expect(screen.getByText(/^Najbliższe terminy po zmianie: /)).toBeTruthy();
    expect(screen.getByText('1 zadanie traci wydarzenie (ten termin znika).')).toBeTruthy();
    expect(screen.getByText('Kupić zeszyt')).toBeTruthy();
    expect(screen.getByText('Zmienione pojedynczo terminy, których po zmianie nie będzie: 1. Ich zmiany przepadną.')).toBeTruthy();
    // „Wróć do edycji” — formularz z wpisanym planem.
    await press(screen.getByText('Wróć do edycji'));
    expect(screen.getByLabelText('Lekcja 1, wtorek').props.value).toBe('Matematyka');
    await press(screen.getByTestId('timetable-save'));
    await press(radio('Co z nimi?', 'Odepnij'));
    await press(screen.getByTestId('timetable-preview-save'));
    expect(store.dispatched).toEqual([
      expect.objectContaining({ kind: 'cmd', cmd: 'split_event', args: expect.objectContaining({ event_id: 'mat', drop_overrides: ['wolne'], tasks: [{ id: 'zeszyt', action: 'unlink' }] }) }),
    ]);
    expect(await screen.findByTestId('undo-bar')).toBeTruthy();
    expect(await screen.findByTestId('screen-member')).toBeTruthy();
  });

  it('zapis bez zmian: nic nie wysyła i nie pokazuje paska (audyt 2, E-5)', async () => {
    const base = sampleBase();
    put(base, 'events', 'mat', { id: 'mat', group_id: 'gf', title: 'Matematyka', start_date: '2026-09-07', start_time: '08:00:00', end_time: '08:45:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-mat', { id: 'p-mat', event_id: 'mat', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    const { store } = await openTimetable(base);
    await press(screen.getByTestId('timetable-save'));
    expect(await screen.findByTestId('screen-member')).toBeTruthy();
    expect(store.dispatched).toEqual([]);
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('D171 (M-15): litery A/B z kotwicy przy dziecku; przełącznik zamienia litery, nie przesuwa lekcji', async () => {
    const base = sampleBase();
    put(base, 'events', 'basen', { id: 'basen', group_id: 'gf', title: 'Basen', start_date: '2026-10-05', start_time: '16:00:00', end_time: '17:00:00', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-basen', { id: 'p-basen', event_id: 'basen', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    put(base, 'group_members', 'kuba', { ...base.group_members!.kuba!, week_a: '2026-09-28' });
    const { store } = await openTimetable(base);
    const week = (group: string, option: string) => radio(group, option).props.accessibilityState.selected;
    // 28.09 to tydzień A, więc ten tydzień (5.10) to B, a basen z 5.10 — tydzień B.
    expect(week('Ten tydzień (5–11 października) to', 'Tydzień B')).toBe(true);
    expect(week('Kiedy, lekcja 1, poniedziałek', 'Tydzień B')).toBe(true);
    expect(screen.getByText('Zmiana tygodnia nie przesuwa lekcji — zamienia tylko litery A i B.')).toBeTruthy();
    await press(radio('Ten tydzień (5–11 października) to', 'Tydzień A'));
    expect(week('Kiedy, lekcja 1, poniedziałek', 'Tydzień A')).toBe(true);
    await press(screen.getByTestId('timetable-save'));
    // Tylko nowa kotwica — lekcje bez zmian.
    expect(store.dispatched).toEqual([{ kind: 'patch', entity: 'group_members', id: 'kuba', set: { week_a: '2026-10-05' } }]);
  });

  it('M-145, E-26: etykiety z numerem w obrębie dnia i dniem; sobota widoczna, gdy ma lekcję', async () => {
    const base = sampleBase();
    put(base, 'events', 'sob', { id: 'sob', group_id: 'gf', title: 'Robotyka', start_date: '2026-10-10', start_time: '09:00:00', end_time: '10:00:00', rrule: 'FREQ=WEEKLY;BYDAY=SA', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p-sob', { id: 'p-sob', event_id: 'sob', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
    await openTimetable(base);
    expect(screen.getByTestId('timetable-day-5')).toBeTruthy();
    expect(screen.queryByTestId('timetable-day-6')).toBeNull();
    expect(screen.getByLabelText('Lekcja 1, sobota').props.value).toBe('Robotyka');
    await press(screen.getByTestId('lesson-add-0'));
    await press(screen.getByTestId('lesson-add-1'));
    await press(screen.getByTestId('lesson-add-1'));
    expect(screen.getByLabelText('Lekcja 2, wtorek')).toBeTruthy();
    expect(screen.getByLabelText(/^Początek, lekcja 2, wtorek$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Koniec, lekcja 2, wtorek$/)).toBeTruthy();
    expect(screen.getByLabelText('Usuń lekcję 2, wtorek')).toBeTruthy();
    expect(screen.getByLabelText('Usuń lekcję 1, poniedziałek')).toBeTruthy();
    await press(screen.getByLabelText('Usuń lekcję 1, sobota'));
    expect(screen.queryByTestId('timetable-day-5')).toBeNull();
  });

  it('D128: przycisk planu tylko przy dziecku', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Rodzina, 3 osoby · administrator'));
    await press(await screen.findByLabelText(/^Ala, /));
    await screen.findByTestId('screen-member');
    expect(screen.queryByTestId('open-timetable')).toBeNull();
  });
});
