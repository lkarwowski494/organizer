/**
 * Wydarzenia przez prawdziwą nawigację: dodanie serii z dwoma terminami (pon. 18:00 i sob. 12:00), zmiana jednego
 * wystąpienia, „to i następne”, „wszystkie”, odwołanie, usunięcie jednorazowego, Moje sprawy, kalendarz, grupa.
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import type { NewOp, Row } from '../../domain/sync-engine/client';
import { splitId } from '../../domain/event-split';
import { overrideId, participantId } from '../../domain/views/events';
import { RootStack } from '../navigation';
import { put, sampleBase, setup , pickDate, setTime } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const type = (el: Parameters<typeof fireEvent.changeText>[0], text: string) => fireEvent.changeText(el, text);

function event(base: ReturnType<typeof sampleBase>, id: string, extra: Row = {}) {
  put(base, 'events', id, { id, group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', deleted_at: null, version: 1, ...extra });
}
/** Seria w środy 17:00 dla Kuby (dziecko) — dotyczy mnie jako dorosłego (D58). */
function withDances() {
  const base = sampleBase();
  event(base, 'ev-tance');
  put(base, 'event_participants', 'p1', { id: 'p1', event_id: 'ev-tance', group_id: 'gf', member_id: 'kuba', deleted_at: null, version: 1 });
  return base;
}
async function open(base = withDances()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
const created = (ops: NewOp[], entity: string) => ops.filter((o) => o.kind === 'create' && o.entity === entity) as Extract<NewOp, { kind: 'create' }>[];

describe('Wydarzenia: dodawanie', () => {
  it('scenariusz właściciela: tańce Kuby w poniedziałki 18:00 i soboty 12:00 — dwie serie, jeden zapis', async () => {
    const { store } = await open(sampleBase());
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    await press(screen.getByLabelText('Rodzina'));
    await type(screen.getByTestId('event-title'), 'Tańce Kuby');
    await press(screen.getByLabelText('Co tydzień'));
    expect(screen.getByLabelText('W środę').props.accessibilityState.checked).toBe(true); // dzień z kalendarza
    await press(screen.getByLabelText('W środę'));
    await press(screen.getByLabelText('W poniedziałek'));
    await setTime('event-start-0', '18:00');
    await setTime('event-end-0', '19:00');
    await press(screen.getByTestId('event-add-slot'));
    await press(screen.getByLabelText('W sobotę (Termin 2)'));
    await setTime('event-start-1', '12:00');
    await press(screen.getByLabelText('Wybrane osoby'));
    await press(screen.getByLabelText('Uczestnik: Kuba'));
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByTestId('screen-calendar')).toBeTruthy();
    const ops = store.dispatched;
    expect(created(ops, 'events').map((o) => o.set)).toEqual([
      { title: 'Tańce Kuby', start_date: '2026-10-12', start_time: '18:00', end_time: '19:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'members', responsible_member_id: null },
      { title: 'Tańce Kuby', start_date: '2026-10-10', start_time: '12:00', end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=SA', audience: 'members', responsible_member_id: null },
    ]);
    expect(created(ops, 'event_participants').map((o) => o.set.member_id)).toEqual(['kuba', 'kuba']);
    expect(created(ops, 'events').every((o) => o.group_id === 'gf')).toBe(true);
    // Sobota 10.10 w kalendarzu: wydarzenie z linią grupy.
    await press(screen.getByTestId('day-2026-10-10'));
    expect(screen.getByLabelText('Tańce Kuby, 12:00, Rodzina, powtarza się')).toBeTruthy();
    expect(screen.getByTestId('day-2026-10-12').props.accessibilityLabel).toMatch(/1 wydarzenie/);
  });

  it('błędy formularza: nazwa, godzina, dni, uczestnicy; usunięcie terminu; cały dzień', async () => {
    const { store } = await open(sampleBase());
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await press(await screen.findByTestId('event-save'));
    expect(screen.getByText('Wpisz nazwę wydarzenia.')).toBeTruthy();
    await type(screen.getByTestId('event-title'), 'Basen');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Sprawdź godzinę (GG:MM).')).toBeTruthy();
    await setTime('event-start-0', '7:00');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Sprawdź godzinę (GG:MM).')).toBeTruthy();
    await press(screen.getByLabelText('Co tydzień'));
    await setTime('event-start-0', '07:00');
    await press(screen.getByTestId('event-add-slot'));
    await setTime('event-start-1', '08:00');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Wybierz co najmniej jeden dzień tygodnia.')).toBeTruthy();
    await press(screen.getByLabelText('Usuń termin 2'));
    expect(screen.queryByTestId('event-start-1')).toBeNull();
    // Audyt 2 (P-53): w grupie osobistej bez „Kogo dotyczy”.
    expect(screen.queryByLabelText('Wybrane osoby')).toBeNull();
    await press(screen.getByLabelText('Rodzina'));
    await press(screen.getByLabelText('Wybrane osoby'));
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Wybierz co najmniej jedną osobę.')).toBeTruthy();
    expect(store.dispatched).toHaveLength(0);
    // Z powrotem w grupie osobistej: wybór „Wybrane osoby” z Rodziny nie blokuje zapisu (zawsze cała grupa).
    await press(screen.getByLabelText('Osobiste'));
    expect(screen.queryByLabelText('Cała grupa')).toBeNull();
    await press(screen.getByLabelText('Cały dzień'));
    expect(screen.queryByTestId('event-start-0')).toBeNull();
    await press(screen.getByLabelText('Do dnia'));
    await pickDate('event-until', '2026-10-01');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText(/Ostatni dzień musi być/)).toBeTruthy();
    await pickDate('event-until', '2026-12-31');
    await type(screen.getByTestId('event-interval'), '2');
    await press(screen.getByTestId('event-save'));
    expect(created(store.dispatched, 'events')[0]!.set).toMatchObject({ title: 'Basen', start_date: '2026-10-07', start_time: null, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20261231', audience: 'group' });
    expect(created(store.dispatched, 'events')[0]!.group_id).toBe('u-me'); // domyślnie pierwsza grupa: osobista
  });

  it('co miesiąc: warianty dnia zależne od daty', async () => {
    const { store } = await open(sampleBase());
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(screen.getByText(/Brak wydarzeń/)).toBeTruthy();
    await press(screen.getByTestId('group-add-event'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.queryByLabelText('Grupa')).toBeTruthy(); // wybór grupy, podpowiedziana Rodzina
    expect(screen.getByLabelText('Rodzina').props.accessibilityState.selected).toBe(true);
    await type(screen.getByTestId('event-title'), 'Zebranie');
    await setTime('event-start-0', '19:00');
    await press(screen.getByLabelText('Co miesiąc'));
    await pickDate('event-date', '2026-10-28');
    expect(screen.getByLabelText('28. dnia')).toBeTruthy();
    expect(screen.getByLabelText('4. środa')).toBeTruthy();
    await press(screen.getByLabelText('ostatnia środa'));
    await pickDate('event-date', '2026-10-30');
    expect(screen.queryByLabelText('5. piątek')).toBeNull();
    expect(screen.getByLabelText('ostatni piątek')).toBeTruthy();
    await pickDate('event-date', '2026-10-05');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Ten wariant nie pasuje do wybranego dnia.')).toBeTruthy();
    await press(screen.getByLabelText('1. poniedziałek'));
    await press(screen.getByTestId('event-save'));
    expect(created(store.dispatched, 'events')[0]!.set).toMatchObject({ rrule: 'FREQ=MONTHLY;BYDAY=1MO', start_date: '2026-10-05' });
    expect(await screen.findByTestId('series-new-1')).toBeTruthy();
    expect(screen.getByLabelText(/Zebranie, Co miesiąc, w 1. poniedziałek · 19:00 · najbliżej: pon. 2 lis/i)).toBeTruthy();
  });
});

describe('Wydarzenia: zmiana i odwołanie (D57)', () => {
  async function openDances() {
    const s = await open();
    expect(screen.getByLabelText('Tańce, 17:00–18:00, 1 h, Rodzina, powtarza się')).toBeTruthy(); // dziecko uczestnikiem → dotyczy mnie
    await press(screen.getByTestId('today-event-ev-tance-2026-10-07'));
    await screen.findByTestId('screen-event');
    return s;
  }

  it('szczegóły: kiedy, opis serii, kto', async () => {
    await openDances();
    expect(screen.getByText('Środa, 7 października · 17:00–18:00 · 1 h')).toBeTruthy();
    expect(screen.getByText('Co tydzień: śr.')).toBeTruthy();
    expect(within(screen.getByTestId('screen-event')).getAllByText('Kuba').length).toBeGreaterThan(0);
  });

  it('„tylko to”: przeniesienie na 16:00 — wyjątek, Moje sprawy pokazuje nową godzinę', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByLabelText('Anuluj'));
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-this'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByText('Zmieniasz tylko to jedno wystąpienie.')).toBeTruthy();
    expect(screen.queryByLabelText('Powtarzanie')).toBeNull();
    expect(screen.queryByLabelText('Kogo dotyczy')).toBeNull();
    await setTime('event-start-0', '16:00');
    await setTime('event-end-0', '17:00');
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    const oid = overrideId('ev-tance', '2026-10-07');
    expect(store.dispatched).toEqual([
      { kind: 'create', entity: 'event_overrides', id: oid, group_id: 'gf', set: { event_id: 'ev-tance', occurrence_date: '2026-10-07', start_date: null, start_time: '16:00', end_time: '17:00', title: null, responsible_member_id: null, cancelled: false } },
      { kind: 'patch', entity: 'event_overrides', id: oid, set: { start_time: '16:00', end_time: '17:00' } },
    ]);
    expect(screen.getByLabelText('Tańce, 16:00–17:00, 1 h, Rodzina, powtarza się')).toBeTruthy();
  });

  it('D136: „tylko to” na cały dzień — znacznik w wyjątku, w Moich sprawach bez godziny', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-this'));
    await screen.findByTestId('screen-event-edit');
    await press(screen.getByLabelText('Cały dzień'));
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(store.dispatched[0]).toEqual(expect.objectContaining({ kind: 'create', entity: 'event_overrides', set: expect.objectContaining({ start_time: null, end_time: null, all_day: true }) }));
    expect(screen.getByLabelText(/^Tańce, cały dzień, Rodzina/)).toBeTruthy();
  });

  it('„tylko to”: dalej niż 62 dni — błąd, nic nie zapisane (audyt 8.10.2026)', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-this'));
    await screen.findByTestId('screen-event-edit');
    await pickDate('event-date', '2026-12-31');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText(/najwyżej o 62 dni/)).toBeTruthy();
    expect(store.dispatched).toEqual([]);
  });

  it('„tylko to”: przeniesienie na jutro — w szczegółach widać skąd przeniesione', async () => {
    await openDances();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-this'));
    await screen.findByTestId('event-date');
    await pickDate('event-date', '2026-10-08');
    await press(screen.getByTestId('event-save'));
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Następny dzień'));
    await press(screen.getByTestId('today-event-ev-tance-2026-10-07'));
    expect(await screen.findByText('Czwartek, 8 października · 17:00–18:00 · 1 h')).toBeTruthy();
    expect(screen.getByText('Przeniesione z: Środa, 7 października')).toBeTruthy();
  });

  it('„to i następne”: od dziś 18:00 — stara seria kończy się wczoraj, nowa z uczestnikiem, jeden zapis', async () => {
    const base = withDances();
    event(base, 'ev-tance', { start_date: '2026-09-02' });
    const { store } = await open(base);
    await press(screen.getByTestId('today-event-ev-tance-2026-10-07'));
    await press(await screen.findByTestId('event-edit'));
    await press(screen.getByTestId('scope-following'));
    expect(await screen.findByText('Zmieniasz to wystąpienie i wszystkie następne. Pierwsze zmienione: Środa, 7 października.')).toBeTruthy();
    // Audyt 2 (E-6): nowa seria zaczyna się od tego wystąpienia — bez pola „Od dnia”, które i tak było pomijane.
    expect(screen.queryByTestId('event-date')).toBeNull();
    await setTime('event-start-0', '18:00');
    await setTime('event-end-0', '');
    await press(screen.getByTestId('event-save'));
    // Podgląd skutków przed zapisem serii.
    expect(await screen.findByText('Najbliższe terminy po zmianie: dziś, śr. 14 paź, śr. 21 paź.')).toBeTruthy();
    expect(store.dispatched).toHaveLength(0);
    await press(screen.getByTestId('event-preview-save'));
    await screen.findByTestId('screen-today');
    // Audyt 2 (M-3): jedno polecenie split_event — serwer wykonuje je w całości albo wcale, telefon od razu u siebie.
    const sid = splitId('ev-tance', '2026-10-07');
    expect(store.dispatched).toEqual([
      {
        kind: 'cmd',
        cmd: 'split_event',
        args: {
          id: sid,
          event_id: 'ev-tance',
          date: '2026-10-07',
          set: { title: 'Tańce', start_date: '2026-10-07', start_time: '18:00', end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', responsible_member_id: null, location: null },
          participants: [{ id: participantId(sid, 'kuba'), member_id: 'kuba' }],
          drop_overrides: [],
          tasks: [],
        },
      },
    ]);
    expect(screen.getByLabelText('Tańce, 18:00, Rodzina, powtarza się')).toBeTruthy();
  });

  it('„wszystkie”: zmiana dnia na czwartek — Moje sprawy: jutro', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-edit'));
    await press(screen.getByTestId('scope-all'));
    expect(await screen.findByText('Zmieniasz wszystkie wystąpienia w serii.')).toBeTruthy();
    expect(screen.queryByTestId('event-date')).toBeNull();
    expect(screen.queryByTestId('event-add-slot')).toBeNull();
    await press(screen.getByLabelText('W środę'));
    await press(screen.getByLabelText('W czwartek'));
    await press(screen.getByTestId('event-save'));
    await screen.findByTestId('screen-event-preview');
    await press(screen.getByLabelText('Wróć do edycji'));
    await press(await screen.findByTestId('event-save'));
    await press(await screen.findByTestId('event-preview-save'));
    await screen.findByTestId('screen-today');
    expect(store.dispatched[0]).toEqual({ kind: 'patch', entity: 'events', id: 'ev-tance', set: { title: 'Tańce', start_date: '2026-10-08', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=TH', audience: 'members', responsible_member_id: null } });
    await press(screen.getByLabelText('Następny dzień'));
    expect(screen.getByTestId('today-event-ev-tance-2026-10-08')).toBeTruthy();
  });

  it('odwołanie: tylko to; to i następne', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-cancel'));
    expect(screen.getByText('Co odwołać?')).toBeTruthy();
    await press(screen.getByTestId('scope-this'));
    await screen.findByTestId('screen-today');
    const oid = overrideId('ev-tance', '2026-10-07');
    expect(store.dispatched).toEqual([
      { kind: 'create', entity: 'event_overrides', id: oid, group_id: 'gf', set: { event_id: 'ev-tance', occurrence_date: '2026-10-07', start_date: null, start_time: null, end_time: null, title: null, responsible_member_id: null, cancelled: true } },
      { kind: 'patch', entity: 'event_overrides', id: oid, set: { cancelled: true } },
    ]);
    expect(screen.queryByTestId('today-event-ev-tance-2026-10-07')).toBeNull();
    // Audyt 8.10.2026: „Cofnij” przywraca termin (usunięcie utworzonego wyjątku — bez zmiany pól na null).
    expect(screen.getByText('Odwołano: Tańce')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij'));
    expect(store.dispatched.slice(2)).toEqual([{ kind: 'delete', entity: 'event_overrides', id: oid }]);
    expect(await screen.findByTestId('today-event-ev-tance-2026-10-07')).toBeTruthy();
  });

  it('audyt 2 (E-18): termin odwołany na innym telefonie — informacja i „Przywróć termin”; bez zadań i kalendarza', async () => {
    const s = await openDances();
    expect(screen.getByTestId('event-calendar')).toBeTruthy();
    expect(screen.getByTestId('quick-add')).toBeTruthy();
    await act(async () => s.store.pull((b) => ({ ...b, event_overrides: { ...b.event_overrides, ov1: { id: 'ov1', event_id: 'ev-tance', group_id: 'gf', occurrence_date: '2026-10-07', cancelled: true, deleted_at: null, version: 2 } } })));
    expect(screen.getByText('Ten termin jest odwołany.')).toBeTruthy();
    expect(screen.queryByTestId('event-calendar')).toBeNull();
    expect(screen.queryByTestId('quick-add')).toBeNull();
    await press(screen.getByRole('button', { name: 'Przywróć termin' }));
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'event_overrides', id: 'ov1', set: { cancelled: false } }]);
    expect(screen.queryByText('Ten termin jest odwołany.')).toBeNull();
    expect(screen.getByTestId('event-calendar')).toBeTruthy();
  });

  it('audyt 2 (E-18): termin, którego seria już nie ma (zmiana na innym telefonie) — informacja, bez zmiany i odwołania', async () => {
    const s = await openDances();
    await act(async () => s.store.pull((b) => ({ ...b, events: { ...b.events, 'ev-tance': { ...b.events!['ev-tance']!, start_date: '2026-10-08', rrule: 'FREQ=WEEKLY;BYDAY=TH', version: 2 } } })));
    expect(screen.getByText('Tego terminu nie ma już w serii (zmieniła się albo skończyła).')).toBeTruthy();
    expect(screen.queryByTestId('event-edit')).toBeNull();
    expect(screen.queryByTestId('event-cancel')).toBeNull();
    expect(screen.queryByTestId('event-calendar')).toBeNull();
    expect(screen.queryByTestId('quick-add')).toBeNull();
  });

  it('audyt 2 (E-7): „wszystkie” na „nie powtarza się” — dzień otwartego terminu, nie pierwszy dzień serii; wyjątki przepadają', async () => {
    const base = withDances();
    event(base, 'ev-tance', { start_date: '2026-09-02' });
    put(base, 'event_overrides', 'ov1', { id: 'ov1', event_id: 'ev-tance', group_id: 'gf', occurrence_date: '2026-10-14', title: 'Pokaz', cancelled: false, deleted_at: null, version: 1 });
    const { store } = await open(base);
    await press(screen.getByTestId('today-event-ev-tance-2026-10-07'));
    await press(await screen.findByTestId('event-edit'));
    await press(screen.getByTestId('scope-all'));
    expect(screen.queryByTestId('event-date')).toBeNull();
    await press(await screen.findByLabelText('Nie powtarza się'));
    expect(screen.getByTestId('event-date')).toBeTruthy();
    await press(screen.getByTestId('event-save'));
    await screen.findByTestId('screen-event-preview');
    // Audyt 2 (E-20): podgląd mówi, ile zmienionych pojedynczo terminów przepada.
    expect(screen.getByText('Zmienione pojedynczo terminy, których po zmianie nie będzie: 1. Ich zmiany przepadną.')).toBeTruthy();
    await press(screen.getByTestId('event-preview-save'));
    await screen.findByTestId('screen-today');
    expect(store.dispatched[0]).toMatchObject({ kind: 'patch', entity: 'events', id: 'ev-tance', set: { start_date: '2026-10-07', rrule: null } });
    expect(store.dispatched).toContainEqual({ kind: 'delete', entity: 'event_overrides', id: 'ov1' });
    expect(screen.getByTestId('today-event-ev-tance-2026-10-07')).toBeTruthy();
  });

  it('usunięcie jednorazowego: pasek mówi „Usunięto”, nie „Odwołano” (audyt 2, U-17)', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev-raz', { id: 'ev-raz', group_id: 'gf', title: 'Wizyta', start_date: '2026-10-07', start_time: '16:00:00', end_time: null, rrule: null, audience: 'group', deleted_at: null, version: 1 });
    const s2 = setup({ base });
    await s2.renderApp(<RootStack />);
    await press(await screen.findByTestId('today-event-ev-raz-2026-10-07'));
    await screen.findByTestId('screen-event');
    await press(screen.getByTestId('event-cancel'));
    await screen.findByTestId('screen-today');
    expect(screen.getByText('Usunięto: Wizyta')).toBeTruthy();
  });

  it('odwołanie od pierwszego wystąpienia = usunięcie serii', async () => {
    const { store } = await openDances();
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByTestId('scope-following'));
    await screen.findByTestId('screen-today');
    expect(store.dispatched).toEqual([{ kind: 'delete', entity: 'events', id: 'ev-tance' }]);
    await press(screen.getByLabelText('Cofnij'));
    expect(store.dispatched.at(-1)).toEqual({ kind: 'restore', entity: 'events', id: 'ev-tance' });
  });

  it('jednorazowe: zmiana bez pytania o zakres, usunięcie bez pytania (D187)', async () => {
    const base = sampleBase();
    event(base, 'ev-1', { rrule: null, audience: 'group', title: 'Wywiadówka', start_time: null, end_time: null });
    const { store } = await open(base);
    expect(screen.getByLabelText('Wywiadówka, cały dzień, Rodzina')).toBeTruthy();
    await press(screen.getByTestId('today-event-ev-1-2026-10-07'));
    expect(await screen.findByText('Jednorazowe')).toBeTruthy();
    expect(screen.getByText('Cała grupa')).toBeTruthy();
    await press(screen.getByTestId('event-edit'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.queryByText(/Zmieniasz/)).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('event-cancel'));
    await screen.findByTestId('screen-today');
    expect(store.dispatched).toEqual([{ kind: 'delete', entity: 'events', id: 'ev-1' }]);
    expect(screen.queryByTestId('today-event-ev-1-2026-10-07')).toBeNull();
  });
});

describe('Wydarzenia: widoczność i uprawnienia', () => {
  it('dziecko w grupie: tylko podgląd; brak wydarzenia; brak grup dla nowego', async () => {
    const base = withDances();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'child' };
    event(base, 'ev-all', { audience: 'group', title: 'Obiad', rrule: null, start_time: '13:00:00', end_time: null });
    const s = setup({ base });
    await s.renderApp(<RootStack />);
    await press(await screen.findByTestId('today-event-ev-all-2026-10-07'));
    expect(await screen.findByText('Dzieci nie zmieniają wydarzeń.')).toBeTruthy();
    expect(screen.queryByTestId('event-edit')).toBeNull();
    expect(screen.queryByTestId('today-event-ev-tance-2026-10-07')).toBeNull(); // zajęcia innego dziecka nie dotyczą dziecka
  });

  it('kalendarz: wszystkie wydarzenia z moich grup (także cudze), z kropką przy dniu', async () => {
    const base = sampleBase();
    event(base, 'ev-ala', { title: 'Ala: lekarz', rrule: null });
    put(base, 'event_participants', 'pa', { id: 'pa', event_id: 'ev-ala', group_id: 'gf', member_id: 'ala', deleted_at: null, version: 1 });
    await open(base);
    expect(screen.queryByTestId('today-event-ev-ala-2026-10-07')).toBeNull();
    await press(screen.getByLabelText('Kalendarz'));
    const day = await screen.findByTestId('day-2026-10-07');
    expect(day.props.accessibilityLabel).toMatch(/1 wydarzenie, 3 zadania/);
    expect(within(screen.getByTestId('cal-event-ev-ala-2026-10-07')).getByText('Ala: lekarz')).toBeTruthy();
    await press(screen.getByTestId('cal-event-ev-ala-2026-10-07'));
    expect(await screen.findByText('Ala')).toBeTruthy();
  });

  it('grupa: lista serii z opisem i najbliższym terminem; zakończona; otwarcie', async () => {
    const base = withDances();
    event(base, 'ev-old', { title: 'Stare zajęcia', rrule: 'FREQ=WEEKLY;BYDAY=WE;UNTIL=20260930', start_date: '2026-09-02', audience: 'group' });
    await open(base);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(screen.getByLabelText('Tańce, Co tydzień: śr. · 17:00–18:00 · najbliżej: dziś')).toBeTruthy();
    expect(screen.getByLabelText(/Stare zajęcia, Co tydzień: śr., do 30.09.2026 · 17:00–18:00 · zakończone/)).toBeTruthy();
    await press(screen.getByTestId('series-ev-old'));
    expect(await screen.findByText('Środa, 2 września · 17:00–18:00 · 1 h')).toBeTruthy();
  });

  it('audyt 2 (E-19): grupa — najbliższy termin po przeniesieniu; otwarcie pokazuje ten termin', async () => {
    const base = withDances();
    put(base, 'event_overrides', 'ov1', { id: 'ov1', event_id: 'ev-tance', group_id: 'gf', occurrence_date: '2026-10-07', start_date: '2026-10-08', cancelled: false, deleted_at: null, version: 1 });
    await open(base);
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('group-gf'));
    expect(screen.getByLabelText('Tańce, Co tydzień: śr. · 17:00–18:00 · najbliżej: jutro')).toBeTruthy();
    await press(screen.getByTestId('series-ev-tance'));
    expect(await screen.findByText('Czwartek, 8 października · 17:00–18:00 · 1 h')).toBeTruthy();
  });

  it('wydarzenie usunięte w międzyczasie: komunikat błędu', async () => {
    const s = setup({ base: withDances() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await press(screen.getByTestId('today-event-ev-tance-2026-10-07'));
    await screen.findByTestId('screen-event');
    // Wydarzenie usunięte w międzyczasie (np. przez inną osobę).
    s.store.dispatch({ kind: 'delete', entity: 'events', id: 'ev-tance' });
    expect(await screen.findByTestId('screen-event-missing')).toBeTruthy();
  });
});

describe('osoba odpowiedzialna (D66)', () => {
  it('wybór dorosłego (bez dzieci); „Moje sprawy” tylko u niego; w szczegółach widać kto', async () => {
    const { store } = await open(sampleBase());
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await press(await screen.findByLabelText('Rodzina'));
    await type(screen.getByTestId('event-title'), 'Logopeda');
    await setTime('event-start-0', '18:00');
    expect(screen.getByLabelText('Osoba odpowiedzialna')).toBeTruthy();
    expect(within(screen.getByLabelText('Osoba odpowiedzialna')).queryByLabelText('Kuba')).toBeNull();
    await press(within(screen.getByLabelText('Osoba odpowiedzialna')).getByLabelText('Ala'));
    await press(screen.getByTestId('event-save'));
    expect(created(store.dispatched, 'events')[0]!.set).toMatchObject({ title: 'Logopeda', responsible_member_id: 'ala' });
    await press(screen.getByLabelText('Dziś'));
    expect(screen.queryByText('Logopeda')).toBeNull(); // odpowiada Ala — nie u mnie
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText(/^Logopeda, 18:00/));
    expect(await screen.findByText('Osoba odpowiedzialna: Ala')).toBeTruthy();
  });

  it('grupa osobista: bez wyboru osoby', async () => {
    await open(sampleBase());
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.queryByLabelText('Osoba odpowiedzialna')).toBeNull();
  });
});
