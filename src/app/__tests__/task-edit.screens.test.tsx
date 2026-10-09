/**
 * Ekran zadania zapisuje od razu (D130) — ale tylko to, co zmieniłem. Audyt 2 (T-22): pola brały wartość raz,
 * przy otwarciu, więc wyjście z ekranu bez edycji cofało zmianę zrobioną w tym czasie na drugim telefonie.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { sampleBase, setTime, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openPackage() {
  const s = setup({ base: sampleBase() });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
  await screen.findByTestId('screen-task');
  const remote = (set: Record<string, unknown>) =>
    act(async () => s.store.pull((b) => ({ ...b, tasks: { ...b.tasks, 't-paczka': { ...b.tasks!['t-paczka']!, ...set } } })));
  return { s, remote };
}

describe('ekran zadania a zmiany z drugiego telefonu (audyt 2, T-22)', () => {
  it('bez edycji: pola pokazują nowe wartości, a wyjście z ekranu nic nie wysyła', async () => {
    const { s, remote } = await openPackage();
    await remote({ title: 'Odebrać paczkę z paczkomatu', note: 'kod 1234' });
    expect(screen.getByTestId('task-title').props.value).toBe('Odebrać paczkę z paczkomatu');
    expect(screen.getByTestId('task-note').props.value).toBe('kod 1234');
    await fireEvent(screen.getByTestId('task-title'), 'blur');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-today');
    expect(s.store.dispatched).toEqual([]);
  });

  it('zmiana samej godziny zostawia dzień ustawiony w tym czasie na drugim telefonie', async () => {
    const { s, remote } = await openPackage();
    await remote({ due_date: '2026-10-09' });
    await setTime('task-time', '19:30');
    expect(s.store.dispatched).toEqual([expect.objectContaining({ kind: 'patch', id: 't-paczka', set: expect.objectContaining({ due_date: '2026-10-09', due_time: '19:30' }) })]);
  });

  it('moja edycja wygrywa przy wyjściu z pola; po zapisie wyjście z ekranu nie wysyła jej drugi raz', async () => {
    const { s, remote } = await openPackage();
    await fireEvent.changeText(screen.getByTestId('task-title'), 'Paczka z poczty');
    await remote({ title: 'Paczka (Ala)' });
    // W trakcie pisania pole nie skacze pod palcem.
    expect(screen.getByTestId('task-title').props.value).toBe('Paczka z poczty');
    await fireEvent(screen.getByTestId('task-title'), 'blur');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { title: 'Paczka z poczty' } }]);
    // Do potwierdzenia przez serwer zmiana czeka w kolejce i przykrywa dane z pobrania (offline-first, D2).
    expect(screen.getByTestId('task-title').props.value).toBe('Paczka z poczty');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-today');
    expect(s.store.dispatched).toHaveLength(1);
  });

  it('pusty tytuł po wyjściu z pola wraca do zapisanego, bez zapisu', async () => {
    const { s } = await openPackage();
    await fireEvent.changeText(screen.getByTestId('task-title'), '   ');
    await fireEvent(screen.getByTestId('task-title'), 'blur');
    expect(screen.getByTestId('task-title').props.value).toBe('Odebrać paczkę');
    expect(s.store.dispatched).toEqual([]);
  });
});
