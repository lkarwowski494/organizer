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
    await press(await screen.findByLabelText(/^Otwórz:\ Przynieść\ korki\ na\ trening(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.getByText('Przynieść korki na trening')).toBeTruthy();
    expect(screen.getByText('czarne')).toBeTruthy();
    for (const id of ['task-title', 'task-note', 'task-date', 'task-time', 'task-save', 'quick-add', 'task-move']) expect(screen.queryByTestId(id)).toBeNull();
    for (const label of ['Usuń zadanie', 'Bez terminu', 'Dla kogo', 'Przenieś do grupy']) expect(screen.queryByLabelText(label)).toBeNull();
    await press(screen.getByLabelText('Oznacz jako zrobione: Przynieść korki na trening'));
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

describe('zadanie dziecka bez konta (decyzja właściciela z 8.10.2026, PW-1)', () => {
  it('u dorosłego w Moich sprawach z „dla: Kuba” — dodane przez @Kuba, przypięte i z terminem; lista bez ostrzeżenia', async () => {
    const b = sampleBase();
    put(b, 'tasks', 't-pokoj', { ...b.tasks!['t-books']!, id: 't-pokoj', group_id: 'gf', list_id: 'lf', title: 'Posprzątać pokój', assignee_member_id: 'kuba' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    expect(screen.getByLabelText('Otwórz: Posprzątać pokój, bez terminu, Rodzina, dla: Kuba')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'spakować plecak dziś 20:00 @Kuba');
    await press(screen.getByLabelText('Dodaj'));
    expect(s.store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { title: 'spakować plecak', assignee_member_id: 'kuba', due_time: '20:00' } });
    expect(await screen.findByLabelText('Otwórz: spakować plecak, 20:00, Rodzina, dla: Kuba')).toBeTruthy();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    expect(await screen.findByLabelText(/^Otwórz: Posprzątać pokój/)).toBeTruthy();
    expect(screen.queryByText(/nikt tego nie widzi/)).toBeNull();
  });
});
