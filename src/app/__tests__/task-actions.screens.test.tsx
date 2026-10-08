/**
 * Odhaczanie z potwierdzeniem (D59), usuwanie przesunięciem z „Cofnij” (D60) i kolejność dnia
 * (całodniowe na górze, potem godziny — wydarzenia przemieszane z zadaniami).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { Alert } from 'react-native';

import { config } from '../../config';
import { nextId } from '../../domain/views/task-repeat';
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
  it('Moje sprawy: całodniowe na górze, potem godziny po kolei, wydarzenia między zadaniami', async () => {
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
    expect(ids(/^cal-(?!gap)/)).toEqual(['cal-event-evAll-2026-10-07', 'cal-t-all', 'cal-t-ala', 'cal-event-ev17-2026-10-07', 'cal-t-korki', 'cal-t-paczka', 'cal-event-ev19-2026-10-07']);
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
    await press(screen.getAllByLabelText('Dziś')[0]!);
    await press(await screen.findByLabelText('Następny dzień'));
    await press(await screen.findByLabelText(/^Otwórz:\ Kupić\ kwiaty(,|$)/));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Oznacz jako zrobione: Wybrać tulipany'));
    await answerAlert('Anuluj');
    await press(screen.getByLabelText('Oznacz jako zrobione: Kupić kwiaty'));
    // Z niezrobionym podzadaniem — pytanie z wyborem (decyzja właściciela z 8.10.2026).
    expect(lastAlert().message).toBe('Kupić kwiaty: zostało 1 niezrobione podzadanie.');
    await answerAlert('Zostaw podzadania');
    expect(store.dispatched.at(-1)).toMatchObject({ id: 't-kwiaty', set: { completed_at: expect.any(String) } });
    const n = (Alert.alert as unknown as jest.Mock).mock.calls.length;
    await press(screen.getByLabelText('Oznacz jako niezrobione: Kupić kwiaty'));
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
      await press(screen.getByLabelText('Usuń: Przynieść korki na trening'));
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
    // D187: lista z zadaniami — jedno pytanie z ich liczbą.
    expect(lastAlert().title).toBe('Usunąć listę „Dom” i 3 zadania? Wrócą razem z listą, jeśli przywrócisz ją z kosza.');
    await answerAlert('Usuń listę');
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

describe('Kalendarz = co było zaplanowane (D135)', () => {
  it('zrobione zadanie zostaje w swoim dniu, odhaczone', async () => {
    const base = sampleBase();
    put(base, 'tasks', 't-paczka', { ...base.tasks!['t-paczka']!, completed_at: '2026-10-07T06:00:00Z' });
    await open(base);
    await press(screen.getByLabelText('Kalendarz'));
    await screen.findByTestId('screen-calendar');
    expect(screen.getByLabelText(/^Oznacz jako niezrobione: Odebrać paczkę/)).toBeTruthy();
  });
});

describe('rolowanie (D61) i miniony dzień', () => {
  it('zaległe dziś na czerwono z liczbą dni; „Tylko tego dnia” mija i trafia na liście do zrobionych z dopiskiem', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'stare', { ...base.tasks!['t-books']!, id: 'stare', title: 'Zapłacić rachunek', deadline_mode: 'own', due_date: '2026-10-04' });
    put(base, 'tasks', 'życzenia', { ...base.tasks!['t-books']!, id: 'życzenia', title: 'Złożyć życzenia', deadline_mode: 'own', due_date: '2026-10-06', rollover: false });
    await open(base);
    expect(within(screen.getByTestId('today-stare')).getByText('zaległe od 3 dni')).toBeTruthy();
    expect(screen.queryByText('Złożyć życzenia')).toBeNull();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lp'));
    expect(within(await screen.findByTestId('task-życzenia')).getByText(/minęło/)).toBeTruthy();
  });

  it('wczoraj: odhaczone tego dnia i wyszarzone wydarzenia; odhaczone można cofnąć bez pytania', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'zrobione', { ...base.tasks!['t-books']!, id: 'zrobione', title: 'Wynieść śmieci', deadline_mode: 'own', due_date: '2026-10-06', completed_at: '2026-10-06T16:00:00Z' });
    put(base, 'events', 'evW', { id: 'evW', group_id: 'gf', title: 'Logopeda', start_date: '2026-10-06', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
    const { store } = await open(base);
    await press(screen.getByLabelText('Poprzedni dzień'));
    expect(screen.getByText(/Minęło: zrobione i wydarzenia/)).toBeTruthy();
    expect(screen.getByLabelText('Logopeda, 18:00, Rodzina')).toBeTruthy();
    // Audyt 2 (M-124): zrobione też przesuwa się do usunięcia — jak na liście i w Kalendarzu.
    expect(screen.getByLabelText('Usuń: Wynieść śmieci')).toBeTruthy();
    await press(screen.getByLabelText('Oznacz jako niezrobione: Wynieść śmieci'));
    expect(store.dispatched.at(-1)).toMatchObject({ id: 'zrobione', set: { completed_at: null } });
  });

  it('zadanie: „Tylko tego dnia” / „Przechodzi na kolejne dni”; bez terminu i na spotkaniu — brak wyboru', async () => {
    const { store } = await open();
    await press(screen.getByLabelText(/^Otwórz:\ Odebrać\ paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.getByLabelText('Przechodzi na kolejne dni').props.accessibilityState.selected).toBe(true);
    await press(screen.getByLabelText('Tylko tego dnia'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { rollover: false } });
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText(/^Otwórz:\ Oddać\ książki\ do\ biblioteki(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByLabelText('Tylko tego dnia')).toBeNull();
  });
});

describe('adresat we wspólnej grupie (D68)', () => {
  it('PW-18 b: dodanie bez osoby i terminu zapisuje od razu, bez pytania; wiersz mówi, że nikt tego nie widzi w Moich sprawach', async () => {
    const { store } = await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await fireEvent.changeText(await screen.findByTestId('quick-add'), 'nowy odkurzacz');
    await press(screen.getByLabelText('Dodaj'));
    expect(screen.queryByTestId('addressee-ask')).toBeNull();
    const created = store.dispatched.at(-1) as { id: string };
    expect(created).toMatchObject({ kind: 'create', set: { title: 'nowy odkurzacz', deadline_mode: 'none' } });
    expect(within(await screen.findByTestId(`task-${created.id}`)).getByText('bez osoby i terminu — nikt tego nie widzi w „Moich sprawach”')).toBeTruthy();
    // Z terminem w tekście — bez dopisku; pusty tekst — nic.
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'chleb jutro');
    await press(screen.getByLabelText('Dodaj'));
    const dated = store.dispatched.at(-1) as { id: string };
    expect(within(await screen.findByTestId(`task-${dated.id}`)).queryByText(/nikt tego nie widzi/)).toBeNull();
    const n = store.dispatched.length;
    await fireEvent.changeText(screen.getByTestId('quick-add'), '  ');
    await press(screen.getByLabelText('Dodaj'));
    expect(store.dispatched).toHaveLength(n);
  });

  it('audyt 2 (T-15): przypięte zadanie osoby usuniętej z grupy (D132) i zadanie odwołanego spotkania (D14) — ostrzeżenie, nie ciche zniknięcie', async () => {
    const base = sampleBase();
    put(base, 'group_members', 'ala', { ...base.group_members!.ala!, deleted_at: '2026-10-06T08:00:00Z' });
    put(base, 'tasks', 'rower', { ...base.tasks!['t-kwiaty']!, id: 'rower', title: 'Rower do serwisu', assignee_member_id: 'ala', deadline_mode: 'none', due_date: null });
    put(base, 'events', 'zeb', { id: 'zeb', group_id: 'gf', title: 'Zebranie', note: null, start_date: '2026-10-09', start_time: '18:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
    put(base, 'event_overrides', 'zeb-o', { id: 'zeb-o', event_id: 'zeb', group_id: 'gf', occurrence_date: '2026-10-09', cancelled: true, deleted_at: null, version: 1 });
    put(base, 'tasks', 'ciasto', { ...base.tasks!['t-kwiaty']!, id: 'ciasto', title: 'Upiec ciasto', deadline_mode: 'event', due_date: null, event_id: 'zeb', occurrence_date: '2026-10-09' });
    await open(base);
    expect(screen.queryByText('Rower do serwisu')).toBeNull(); // nikt nie ma go w Moich sprawach…
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    // …więc lista mówi to wprost.
    expect(within(await screen.findByTestId('task-rower')).getByText(/bez osoby i terminu/)).toBeTruthy();
    expect(within(screen.getByTestId('task-ciasto')).getByText(/bez osoby i terminu/)).toBeTruthy();
    await press(screen.getByLabelText(/^Otwórz:\ Rower\ do\ serwisu(,|$)/));
    expect(await screen.findByTestId('task-no-addressee')).toBeTruthy();
  });

  it('istniejące zadanie bez adresata: czerwony dopisek na liście i w zadaniu; grupa osobista i zakupy bez pytania', async () => {
    const base = sampleBase();
    put(base, 'tasks', 'rosół', { ...base.tasks!['t-kwiaty']!, id: 'rosół', title: 'Dać dzieciom rosół', deadline_mode: 'none', due_date: null });
    const { store } = await open(base);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    expect(within(await screen.findByTestId('task-rosół')).getByText(/bez osoby i terminu/)).toBeTruthy();
    await press(screen.getByLabelText(/^Otwórz:\ Dać\ dzieciom\ rosół(,|$)/));
    expect(await screen.findByTestId('task-no-addressee')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Wróć'));
    await press(await screen.findByTestId('list-lz'));
    await fireEvent.changeText(await screen.findByTestId('quick-add'), 'masło');
    await press(screen.getByLabelText('Dodaj'));
    expect(screen.queryByTestId('addressee-ask')).toBeNull();
    expect(store.dispatched.at(-1)).toMatchObject({ set: { title: 'masło' } });
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('list-lp'));
    await fireEvent.changeText(await screen.findByTestId('quick-add'), 'książka');
    await press(screen.getByLabelText('Dodaj'));
    expect(screen.queryByTestId('addressee-ask')).toBeNull();
  });
});

describe('odhaczenie zadania z niezrobionymi podzadaniami (decyzja właściciela z 8.10.2026)', () => {
  // Odebrać paczkę (dziś 18:00, moje) z podzadaniami: etykieta (z podzadaniem taśma) i karton — już zrobiony.
  function parcel() {
    const base = sampleBase();
    const sub = (id: string, parent: string, title: string, extra: Record<string, unknown> = {}) =>
      put(base, 'tasks', id, { ...base.tasks!['t-paczka']!, id, parent_id: parent, title, deadline_mode: 'inherit', due_date: null, due_time: null, assignee_member_id: null, ...extra });
    sub('s-etykieta', 't-paczka', 'Wydrukować etykietę');
    sub('s-tasma', 's-etykieta', 'Kupić taśmę');
    sub('s-karton', 't-paczka', 'Złożyć karton', { completed_at: '2026-10-07T07:00:00Z' });
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Zebranie', note: null, start_date: '2026-10-07', start_time: '19:00:00', end_time: null, rrule: null, audience: 'group', responsible_member_id: null, deleted_at: null, version: 1 });
    put(base, 'tasks', 't-ciasto', { ...base.tasks!['t-paczka']!, id: 't-ciasto', title: 'Upiec ciasto', deadline_mode: 'event', due_date: null, due_time: null, event_id: 'ev', occurrence_date: '2026-10-07' });
    sub('s-jajka', 't-ciasto', 'Kupić jajka');
    return base;
  }
  const asks = (title: string, n: string) => {
    expect(lastAlert()).toMatchObject({ title: 'Zrobione?', message: `${title}: ${n}.` });
    expect(lastAlert().buttons.map((b) => b.text)).toEqual(['Anuluj', 'Zostaw podzadania', 'Oznacz wszystko jako zrobione']);
  };

  it('to samo pytanie wszędzie, gdzie się odhacza: Moje sprawy, lista, ekran zadania, Kalendarz, wydarzenie', async () => {
    const { store } = await open(parcel());
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    asks('Odebrać paczkę', 'zostały 2 niezrobione podzadania');
    await answerAlert('Anuluj');
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lf'));
    await press(await screen.findByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    asks('Odebrać paczkę', 'zostały 2 niezrobione podzadania');
    await answerAlert('Anuluj');
    await press(screen.getByLabelText(/^Otwórz:\ Odebrać\ paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    asks('Odebrać paczkę', 'zostały 2 niezrobione podzadania');
    await answerAlert('Anuluj');
    // Podzadanie z własnym podzadaniem pyta tak samo.
    await press(screen.getByLabelText('Oznacz jako zrobione: Wydrukować etykietę'));
    asks('Wydrukować etykietę', 'zostało 1 niezrobione podzadanie');
    await answerAlert('Anuluj');
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Wróć'));
    await press(await screen.findByLabelText('Kalendarz'));
    await press(await screen.findByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    asks('Odebrać paczkę', 'zostały 2 niezrobione podzadania');
    await answerAlert('Anuluj');
    await press(screen.getByTestId('cal-event-ev-2026-10-07'));
    await screen.findByTestId('screen-event');
    await press(screen.getByLabelText('Oznacz jako zrobione: Upiec ciasto'));
    asks('Upiec ciasto', 'zostało 1 niezrobione podzadanie');
    await answerAlert('Anuluj');
    expect(store.dispatched).toEqual([]);
  });

  it('„Oznacz wszystko jako zrobione”: zadanie z niezrobionymi podzadaniami naraz; „Cofnij” przywraca wszystko', async () => {
    const { store } = await open(parcel());
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    await answerAlert('Oznacz wszystko jako zrobione');
    const done = { completed_at: '2026-10-07T08:00:00.000Z' };
    expect(store.dispatched).toEqual(['t-paczka', 's-etykieta', 's-tasma'].map((id) => ({ kind: 'patch', entity: 'tasks', id, set: done })));
    expect(screen.queryByLabelText(/Wydrukować etykietę/)).toBeNull();
    const bar = screen.getByTestId('undo-bar');
    expect(within(bar).getByText('Zrobione: Odebrać paczkę i 2 podzadania')).toBeTruthy();
    await press(within(bar).getByLabelText('Cofnij'));
    expect(store.dispatched.slice(3)).toEqual(['t-paczka', 's-etykieta', 's-tasma'].map((id) => ({ kind: 'patch', entity: 'tasks', id, set: { completed_at: null } })));
    expect(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę')).toBeTruthy();
    // Zrobione wcześniej („Złożyć karton”) zostaje zrobione.
    expect(store.dispatched.some((o) => o.kind === 'patch' && o.id === 's-karton')).toBe(false);
  });

  it('„Zostaw podzadania”: tylko zadanie; powtarzane — następny termin z kopiami podzadań; dziś podzadania jeszcze są', async () => {
    const base = parcel();
    put(base, 'tasks', 't-paczka', { ...base.tasks!['t-paczka']!, repeat: 'FREQ=WEEKLY;BYDAY=WE' });
    const { store } = await open(base);
    await press(screen.getByLabelText('Oznacz jako zrobione: Odebrać paczkę'));
    await answerAlert('Zostaw podzadania');
    expect(store.dispatched[0]).toEqual({ kind: 'patch', entity: 'tasks', id: 't-paczka', set: { completed_at: '2026-10-07T08:00:00.000Z' } });
    const created = store.dispatched.slice(1).map((o) => (o.kind === 'create' ? [o.id, o.set.parent_id, o.set.title, o.set.due_date ?? null] : o.kind));
    expect(created).toEqual([
      [nextId('t-paczka'), null, 'Odebrać paczkę', '2026-10-14'],
      [nextId('s-etykieta'), nextId('t-paczka'), 'Wydrukować etykietę', null],
      [nextId('s-tasma'), nextId('s-etykieta'), 'Kupić taśmę', null],
      [nextId('s-karton'), nextId('t-paczka'), 'Złożyć karton', null],
    ]);
    expect(screen.queryByTestId('undo-bar')).toBeNull(); // pojedyncze odhaczenie — jak dotąd bez paska
    // Niezrobione podzadania zrobionego zadania dziś jeszcze widać (z dopiskiem zadania); od jutra mijają.
    expect(screen.getByLabelText(/^Otwórz: Wydrukować etykietę, .*↳ Odebrać paczkę/)).toBeTruthy();
    await press(screen.getByLabelText('Następny dzień'));
    expect(screen.queryByLabelText(/Wydrukować etykietę/)).toBeNull();
  });
});
