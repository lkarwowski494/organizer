/**
 * VoiceOver, fokus, ogłoszenia i klawiatura (audyt 2, paczka P14a): ogłoszenia błędów i potwierdzeń (M-37, M-39), role
 * zakładek (M-40), klawiatura (M-41, M-268), fokus paneli i tytułów (M-44, M-269), „Bez dnia” (M-125), stany
 * rozwinięcia (M-141), wiersze bez otwierania (M-142), postęp Pierwszych kroków (M-143), pola daty i godziny (M-144),
 * usuwanie jako czynność VoiceOvera (M-150), etykiety (M-263, M-264, M-265), stan „zajęty” (M-267).
 * Atrapa AccessibilityInfo z presetu React Native (jest.fn) — sprawdzamy, co aplikacja jej przekazuje.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo, Text } from 'react-native';

import { config } from '../../config';
import { Screen, syncAnnouncement, Title } from '../../ui/components';
import { DateField } from '../../ui/DateField';
import { pinFocus, spoken } from '../../ui/a11y';
import { RootStack } from '../navigation';
import { lastAlert, NOW, put, sampleBase, setTime, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const announced = () => (AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock).mock.calls.map((c) => c[0] as string);
const focused = () => (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mock.calls.filter((c) => c[1] === 'focus').map((c) => c[0] as unknown);
const HIDDEN = { includeHiddenElements: true };

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] | null };
/** Elementy drzewa (jak w a11y.test.tsx) spełniające warunek. */
function nodes(pred: (n: Json) => boolean): Json[] {
  const out: Json[] = [];
  const walk = (n: Json | Json[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (pred(n)) out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON() as never);
  return out;
}

beforeEach(() => {
  (AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock).mockClear();
  (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
});

async function open(base = sampleBase(), extra: Parameters<typeof setup>[0] = {}) {
  const s = setup({ base, ...extra });
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}

/** Element, na który przeniesiono fokus, ma podany tekst (cel `sendAccessibilityEvent`). */
async function expectFocusOn(text: string) {
  await waitFor(() => expect(focused().some((t) => JSON.stringify((t as { props?: unknown })?.props ?? null).includes(text))).toBe(true));
}

describe('ogłoszenia błędów i potwierdzeń (M-39)', () => {
  it('błąd formularza ogłaszany w kolejce, gdy się pojawi (rola „alert” na iOS milczy)', async () => {
    await open();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText(/^Rodzina/));
    await fireEvent.changeText(await screen.findByTestId('group-rename'), '   ');
    await fireEvent(screen.getByTestId('group-rename'), 'blur');
    await waitFor(() => expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Wpisz nazwę grupy.', { queue: true }));
  });

  it('dodanie do kalendarza: potwierdzenie i odmowa ogłaszane, odmowa na czerwono jako błąd', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'group', deleted_at: null, version: 1 });
    const s = await open(base);
    await press(screen.getByLabelText(/^Basen, 17:00–18:00/));
    await press(await screen.findByTestId('event-calendar'));
    await waitFor(() => expect(announced()).toContain('Dodano do kalendarza.'));
    s.calendar.add = jest.fn(async () => 'denied' as const);
    await press(screen.getByTestId('event-calendar'));
    await waitFor(() => expect(screen.getByRole('alert').props.children).toMatch(/^Brak zgody/));
    expect(announced().some((t) => t.startsWith('Brak zgody'))).toBe(true);
  });

  it('plan lekcji: błąd w karcie lekcji tekstem, a przy „Zapisz” — której lekcji dotyczy (ogłoszone raz)', async () => {
    const { services } = await open();
    void services;
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText(/^Rodzina/));
    await press(await screen.findByTestId('group-timetable-tymek'));
    await press(await screen.findByTestId('lesson-add-2'));
    await fireEvent.changeText(screen.getByTestId('lesson-title-0'), 'Matematyka');
    await setTime('lesson-end-0', '07:00');
    await press(screen.getByTestId('timetable-save'));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(2);
    const bottom = alerts.map((a) => String(a.props.children)).find((t) => t.startsWith('Popraw lekcję 1, środa: '));
    expect(bottom).toBeTruthy();
    expect(announced().filter((t) => t.includes('Popraw lekcję'))).toHaveLength(1);
    expect(announced().filter((t) => !t.includes('Popraw lekcję') && bottom!.endsWith(t))).toHaveLength(0);
  });
});

describe('stan synchronizacji (M-37)', () => {
  it('ogłasza wejście w problem i powrót do normy, nie każde „synchronizuję”', () => {
    const now = Date.UTC(2026, 9, 7, 8, 0);
    let last: Parameters<typeof syncAnnouncement>[0] = 'synced';
    const step = (i: Parameters<typeof syncAnnouncement>[1]) => {
      const r = syncAnnouncement(last, i, now);
      last = r.last;
      return r.text;
    };
    expect(step({ state: 'syncing', pending: 0 })).toBeNull();
    expect(step({ state: 'pending', pending: 2 })).toBeNull();
    expect(step({ state: 'offline', pending: 2 })).toBe('Offline, 2 zmiany czekają');
    expect(step({ state: 'offline', pending: 3 })).toBeNull();
    expect(step({ state: 'syncing', pending: 0 })).toBeNull();
    expect(step({ state: 'auth_expired', pending: 0 })).toBe('Zaloguj się ponownie');
    expect(step({ state: 'synced', since: now - 5 * 60_000 })).toBe('5 minut temu');
    expect(step({ state: 'synced', since: now })).toBeNull();
  });
});

describe('zakładki (M-40)', () => {
  it('na iOS zakładki to przyciski, a pasek ma cechę paska kart', async () => {
    await open();
    expect(screen.getByTestId('tab-Today').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('tab-Today').props.accessibilityState).toEqual({ selected: true });
    expect(nodes((n) => n.props.accessibilityRole === 'tabbar')).toHaveLength(1);
  });
});

describe('klawiatura (M-41, M-268)', () => {
  it('przewijany ekran odsuwa treść o klawiaturę', async () => {
    await open();
    expect(screen.getByTestId('screen-today').props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('klawiatura numeryczna ma „Gotowe”; pole mojego imienia podpowiada imię z kontaktów', async () => {
    await open();
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByRole('button', { name: 'Dołącz do grupy' }));
    const id = screen.getByTestId('invite-join-id').props.inputAccessoryViewID as string;
    expect(id).toBeTruthy();
    expect(screen.getByTestId('invite-code').props.inputAccessoryViewID).not.toBe(id);
    expect(nodes((n) => n.props.nativeID === id)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Gotowe' })).toHaveLength(2);
    expect(screen.getByTestId('invite-name').props.textContentType).toBe('givenName');
    expect(screen.getByTestId('invite-input').props.inputAccessoryViewID).toBeUndefined();
  });
});

describe('fokus paneli i tytułów (M-44, M-269)', () => {
  it('pytanie w miejscu przycisku dostaje fokus (zakres zmiany serii)', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
    await open(base);
    await press(screen.getByLabelText(/^Tańce, 17:00–18:00/));
    await press(await screen.findByTestId('event-edit'));
    await expectFocusOn('Co zmienić?');
  });

  it('potwierdzenie wyjścia z grupy to okno systemowe (PWD-4 A) — VoiceOver dostaje je sam', async () => {
    await open(sampleBase(), { resetLocal: jest.fn() });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText(/^Klasa 2b/));
    await press(await screen.findByTestId('leave'));
    expect(lastAlert().message).toMatch(/^Na pewno wyjść\?/);
  });

  it('Pierwsze kroki: „Dalej” przenosi fokus na nowy nagłówek; postęp to jeden element z etykietą (M-143)', async () => {
    // Konto bez grupy wspólnej — z wyborem startu (PWD-20 A).
    const alone = sampleBase();
    delete alone.groups!.gf;
    delete alone.groups!.gk;
    await open(alone);
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('welcome-again'));
    expect((await screen.findByTestId('welcome-progress')).props.accessible).toBe(true);
    expect(screen.getByLabelText('Krok 1 z 4')).toBeTruthy();
    (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
    await press(screen.getByTestId('welcome-next'));
    expect(screen.getByLabelText('Krok 2 z 4')).toBeTruthy();
    const header = screen.getByRole('header');
    await expectFocusOn(String(header.props.children));
    await press(screen.getByTestId('welcome-skip'));
    await expectFocusOn('Od czego zaczynasz?');
  });

  it('tytuł ekranu dostaje fokus po wejściu na ekran (koniec przejścia), pasek „Cofnij” ma pierwszeństwo', async () => {
    jest.useFakeTimers();
    try {
      const listeners: ((e: { data?: { closing?: boolean } }) => void)[] = [];
      const parent = { addListener: jest.fn((_: string, fn: (typeof listeners)[number]) => (listeners.push(fn), () => {})), getParent: () => undefined, isFocused: () => true };
      const nav = { ...parent, getParent: () => parent };
      const ui = (el: ReactElement) => <NavigationContext.Provider value={nav as never}>{el}</NavigationContext.Provider>;
      await render(ui(<Title>Moje sprawy</Title>));
      // Słucha własnego ekranu i rodzica (ekran zakładki leży w ekranie stosu).
      expect(parent.addListener).toHaveBeenCalledTimes(2);
      await act(async () => listeners.forEach((l) => l({ data: { closing: true } })));
      await act(async () => jest.advanceTimersByTime(config.a11y.FOCUS_DELAY_MS));
      expect(focused()).toHaveLength(0);
      await act(async () => listeners[0]!({ data: { closing: false } }));
      await act(async () => jest.advanceTimersByTime(config.a11y.FOCUS_DELAY_MS));
      expect(focused()).toHaveLength(1);
      // Pasek pokazany przed chwilą — fokus wraca na niego, nie na tytuł.
      const bar = jest.fn(() => () => {});
      pinFocus(bar);
      await act(async () => listeners[0]!({ data: { closing: false } }));
      expect(bar).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(config.a11y.PIN_MS + 1));
      await act(async () => listeners[0]!({ data: { closing: false } }));
      await act(async () => jest.advanceTimersByTime(config.a11y.FOCUS_DELAY_MS));
      expect(bar).toHaveBeenCalledTimes(1);
      expect(focused()).toHaveLength(2);
      pinFocus(null);
    } finally {
      jest.useRealTimers();
    }
  });

  it('poza nawigacją (logowanie) tytuł niczego nie nasłuchuje', async () => {
    await render(<Text>{'x'}</Text>);
    const s = setup();
    await render(s.wrap(<Screen><Title>Organizer</Title></Screen>));
    expect(screen.getByRole('header').props.children).toBe('Organizer');
  });
});

describe('„Bez dnia” w polu daty (M-125)', () => {
  it('plan lekcji: „Do dnia” da się wyczyścić tym samym przyciskiem co w zadaniu', async () => {
    const onChange = jest.fn();
    const s = setup();
    await render(s.wrap(<DateField label="Do dnia" value="2026-12-20" onChange={onChange} today={{ y: NOW.y, m: NOW.m, d: NOW.d }} testID="d" optional />));
    await press(screen.getByTestId('d'));
    await press(screen.getByRole('button', { name: 'Bez dnia' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByTestId('d-calendar')).toBeNull();
  });

  it('pole bez „optional” albo bez dnia nie ma „Bez dnia”', async () => {
    const s = setup();
    const today = { y: NOW.y, m: NOW.m, d: NOW.d };
    await render(s.wrap(<><DateField label="A" value="2026-12-20" onChange={() => {}} today={today} testID="a" /><DateField label="B" value="" onChange={() => {}} today={today} testID="b" optional /></>));
    await press(screen.getByTestId('a'));
    await press(screen.getByTestId('b'));
    expect(screen.queryByRole('button', { name: 'Bez dnia' })).toBeNull();
  });

  it('zadanie: „Bez dnia” w kalendarzu zdejmuje termin jak „Bez terminu”', async () => {
    const { store } = await open();
    await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
    await press(await screen.findByTestId('task-date'));
    await press(screen.getByTestId('task-date-clear'));
    expect(store.getSnapshot().state.base.tasks?.['t-paczka']).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bez terminu' }).props.accessibilityState).toEqual({ selected: true }));
  });
});

describe('pola daty i godziny (M-144, M-141)', () => {
  it('etykieta to podpis, wartość raz i słownie (bez ISO), podpowiedź mówi, co zrobi dotknięcie', async () => {
    await open();
    await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/));
    const date = await screen.findByTestId('task-date');
    expect(date.props.accessibilityLabel).toBe('Dzień');
    // Pole i opcja „Inny dzień” mają różne nazwy.
    expect(screen.getAllByLabelText('Inny dzień')).toHaveLength(1);
    expect(date.props.accessibilityValue.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(date.props.accessibilityValue.text).toMatch(/października|dziś/i);
    expect(date.props.accessibilityHint).toBe('Rozwija kalendarz');
    await press(date);
    expect(screen.getByTestId('task-date').props.accessibilityHint).toBe('Zwija kalendarz');
    // Audyt 3 (N-9): stan rozwinięcia po polsku w wartości, nie angielskie „expanded” z accessibilityState.
    expect(screen.getByTestId('task-date').props.accessibilityState.expanded).toBeUndefined();
    expect(screen.getByTestId('task-date').props.accessibilityValue.text).toMatch(/, rozwinięte$/);
    const time = screen.getByTestId('task-time');
    expect(time.props.accessibilityLabel).toBe('Godzina (opcjonalnie)');
    expect(time.props.accessibilityValue).toEqual({ text: '18:00' });
    expect(time.props.accessibilityHint).toBe('Rozwija wybór godziny');
  });

  // A-46 + D186 (XCUITest 9.10.2026: ukryte skróty to „Potentially inaccessible text”): nagłówek kolumn to jeden
  // element z pełnymi nazwami — nie siedem przystanków i nie tekst, którego VoiceOver nie zna.
  it.each([
    ['mini kalendarz przy dacie', async () => (await press(screen.getByLabelText(/^Odebrać paczkę(,|$)/)), await press(await screen.findByTestId('task-date')))],
    ['Kalendarz', async () => press(screen.getByTestId('tab-Calendar'))],
  ] as const)('%s: skróty dni tygodnia jednym elementem z pełnymi nazwami', async (_where, go) => {
    await open();
    await go();
    const header = await screen.findByTestId('weekday-header');
    expect(header.props).toMatchObject({ accessible: true, accessibilityRole: 'text', accessibilityLabel: 'Dni tygodnia: poniedziałek, wtorek, środa, czwartek, piątek, sobota, niedziela' });
    expect(header.props.accessibilityElementsHidden).toBeUndefined();
    expect(within(header).getByText('pon.')).toBeTruthy();
    expect(screen.getAllByText('pon.', HIDDEN)).toHaveLength(1);
  });
});

describe('wiersze (M-141, M-142, M-150, M-263)', () => {
  it('wiersz zadania: tytuł na początku, czynność w podpowiedzi, „czeka na wysłanie” i dopiski słowami', async () => {
    await open();
    const row = screen.getByLabelText('Odebrać paczkę, 18:00, Rodzina, dla Ciebie');
    expect(row.props.accessibilityHint).toBe('Otwiera zadanie');
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText(/^Dom, /));
    await fireEvent.changeText(await screen.findByTestId('quick-add'), 'wstążka');
    await press(screen.getByLabelText('Dodaj'));
    expect(await screen.findByLabelText(/^wstążka, .*czeka na wysłanie$/)).toBeTruthy();
  });

  it('usuwanie jako czynność VoiceOvera wiersza; przycisk „Usuń” poza kolejnością VoiceOvera', async () => {
    await open();
    // Przycisk zostaje dla dotyku, ale nie jest elementem VoiceOvera (napis też nie).
    expect(screen.getByLabelText('Usuń: Odebrać paczkę').props.accessible).toBe(false);
    expect(screen.queryByRole('button', { name: 'Usuń: Odebrać paczkę' })).toBeNull();
    expect(screen.queryByText('Usuń')).toBeNull();
    const row = screen.getByLabelText(/^Odebrać paczkę(,|$)/);
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Usuń' }]);
    await act(async () => fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'other' } }));
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    await act(async () => fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } }));
    expect(within(screen.getByTestId('undo-bar')).getByText(/Odebrać paczkę/)).toBeTruthy();
  });

  it('wiersz bez otwierania (zakupy odhaczone) — zwykły element z etykietą, nie wyszarzony przycisk', async () => {
    await open();
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText(/^Zakupy na weekend/));
    const done = await screen.findByLabelText(/^Masło(,|$)/);
    expect(done.props.accessibilityRole).toBeUndefined();
    expect(done.props.accessibilityState).toBeUndefined();
    expect(done.props.accessible).toBe(true);
    const item = screen.getByLabelText(/^Chleb żytni(,|$)/);
    expect(item.props.accessibilityState.expanded).toBeUndefined();
    expect(item.props.accessibilityValue.text).toBeUndefined();
    expect(item.props.accessibilityHint).toBe('Pokazuje nazwę, dział i stałe zakupy');
    await press(item);
    expect(screen.getByLabelText(/^Chleb żytni(,|$)/).props.accessibilityValue).toEqual({ text: 'rozwinięte' });
    await expectFocusOn('Nazwa i ilość');
  });

  it('wydarzenie: bez niewidocznego „powtarza się”, długość słowami, „minione” przy wyszarzonym', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:30:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'group', deleted_at: null, version: 1 });
    put(base, 'events', 'rano', { id: 'rano', group_id: 'gf', title: 'Śniadanie', note: null, start_date: '2026-10-06', start_time: '07:00:00', end_time: '07:30:00', rrule: null, audience: 'group', deleted_at: null, version: 1 });
    await open(base);
    expect(screen.getByLabelText('Tańce, 17:00–18:30, 1 godzina 30 minut, Rodzina')).toBeTruthy();
    await press(screen.getByLabelText('Poprzedni dzień'));
    expect(await screen.findByLabelText(/^Śniadanie, [^,]+, 30 minut, Rodzina, minione$/)).toBeTruthy();
  });

  it('chip rozpoznanego fragmentu: etykieta od widocznego tekstu, czynność w podpowiedzi', async () => {
    await open();
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'basen jutro');
    const chip = await screen.findByLabelText('jutro, rozpoznane');
    expect(chip.props.accessibilityHint).toBe('Usuwa rozpoznanie, tekst zostaje w tytule');
  });

  it('spoken: symbole widoku słowami', () => {
    expect(spoken('↳ Zakupy')).toBe('podzadanie: Zakupy');
    expect(spoken('2/3 zrobione · 1 h · 2 h 5 min · 22 min')).toBe('2 z 3 zrobione, 1 godzina, 2 godziny 5 minut, 22 minuty');
  });
});

describe('etykiety z kontekstem (M-264, M-265)', () => {
  it('chip synchronizacji to jeden element (tekst ze stanem); Ustawienia — osobna ikona (PW-28 A, D188)', async () => {
    await open();
    expect(screen.getByTestId('sync-chip').props.accessible).toBe(true);
    expect(screen.getByTestId('sync-chip').props.accessibilityLabel).toMatch(/^Stan synchronizacji: /);
    expect(screen.getByTestId('open-settings').props.accessibilityRole).toBe('button');
  });

  it('obecność kilku osób: opcja mówi, czyja to odpowiedź', async () => {
    const base = sampleBase();
    put(base, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Basen', note: null, start_date: '2026-10-08', start_time: '17:00:00', end_time: '18:00:00', rrule: null, audience: 'members', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p1', { id: 'p1', event_id: 'ev', group_id: 'gf', member_id: 'mf', deleted_at: null, version: 1 });
    put(base, 'event_participants', 'p2', { id: 'p2', event_id: 'ev', group_id: 'gf', member_id: 'tymek', deleted_at: null, version: 1 });
    await open(base);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('day-2026-10-08'));
    await press(await screen.findByLabelText(/^Basen, 17:00–18:00/));
    const rsvp = await screen.findByTestId('rsvp');
    const radios = within(rsvp).getAllByRole('button').map((r) => String(r.props.accessibilityLabel));
    expect(radios.every((l) => l.includes(', '))).toBe(true);
  });

  it('karty „Do potwierdzenia”: przyciski mówią, czego dotyczą', async () => {
    const base = sampleBase();
    const h = { group_id: 'gf', entity: 'tasks', occurrence_date: null, closed: false, decided_at: null, version: 1, created_at: '2026-10-07T07:00:00Z', deleted_at: null };
    put(base, 'handoffs', 'h1', { ...h, id: 'h1', entity_id: 't-ala', from_member: 'ala', to_member: 'mf', status: 'pending' });
    await open(base);
    expect(screen.getByTestId('handoff-accept-h1').props.accessibilityLabel).toBe('Przyjmij: Zadanie Ali');
    expect(screen.getByTestId('handoff-decline-h1').props.accessibilityLabel).toBe('Odrzuć: Zadanie Ali');
  });
});

describe('stan „zajęty” (M-267)', () => {
  it('wysyłanie uwagi: przycisk zajęty ze wskaźnikiem postępu, potem potwierdzenie ogłoszone', async () => {
    let done: () => void = () => {};
    const s = await open();
    s.account.sendFeedback.mockImplementation(() => new Promise<void>((r) => (done = r)));
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('open-feedback'));
    await fireEvent.changeText(await screen.findByTestId('feedback-text'), 'Super');
    await press(screen.getByTestId('feedback-send'));
    expect(screen.getByTestId('feedback-send').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.getByTestId('feedback-send').props.accessibilityValue).toEqual({ text: 'w toku' });
    expect(screen.getByTestId('feedback-send-busy')).toBeTruthy();
    await act(async () => done());
    expect(screen.getByTestId('feedback-send').props.accessibilityValue.text).toBeUndefined();
    expect(screen.queryByTestId('feedback-send-busy')).toBeNull();
    expect(announced()).toContain('Dziękujemy! Uwaga dotarła.');
  });
});
