/** Działy, podpowiedzi i stałe zakupy na liście zakupów (D85, D86). */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

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
    await press(screen.getByLabelText(/^Zmień dział: Mydło(,|$)/));
    expect(screen.getByTestId('category-picker')).toBeTruthy();
    expect(screen.getByTestId('category-hygiene').props.accessibilityState.selected).toBe(true);
    await press(screen.getByTestId('category-household'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 's-mydlo', set: { category: 'household' } });
    expect(within(screen.getByTestId('section-household')).getByText('Mydło')).toBeTruthy();
    expect(screen.queryByTestId('category-picker')).toBeNull();
    // Druga pozycja o tej samej nazwie trafia od razu do zapamiętanego działu.
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'mydło');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    expect(within(screen.getByTestId('section-household')).getAllByText(/mydło/i)).toHaveLength(2);
    // Ponowne dotknięcie zamyka panel; „Anuluj” też.
    await press(screen.getByLabelText(/^Zmień dział: jabłek(,|$)/));
    await press(screen.getByLabelText(/^Zmień dział: jabłek(,|$)/));
    expect(screen.queryByTestId('category-picker')).toBeNull();
    await press(screen.getByLabelText(/^Zmień dział: jabłek(,|$)/));
    await press(screen.getByText('Anuluj'));
    expect(screen.queryByTestId('category-picker')).toBeNull();
  });

  it('dziecko nie zmienia działów ani stałych', async () => {
    const b = base((x) => put(x, 'group_members', 'mf', { ...x.group_members!.mf!, role: 'child' }));
    await openList(b);
    expect(screen.queryByLabelText(/^Zmień dział: Mydło(,|$)/)).toBeNull();
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
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', set: { list_id: 'lz', title: 'Makaron' } });
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
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'Mleko 2');
    expect(screen.queryByText('Wpisz nazwę.')).toBeNull();
    await press(screen.getByTestId('staple-save'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { staples: ['Mleko 2'] } });
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'mleko');
    await fireEvent(screen.getByTestId('staple-name'), 'submitEditing');
    expect(screen.getByText('Ta pozycja już jest na liście stałych.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'x'.repeat(201));
    await press(screen.getByTestId('staple-save'));
    expect(screen.getByText('Za długa nazwa (najwyżej 200 znaków).')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staple-name'), 'Mydło');
    await press(screen.getByTestId('staple-save'));
    await press(screen.getByTestId('staples-done'));
    expect(within(card()).getByText('Mleko 2, Mydło')).toBeTruthy();
    // Mydło już czeka na liście — brakuje tylko mleka.
    await press(screen.getByTestId('staples-add'));
    expect(store.dispatched.at(-1)).toMatchObject({ kind: 'create', entity: 'tasks', group_id: 'gf', set: { list_id: 'lz', title: 'Mleko 2' } });
    expect(within(card()).getByText('Wszystkie stałe zakupy są już na liście.')).toBeTruthy();
    await press(screen.getByTestId('staples-edit'));
    await press(screen.getByLabelText('Usuń ze stałych: Mydło'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { staples: ['Mleko 2'] } });
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
    await press(screen.getByLabelText(/^Zmień dział: Mydło(,|$)/));
    await press(screen.getByText('Usuń ze stałych'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { staples: [] } });
    await press(screen.getByLabelText(/^Zmień dział: jabłek(,|$)/));
    await press(screen.getByText('Dodaj do stałych'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'lists', id: 'lz', set: { staples: ['2 kg jabłek'] } });
  });
});
