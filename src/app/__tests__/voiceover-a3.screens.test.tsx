/**
 * VoiceOver — audyt 3 (paczka PK-21): stany po polsku zamiast angielskich słów React Native (N-9), dni tygodnia
 * z przyimkiem (N-64), dopiski słowami (N-65), etykiety chipów szybkiego dodawania (N-66).
 * Atrapa AccessibilityInfo z presetu React Native (jest.fn) — sprawdzamy, co aplikacja jej przekazuje.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { AccessibilityInfo } from 'react-native';

import { config } from '../../config';
import { WEEKDAYS_ABBREVIATED } from '../../config/calendar.pl';
import { WEEKDAYS_ACCUSATIVE, WEEKDAYS_ON } from '../../config/quickadd.pl';
import { buttonA11y, spoken } from '../../ui/a11y';
import { EventRow, GroupLine, MissingScreen, StationRow, syncAnnouncement, syncAnnouncer } from '../../ui/components';
import { RootStack } from '../navigation';
import { answerAlert, put, sampleBase, setup, TOGGLE_BOX } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const announced = () => (AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock).mock.calls.map((c) => c[0] as string);
const focused = () => (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mock.calls.filter((c) => c[1] === 'focus').map((c) => c[0] as { props?: Record<string, unknown> } | null);
/** Ostatni element, na który przeniesiono fokus, ma podaną właściwość (testID albo etykietę). */
async function expectFocusOn(pred: (props: Record<string, unknown>) => boolean) {
  await waitFor(() => expect(pred(focused().at(-1)?.props ?? {})).toBe(true));
}
const byTestId = (id: string) => (p: Record<string, unknown>) => p.testID === id;

beforeEach(() => {
  (AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock).mockClear();
  (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
});

async function open(base = sampleBase()) {
  const s = setup({ base });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

describe('stany po polsku (N-9)', () => {
  it('buttonA11y: rola „button”, wybór cechą `selected`, rozwinięcie i „w toku” polską wartością po wartości pola', () => {
    expect(buttonA11y()).toEqual({ accessibilityRole: 'button' });
    expect(buttonA11y({ selected: false })).toEqual({ accessibilityRole: 'button', accessibilityState: { selected: false } });
    expect(buttonA11y({ expanded: false, busy: false, disabled: false })).toEqual({ accessibilityRole: 'button', accessibilityState: { disabled: false } });
    expect(buttonA11y({ expanded: true }, 'Środa, 7 października')).toEqual({ accessibilityRole: 'button', accessibilityValue: { text: 'Środa, 7 października, rozwinięte' } });
    expect(buttonA11y({ busy: true, disabled: true })).toEqual({ accessibilityRole: 'button', accessibilityState: { disabled: true }, accessibilityValue: { text: 'w toku' } });
    expect(buttonA11y({}, 'Wybierz godzinę')).toEqual({ accessibilityRole: 'button', accessibilityValue: { text: 'Wybierz godzinę' } });
  });

  it('pole odhaczenia to przycisk ze stanem „wybrane” (bez „checkbox, unchecked”); po odhaczeniu — wybrane', async () => {
    await open();
    const box = screen.getByRole('button', { name: 'Oznacz jako zrobione: Odebrać paczkę' });
    expect(box.props.accessibilityRole).toBe('button');
    expect(box.props.accessibilityState).toMatchObject({ selected: false, checked: undefined });
    expect(TOGGLE_BOX.test(String(box.props.accessibilityLabel))).toBe(true);
    await press(box);
    await answerAlert('Zrobione');
    await press(screen.getByLabelText('Zrobione dziś (1), pokaż'));
    const done = await screen.findByRole('button', { name: 'Oznacz jako niezrobione: Odebrać paczkę' });
    expect(done.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('wybór wielu (dni tygodnia) to przyciski ze stanem „wybrane”', async () => {
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    const day = screen.getByLabelText('śr., w środę');
    expect(day.props.accessibilityRole).toBe('button');
    expect(day.props.accessibilityState).toMatchObject({ selected: true, checked: undefined });
  });

  it('opcje jednej z wielu: przyciski ze stanem „wybrane”, grupa bez roli „radiogroup” (na iOS bez cechy)', async () => {
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-event'));
    const group = await screen.findByLabelText('Grupa');
    expect(group.props.accessibilityRole).toBeUndefined();
    const options = within(group).getAllByRole('button');
    expect(options.length).toBeGreaterThan(1);
    expect(options.filter((o) => o.props.accessibilityState?.selected === true)).toHaveLength(1);
  });
});

describe('dni tygodnia z przyimkiem (N-64)', () => {
  it('„we wtorek”, pozostałe „w …” (Poradnia PWN); etykieta zaczyna się od widocznego skrótu', async () => {
    expect(WEEKDAYS_ON).toEqual(['w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę', 'w niedzielę']);
    WEEKDAYS_ON.forEach((on, i) => expect(on.split(' ')[1]).toBe(WEEKDAYS_ACCUSATIVE[i]));
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    const labels = WEEKDAYS_ABBREVIATED.map((w, i) => `${w}, ${WEEKDAYS_ON[i]!}`);
    expect(labels[1]).toBe('wt., we wtorek');
    for (const l of labels) expect(screen.getByLabelText(l)).toBeTruthy();
  });
});

describe('dopiski słowami (N-65)', () => {
  it('spoken: skrót dnia tygodnia słowem, „·” przecinkiem, „min”/„h” słowami', () => {
    expect(spoken('Co tydzień: pon., śr.')).toBe('Co tydzień: poniedziałek, środa');
    expect(spoken('Wyjdź o 16:20 · 35 min autem')).toBe('Wyjdź o 16:20, 35 minut autem');
    expect(spoken('Środa, 7 października · 17:00–18:00 · 1 h')).toBe('Środa, 7 października, 17:00–18:00, 1 godzina');
    // Bez kropki to nie skrót dnia (np. „pt” w słowie) — bez zmian.
    expect(spoken('Opt. wt')).toBe('Opt. wt');
  });

  it('„Wyjdź o …” w wierszu wydarzenia i ostrzeżenie w wierszu zadania czytane słowami', async () => {
    const { wrap } = setup();
    await render(
      wrap(
        <>
          <EventRow title="Basen" time="17:00" line={0} group="Rodzina" alert="Wyjdź o 16:20 · 35 min autem" onPress={() => {}} testID="ev" />
          <StationRow title="Rachunek" line={0} checked={false} alert="zaległe · 2 dni" onOpen={() => {}} testID="st" />
        </>,
      ),
    );
    expect(screen.getByTestId('ev').props.accessibilityLabel).toBe('Basen, 17:00, Rodzina, Wyjdź o 16:20, 35 minut autem');
    expect(screen.getByLabelText(/^Rachunek, zaległe, 2 dni$/)).toBeTruthy();
  });

  it('pasek „Dodano”, wiersz grupy i szczegóły wydarzenia bez „·”, „1 h” i „śr.”', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
    await open(base);
    await fireEvent.changeText(await screen.findByTestId('quick-add'), 'basen jutro 19.00');
    await press(screen.getByLabelText('Dodaj'));
    expect((await screen.findByTestId('undo-message')).props.accessibilityLabel).toBe('Dodano zadanie: basen, Osobiste');
    await press(screen.getByLabelText(/^Tańce, 17:00–18:00/));
    await screen.findByTestId('screen-event');
    expect(screen.getByLabelText(/^[^·]*7 października, 17:00–18:00, 1 godzina$/)).toBeTruthy();
    expect(screen.getByLabelText('Co tydzień: środa')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Grupy'));
    expect(await screen.findByLabelText('Rodzina, 3 osoby, administrator')).toBeTruthy();
  });
});

describe('etykiety chipów szybkiego dodawania (N-66, WCAG 2.5.3)', () => {
  it('etykieta zaczyna się od widocznego napisu, podpowiedź bez nazwy gestu', async () => {
    const s = setup({ base: sampleBase() });
    s.services.local!.save('lastUsedGroup', 'gf');
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    const chip = screen.getByTestId('quick-group');
    const visible = within(chip).getByText(/^Do: /).props.children as string;
    expect(String(chip.props.accessibilityLabel).startsWith(visible)).toBe(true);
    expect(chip.props.accessibilityHint).not.toMatch(/dotknij|dotknięci/i);
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'mleko');
    const shop = await screen.findByTestId('quick-shopping');
    const shown = within(shop).getByText(/^Na listę: /).props.children as string;
    expect(String(shop.props.accessibilityLabel).startsWith(shown)).toBe(true);
    expect(shop.props.accessibilityLabel).toContain('mleko');
    expect(shop.props.accessibilityHint).not.toMatch(/dotknij|dotknięci/i);
  });
});

describe('zmiana okresu ogłaszana (N-60)', () => {
  it('„Następny dzień” w Moich sprawach i „Następny miesiąc” w Kalendarzu i mini kalendarzu ogłaszają nowy okres', async () => {
    await open();
    expect(announced()).toEqual([]);
    await press(screen.getByLabelText('Następny dzień'));
    expect(announced()).toEqual([screen.getByTestId('today-range-label').props.children]);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByLabelText('Następny miesiąc'));
    expect(announced().at(-1)).toBe('Listopad 2026');
    await press(screen.getByTestId('calendar-go-today'));
    expect(announced().at(-1)).toBe('Październik 2026');
  });
});

describe('fokus po zamknięciu panelu (N-62)', () => {
  it('wybór dnia w mini kalendarzu: fokus wraca na pole dnia z nową wartością', async () => {
    await open();
    await press(screen.getByLabelText('Więcej'));
    await press(await screen.findByTestId('form-date'));
    (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
    await press(screen.getByTestId('form-date-day-2026-10-09'));
    expect(screen.queryByTestId('form-date-calendar')).toBeNull();
    await expectFocusOn(byTestId('form-date'));
  });

  it('wybór minuty zwija kafelki: fokus wraca na pole godziny; otwarcie drugiego pola pary nie zabiera mu fokusu', async () => {
    await open();
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    await press(screen.getByTestId('routine-start'));
    (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
    await press(screen.getByTestId('routine-end'));
    await act(async () => new Promise((r) => setTimeout(r, config.a11y.FOCUS_DELAY_MS + 20)));
    expect(focused().some((t) => t?.props?.testID === 'routine-start')).toBe(false);
    await press(screen.getByTestId('routine-end-m-30'));
    await expectFocusOn(byTestId('routine-end'));
  });

  it('„Anuluj” w pytaniu o zakres: fokus wraca na „Zmień”; przekazanie: na przycisk, który otworzył panel', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
    await open(base);
    await press(screen.getByLabelText(/^Tańce, 17:00–18:00/));
    await press(await screen.findByTestId('event-edit'));
    await press(screen.getByRole('button', { name: 'Anuluj' }));
    await expectFocusOn(byTestId('event-edit'));
    await press(screen.getByTestId('event-cancel'));
    await press(screen.getByRole('button', { name: 'Anuluj' }));
    await expectFocusOn(byTestId('event-cancel'));
  });

  it('zadanie: „Anuluj” w przekazaniu i w przenoszeniu wraca na przycisk', async () => {
    await open();
    await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
    await press(await screen.findByTestId('handoff-start'));
    await press(within(screen.getByTestId('handoff-picker')).getByRole('button', { name: 'Anuluj' }));
    await expectFocusOn(byTestId('handoff-start'));
    await press(screen.getByTestId('task-move'));
    await press(within(screen.getByTestId('move-groups')).getByRole('button', { name: 'Anuluj' }));
    await expectFocusOn(byTestId('task-move'));
  });

  it('„Anuluj” w pytaniu „Kogo masz na myśli?” pod polem dodawania: fokus wraca do pola', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'zadzwonić @x jutro');
    await fireEvent(screen.getByTestId('quick-add'), 'submitEditing');
    const panel = await screen.findByTestId(/^mention-(choices|unknown)$/);
    (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
    await press(within(panel).getByRole('button', { name: 'Anuluj' }));
    await expectFocusOn(byTestId('quick-add'));
  });
});

describe('fokus na nagłówku po wejściu (N-63)', () => {
  it('linia grupy na ekranie zadania i powód na ekranie „brak obiektu” to nagłówki z fokusem po przejściu (jak Title, M-269)', async () => {
    jest.useFakeTimers();
    try {
      const listeners: ((e: { data?: { closing?: boolean } }) => void)[] = [];
      const nav = { addListener: jest.fn((_: string, fn: (typeof listeners)[number]) => (listeners.push(fn), () => {})), getParent: () => undefined, isFocused: () => true };
      const { wrap } = setup();
      await render(
        wrap(
          <NavigationContext.Provider value={nav as never}>
            <GroupLine name="Rodzina" line={0} detail="Dom" header="Odebrać paczkę, Rodzina, Dom" />
            <MissingScreen testID="screen-x-missing" text="Tego zadania już nie ma." onBack={() => {}} />
          </NavigationContext.Provider>,
        ),
      );
      expect(screen.getAllByRole('header').map((h) => String(h.props.accessibilityLabel ?? h.props.children))).toEqual(['Odebrać paczkę, Rodzina, Dom', 'Tego zadania już nie ma.']);
      expect(listeners).toHaveLength(2);
      await act(async () => listeners.forEach((l) => l({ data: { closing: false } })));
      await act(async () => jest.advanceTimersByTime(config.a11y.FOCUS_DELAY_MS));
      expect(focused().map((t) => String(t?.props?.accessibilityLabel ?? t?.props?.children))).toEqual(['Odebrać paczkę, Rodzina, Dom', 'Tego zadania już nie ma.']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ekran zadania ma nagłówek z nazwą zadania', async () => {
    await open();
    await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
    await screen.findByTestId('screen-task');
    expect(screen.getAllByRole('header').some((h) => String(h.props.accessibilityLabel).startsWith('Odebrać paczkę, '))).toBe(true);
  });
});

describe('ten sam błąd przy drugim „Zapisz” (N-194)', () => {
  it('każde „Zapisz” z błędem jest ogłaszane', async () => {
    await open();
    await press(screen.getByLabelText('Więcej'));
    await press(await screen.findByLabelText('Zapisz zadanie'));
    const first = announced().length;
    expect(first).toBeGreaterThan(0);
    await press(screen.getByLabelText('Zapisz zadanie'));
    expect(announced().length).toBe(first + 1);
    expect(announced().at(-1)).toBe(announced()[first - 1]);
  });
});

describe('podpisy pól i notki (N-195, N-199)', () => {
  it('widoczny podpis pola jest ukryty przed VoiceOverem (pole ma tę samą etykietę); powód nieaktywnej godziny — raz', async () => {
    await open();
    await press(screen.getByLabelText('Więcej'));
    await screen.findByTestId('form-title');
    expect(screen.queryByText('Tytuł')).toBeNull();
    expect(screen.getByText('Tytuł', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('form-title').props.accessibilityLabel).toBe('Tytuł');
    expect(screen.queryByText('Dzień')).toBeNull();
    await press(screen.getByRole('button', { name: 'Bez terminu' }));
    const time = screen.getByTestId('form-time');
    expect(time.props.accessibilityHint).toBeUndefined();
    expect(screen.getAllByText('Najpierw wybierz dzień.')).toHaveLength(1);
  });
});

describe('powtórzone etykiety (N-196)', () => {
  it('stałe zakupy: „Dodaj stałą pozycję” obok „Dodaj” pola szybkiego dodawania', async () => {
    await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText(/^Zakupy na weekend, /));
    await press(await screen.findByTestId('staples-edit'));
    expect(screen.getByTestId('staple-save').props.accessibilityLabel).toBe('Dodaj stałą pozycję');
  });
});

describe('„migająca” sieć (N-198)', () => {
  it('wejście w problem od razu; powrót po config.a11y.SYNC_CALM_MS bez nowego problemu; powtórny problem bez drugiego ogłoszenia', () => {
    jest.useFakeTimers();
    try {
      let i: Parameters<typeof syncAnnouncement>[1] = { state: 'synced', since: 0 };
      const said: (string | null)[] = [];
      const a = syncAnnouncer(() => i, () => 0, (t) => said.push(t));
      const to = (next: typeof i) => ((i = next), a.update());
      to({ state: 'offline', pending: 1 });
      expect(said).toEqual(['Offline, 1 zmiana czeka']);
      to({ state: 'pending', pending: 1 });
      jest.advanceTimersByTime(config.a11y.SYNC_CALM_MS - 1);
      to({ state: 'offline', pending: 1 });
      jest.advanceTimersByTime(config.a11y.SYNC_CALM_MS);
      // Ani powrotu, ani drugiego „Offline”.
      expect(said.filter(Boolean)).toEqual(['Offline, 1 zmiana czeka']);
      to({ state: 'syncing', pending: 0 });
      to({ state: 'synced', since: 0 });
      to({ state: 'synced', since: 0 });
      jest.advanceTimersByTime(config.a11y.SYNC_CALM_MS);
      expect(said.filter(Boolean)).toEqual(['Offline, 1 zmiana czeka', 'Przed chwilą']);
      // Powrót, który w chwili ogłoszenia znów jest problemem albo synchronizacją — bez słowa.
      to({ state: 'error', pending: 0, error: 'x' });
      to({ state: 'pending', pending: 2 });
      i = { state: 'syncing', pending: 0 };
      jest.advanceTimersByTime(config.a11y.SYNC_CALM_MS);
      expect(said.filter(Boolean)).toHaveLength(3);
      a.stop();
      a.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});
