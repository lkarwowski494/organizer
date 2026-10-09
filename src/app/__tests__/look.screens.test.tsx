/**
 * Audyt 2 — wygląd, kontrast i układ (paczka P14): dziś i święta w siatce miesiąca (M-140, M-291), jeden wzór
 * zaznaczenia (M-151), kafelki godzin na pełnej szerokości pod parą pól (M-45), margines pod treścią i pasek „Cofnij”
 * (M-149), szerokość treści na iPadzie (M-294), glify (M-293), przełączniki w Ustawieniach (M-308).
 */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { layout, palettes, sizes, space } from '../../config/theme';
import { glyphSize } from '../../ui/glyph';
import { RootStack } from '../navigation';
import type { TravelService } from '../travel-service';
import { setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const c = palettes.light;
/** Insety z harness (iPhone z wskaźnikiem Home). */
const HOME = 34;

describe('siatka miesiąca: dziś, święto, zaznaczenie', () => {
  it('Kalendarz: dziś — kółko z obwódką i „Dziś, …” dla VoiceOvera; święto — kreska pod liczbą; zaznaczenie ciemnym wypełnieniem', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await screen.findByTestId('screen-calendar');
    // Dziś = 7.10.2026 (harness).
    expect(screen.getByTestId('day-2026-10-07').props.accessibilityLabel).toMatch(/^Dziś, Środa, 7 października/);
    expect(screen.getByTestId('day-2026-10-08').props.accessibilityLabel).not.toMatch(/Dziś/);
    // Dziś jest też zaznaczony na starcie — wypełnienie; po wyborze innego dnia dziś ma obwódkę, wybrany — wypełnienie.
    expect(flat(screen.getByTestId('day-num-2026-10-07')).backgroundColor).toBe(c.ink);
    await press(screen.getByTestId('day-2026-10-08'));
    expect(flat(screen.getByTestId('day-num-2026-10-07'))).toMatchObject({ borderWidth: 2, borderColor: c.ink, backgroundColor: 'transparent' });
    expect(flat(screen.getByTestId('day-num-2026-10-08'))).toMatchObject({ backgroundColor: c.ink, borderWidth: 0 });
    expect(flat(within(screen.getByTestId('day-num-2026-10-08')).getByText('8')).color).toBe(c.surface);
    // 1 listopada (Wszystkich Świętych) w ostatnim tygodniu siatki października: kreska, nie tylko kolor.
    expect(screen.getByTestId('day-num-2026-11-01-holiday')).toBeTruthy();
    expect(screen.queryByTestId('day-num-2026-10-08-holiday')).toBeNull();
    expect(screen.getByTestId('day-2026-11-01').props.accessibilityLabel).toMatch(/Wszystkich Świętych/);
  });

  it('mini kalendarz: „Dziś, …”, obwódka dnia dzisiejszego, zaznaczony dzień ciemny (nie terakota)', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(await screen.findByLabelText('Więcej'));
    await press(await screen.findByTestId('form-date'));
    const today = screen.getAllByLabelText(/^Dziś, Środa, 7 października/);
    expect(today).toHaveLength(1);
    const id = String(today[0]!.props.testID).replace('-day-', '-num-');
    expect(flat(screen.getByTestId(id))).toMatchObject({ borderWidth: 2, borderColor: c.ink });
    await press(screen.getByLabelText('Czwartek, 8 października'));
    await press(screen.getByTestId('form-date'));
    const sel = screen.getByLabelText('Czwartek, 8 października');
    expect(sel.props.accessibilityState).toMatchObject({ selected: true });
    expect(flat(screen.getByTestId(String(sel.props.testID).replace('-day-', '-num-'))).backgroundColor).toBe(c.ink);
  });
});

describe('zaznaczenie (PW-52 A, D198)', () => {
  it('wybór wielu (dni tygodnia): ciemne wypełnienie i ✓; terakota zostaje dla przycisku głównego', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    const wed = screen.getAllByRole('checkbox').find((e) => e.props.accessibilityState?.checked)!;
    expect(flat(wed)).toMatchObject({ backgroundColor: c.ink });
    expect(within(wed).getByTestId('glyph-check', { includeHiddenElements: true }).props).toMatchObject({ name: 'checkmark', tintColor: c.surface });
    const off = screen.getAllByRole('checkbox').find((e) => !e.props.accessibilityState?.checked)!;
    expect(flat(off).backgroundColor).toBe(c.surface);
    expect(within(off).queryByTestId('glyph-check', { includeHiddenElements: true })).toBeNull();
  });
});

describe('kafelki godzin pod parą pól (M-45, D195)', () => {
  it('jeden panel na pełnej szerokości pod „Początek” i „Koniec”; kafelek ≥ 44 pt; zaznaczenie wypełnia tylko swój kafelek', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Kalendarz'));
    await press(await screen.findByTestId('calendar-add-routine'));
    await press(screen.getByTestId('routine-start'));
    const panel = screen.getByTestId('routine-start-panel');
    // Panel nie leży w kolumnie pola (połowie szerokości), tylko pod całą parą.
    let col = screen.getByTestId('routine-start').parent;
    while (col && flat(col).flex !== 1) col = col.parent;
    expect(col).toBeTruthy();
    expect(within(col!).queryByTestId('routine-start-panel')).toBeNull();
    expect(within(col!.parent!.parent!).getByTestId('routine-start-panel')).toBe(panel);
    // Drugi panel otwiera się w tym samym miejscu, pierwszy się zwija.
    await press(screen.getByTestId('routine-end'));
    expect(screen.queryByTestId('routine-start-panel')).toBeNull();
    expect(screen.getByTestId('routine-end-panel')).toBeTruthy();
    await press(screen.getByTestId('routine-end-h-17'));
    const tile = screen.getByTestId('routine-end-h-17');
    expect(flat(tile)).toMatchObject({ width: `${100 / 6}%`, minHeight: sizes.TOUCH_TARGET });
    expect(flat(screen.getByTestId('routine-end-h-17-tile'))).toMatchObject({ flex: 1, backgroundColor: c.ink });
    expect(flat(screen.getByTestId('routine-end-h-17-tile')).minWidth).toBeUndefined();
    expect(flat(screen.getByTestId('routine-end-h-16-tile')).backgroundColor).toBe('transparent');
  });
});

describe('układ ekranu', () => {
  const content = () => flat({ props: { style: screen.getByTestId('screen-settings').props.contentContainerStyle } });

  it('ekran stosu: margines pod treścią obejmuje strefę wskaźnika Home (M-149); treść najwyżej 600 pt, wyśrodkowana (M-294)', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Ustawienia'));
    await screen.findByTestId('screen-settings');
    expect(content()).toMatchObject({ paddingBottom: space.SCREEN_BOTTOM + HOME, maxWidth: layout.CONTENT_MAX_WIDTH + 2 * space.SCREEN_SIDE, alignSelf: 'center', width: '100%' });
  });

  it('pasek „Cofnij” dodaje miejsce pod treścią — ostatni przycisk nie chowa się pod nim (M-149)', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Dom, Rodzina · Zadania · 3 otwarte'));
    const list = await screen.findByTestId(/^screen-list/);
    const pad = () => flat({ props: { style: list.props.contentContainerStyle } }).paddingBottom as number;
    expect(pad()).toBe(space.SCREEN_BOTTOM + HOME);
    await press(screen.getAllByLabelText(/^Usuń: /)[0]!);
    expect(screen.getByTestId('undo-bar')).toBeTruthy();
    expect(pad()).toBe(HOME + layout.UNDO_BAR_OFFSET + layout.UNDO_BAR_MIN_HEIGHT + space.SCREEN_GAP);
  });
});

describe('glify i przełączniki', () => {
  it('„Wróć” i strzałka wiersza: symbol SF Symbols, niewidoczny dla VoiceOvera, rośnie z Dynamic Type do 200% (M-293)', async () => {
    const s = setup();
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Ustawienia'));
    const back = await screen.findByLabelText('Wróć');
    const glyph = within(back).getByTestId('glyph-prev', { includeHiddenElements: true });
    // Środowisko testów podaje fontScale 2 — symbol rośnie razem z tekstem.
    expect(glyph.props).toMatchObject({ name: 'chevron.left', size: glyphSize(sizes.GLYPH_ROW, Dimensions.get('window').fontScale, 2), weight: 'semibold', tintColor: c.ink, accessible: false, importantForAccessibility: 'no-hide-descendants' });
    expect(within(screen.getAllByLabelText(/^Powiadomienia/)[0]!).getByTestId('glyph-next', { includeHiddenElements: true }).props.name).toBe('chevron.right');
  });

  it('rozmiar symbolu: mnożnik Dynamic Type z limitem 200%, bez mnożnika — rozmiar bazowy', () => {
    expect(glyphSize(17, 1.5, 2)).toBe(26);
    expect(glyphSize(17, 3.571, 2)).toBe(34);
    expect(glyphSize(17, 0, 2)).toBe(17);
  });

  it('Ustawienia: włącz/wyłącz to systemowy przełącznik z nazwą wiersza (M-308)', async () => {
    const travel = { status: jest.fn(async () => 'granted' as const), request: jest.fn(async () => true), position: jest.fn(), geocode: jest.fn(), eta: jest.fn() } as unknown as TravelService;
    const m = new Map([['welcomeSeen', '1']]);
    const prefs = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) };
    const s = setup({ travel, prefs });
    await s.renderApp(<RootStack />);
    await press(screen.getByLabelText('Ustawienia'));
    await press(await screen.findByTestId('settings-calendar'));
    const sw = await screen.findByTestId('switch-travel');
    expect(sw.props.accessibilityRole).toBe('switch');
    expect(sw.props.accessibilityLabel).toBe('Czas dojazdu do najbliższych wydarzeń');
    expect(screen.queryByLabelText('Włączony')).toBeNull();
  });
});
