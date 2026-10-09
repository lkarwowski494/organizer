/** Powtarzanie zadań i historia na ekranie zadania (D76). */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { nextId } from '../../domain/views/task-repeat';
import { RootStack } from '../navigation';
import { expectOps, answerAlert, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openTask(base = sampleBase(), title = 'Odebrać paczkę') {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await press(screen.getByLabelText(new RegExp(`^${title}(,|$)`)));
  await screen.findByTestId('screen-task');
  return s;
}

describe('powtarzanie zadania', () => {
  it('D133: minione „tylko tego dnia” dostaje następne od dziś po otwarciu Moich spraw', async () => {
    const b = sampleBase();
    put(b, 'tasks', 'leki', { ...b.tasks!['t-paczka']!, id: 'leki', title: 'Leki', due_date: '2026-10-05', due_time: '08:00:00', rollover: false, repeat: 'FREQ=DAILY' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(s.store.dispatched).toEqual([expect.objectContaining({ kind: 'create', id: nextId('leki'), set: expect.objectContaining({ due_date: '2026-10-07', title: 'Leki' }) })]);
    expect(await screen.findByLabelText(/^Leki/)).toBeTruthy();
  });

  it('audyt 2 (T-19): minione „od wykonania” dostaje następne na dziś, nie na wczoraj + interwał', async () => {
    const b = sampleBase();
    put(b, 'tasks', 'podlac', { ...b.tasks!['t-paczka']!, id: 'podlac', title: 'Podlać kwiaty', due_date: '2026-10-05', due_time: null, rollover: false, repeat: 'AFTER=WEEKLY;INTERVAL=1' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(s.store.dispatched).toEqual([expect.objectContaining({ kind: 'create', id: nextId('podlac'), set: expect.objectContaining({ due_date: '2026-10-07', repeat: 'AFTER=WEEKLY;INTERVAL=1' }) })]);
    expect(await screen.findByLabelText(/^Podlać kwiaty/)).toBeTruthy();
  });

  it('decyzja właściciela z 8.10.2026: zaległe „codziennie” odhaczone dziś — następne jutro, bez osobnego na dziś', async () => {
    const b = sampleBase();
    put(b, 'tasks', 'leki', { ...b.tasks!['t-paczka']!, id: 'leki', title: 'Leki', due_date: '2026-10-05', due_time: '08:00:00', repeat: 'FREQ=DAILY' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Oznacz jako zrobione: Leki'));
    await answerAlert('Zrobione');
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 'leki', set: { completed_at: '2026-10-07T08:00:00.000Z' } }, { kind: 'create', entity: 'tasks', id: nextId('leki'), group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'Leki', note: null, sort_key: 'a0', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-08', due_time: '08:00:00', rollover: true, repeat: 'FREQ=DAILY' } }]);
    expect(screen.queryByLabelText(/^Leki/)).toBeNull();
  });

  it('audyt 2 (T-12): dziecko odhacza zadanie powtarzane bez kopii (serwer by ją odrzucił)', async () => {
    const child = sampleBase();
    child.group_members!.mf = { ...child.group_members!.mf, role: 'child' };
    put(child, 'tasks', 'smieci', { ...child.tasks!['t-paczka']!, id: 'smieci', title: 'Śmieci', assignee_member_id: 'mf', due_date: '2026-10-07', due_time: null, repeat: 'FREQ=WEEKLY;BYDAY=WE' });
    const c = setup({ base: child });
    await c.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Oznacz jako zrobione: Śmieci'));
    await answerAlert('Zrobione');
    expect(c.store.dispatched).toEqual([expect.objectContaining({ kind: 'patch', id: 'smieci', set: { completed_at: expect.any(String) } })]);
  });

  it('audyt 2 (T-12): telefon dorosłego dokłada następne po odhaczeniu przez dziecko — od dnia odhaczenia', async () => {
    const adult = sampleBase();
    put(adult, 'tasks', 'smieci', { ...adult.tasks!['t-paczka']!, id: 'smieci', title: 'Śmieci', assignee_member_id: 'kuba', due_date: '2026-10-07', due_time: null, repeat: 'FREQ=WEEKLY;BYDAY=WE', completed_at: '2026-10-07T07:00:00Z' });
    const a = setup({ base: adult });
    await a.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(a.store.dispatched).toEqual([expect.objectContaining({ kind: 'create', id: nextId('smieci'), set: expect.objectContaining({ due_date: '2026-10-14', title: 'Śmieci' }) })]);
  });

  it('ustawienie: co tydzień (dzień z terminu, wybór dni), co miesiąc, od wykonania co N, wyłączenie', async () => {
    const { store } = await openTask();
    const ed = screen.getByTestId('repeat-editor');
    await press(within(ed).getByLabelText('Co tydzień'));
    // Termin 7.10.2026 to środa.
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'FREQ=WEEKLY;BYDAY=WE' } }]);
    expect(screen.getByText('Po odhaczeniu pojawi się następne z kolejnym terminem.')).toBeTruthy();
    await press(screen.getByLabelText('W poniedziałek'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'FREQ=WEEKLY;BYDAY=MO,WE' } }]);
    await press(screen.getByLabelText('W poniedziałek'));
    await press(screen.getByLabelText('W środę'));
    // Ostatniego dnia nie da się odznaczyć.
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'FREQ=WEEKLY;BYDAY=WE' } }]);
    await press(within(ed).getByLabelText('Co miesiąc'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'FREQ=MONTHLY;BYMONTHDAY=7' } }]); // D137: dzień miesiąca z terminu
    await press(within(ed).getByLabelText('Codziennie'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'FREQ=DAILY' } }]);
    await press(within(ed).getByLabelText('Od wykonania'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'AFTER=DAILY;INTERVAL=7' } }]);
    await press(screen.getByLabelText('Tygodnie'));
    await press(screen.getByLabelText('2'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'AFTER=WEEKLY;INTERVAL=7' } }, { kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: 'AFTER=WEEKLY;INTERVAL=2' } }]);
    await press(within(ed).getByLabelText('Nie'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { repeat: null } }]);
  });

  it('bez terminu: podpowiedź zamiast wyboru', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText(/^Oddać\ książki\ do\ biblioteki(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByTestId('repeat-editor')).toBeNull();
    expect(screen.getByText('Ustaw termin, żeby zadanie mogło się powtarzać.')).toBeTruthy();
  });

  it('odhaczenie dokłada następne zadanie; cofnięcie zdejmuje nietknięte', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-paczka', { ...base.tasks!['t-paczka']!, repeat: 'FREQ=WEEKLY;BYDAY=WE' });
    const { store } = await openTask(base);
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    await answerAlert('Zrobione');
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { completed_at: '2026-10-07T08:00:00.000Z' } }, { kind: 'create', entity: 'tasks', id: '1bd14f3b-20bb-58f7-a38a-b268e1648bab', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'Odebrać paczkę', note: null, sort_key: 'a0', assignee_member_id: 'mf', deadline_mode: 'own', due_date: '2026-10-14', due_time: '18:00:00', rollover: true, repeat: 'FREQ=WEEKLY;BYDAY=WE' } }]);
    expectOps(store, []);
    await press(screen.getByLabelText('Oznacz jako niezrobione: Odebrać paczkę'));
    expectOps(store, [
      { kind: 'patch', entity: 'tasks', id: 't-paczka', set: { completed_at: null } },
      { kind: 'delete', entity: 'tasks', id: nextId('t-paczka') },
    ]);
  });

  it('zdjęcie terminu zdejmuje też powtarzanie', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-kwiaty', { ...base.tasks!['t-kwiaty']!, assignee_member_id: 'mf', repeat: 'FREQ=DAILY' });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Następny dzień'));
    await press(await screen.findByLabelText(/^Kupić\ kwiaty(,|$)/));
    await press(await screen.findByLabelText('Bez terminu'));
    expectOps(s.store, [{ kind: 'patch', entity: 'tasks', id: 't-kwiaty', set: { deadline_mode: 'none', due_date: null, due_time: null, repeat: null } }]);
  });
});

describe('historia zadania', () => {
  it('kto, co, kiedy — najnowsze na górze; bez wpisów: „Brak zmian.”', async () => {
    const base = sampleBase();
    const a = (id: string, extra: Record<string, unknown>) => put(base, 'activity', id, { id, group_id: 'gf', entity: 'tasks', entity_id: 't-paczka', actor_name: 'Ala', verb: 'update', changes: {}, created_at: '2026-10-07T06:00:00Z', version: 1, ...extra });
    a('h1', { verb: 'create', created_at: '2026-10-06T16:05:00Z' });
    a('h2', { changes: { due_date: ['2026-10-06', '2026-10-07'], repeat: [null, 'FREQ=DAILY'], parent_id: [null, null], weird: [1, 2] } });
    a('h3', { actor_name: null, created_at: '2026-10-07T07:30:00Z', changes: { completed_at: [null, 'x'] } });
    await openTask(base);
    const h = screen.getByTestId('task-history');
    const lines = within(h).getAllByText(/ · /).map((n) => [n.props.children].flat().map((x: unknown) => (typeof x === 'string' ? x : (x as { props: { children: string } }).props.children)).join(''));
    expect(lines).toEqual(['Ktoś odhacza · dziś, 09:30', 'Ala zmienia: termin, powtarzanie, inne · dziś, 08:00', 'Ala dodaje · wczoraj, 18:05']);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText(/^Przynieść\ korki\ na\ trening(,|$)/));
    expect(within(await screen.findByTestId('task-history')).getByText('Brak zmian.')).toBeTruthy();
    // Audyt 2 (M-62): ekran mówi, jak daleko sięga historia.
    expect(within(screen.getByTestId('task-history')).getByText('Zmiany z ostatnich 90 dni.')).toBeTruthy();
  });
});
