/** Dziecko z kontem (D34) tylko odhacza: bez pól i przycisków, które serwer i tak odrzuci (audyt 8.10.2026). */
import { fireEvent, screen } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { answerAlert, lastAlert, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

function childBase() {
  const b = sampleBase();
  put(b, 'group_members', 'mk', { ...b.group_members!.mk!, role: 'child' });
  put(b, 'tasks', 't-korki', { ...b.tasks!['t-korki']!, note: 'czarne' });
  return b;
}

describe('dziecko w grupie (D34)', () => {
  it('zadanie tylko do odczytu, odhaczenie zostaje; lista bez dodawania i usuwania; grupa bez „Nowa lista”', async () => {
    const s = setup({ base: childBase() });
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Otwórz: Przynieść korki na trening'));
    await screen.findByTestId('screen-task');
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    expect(screen.getByText('czarne')).toBeTruthy();
    for (const id of ['task-title', 'task-note', 'task-date', 'task-time', 'task-save', 'task-sub']) expect(screen.queryByTestId(id)).toBeNull();
    for (const label of ['Usuń zadanie', 'Usuń termin', 'Dla kogo']) expect(screen.queryByLabelText(label)).toBeNull();
    await press(screen.getByLabelText('Oznacz jako zrobione'));
    await answerAlert(lastAlert().buttons.at(-1)!.text!); // D59: potwierdzenie odhaczenia
    expect(s.store.dispatched.at(-1)).toMatchObject({ kind: 'patch', entity: 'tasks', id: 't-korki' });
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lk'));
    expect(screen.queryByTestId('quick-add')).toBeNull();
    expect(screen.queryByLabelText('Usuń listę')).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gk'));
    expect(screen.queryByLabelText('Nowa lista')).toBeNull();
    expect(screen.queryByTestId('group-add-event')).toBeNull();
  });
});
