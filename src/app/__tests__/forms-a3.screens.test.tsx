/**
 * Audyt 3, paczka formularzy i szkiców (PK-16, poprawki do buildu 23): szkic z wyborami, których już nie ma (N-32),
 * miniony dzień (N-144), przełącznik „Rodzaj” (N-138), plan lekcji zmieniony w międzyczasie (N-31), „Cofnij” rutyny
 * i planu (N-35), limity długości (N-134), uwaga (N-143), zapis pól przy wyjściu z aplikacji (N-139).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import type { Row } from '../../domain/sync-engine/client';
import { draftKey } from '../form-draft';
import { RootStack } from '../navigation';
import { appStateEvents, ME, sampleBase, setTime, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const DAY = 86_400_000;

async function start(o: Parameters<typeof setup>[0] = {}) {
  const s = setup({ base: sampleBase(), ...o });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
type S = Awaited<ReturnType<typeof start>>;
const creates = (s: S, entity: string) => (s.store.dispatched as { kind: string; entity: string; group_id?: string; set?: Row }[]).filter((o) => o.kind === 'create' && o.entity === entity);
const removeMember = (s: S, id: string) => act(async () => s.store.pull((b) => ({ ...b, group_members: { ...b.group_members, [id]: { ...b.group_members![id]!, deleted_at: '2026-10-07T09:00:00Z' } } })));
const selected = (label: string, inside?: string) => (inside ? within(screen.getByTestId(inside)).getByLabelText(label) : screen.getByLabelText(label)).props.accessibilityState?.selected;
const openRoutine = async () => (await press(screen.getByLabelText('Kalendarz')), await press(await screen.findByTestId('calendar-add-routine')), await screen.findByTestId('screen-routine'));
const openEvent = async () => (await press(screen.getByLabelText('Kalendarz')), await press(await screen.findByTestId('calendar-add-event')), await screen.findByTestId('screen-event-edit'));
const openList = async () => (await press(screen.getByLabelText('Listy')), await press(await screen.findByLabelText('Nowa lista')), await screen.findByTestId('screen-new-list'));

describe('N-32: szkic albo otwarty formularz z osobą lub grupą, której już nie ma', () => {
  it('zadanie: „Dla kogo: Ala” w szkicu, Ala usunięta — przywrócenie daje „nikt konkretny” z napisem, zapis bez odrzucenia', async () => {
    const s = await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Basen');
    await press(screen.getByLabelText('Rodzina'));
    await press(screen.getByLabelText('Ala'));
    await press(screen.getByLabelText('Wróć'));
    await removeMember(s, 'ala');
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Ala nie należy już do grupy — wybór usunięto.')).toBeTruthy();
    expect(selected('Nikt konkretny')).toBe(true);
    await press(screen.getByTestId('form-save'));
    expect(creates(s, 'tasks')[0]!.set!.assignee_member_id ?? null).toBeNull();
  });

  it('zadanie: Ala usunięta w trakcie wypełniania — „Zapisz” mówi o tym i niczego nie wysyła', async () => {
    const s = await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Basen');
    await press(screen.getByLabelText('Rodzina'));
    await press(screen.getByLabelText('Ala'));
    await removeMember(s, 'ala');
    await press(screen.getByTestId('form-save'));
    expect(screen.getByText('Ala nie należy już do grupy — wybierz inaczej.')).toBeTruthy();
    expect(creates(s, 'tasks')).toEqual([]);
  });

  it('rutyna: szkic w „Klasa 2b”, potem usunięto mnie z grupy — inna grupa z napisem, zapis nie idzie do obcej grupy', async () => {
    const s = await start();
    await openRoutine();
    await press(screen.getByLabelText('Klasa 2b'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek');
    await press(screen.getByLabelText('Wróć'));
    await removeMember(s, 'mk');
    await press(await screen.findByTestId('calendar-add-routine'));
    await screen.findByTestId('screen-routine');
    expect(screen.getByText('Grupy „Klasa 2b” ze szkicu już nie masz — sprawdź wybraną grupę.')).toBeTruthy();
    expect(screen.getByTestId('routine-title').props.value).toBe('Poranek');
    await setTime('routine-start', '07:00');
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Zęby');
    await press(screen.getByTestId('routine-save'));
    expect(creates(s, 'events').map((e) => e.group_id)).not.toContain('gk');
    expect(creates(s, 'events')).toHaveLength(1);
  });

  it('rutyna: usunięto mnie z grupy w trakcie wypełniania — „Zapisz” mówi o tym', async () => {
    const s = await start();
    await openRoutine();
    await press(screen.getByLabelText('Klasa 2b'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek');
    await setTime('routine-start', '07:00');
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Zęby');
    await removeMember(s, 'mk');
    await press(screen.getByTestId('routine-save'));
    expect(screen.getByText('Tej grupy już nie masz — wybierz inną.')).toBeTruthy();
    expect(creates(s, 'events')).toEqual([]);
  });

  it('rutyna: „Dla kogo: Ala”, Ala usunięta w trakcie — „Zapisz” mówi o tym', async () => {
    const s = await start();
    await openRoutine();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek');
    await setTime('routine-start', '07:00');
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Zęby');
    await press(screen.getByLabelText('Uczestnik: Ala'));
    await removeMember(s, 'ala');
    await press(screen.getByTestId('routine-save'));
    expect(screen.getByText('Ala nie należy już do grupy — wybierz inaczej.')).toBeTruthy();
    expect(creates(s, 'events')).toEqual([]);
  });

  it('wydarzenie: szkic z uczestniczką i osobą odpowiedzialną Alą, Ala usunięta — obie odpadają z napisem', async () => {
    const s = await start();
    await openEvent();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Dentysta');
    await press(screen.getByLabelText('Wybrane osoby'));
    await press(screen.getByLabelText('Uczestnik: Ala'));
    await press(within(screen.getByLabelText('Osoba odpowiedzialna')).getByLabelText('Ala'));
    await press(screen.getByLabelText('Wróć'));
    await removeMember(s, 'ala');
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getByText('Ala nie należy już do grupy — wybór usunięto.')).toBeTruthy();
    expect(screen.queryByLabelText('Uczestnik: Ala')).toBeNull();
  });

  it('wydarzenie: osoba odpowiedzialna usunięta w trakcie — „Zapisz” mówi o tym', async () => {
    const s = await start();
    await openEvent();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Dentysta');
    await setTime('event-start-0', '10:00');
    await press(within(screen.getByLabelText('Osoba odpowiedzialna')).getByLabelText('Ala'));
    await removeMember(s, 'ala');
    await press(screen.getByTestId('event-save'));
    expect(screen.getByText('Ala nie należy już do grupy — wybierz inaczej.')).toBeTruthy();
    expect(creates(s, 'events')).toEqual([]);
  });

  it('nowa lista zakupów: „Kto robi zakupy: Ala” w szkicu, Ala usunięta — „nikt konkretny” z napisem', async () => {
    const s = await start();
    const openShopping = async () => (await press(screen.getByLabelText('Listy')), await press(await screen.findByLabelText('Nowa lista zakupów')), await screen.findByTestId('screen-new-list'));
    await openShopping();
    await fireEvent.changeText(screen.getByTestId('list-name'), 'Na weekend');
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await press(within(screen.getByTestId('trip-editor')).getByLabelText('Ala'));
    await press(screen.getByLabelText('Wróć'));
    await removeMember(s, 'ala');
    await openShopping();
    expect(screen.getByText('Ala nie należy już do grupy — wybór usunięto.')).toBeTruthy();
    expect(selected('Nikt konkretny', 'trip-editor')).toBe(true);
  });

  it('nowa lista: usunięto mnie z grupy w trakcie — „Utwórz” mówi o tym', async () => {
    const s = await start();
    await openList();
    await fireEvent.changeText(screen.getByTestId('list-name'), 'Wycieczka');
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Klasa 2b'));
    await removeMember(s, 'mk');
    await press(screen.getByTestId('create-list'));
    expect(screen.getByText('Tej grupy już nie masz — wybierz inną.')).toBeTruthy();
    expect(creates(s, 'lists')).toEqual([]);
  });
});

describe('N-144: szkic z dniem, który minął', () => {
  const clock = { at: { y: 2026, m: 10, d: 7, hh: 10, mm: 0 }, ms: Date.UTC(2026, 9, 7, 8, 0) };
  const nextDay = async () => act(async () => void Object.assign(clock, { at: { ...clock.at, d: 8 }, ms: clock.ms + DAY }));

  it('zadanie „Kiedy: Dziś” przywrócone następnego dnia — bez terminu, z napisem (nie od razu zaległe)', async () => {
    const s = await start({ clock });
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Basen');
    await press(within(screen.getByLabelText('Kiedy')).getByLabelText('Dziś'));
    await press(screen.getByLabelText('Wróć'));
    await nextDay();
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    expect(screen.getByText('Dzień ze szkicu minął — wybierz nowy.')).toBeTruthy();
    expect(selected('Bez terminu')).toBe(true);
    await press(screen.getByTestId('form-save'));
    expect(creates(s, 'tasks')[0]!.set!.due_date).toBeNull();
  });
});

describe('N-138: przełącznik „Rodzaj” — przeniesione pola są szkicem', () => {
  it('„Więcej → Rutyna → Wróć” zostawia przeniesioną nazwę w szkicu rutyny', async () => {
    const s = await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Wieczór');
    await press(screen.getByLabelText('Rutyna'));
    await screen.findByTestId('screen-routine');
    await press(screen.getByLabelText('Wróć'));
    expect(s.services.local!.load(draftKey(ME, 'routine:new'))).toContain('Wieczór');
    await openRoutine();
    expect(screen.getByTestId('routine-title').props.value).toBe('Wieczór');
  });

  it('zadanie → wydarzenie → „Wróć”: nazwa w szkicu wydarzenia', async () => {
    const s = await start();
    await press(screen.getByTestId('add-more'));
    await fireEvent.changeText(screen.getByTestId('form-title'), 'Dentysta');
    await press(screen.getByLabelText('Wydarzenie'));
    await screen.findByTestId('screen-event-edit');
    await press(screen.getByLabelText('Wróć'));
    expect(s.services.local!.load(draftKey(ME, 'event:new'))).toContain('Dentysta');
  });

  it('pusty przełączony formularz nie kasuje szkicu docelowego', async () => {
    const s = await start();
    await openRoutine();
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Wieczór');
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Piżama');
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Moje sprawy'));
    await press(await screen.findByTestId('add-more'));
    await press(screen.getByLabelText('Rutyna'));
    await screen.findByTestId('screen-routine');
    await press(screen.getByLabelText('Wróć'));
    expect(s.services.local!.load(draftKey(ME, 'routine:new'))).toContain('Piżama');
  });
});

const openTimetable = async () => {
  await press(screen.getByLabelText('Grupy'));
  await press(await screen.findByLabelText('Rodzina, 3 osoby, administrator'));
  await press(await screen.findByLabelText('Tymek, dziecko'));
  await press(await screen.findByTestId('open-timetable'));
  await screen.findByTestId('screen-timetable');
};
const back = async (n = 1) => {
  for (let i = 0; i < n; i++) await press(screen.getAllByLabelText('Wróć').at(-1)!);
};
/** Drugi rodzic dodaje Tymkowi lekcję we wtorki (pobranie z serwera). */
const otherParentAddsLesson = (s: S) =>
  act(async () =>
    s.store.pull((b) => ({
      ...b,
      events: { ...b.events, 'ev-pl': { id: 'ev-pl', group_id: 'gf', title: 'Plastyka', note: null, start_date: '2026-10-06', start_time: '09:00:00', end_time: '09:45:00', rrule: 'FREQ=WEEKLY;BYDAY=TU', audience: 'members', responsible_member_id: null, kind: 'lesson', deleted_at: null, version: 1 } },
      event_participants: { ...b.event_participants, pp: { id: 'pp', event_id: 'ev-pl', group_id: 'gf', member_id: 'tymek', deleted_at: null, version: 1 } },
    })),
  );
const touchesPl = (s: S) => s.store.dispatched.some((o) => ('id' in o && o.id === 'ev-pl') || (o.kind === 'cmd' && (o.args as { event_id?: string }).event_id === 'ev-pl'));

describe('N-31: plan lekcji zmieniony w międzyczasie przez drugiego rodzica', () => {
  it('przywrócony szkic: pytanie od razu; „Pokaż obecny plan” otwiera plan z lekcją drugiego rodzica, bez szkicu', async () => {
    const s = await start();
    await openTimetable();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await back();
    await otherParentAddsLesson(s);
    await press(await screen.findByTestId('open-timetable'));
    await screen.findByTestId('screen-timetable');
    expect(screen.getByText('Ktoś zmienił plan w międzyczasie')).toBeTruthy();
    await press(screen.getByLabelText('Pokaż obecny plan'));
    expect(await screen.findByDisplayValue('Plastyka')).toBeTruthy();
    expect(screen.queryByDisplayValue('Matematyka')).toBeNull();
    expect(screen.queryByText('Ktoś zmienił plan w międzyczasie')).toBeNull();
    expect(s.services.local!.load(draftKey(ME, 'timetable:gf:tymek'))).toBeNull();
    expect(touchesPl(s)).toBe(false);
  });

  it('otwarty ekran: „Zapisz plan” pyta; „Anuluj” nic nie zapisuje; „Zapisz mój plan” — świadomie, z obecnym planem', async () => {
    const s = await start();
    await openTimetable();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await otherParentAddsLesson(s);
    await press(screen.getByTestId('timetable-save'));
    expect(screen.getByText('Ktoś zmienił plan w międzyczasie')).toBeTruthy();
    expect(s.store.dispatched).toEqual([]);
    await press(within(screen.getByTestId('timetable-changed')).getByLabelText('Anuluj'));
    expect(s.store.dispatched).toEqual([]);
    await press(screen.getByTestId('timetable-save'));
    await press(screen.getByLabelText('Zapisz mój plan'));
    // Zapis liczony z obecnego planu: lekcja drugiego rodzica kończy się (wybrałem to), moja powstaje.
    expect(creates(s, 'events').map((e) => e.set!.title)).toEqual(['Matematyka']);
    expect(touchesPl(s)).toBe(true);
  });

  it('bez zmian w międzyczasie — bez pytania', async () => {
    const s = await start();
    await openTimetable();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await back();
    await press(await screen.findByTestId('open-timetable'));
    await screen.findByTestId('screen-timetable');
    expect(screen.queryByText('Ktoś zmienił plan w międzyczasie')).toBeNull();
    await press(screen.getByTestId('timetable-save'));
    expect(creates(s, 'events')).toHaveLength(1);
  });

  it('szkic starszej wersji (bez znacznika) — pytanie, bo nie wiadomo, na jakim planie powstał', async () => {
    const s = await start();
    s.services.local!.save(draftKey(ME, 'timetable:gf:tymek'), JSON.stringify({ at: Date.UTC(2026, 9, 7, 7), changes: { until: '2027-06-26' } }));
    await openTimetable();
    expect(screen.getByText('Ktoś zmienił plan w międzyczasie')).toBeTruthy();
  });
});

describe('N-35: „Cofnij” rutyny i planu lekcji sprawdza, czy ktoś je zmienił', () => {
  it('rutyna przemianowana na drugim telefonie: „Cofnij” z „Ostatnich zmian” jej nie usuwa', async () => {
    const s = await start();
    await openRoutine();
    await press(within(screen.getByLabelText('Grupa')).getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Poranek');
    await setTime('routine-start', '07:00');
    await fireEvent.changeText(screen.getByTestId('routine-step-0'), 'Zęby');
    await press(screen.getByTestId('routine-save'));
    expect(within(await screen.findByTestId('undo-bar')).getByText('Dodano rutynę: Poranek')).toBeTruthy();
    const ev = creates(s, 'events')[0]! as unknown as { id: string; group_id: string; set: Row };
    await act(async () => s.store.pull((b) => ({ ...b, events: { ...b.events, [ev.id]: { id: ev.id, group_id: ev.group_id, ...ev.set, title: 'Poranek Tymka', deleted_at: null, version: 9 } } })));
    const n = s.store.dispatched.length;
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByTestId('open-recent'));
    await press(await screen.findByLabelText('Cofnij: Dodano rutynę: Poranek'));
    expect(s.store.dispatched.slice(n).filter((o) => o.kind === 'delete')).toEqual([]);
    expect(screen.getByText(/zmieniło się od tamtej chwili/)).toBeTruthy();
  });

  it('plan lekcji zmieniony po zapisie: „Cofnij” na pasku go nie cofa', async () => {
    const s = await start();
    await openTimetable();
    await press(screen.getByTestId('lesson-add-0'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '08:45');
    await press(screen.getByTestId('timetable-save'));
    expect(within(await screen.findByTestId('undo-bar')).getByText('Dodano plan lekcji: 1 lekcja w tygodniu')).toBeTruthy();
    const ev = creates(s, 'events')[0]! as unknown as { id: string; group_id: string; set: Row };
    await act(async () => s.store.pull((b) => ({ ...b, events: { ...b.events, [ev.id]: { id: ev.id, group_id: ev.group_id, ...ev.set, start_time: '08:10:00', deleted_at: null, version: 9 } } })));
    const n = s.store.dispatched.length;
    await press(within(screen.getByTestId('undo-bar')).getByLabelText('Cofnij'));
    expect(s.store.dispatched.slice(n).filter((o) => o.kind === 'delete')).toEqual([]);
    expect(await screen.findByText(/to się w międzyczasie zmieniło/)).toBeTruthy();
  });
});

describe('N-134: pola nie przyjmują więcej, niż przyjmie serwer', () => {
  it.each<[string, () => Promise<unknown>, [string, number][]]>([
    ['formularz „Więcej”', () => press(screen.getByTestId('add-more')), [['form-title', 500]]],
    ['wydarzenie', openEvent, [['event-title', 200], ['event-location', 300]]],
    ['rutyna', openRoutine, [['routine-title', 200], ['routine-step-0', 500]]],
    ['plan lekcji', async () => (await openTimetable(), await press(screen.getByTestId('lesson-add-0'))), [['lesson-title-0', 200]]],
    ['notatka zadania', async () => press(await screen.findByText('Oddać książki do biblioteki')), [['task-note', 10000]]],
  ])('%s: maxLength z config (zgodny z SQL)', async (_name, open, fields) => {
    await start();
    await open();
    for (const [id, max] of fields) expect((await screen.findByTestId(id)).props.maxLength).toBe(max);
  });

  it('nazwa zadania przy limicie — napis o limicie; dłuższa (np. ze szkicu) — błąd zamiast odrzucenia', async () => {
    const s = await start();
    s.services.local!.save(draftKey(ME, 'task:new'), JSON.stringify({ at: Date.UTC(2026, 9, 7, 7), changes: { title: 'x'.repeat(501) } }));
    await press(screen.getByTestId('add-more'));
    await screen.findByTestId('screen-add-task');
    await press(screen.getByTestId('form-save'));
    expect(screen.getByRole('alert').props.children).toBe('Najwyżej 500 znaków.');
    expect(creates(s, 'tasks')).toEqual([]);
  });
});

describe('N-143: uwaga — limit i szkic', () => {
  it('pole ma limit (napis o limicie), a wyjście z ekranu nie gubi tekstu (Q31 A)', async () => {
    await start();
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('open-feedback'));
    expect(screen.getByTestId('feedback-text').props.maxLength).toBe(2000);
    await fireEvent.changeText(screen.getByTestId('feedback-text'), 'Brakuje stałych zakupów');
    await back();
    await press(await screen.findByTestId('open-feedback'));
    expect(screen.getByTestId('feedback-text').props.value).toBe('Brakuje stałych zakupów');
    expect(screen.getByText('Przywrócono niezapisane zmiany.')).toBeTruthy();
  });
});

describe('N-139: pole zapisywane od razu zapisuje się przy wyjściu z aplikacji', () => {
  it('notatka zadania: przejście do innej aplikacji zapisuje wpisany tekst', async () => {
    const app = appStateEvents();
    try {
      const s = await start();
      await press(await screen.findByText('Oddać książki do biblioteki'));
      await fireEvent.changeText(await screen.findByTestId('task-note'), 'Trzy książki');
      await app.background();
      expect(s.store.dispatched).toContainEqual({ kind: 'patch', entity: 'tasks', id: 't-books', set: { note: 'Trzy książki' } });
    } finally {
      app.restore();
    }
  });
});

