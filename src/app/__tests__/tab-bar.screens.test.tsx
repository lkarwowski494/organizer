/**
 * Audyt 3 — pasek zakładek i kontrast stanu offline (paczka PK-22): napis zakładki stałej wielkości z Large Content
 * Viewer i plakietką w rogu (N-67, decyzja Q11 A), wybrana zakładka odróżniona od reszty ≥ 3:1 (N-68, WCAG 2.1 SC 1.4.11),
 * obwódka i kropka „offline” ≥ 3:1 (N-200) — we wszystkich motywach: jasny, ciemny, oba z „Zwiększ kontrast”.
 */
import { screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { contrastMin, paletteOf, type Scheme, sizes } from '../../config/theme';
import { contrastRatio } from '../../domain/contrast';
import { RootStack } from '../navigation';
import { put, sampleBase, setup } from './harness';

type El = { props: Record<string, unknown>; children: (El | string)[]; type: unknown; parent: El | null };
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
/** Potomkowie (host) spełniający warunek, w kolejności drzewa. */
function findAll(root: El, ok: (n: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (n: El | string) => {
    if (typeof n === 'string') return;
    if (n !== root && ok(n)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}
/** Pierwszy potomek (host View) z tłem — pigułka zakładki. */
const pill = (tab: El) => findAll(tab, (n) => n.type === 'View' && 'backgroundColor' in flat(n))[0]!;
const labelOf = (tab: El, text: string) => within(tab as never).getByText(text) as unknown as El;

/** Przekazanie czekające na moją decyzję — plakietka „1” na „Moje sprawy” (D70). */
function baseWithHandoff() {
  const t = sampleBase();
  put(t, 'handoffs', 'h1', { id: 'h1', group_id: 'gf', entity: 'tasks', entity_id: 't-ala', from_member: 'ala', to_member: 'mf', status: 'pending', occurrence_date: null, closed: false, decided_at: null, version: 1, created_at: '2026-10-07T07:00:00Z', deleted_at: null });
  return t;
}

const THEMES: [string, Scheme, boolean][] = [
  ['jasny', 'light', false],
  ['ciemny', 'dark', false],
  ['jasny, Zwiększ kontrast', 'light', true],
  ['ciemny, Zwiększ kontrast', 'dark', true],
];

afterEach(() => jest.restoreAllMocks());

describe.each(THEMES)('motyw %s', (_name, scheme, increased) => {
  const c = paletteOf(scheme, increased);
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(increased);
  });

  it('N-68: wybrana zakładka — pigułka ≥ 3:1 do paska, napis inny niż niewybranych i ≥ 4,5:1 do pigułki', async () => {
    await setup({ scheme }).renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    const bar = flat((screen.getByTestId('tab-Today') as unknown as El).parent!).backgroundColor as string;
    const on = screen.getByTestId('tab-Today') as unknown as El;
    const off = screen.getByTestId('tab-Lists') as unknown as El;
    const onPill = flat(pill(on) as never).backgroundColor as string;
    expect(contrastRatio(onPill, bar)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
    expect(flat(pill(off) as never).backgroundColor).toBe('transparent');
    const onInk = flat(labelOf(on, 'Moje sprawy') as never).color as string;
    const offInk = flat(labelOf(off, 'Listy') as never).color as string;
    expect(contrastRatio(onInk, onPill)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    expect(contrastRatio(offInk, bar)).toBeGreaterThanOrEqual(contrastMin.TEXT);
    // Jeden wzór zaznaczenia w aplikacji (D198): ciemne wypełnienie, jasny napis.
    expect(onPill).toBe(c.ink);
    expect(onInk).toBe(c.surface);
  });

  it('N-67: napis stałej wielkości (bez zmniejszania), Large Content Viewer z tytułem, plakietka w rogu nie zabiera miejsca napisowi', async () => {
    await setup({ scheme, base: baseWithHandoff() }).renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    for (const [id, text] of [['Today', 'Moje sprawy'], ['Lists', 'Listy'], ['Calendar', 'Kalendarz'], ['Groups', 'Grupy']] as const) {
      const tab = screen.getByTestId(`tab-${id}`);
      const label = labelOf(tab as never, text);
      expect(label.props.adjustsFontSizeToFit).toBeFalsy();
      expect(label.props.allowFontScaling).toBe(false);
      expect(flat(label as never).fontSize).toBe(sizes.TAB);
      expect(sizes.TAB).toBeGreaterThanOrEqual(sizes.MIN_TEXT);
      // Wąski ekran: druga linia zamiast zmniejszania napisu.
      expect(label.props.numberOfLines).toBe(2);
      expect(tab.props.accessibilityShowsLargeContentViewer).toBe(true);
      expect(tab.props.accessibilityLargeContentTitle).toBe(tab.props.accessibilityLabel);
    }
    expect(screen.getByTestId('tab-Today').props.accessibilityLargeContentTitle).toBe('Moje sprawy, 1 do potwierdzenia');
    const badge = screen.getByTestId('tab-badge');
    expect(flat(badge)).toMatchObject({ position: 'absolute' });
    // Obwódka w kolorze paska oddziela czerwoną plakietkę od ciemnej pigułki wybranej zakładki.
    expect(flat(badge).borderColor).toBe(c.surface);
    expect(contrastRatio(flat(badge).backgroundColor as string, c.surface)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
  });

  it('N-200: obwódka i kropka stanu offline ≥ 3:1 do tła stanu i do tła ekranu', async () => {
    await setup({ scheme, indicator: { state: 'offline', pending: 0 } }).renderApp(<RootStack />);
    const chip = await screen.findByTestId('sync-chip');
    const s = flat(chip);
    const dot = findAll(chip as unknown as El, (n) => n.type === 'View' && flat(n).width === 8)[0]!;
    for (const fg of [s.borderColor as string, flat(dot as never).backgroundColor as string]) {
      expect(contrastRatio(fg, s.backgroundColor as string)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
      expect(contrastRatio(fg, c.ground)).toBeGreaterThanOrEqual(contrastMin.NON_TEXT);
    }
  });
});
