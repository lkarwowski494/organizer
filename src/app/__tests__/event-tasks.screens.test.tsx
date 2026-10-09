/**
 * Zadania na spotkaniu (D13), przepinanie przy odwołaniu (D14), podgląd skutków zmiany serii, „Dodaj do kalendarza” (D7).
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { splitId } from '../../domain/event-split';
import { materialize, type NewOp, type Row } from '../../domain/sync-engine/client';
import { overrideId } from '../../domain/views/events';
import { RootStack } from '../navigation';
import { put, sampleBase, setup , pickDate, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const type = (el: Parameters<typeof fireEvent.changeText>[0], text: string) => fireEvent.changeText(el, text);

/** Tańce w środy 17:00 (cała grupa) + zadanie „Strój” na dzisiejsze wystąpienie; Wywiadówka w piątek. */
function base(extraTask: Row = {}) {
  const t = sampleBase();
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
  put(t, 'events', 'ev2', { id: 'ev2', group_id: 'gf', title: 'Wywiadówka', start_date: '2026-10-09', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
  put(t, 'tasks', 'strój', { ...t.tasks!['t-kwiaty']!, id: 'strój', title: 'Spakować strój', deadline_mode: 'event', due_date: null, event_id: 'ev', occurrence_date: '2026-10-07', ...extraTask });
  return t;
}
async function open(b = base(), opts: Parameters<typeof setup>[0] = {}) {
  const s = setup({ base: b, ...opts });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const openEvent = async () => {
  await press(screen.getByTestId('today-event-ev-2026-10-07'));
  return screen.findByTestId('screen-event');
};

describe('zadania na spotkaniu (D13)', () => {
  it('termin jak spotkanie w Moje sprawy; lista zadań spotkania; nowe zadanie na spotkaniu', async () => {
    const { store } = await open();
    expect(screen.getByLabelText(/^Otwórz:\ Spakować\ strój(,|$)/)).toBeTruthy();
    await openEvent();
    expect(screen.getByTestId('event-task-strój')).toBeTruthy();
    await type(screen.getByTestId('quick-add'), '  ');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched).toHaveLength(0);
    await type(screen.getByTestId('quick-add'), 'Kupić baletki');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched).toEqual([
      { kind: 'create', entity: 'tasks', id: 'new-1', group_id: 'gf', set: { list_id: 'lf', parent_id: null, title: 'Kupić baletki', sort_key: 'a0', deadline_mode: 'event', due_date: null, due_time: null, event_id: 'ev', occurrence_date: '2026-10-07' } },
    ]);
    expect(screen.getByTestId('event-task-new-1')).toBeTruthy();
  });

  it('grupa bez listy zadań: powstaje lista „Zadania”; kilka list — wybór listy', async () => {
    const b = base();
    delete b.lists!.lf;
    delete b.tasks!['t-kwiaty'];
    delete b.tasks!['t-paczka'];
    delete b.tasks!['t-ala'];
    delete b.tasks!.strój;
    const { store } = await open(b);
    await openEvent();
    await type(screen.getByTestId('quick-add'), 'Baletki');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched[0]).toEqual({ kind: 'create', entity: 'lists', id: 'new-1', group_id: 'gf', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } });
    expect(store.dispatched[1]).toMatchObject({ entity: 'tasks', set: { list_id: 'new-1' } });
    // Druga lista zadań w grupie → wybór.
    await act(async () => store.dispatch({ kind: 'create', entity: 'lists', id: 'l2', group_id: 'gf', set: { kind: 'tasks', name: 'Szkoła' } }));
    expect(await screen.findByLabelText('Na liście')).toBeTruthy();
    await press(screen.getByLabelText('Szkoła'));
    await type(screen.getByTestId('quick-add'), 'Zeszyt');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched.at(-1)).toMatchObject({ entity: 'tasks', set: { list_id: 'l2', title: 'Zeszyt' } });
  });

  it('ekran zadania: spotkanie, otwarcie, własny termin i powrót do terminu spotkania, odpięcie, podpięcie', async () => {
    const { store } = await open(base({ deadline_mode: 'own', due_date: '2026-10-07' }));
    await press(screen.getByLabelText(/^Otwórz:\ Spakować\ strój(,|$)/)); // własny termin dziś
    await screen.findByTestId('screen-task');
    expect(screen.getByText('Wydarzenie: Tańce, dziś · 17:00')).toBeTruthy();
    await press(screen.getByTestId('task-event-due'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: 'ev', occurrence_date: '2026-10-07', deadline_mode: 'event', due_date: null, due_time: null, repeat: null } });
    expect(screen.getByText('Jak wydarzenie: dziś · 17:00')).toBeTruthy();
    await press(screen.getByTestId('task-relink'));
    await press(screen.getByTestId('pick-ev2-2026-10-09'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: 'ev2', occurrence_date: '2026-10-09' } });
    expect(screen.getByText(/Wydarzenie: Wywiadówka/)).toBeTruthy();
    await press(screen.getByTestId('task-detach'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } });
    await press(screen.getByTestId('task-attach'));
    expect(screen.getByText('Wybierz termin')).toBeTruthy();
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('task-attach'));
    await press(screen.getByTestId('pick-ev-2026-10-14'));
    expect(store.dispatched.at(-1)).toMatchObject({ set: { event_id: 'ev', occurrence_date: '2026-10-14', deadline_mode: 'event' } });
    await press(screen.getByTestId('task-open-event'));
    expect(await screen.findByText('Środa, 14 października · 17:00–18:00 · 1 h')).toBeTruthy();
  });

  it('spotkanie odwołane gdzie indziej: zadanie zostaje z komunikatem i można je przepiąć', async () => {
    const b = base();
    put(b, 'event_overrides', 'o1', { id: 'o1', event_id: 'ev', group_id: 'gf', occurrence_date: '2026-10-07', cancelled: true, deleted_at: null, version: 1 });
    await open(b);
    // Bez terminu we wspólnej grupie nie ma go w Moje sprawy — jest na liście.
    expect(screen.queryByLabelText(/^Otwórz:\ Spakować\ strój(,|$)/)).toBeNull();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText(/^Otwórz:\ Spakować\ strój(,|$)/));
    expect(await screen.findByText(/Wydarzenie odwołane albo zmienione/)).toBeTruthy();
    expect(screen.queryByTestId('task-open-event')).toBeNull();
    expect(screen.queryByTestId('task-event-due')).toBeNull();
  });
});

describe('odwołanie spotkania z zadaniami (D14)', () => {
  const lastOps = (ops: NewOp[], n: number) => ops.slice(-n);

  it('„przepnij na kolejne” — odwołanie i przepięcie w jednym zapisie', async () => {
    const { store } = await open();
    await openEvent();
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-this'));
    expect(screen.getByText('1 zadanie jest podpięte do odwoływanych wydarzeń. Co z nim?')).toBeTruthy();
    await press(screen.getByLabelText('Anuluj'));
    expect(store.dispatched).toHaveLength(0);
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-this'));
    await press(screen.getByLabelText('Przepnij na kolejne: śr. 14 paź'));
    const oid = overrideId('ev', '2026-10-07');
    expect(lastOps(store.dispatched, 3)).toEqual([
      { kind: 'create', entity: 'event_overrides', id: oid, group_id: 'gf', set: { event_id: 'ev', occurrence_date: '2026-10-07', start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, cancelled: true } },
      { kind: 'patch', entity: 'event_overrides', id: oid, set: { cancelled: true } },
      { kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: 'ev', occurrence_date: '2026-10-14' } },
    ]);
  });

  it('„przepnij na inne spotkanie” (bez odwoływanych), odepnij, usuń', async () => {
    const s = await open();
    await openEvent();
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-following'));
    expect(screen.queryByTestId('relink-next')).toBeNull();
    await press(screen.getByTestId('relink-other'));
    expect(screen.queryByTestId('pick-ev-2026-10-14')).toBeNull(); // seria odwoływana od dziś
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('relink-other'));
    await press(screen.getByTestId('pick-ev2-2026-10-09'));
    expect(s.store.dispatched).toEqual([
      { kind: 'delete', entity: 'events', id: 'ev' },
      { kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: 'ev2', occurrence_date: '2026-10-09' } },
    ]);
  });

  it.each([
    ['relink-unlink', { kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } }],
    ['relink-delete', { kind: 'delete', entity: 'tasks', id: 'strój' }],
  ])('%s', async (id, op) => {
    const { store } = await open();
    await openEvent();
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-all'));
    await press(screen.getByTestId(id));
    expect(store.dispatched).toEqual([{ kind: 'delete', entity: 'events', id: 'ev' }, op]);
  });

  it('zadanie na innym wystąpieniu nie blokuje odwołania tylko tego', async () => {
    const { store } = await open(base({ occurrence_date: '2026-10-14' }));
    await press(screen.getByTestId('today-event-ev-2026-10-07'));
    await press(await screen.findByTestId('event-cancel'));
    await press(screen.getByTestId('scope-this'));
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(store.dispatched.map((o) => o.kind)).toEqual(['create', 'patch']); // tylko wyjątek terminu, bez zadań
  });
});

describe('zmiana serii z zadaniami: podgląd skutków', () => {
  it('„wszystkie” na czwartki: zadanie traci termin → odepnij albo najbliższy', async () => {
    const { store } = await open();
    await openEvent();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-all'));
    await press(await screen.findByLabelText('W środę'));
    await press(screen.getByLabelText('W czwartek'));
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByText('1 zadanie traci wydarzenie (ten termin znika).')).toBeTruthy();
    expect(screen.getByText('Spakować strój')).toBeTruthy();
    await press(screen.getByLabelText('Odepnij'));
    await press(screen.getByTestId('event-preview-save'));
    await screen.findByTestId('screen-today');
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 'strój', set: { event_id: null, occurrence_date: null, deadline_mode: 'none' } });
  });

  it('„to i następne” bez zmiany dni: zadanie przechodzi do nowej serii', async () => {
    const b = base({ occurrence_date: '2026-10-14' });
    b.events!.ev = { ...b.events!.ev!, start_date: '2026-09-30' };
    const { store } = await open(b);
    await openEvent();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-following'));
    await setTime('event-start-0', '16:00');
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByText('1 podpięte zadanie przejdzie razem z terminami.')).toBeTruthy();
    await press(screen.getByTestId('event-preview-save'));
    await screen.findByTestId('screen-today');
    // Jedno polecenie podziału: zadanie przenosi ono samo (bez osobnej operacji).
    expect(store.dispatched).toEqual([expect.objectContaining({ kind: 'cmd', cmd: 'split_event', args: expect.objectContaining({ tasks: [] }) })]);
    expect(store.getSnapshot().state.pending).toHaveLength(1);
    expect(materialize(store.getSnapshot().state).tasks!.strój).toMatchObject({ event_id: splitId('ev', '2026-10-07'), occurrence_date: '2026-10-14' });
  });

  it('seria kończy się wcześniej: brak kolejnych terminów', async () => {
    await open();
    await openEvent();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-following'));
    await press(await screen.findByLabelText('Do dnia'));
    await pickDate('event-until', '2026-10-07');
    await press(screen.getByTestId('event-save'));
    // „To i następne” od pierwszego wystąpienia = cała seria; kończy się dziś.
    expect(await screen.findByText('Najbliższe terminy po zmianie: dziś.')).toBeTruthy();
  });
});

describe('dodaj do kalendarza iPhone’a (D7)', () => {
  it('zapisane, brak zgody, rezygnacja', async () => {
    const add = jest.fn(async () => 'saved' as const);
    await open(base(), { calendar: { add } });
    await openEvent();
    await press(screen.getByTestId('event-calendar'));
    expect(await screen.findByText('Dodano do kalendarza.')).toBeTruthy();
    expect(add).toHaveBeenCalledWith({ title: 'Tańce', start: new Date(Date.UTC(2026, 9, 7, 15, 0)), end: new Date(Date.UTC(2026, 9, 7, 16, 0)), allDay: false, notes: 'Rodzina\n\nDodane przez aplikację Organizer' });
    add.mockResolvedValueOnce('denied' as never);
    await press(screen.getByTestId('event-calendar'));
    expect(await screen.findByText(/Brak zgody na dodawanie do kalendarza/)).toBeTruthy();
    add.mockResolvedValueOnce('canceled' as never);
    await press(screen.getByTestId('event-calendar'));
    expect(screen.queryByText(/Brak zgody/)).toBeNull();
  });
});

describe('na każde spotkanie w serii (D65)', () => {
  it('definicja + kopie na najbliższe tygodnie (osobne zadanie na każde spotkanie), zakończenie', async () => {
    const b = base();
    delete b.tasks!.strój;
    const { store } = await open(b);
    await openEvent();
    await press(screen.getByLabelText('Na każdy termin w serii'));
    await type(screen.getByTestId('quick-add'), 'Spakować strój');
    await press(screen.getByLabelText('Dodaj'));
    const def = store.dispatched.find((o) => o.kind === 'create' && o.entity === 'event_task_series') as Extract<NewOp, { kind: 'create' }>;
    expect(def).toMatchObject({ group_id: 'gf', set: { event_id: 'ev', list_id: 'lf', title: 'Spakować strój' } });
    const copies = store.dispatched.filter((o) => o.kind === 'create' && o.entity === 'tasks') as Extract<NewOp, { kind: 'create' }>[];
    expect(copies).toHaveLength(8);
    expect(copies.map((o) => o.set.occurrence_date).slice(0, 2)).toEqual(['2026-10-07', '2026-10-14']);
    expect(new Set(copies.map((o) => o.id)).size).toBe(8);
    expect(await screen.findByTestId(`event-task-${copies[0]!.id}`)).toBeTruthy();
    expect(screen.getByText('Na każdy termin w serii (osobne zadanie na każdy):')).toBeTruthy();
    const n = store.dispatched.length;
    await press(screen.getByLabelText('Zakończ: Spakować strój'));
    expect(store.dispatched[n]).toEqual({ kind: 'delete', entity: 'event_task_series', id: def.id });
    expect(store.dispatched.slice(n + 1)).toHaveLength(8);
    expect(screen.queryByText('Na każdy termin w serii (osobne zadanie na każdy):')).toBeNull();
  });

  it('jednorazowe spotkanie: bez wyboru „jak często”', async () => {
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('day-2026-10-09'));
    await press(screen.getByTestId('cal-event-ev2-2026-10-09'));
    await screen.findByTestId('screen-event');
    expect(screen.queryByLabelText('Jak często')).toBeNull();
  });
});
