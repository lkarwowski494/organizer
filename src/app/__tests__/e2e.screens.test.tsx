/**
 * Tryb E2E (D143) na RNTL: te same kroki co scenariusze Maestro (.maestro/*.yaml) na atrapach z src/app/e2e.ts.
 * Sprawdza dane demo, teksty i testID, na których opierają się scenariusze — zanim pójdą na symulator w e2e.yml.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { memoryDb } from '../../data/__tests__/sqlite';
import { E2E_IDS, e2eDeps } from '../e2e';
import { Root } from '../Root';
import { answerAlert, lastAlert } from './harness';

// Oficjalna atrapa (react-native-safe-area-context/jest/mock): bez niej SafeAreaProvider czeka na wymiary ekranu z natywnej strony.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);

function start(isSimulator = true) {
  let n = 0;
  const deps = e2eDeps({
    openDb: () => memoryDb(),
    newId: () => `0199b000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
    isSimulator: async () => isSimulator,
  });
  return { deps, render: () => render(<Root deps={deps} fontsLoaded />) };
}

describe('tryb E2E (D143) — scenariusze z .maestro', () => {
  it('01 „Moje sprawy” pokazują dane demo', async () => {
    await start().render();
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    // Selektory jak w .maestro/01-today.yaml (na iOS wiersz jest jednym elementem z etykietą VoiceOver).
    expect(await screen.findByLabelText(/^Otwórz: Oddać książki do biblioteki,/)).toBeTruthy();
    expect(screen.getByLabelText(/^Otwórz: Odebrać paczkę,/)).toBeTruthy();
    expect(screen.getByTestId(`today-event-${E2E_IDS.swimming}-2026-10-07`)).toBeTruthy();
    expect(screen.getByLabelText(/^Basen Kuby, 17:00/)).toBeTruthy();
    expect(screen.queryByLabelText(/Umówić przegląd auta/)).toBeNull(); // zadanie Ali
    expect(screen.queryByTestId('whats-new')).toBeNull();
    expect(screen.queryByTestId('push-prompt')).toBeNull();
    expect(screen.queryByTestId('screen-welcome')).toBeNull();
  });

  it('02 szybkie dodanie „Kupić mleko jutro” — widać jutro', async () => {
    await start().render();
    await screen.findByText('Oddać książki do biblioteki');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Kupić mleko jutro');
    await press(screen.getByLabelText('Dodaj'));
    await press(screen.getByLabelText('Następny dzień'));
    expect(within(await screen.findByTestId('today-day-2026-10-08')).getByLabelText(/^Otwórz: Kupić mleko,/)).toBeTruthy();
    expect(screen.getByTestId('undo-bar')).toBeTruthy(); // .maestro/02 czeka, aż zniknie, przed zrzutem
  });

  it('03 wydarzenie: odpowiedź „Będę”', async () => {
    await start().render();
    await press(await screen.findByTestId(`today-event-${E2E_IDS.swimming}-2026-10-07`));
    const box = await screen.findByTestId('rsvp');
    expect(within(box).getByText('Obecność')).toBeTruthy();
    expect(screen.getAllByLabelText('Będę')).toHaveLength(1); // .maestro/03: tapOn „Będę” bez zawężania
    await press(within(box).getByLabelText('Będę'));
    expect(within(box).getByText('Tak: Ty')).toBeTruthy();
  });

  it('04 nowe wydarzenie z formularza: kafelki godzin i minut', async () => {
    await start().render();
    await screen.findByTestId('screen-today');
    await press(screen.getByTestId('tab-Calendar'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    expect(screen.getAllByLabelText('Rodzina')).toHaveLength(1);
    await press(screen.getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Wywiadówka');
    await press(screen.getByTestId('event-start-0'));
    await press(screen.getByTestId('event-start-0-h-18'));
    await press(screen.getByTestId('event-start-0-m-30'));
    await press(screen.getByTestId('event-end-0'));
    await press(screen.getByTestId('event-end-0-h-19'));
    await press(screen.getByTestId('event-end-0-m-15'));
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByTestId('screen-calendar')).toBeTruthy();
    expect(await screen.findByLabelText(/^Wywiadówka, 18:30/)).toBeTruthy();
  });

  it('08 wydarzenie przez kilka dni (D199): „Kończy się”, „dzień 2 z 3” w Kalendarzu', async () => {
    await start().render();
    await screen.findByTestId('screen-today');
    await press(screen.getByTestId('tab-Calendar'));
    await press(await screen.findByTestId('calendar-add-event'));
    await screen.findByTestId('screen-event-edit');
    await press(screen.getByLabelText('Rodzina'));
    await fireEvent.changeText(screen.getByTestId('event-title'), 'Obóz');
    expect(screen.getAllByLabelText('Cały dzień')).toHaveLength(1);
    await press(screen.getByLabelText('Cały dzień'));
    await press(screen.getByTestId('event-end-date'));
    const cal = screen.getByTestId('event-end-date-calendar');
    const friday = within(cal).getAllByLabelText(/^Piątek, 9 października/);
    expect(friday).toHaveLength(1);
    await press(friday[0]!);
    await press(screen.getByTestId('event-save'));
    expect(await screen.findByTestId('screen-calendar')).toBeTruthy();
    await press(screen.getByTestId('day-2026-10-08'));
    expect(await screen.findByLabelText(/^Obóz, cały dzień, dzień 2 z 3/)).toBeTruthy();
  });

  it('05 lista zakupów: dodanie produktu i włożenie do koszyka', async () => {
    await start().render();
    await screen.findByTestId('screen-today');
    await press(screen.getByTestId('tab-Lists'));
    await press(await screen.findByTestId(`list-${E2E_IDS.shoppingList}`));
    await screen.findByTestId('screen-list');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Ser żółty');
    await press(screen.getByLabelText('Dodaj'));
    await press(await screen.findByLabelText('Włóż do koszyka: Ser żółty'));
    // Bez pytania, z paskiem „Cofnij” (zmiana D59) — .maestro/05 czeka, aż pasek zniknie, przed zrzutem.
    expect(within(screen.getByTestId('undo-bar')).getByText('W koszyku: Ser żółty')).toBeTruthy();
    expect(await screen.findByLabelText('Wyjmij z koszyka: Ser żółty')).toBeTruthy();
    expect(await screen.findByLabelText('Stan synchronizacji: Przed chwilą', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('06 Ustawienia się otwierają', async () => {
    await start().render();
    await screen.findByTestId('screen-today');
    expect(screen.getAllByLabelText('Ustawienia')).toHaveLength(1);
    await press(screen.getByLabelText('Ustawienia'));
    expect(await screen.findByTestId('screen-settings')).toBeTruthy();
    // .maestro/06: „Konto i dane” (D131), przewinięcie do „Wyloguj”, powrót na stronę główną do zrzutu.
    expect(screen.getAllByLabelText('Konto i dane')).toHaveLength(1);
    await press(screen.getByLabelText('Konto i dane'));
    expect(await screen.findByTestId('screen-settings-account')).toBeTruthy();
    expect(screen.getByTestId('sign-out')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    expect(await screen.findByTestId('screen-settings')).toBeTruthy();
    expect(await screen.findByLabelText('Stan synchronizacji: Przed chwilą', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('zmiany przechodzą przez „serwer” i wracają przy pobraniu (synchronizacja bez sieci)', async () => {
    const t = start();
    await t.render();
    await screen.findByText('Oddać książki do biblioteki');
    await fireEvent.changeText(screen.getByTestId('quick-add'), 'Zadzwonić do babci');
    await press(screen.getByLabelText('Dodaj'));
    // Pętla wysyła po config.sync.PUSH_DEBOUNCE_MS (prawdziwy timer), serwer oddaje wiersz przy pobraniu.
    await waitFor(
      async () => {
        const res = await t.deps.transport.pull({ cursors: {}, schema_version: 2, entities: [] }, 100);
        expect(res.groups.flatMap((g) => g.rows).some((r) => r.row.title === 'Zadzwonić do babci')).toBe(true);
      },
      { timeout: 5000 },
    );
  });

  it('wylogowanie i ponowne logowanie (Apple) w trybie E2E', async () => {
    const t = start();
    await t.render();
    await screen.findByTestId('screen-today');
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-account'));
    await press(await screen.findByTestId('sign-out'));
    expect(lastAlert().title).toBe('Wylogować się?');
    await answerAlert('Wyloguj');
    expect(await screen.findByTestId('screen-sign-in')).toBeTruthy();
    await act(() => t.deps.account.signInWithApple());
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('druga bariera: poza symulatorem nie ma sesji demo — tylko ekran logowania', async () => {
    const t = start(false);
    await t.render();
    expect(await screen.findByTestId('screen-sign-in')).toBeTruthy();
    await expect(t.deps.account.signInWithApple()).rejects.toThrow('e2e_not_simulator');
    expect(screen.queryByTestId('screen-today')).toBeNull();
  });
});
