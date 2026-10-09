/**
 * Audyt drzewa (a11y-audit.ts) przy włączonych „Zwiększ kontrast” i „Pogrubiony tekst” iOS (audyt 3, N-59): kilka ekranów
 * w obu trybach — tańsze niż powtórzenie całego a11y.test.tsx, a obejmuje każdy rodzaj elementu (wiersze, pola, opcje,
 * mini kalendarz, kafelki godzin, pasek zakładek). Paleta z highContrast (src/config/theme.ts), korpus par — ten sam
 * contrastPairs liczony na tej palecie; ustawienia czyta src/ui/theme.tsx z AccessibilityInfo.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { contrastPairs, groupLines, highContrastPairs, paletteOf, type Scheme } from '../../config/theme';
import { RootStack } from '../navigation';
import { audit } from './a11y-audit';
import { setup } from './harness';

/**
 * Znane odstępstwo wspólne z a11y.test.tsx: napis zakładki zmniejsza się bez minimumFontScale (N-67, paczka „Wygląd:
 * pasek zakładek” — rozmiar napisu i plakietka po decyzji Q11).
 */
const KNOWN = /^tekst „(Moje sprawy|Listy|Kalendarz|Grupy)” zmniejsza się do 0 pt/;

const SCREENS: [string, (press: (l: string | RegExp) => Promise<void>) => Promise<void>][] = [
  ['Moje sprawy', async () => {}],
  ['Lista zakupów', async (p) => (await p('Listy'), await p(/^Zakupy na weekend, /))],
  ['Zadanie', async (p) => p(/^Odebrać paczkę(,|$)/)],
  ['Pełny formularz zadania z mini kalendarzem', async (p) => (await p('Więcej'), await fireEvent.press(await screen.findByTestId('form-date')))],
  ['Kalendarz', async (p) => p('Kalendarz')],
  ['Nowa rutyna z kafelkami godzin', async (p) => (await p('Kalendarz'), await fireEvent.press(await screen.findByTestId('calendar-add-routine')), await fireEvent.press(await screen.findByTestId('routine-start')))],
  ['Grupa', async (p) => (await p('Grupy'), await p(/^Rodzina, /))],
  ['Ustawienia', async (p) => p('Ustawienia')],
];

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isBoldTextEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe.each(['light', 'dark'] as Scheme[])('„Zwiększ kontrast” i „Pogrubiony tekst”, tryb %s', (scheme) => {
  const palette = paletteOf(scheme, true);
  const corpus = [...contrastPairs(palette), ...highContrastPairs(palette)];

  it.each(SCREENS)('%s: audyt bez problemów, pary kolorów z korpusu palety „Zwiększ kontrast”', async (name, go) => {
    const s = setup({ scheme });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await go(async (label) => {
      await fireEvent.press(await screen.findByLabelText(label));
    });
    const r = audit(screen.root!, palette, name, { screen: true });
    expect(r.problems.filter((p) => !KNOWN.test(p.slice(name.length + 2)))).toEqual([]);
    const missing = r.pairs.filter((p) => {
      const inCorpus = corpus.some((c) => c.kind === p.kind && c.fg.toUpperCase() === p.fg && c.bg.toUpperCase() === p.bg);
      const line = p.kind === 'TEXT' && groupLines.some((g) => g[scheme].ink.toUpperCase() === p.fg);
      return !inCorpus && !line;
    });
    expect(missing).toEqual([]);
    // Ustawienie naprawdę działa: obwódka pola z palety „Zwiększ kontrast”.
    expect(r.pairs.some((p) => p.fg === palette.control.toUpperCase())).toBe(true);
  });
});
