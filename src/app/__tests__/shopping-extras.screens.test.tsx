/** Działy, podpowiedzi i stałe zakupy na liście zakupów (D85, D86). */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { expectOps, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

function base(extra: (b: ReturnType<typeof sampleBase>) => void = () => {}) {
  const b = sampleBase();
  const item = (id: string, title: string, more: Record<string, unknown> = {}) =>
    put(b, 'tasks', id, { id, group_id: 'gf', list_id: 'lz', parent_id: null, title, note: null, sort_key: 'a0', assignee_member_id: null, deadline_mode: 'none', due_date: null, due_time: null, start_date: null, completed_at: null, deleted_at: null, version: 1, ...more });
  item('s-jablka', '2 kg jabłek');
  item('s-mydlo', 'Mydło');
  item('s-mleko-old', 'Mleko', { completed_at: '2026-10-01T10:00:00Z', version: 3 });
  item('s-mak-old', 'Makaron', { completed_at: '2026-10-01T10:00:00Z' });
  extra(b);
  return b;
}

async function openList(b = base(), account?: Parameters<typeof setup>[0]) {
  const s = setup({ base: b, ...account });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await press(screen.getByLabelText('Listy'));
  await press(await screen.findByText('Zakupy na weekend'));
  await screen.findByTestId('screen-list');
  return s;
}

describe('działy', () => {
  it('pozycje pod nagłówkami działów w stałej kolejności; „W koszyku” bez działów', async () => {
    await openList();
    const order = ['section-produce', 'section-bakery', 'section-hygiene'];
    for (const id of order) expect(screen.getByTestId(id)).toBeTruthy();
    expect(within(screen.getByTestId('section-produce')).getByText('jabłek')).toBeTruthy();
    expect(within(screen.getByTestId('section-bakery')).getByText('Chleb żytni')).toBeTruthy();
    expect(within(screen.getByTestId('section-hygiene')).getByText('Mydło')).toBeTruthy();
    expect(screen.getByText('W koszyku')).toBeTruthy();
  });

  it('dotknięcie pozycji: wybór działu wysyła zmianę i przenosi pozycję; pamięć grupy działa na nową pozycję', async () => {
    const { store } = await openList();
    await press(screen.getByLabelText(/^Zmień pozycję: Mydło(,|$)/));
    // Audyt 2 (M-238): dział to wybór jednej opcji (radio w grupie „Dział”), jak inne takie wybory.
    const picker = screen.getByTestId('item-panel');
    expect(within(picker).getByLabelText('Dział').props.accessibilityRole).toBe('radiogroup');
    expect(within(picker).getAllByRole('radio')).toHaveLength(13);
    expect(within(picker).getByRole('radio', { name: 'Higiena i kosmetyki' }).props.accessibilityState.selected).toBe(true);
    expect(within(picker).getByRole('radio', { name: 'Chemia i dom' }).props.accessibilityState.selected).toBe(false);
    await press(within(picker).getByRole('radio', { name: 'Chemia i dom' }));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 's-mydlo', set: { category: 'household' } }]);
    expect(within(screen.getByTestId('section-household')).getByText('Mydło')).toBeTruthy();
    expect(screen.queryByTestId('item-panel')).toBeNull();
    // Druga pozycja o tej samej nazwie trafia od razu do zapamiętanego działu.
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'mydło');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(screen.getByTestId('section-household')).getAllByText(/mydło/i)).toHaveLength(2);
    // Dział z pamięci grupy czyta wyświetlanie — nowa pozycja nie wysyła własnego działu.
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'mydło', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    // Ponowne dotknięcie zamyka panel; „Gotowe” też.
    await press(screen.getByLabelText(/^Zmień pozycję: jabłek(,|$)/));
    await press(screen.getByLabelText(/^Zmień pozycję: jabłek(,|$)/));
    expect(screen.queryByTestId('item-panel')).toBeNull();
    await press(screen.getByLabelText(/^Zmień pozycję: jabłek(,|$)/));
    await press(within(screen.getByTestId('item-panel')).getByText('Gotowe'));
    expect(screen.queryByTestId('item-panel')).toBeNull();
  });

  it('dziecko nie zmienia działów ani stałych', async () => {
    const b = base((x) => put(x, 'group_members', 'mf', { ...x.group_members!.mf!, role: 'child' }));
    await openList(b);
    expect(screen.queryByLabelText(/^Zmień pozycję: Mydło(,|$)/)).toBeNull();
    expect(screen.queryByTestId('staples')).toBeNull();
  });
});

describe('podpowiedzi', () => {
  it('po dwóch literach: wcześniej kupowane z grupy; dotknięcie dodaje pozycję', async () => {
    const { store } = await openList();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'm');
    expect(screen.queryByTestId('suggestions')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'ma');
    const s = screen.getByTestId('suggestions');
    expect(within(s).getByLabelText('Dodaj: Makaron')).toBeTruthy();
    await press(within(s).getByLabelText('Dodaj: Makaron'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'Makaron', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(screen.getByTestId('quick-add').props.value).toBe('');
  });
});

describe('stałe zakupy', () => {
  it('edycja: dodanie, błędy, usunięcie; „Dodaj stałe” dokłada brakujące', async () => {
    const { store } = await openList();
    const card = () => screen.getByTestId('staples');
    expect(within(card()).getByText(/Zapisz je raz/)).toBeTruthy();
    await press(screen.getByTestId('staples-edit'));
    expect(screen.getByText('Nie masz jeszcze stałych zakupów.')).toBeTruthy();
    await press(screen.getByTestId('staple-save'));
    expect(screen.getByText('Wpisz nazwę.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'Jajka 10');
    expect(screen.queryByText('Wpisz nazwę.')).toBeNull();
    await press(screen.getByTestId('staple-save'));
    // Stała bez ilości (decyzja właściciela z 8.10.2026, PWD-19 A).
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Jajka' } }]);
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'jajka');
    await fireEvent(screen.getByTestId('staple-name'), 'submitEditing');
    expect(screen.getByText('Ta pozycja już jest na liście stałych.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'x'.repeat(201));
    await press(screen.getByTestId('staple-save'));
    expect(screen.getByText('Za długa nazwa (najwyżej 200 znaków).')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'Mydło');
    await press(screen.getByTestId('staple-save'));
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'Mleko');
    await press(screen.getByTestId('staple-save'));
    await press(screen.getByTestId('staples-done'));
    expect(within(card()).getByText('Jajka, Mydło, Mleko')).toBeTruthy();
    // Mydło czeka na liście, mleko jest w koszyku (PWD-19 A: też „już na liście”) — brakuje tylko jajek.
    expect(screen.getByTestId('staples-add').props.accessibilityLabel).toBe('Dodaj stałe (1)');
    await press(screen.getByTestId('staples-add'));
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Mydło' } }, { kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'Mleko' } }, { kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: 'Jajka', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(within(card()).getByText('Wszystkie stałe zakupy są już na liście.')).toBeTruthy();
    await press(screen.getByTestId('staples-edit'));
    await press(screen.getByLabelText('Usuń ze stałych: Mydło'));
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mydło'] } }]);
    expect(screen.queryByLabelText('Usuń ze stałych: Mydło')).toBeNull();
  });

  it('pełna lista stałych: komunikat z limitem', async () => {
    await openList(base((x) => put(x, 'lists', 'lz', { ...x.lists!.lz!, staples: Array.from({ length: 50 }, (_, i) => `p${i}`) })));
    await press(screen.getByTestId('staples-edit'));
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'nowe');
    await press(screen.getByTestId('staple-save'));
    expect(screen.getByText('Lista stałych jest pełna (50 pozycji).')).toBeTruthy();
  });

  it('z panelu pozycji: „Dodaj do stałych” i „Usuń ze stałych”', async () => {
    const { store } = await openList(base((x) => put(x, 'lists', 'lz', { ...x.lists!.lz!, staples: ['Mydło'] })));
    await press(screen.getByLabelText(/^Zmień pozycję: Mydło(,|$)/));
    await press(screen.getByText('Usuń ze stałych'));
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'lz', names: ['Mydło'] } }]);
    await press(screen.getByLabelText(/^Zmień pozycję: jabłek(,|$)/));
    await press(screen.getByText('Dodaj do stałych'));
    expectOps(store, [{ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'lz', name: 'jabłek' } }]);
  });
});
