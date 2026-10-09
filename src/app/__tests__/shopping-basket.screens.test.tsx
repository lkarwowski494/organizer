/**
 * Koszyk, dublowanie i kupione (audyt 3): „Zakupy zrobione” bez planu (Q8 A, N-7), „już jest na liście” (N-7),
 * „Kupione w ostatnich zakupach” (Q9 B, N-49), zwinięte „Zrobione” (N-52), panel pozycji (N-174), „Przekaż zakupy” na
 * liście „Tylko ja” (N-172).
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { RootStack } from '../navigation';
import { answerAlert, expectOps, lastAlert, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

async function openList(base = sampleBase(), id = 'lz') {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  await press(screen.getByLabelText('Listy'));
  await press(await screen.findByTestId(`list-${id}`));
  await screen.findByTestId('screen-list');
  return s;
}
const add = async (text: string) => {
  await fireEvent.changeText(screen.getByTestId('quick-add'), text);
  await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
};

describe('„Zakupy zrobione” bez zaplanowanych zakupów (Q8 A, N-7)', () => {
  it('przycisk jest, gdy w koszyku coś leży; kupione schodzą z listy, plan się nie zmienia, historia bez dnia planu', async () => {
    const { store } = await openList();
    const trip = screen.getByTestId('trip');
    expect(within(trip).getByText(/^Bez zaplanowanych zakupów/)).toBeTruthy();
    await press(within(trip).getByTestId('trip-done'));
    expect(lastAlert().message).toBe('Na liście została 1 niekupiona pozycja.');
    await answerAlert('Zostaw na następne zakupy');
    expectOps(store, [
      { kind: 'delete', entity: 'tasks', id: 's-maslo' },
      { kind: 'create', entity: 'shopping_trips', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', planned_date: null, done_at: '2026-10-07T08:00:00.000Z' } },
    ]);
    // Pusty koszyk — nie ma czego kończyć.
    expect(screen.queryByTestId('trip-done')).toBeNull();
    expect(screen.queryByText('W koszyku')).toBeNull();
  });

  it('pusty koszyk bez planu — bez przycisku', async () => {
    const b = sampleBase();
    put(b, 'tasks', 's-maslo', { ...b.tasks!['s-maslo']!, completed_at: null });
    await openList(b);
    expect(screen.queryByTestId('trip-done')).toBeNull();
    expect(screen.getByTestId('trip-plan')).toBeTruthy();
  });
});

describe('ten sam produkt drugi raz (Q8 A, N-7)', () => {
  it('czeka na liście: pytanie, „Anuluj” zostawia tekst, „Dodaj jeszcze raz” dodaje', async () => {
    const { store } = await openList();
    await add('2 chleb żytni');
    const ask = screen.getByTestId('shop-duplicate');
    expect(within(ask).getByText('„Chleb żytni” już jest na liście')).toBeTruthy();
    expect(within(ask).queryByLabelText('Wyjmij z koszyka')).toBeNull();
    expect(store.dispatched).toEqual([]);
    await press(within(ask).getByLabelText('Anuluj'));
    expect(screen.queryByTestId('shop-duplicate')).toBeNull();
    expect(screen.getByTestId('quick-add').props.value).toBe('2 chleb żytni');
    await add('2 chleb żytni');
    await press(within(screen.getByTestId('shop-duplicate')).getByLabelText('Dodaj jeszcze raz'));
    expectOps(store, [{ kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', parent_id: null, title: '2 chleb żytni', sort_key: 'a0', deadline_mode: 'none', due_date: null, due_time: null } }]);
    expect(screen.getByTestId('quick-add').props.value).toBe('');
  });

  it('w koszyku (także w innej formie, „2 masła”): „Wyjmij z koszyka” zamiast nowej pozycji; zmiana tekstu chowa pytanie', async () => {
    const { store } = await openList();
    await add('2 masła');
    expect(within(screen.getByTestId('shop-duplicate')).getByText('„Masło” jest już w koszyku')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('quick-add'), '2 masł');
    expect(screen.queryByTestId('shop-duplicate')).toBeNull();
    await add('masło');
    await press(within(screen.getByTestId('shop-duplicate')).getByLabelText('Wyjmij z koszyka'));
    expectOps(store, [{ kind: 'patch', entity: 'tasks', id: 's-maslo', set: { completed_at: null } }]);
    expect(screen.queryByTestId('shop-duplicate')).toBeNull();
    expect(screen.getByTestId('quick-add').props.value).toBe('');
    expect(screen.queryByText('W koszyku')).toBeNull();
  });

  it('lista zadań nie pyta o duble', async () => {
    const { store } = await openList(sampleBase(), 'lf');
    await add('Kupić kwiaty');
    expect(screen.queryByTestId('shop-duplicate')).toBeNull();
    expect(store.dispatched).toHaveLength(1);
  });
});

describe('„Kupione w ostatnich zakupach” (Q9 B, N-49)', () => {
  it('po „Zakupy zrobione” kupione są na liście, zwinięte; „Kup jeszcze raz” wraca do kupienia; nie ma ich w Koszu', async () => {
    const { store } = await openList();
    expect(screen.queryByTestId('bought')).toBeNull();
    await press(screen.getByTestId('trip-done'));
    await answerAlert('Zostaw na następne zakupy');
    expectOps(store, [
      { kind: 'delete', entity: 'tasks', id: 's-maslo' },
      { kind: 'create', entity: 'shopping_trips', id: 'new-1', group_id: 'gf', set: { list_id: 'lz', planned_date: null, done_at: '2026-10-07T08:00:00.000Z' } },
    ]);
    expect(screen.queryByTestId('bought-s-maslo')).toBeNull();
    await press(screen.getByLabelText('Kupione w ostatnich zakupach (1), pokaż'));
    const row = screen.getByTestId('bought-s-maslo');
    expect(within(row).getByText('Masło')).toBeTruthy();
    await press(within(row).getByLabelText('Kup jeszcze raz: Masło'));
    expectOps(store, [
      { kind: 'restore', entity: 'tasks', id: 's-maslo' },
      { kind: 'patch', entity: 'tasks', id: 's-maslo', set: { completed_at: null } },
    ]);
    expect(screen.queryByTestId('bought')).toBeNull();
    expect(within(screen.getByTestId('section-dairy')).getByText('Masło')).toBeTruthy();
  });

  it('kosz grupy nie pokazuje kupionych; usunięta niekupiona pozycja — tak', async () => {
    const b = sampleBase();
    put(b, 'tasks', 's-maslo', { ...b.tasks!['s-maslo']!, deleted_at: '2026-10-06T08:00:00Z' });
    put(b, 'tasks', 's-chleb', { ...b.tasks!['s-chleb']!, deleted_at: '2026-10-06T08:00:00Z' });
    const s = setup({ base: b });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Grupy'));
    await screen.findByTestId('trash');
    const items = await screen.findByTestId('trash-item');
    expect(within(items).getByText('Chleb żytni')).toBeTruthy();
    expect(within(items).queryByText('Masło')).toBeNull();
  });
});

describe('zrobione na liście zadań (N-52)', () => {
  it('rok zrobionych: zwinięte „Zrobione (N)”, po rozwinięciu ostatnie 30 dni, starsze na życzenie', async () => {
    const b = sampleBase();
    // 1000 zrobionych zadań, jedno dziennie wstecz od 7.10.2026.
    for (let i = 0; i < 1000; i++) {
      const at = new Date(Date.UTC(2026, 9, 7 - i, 9)).toISOString();
      put(b, 'tasks', `d${i}`, { ...b.tasks!['t-books']!, id: `d${i}`, list_id: 'lf', group_id: 'gf', title: `Zrobione ${i}`, completed_at: at });
    }
    await openList(b, 'lf');
    expect(screen.queryAllByTestId(/^task-d\d+$/)).toHaveLength(0);
    await press(screen.getByLabelText('Zrobione (1000), pokaż'));
    // 7.10 i 30 dni wstecz (od 7.09 włącznie).
    expect(screen.queryAllByTestId(/^task-d\d+$/)).toHaveLength(31);
    expect(screen.getByTestId('task-d30')).toBeTruthy();
    expect(screen.queryByTestId('task-d31')).toBeNull();
    await press(screen.getByLabelText('Pokaż starsze (969)'));
    expect(screen.queryAllByTestId(/^task-d\d+$/)).toHaveLength(1000);
    expect(screen.queryByTestId('list-done-older')).toBeNull();
    await press(screen.getByLabelText('Zrobione (1000), schowaj'));
    expect(screen.queryAllByTestId(/^task-d\d+$/)).toHaveLength(0);
  });
});

describe('panel pozycji i przekazanie', () => {
  it('N-174: pozycja włożona do koszyka zamyka swój panel', async () => {
    await openList();
    await press(screen.getByLabelText(/^Chleb żytni(,|$)/));
    expect(screen.getByTestId('item-panel')).toBeTruthy();
    await press(screen.getByLabelText('Włóż do koszyka: Chleb żytni'));
    expect(screen.queryByTestId('item-panel')).toBeNull();
    // Wyjęcie z koszyka nie otwiera go znowu.
    await press(screen.getByLabelText('Wyjmij z koszyka: Chleb żytni'));
    expect(screen.queryByTestId('item-panel')).toBeNull();
  });

  it('N-172: lista „Tylko ja” — moje zakupy bez „Przekaż zakupy” (nie ma komu)', async () => {
    const b = sampleBase();
    put(b, 'lists', 'lz', { ...b.lists!.lz!, visibility: 'private', owner_member_id: 'mf', due_date: '2026-10-07', responsible_member_id: 'mf' });
    await openList(b);
    expect(screen.getByTestId('trip-done')).toBeTruthy();
    expect(screen.queryByTestId('handoff-start')).toBeNull();
  });
});
