/**
 * Kontrakt scenariuszy Maestro (.maestro/*.yaml): wskaźnik synchronizacji jest w pierwszym wierszu ekranu
 * (ListScreen, SettingsScreen, TabHeader). Maestro widzi tylko elementy na ekranie (2.11.0, ViewHierarchy:
 * `filterOutOfBounds`), więc po przewinięciu w dół czekanie na wskaźnik zawsze oblewa, choć aplikacja działa
 * (audyt 3, N-81). Po `scrollUntilVisible` w dół scenariusz musi wrócić na górę, zanim sprawdzi wskaźnik.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '../../../.maestro');
const flows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f) && f !== 'config.yaml');

/** Kroki scenariusza: każdy zaczyna się od `- ` w pierwszej kolumnie (bez komentarzy). */
const steps = (s: string) =>
  s
    .split('---')
    .slice(1)
    .join('---')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .split(/\n(?=- )/)
    .map((x) => x.trim())
    .filter(Boolean);

const checksSyncChip = (step: string) =>
  /^- (extendedWaitUntil|assertVisible|assertNotVisible)/.test(step) && /Stan synchronizacji|id: "sync-chip"/.test(step);

/** Numery kroków, które sprawdzają wskaźnik, gdy ekran jest przewinięty w dół. */
function syncChecksBelowTop(text: string): number[] {
  let scrolledDown = false;
  const bad: number[] = [];
  steps(text).forEach((step, i) => {
    if (/^- scrollUntilVisible/.test(step)) scrolledDown = !/direction: UP/.test(step);
    else if (/^- (tapOn: "Wróć"|runFlow|tapOn:\s*\n\s+id: "tab-)/.test(step)) scrolledDown = false;
    else if (scrolledDown && checksSyncChip(step)) bad.push(i);
  });
  return bad;
}

describe('scenariusze Maestro — wskaźnik synchronizacji na górze ekranu (N-81)', () => {
  it('wykrywa czekanie na wskaźnik po przewinięciu w dół (wersja 05 sprzed poprawki)', () => {
    const before = [
      'appId: x',
      '---',
      '- scrollUntilVisible:',
      '    element: "Wyjmij z koszyka: Ser żółty"',
      '    direction: DOWN',
      '- extendedWaitUntil:',
      '    visible: "Stan synchronizacji: Przed chwilą"',
    ].join('\n');
    expect(syncChecksBelowTop(before)).toEqual([1]);
    const after = before.replace('- extendedWaitUntil', '- scrollUntilVisible:\n    element:\n      id: "sync-chip"\n    direction: UP\n- extendedWaitUntil');
    expect(syncChecksBelowTop(after)).toEqual([]);
  });

  it.each(flows)('%s nie sprawdza wskaźnika poza ekranem', (f) => {
    expect(syncChecksBelowTop(readFileSync(join(DIR, f), 'utf8'))).toEqual([]);
  });
});
