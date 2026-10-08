/**
 * Szkic formularza z „Zapisz” (decyzja właściciela 8.10.2026, D179; audyt 2, M-123): wyjście gestem albo „Wróć”
 * zostawia wpisane pola, ponowne otwarcie je przywraca z „Przywrócono niezapisane zmiany · Odrzuć”.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import { config } from '../../config';
import { draftKey } from '../form-draft';
import { RootStack } from '../navigation';
import { ME, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const NOTE = 'Przywrócono niezapisane zmiany.';

type Form = { name: string; open: () => Promise<void>; field: string; screen: string };
const forms: Form[] = [
  { name: 'nowe zadanie', open: async () => press(screen.getByTestId('add-more')), field: 'form-title', screen: 'screen-add-task' },
  { name: 'nowe wydarzenie', open: async () => (await press(screen.getByLabelText('Kalendarz')), await press(await screen.findByTestId('calendar-add-event'))), field: 'event-title', screen: 'screen-event-edit' },
  { name: 'rutyna', open: async () => (await press(screen.getByLabelText('Kalendarz')), await press(await screen.findByTestId('calendar-add-routine'))), field: 'routine-title', screen: 'screen-routine' },
  { name: 'nowa lista', open: async () => (await press(screen.getByLabelText('Listy')), await press(await screen.findByLabelText('Nowa lista'))), field: 'list-name', screen: 'screen-new-list' },
  { name: 'nowa grupa', open: async () => (await press(screen.getByLabelText('Grupy')), await press(await screen.findByLabelText('Nowa grupa'))), field: 'group-name', screen: 'screen-new-group' },
];

async function start(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('szkic formularza na telefonie (D179)', () => {
  it.each(forms)('$name: „Wróć” zostawia wpisane, ponowne otwarcie przywraca; „Odrzuć” czyści', async (f) => {
    const s = await start();
    await f.open();
    await screen.findByTestId(f.screen);
    expect(screen.queryByText(NOTE)).toBeNull();
    await fireEvent.changeText(screen.getByTestId(f.field), 'Szkic');
    await press(screen.getByLabelText('Wróć'));
    expect(s.store.dispatched).toEqual([]);
    await f.open();
    await screen.findByTestId(f.screen);
    expect(screen.getByTestId(f.field).props.value).toBe('Szkic');
    expect(screen.getByText(NOTE)).toBeTruthy();
    await press(screen.getByLabelText('Odrzuć niezapisane zmiany'));
    expect(screen.getByTestId(f.field).props.value).toBe('');
    expect(screen.queryByText(NOTE)).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await f.open();
    await screen.findByTestId(f.screen);
    expect(screen.queryByText(NOTE)).toBeNull();
    // Szkic jest osobno dla każdego konta na telefonie.
    expect(s.services.local!.load(draftKey(ME, 'task:new'))).toBeNull();
  });

  it('cofnięcie zmiany do wartości z otwarcia usuwa szkic; zapis usuwa szkic', async () => {
    const s = await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Basen');
    expect(s.services.local!.load(draftKey(ME, 'task:new'))).toContain('Basen');
    await fireEvent.changeText(screen.getByTestId('form-title'), '');
    expect(s.services.local!.load(draftKey(ME, 'task:new'))).toBeNull();
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Basen');
    await press(screen.getByTestId('form-save'));
    await screen.findByTestId('screen-today');
    expect(s.services.local!.load(draftKey(ME, 'task:new'))).toBeNull();
    await press(screen.getByTestId('add-more'));
    expect(screen.getByTestId('form-title').props.value).toBe('');
  });

  it('formularz otwarty z wpisanym tekstem („Więcej”) startuje z tekstu, nie ze szkicu', async () => {
    await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Stary szkic');
    await press(screen.getByLabelText('Wróć'));
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Trening jutro');
    await press(screen.getByTestId('add-more'));
    expect(screen.getByTestId('form-title').props.value).toBe('Trening');
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it(`szkic starszy niż ${config.forms.DRAFT_MAX_DAYS} dni przepada`, async () => {
    const s = await start();
    s.services.local!.save(draftKey(ME, 'task:new'), JSON.stringify({ at: s.services.nowMs() - (config.forms.DRAFT_MAX_DAYS * 86_400_000 + 1), changes: { title: 'Dawno' } }));
    await press(screen.getByTestId('add-more'));
    expect(screen.getByTestId('form-title').props.value).toBe('');
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('zmiana wydarzenia: szkic nakłada się na obecne dane tylko w polach, które zmieniłem', async () => {
    const base = sampleBase();
    put(base, 'events', 'e1', { id: 'e1', group_id: 'gf', title: 'Zebranie', note: null, start_date: '2026-10-07', start_time: '18:00:00', end_time: null, rrule: null, until: null, audience: 'group', responsible_member_id: null, location: 'Szkoła', deleted_at: null, version: 1 });
    const s = await start(base);
    await press((await screen.findAllByLabelText(/Zebranie/))[0]!);
    await press(await screen.findByTestId('event-edit'));
    await screen.findByTestId('screen-event-edit');
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Zebranie rodziców');
    await press(screen.getByLabelText('Wróć'));
    // W tym czasie drugi telefon zmienia miejsce (pole, którego nie ruszałem).
    await act(async () => s.store.pull((b) => ({ ...b, events: { ...b.events, e1: { ...b.events!.e1!, location: 'Aula', version: 2 } } })));
    await press(await screen.findByTestId('event-edit'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getByTestId('event-title').props.value).toBe('Zebranie rodziców');
    expect(screen.getByTestId('event-location').props.value).toBe('Aula');
  });

  it('plan lekcji: wpisana lekcja zostaje po wyjściu', async () => {
    await start();
    const openTimetable = async () => {
      await press(screen.getByLabelText('Grupy'));
      await press(await screen.findByLabelText('Rodzina, 3 osoby · admin'));
      await press(await screen.findByLabelText('Kuba, dziecko'));
      await press(await screen.findByTestId('open-timetable'));
      await screen.findByTestId('screen-timetable');
    };
    await openTimetable();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('open-timetable'));
    await screen.findByTestId('screen-timetable');
    expect(screen.getByTestId('lesson-title-0').props.value).toBe('Matematyka');
    expect(screen.getByText(NOTE)).toBeTruthy();
  });
});
