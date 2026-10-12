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
    // common/scroll-tap*.yaml i common/scroll-to.yaml przewijają w dół.
    else if (/^- runFlow:\s*\n\s+file: common\/scroll-(tap(-text)?|to)\.yaml/.test(step)) scrolledDown = true;
    // Wspólny start (launch.yaml) otwiera ekran od góry; wpisanie tekstu (type.yaml) nie przewija w górę.
    else if (/^- (tapOn: "Wróć"|runFlow: common\/launch\.yaml|runFlow:\s*\n\s+file: common\/open-tab\.yaml)/.test(step)) scrolledDown = false;
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

/**
 * `centerElement` w `scrollUntilVisible` (Maestro 2.11.0, Orchestra.scrollUntilVisible): krok kończy się dopiero, gdy
 * środek elementu wejdzie w pas środka ekranu (UiElement.isElementNearScreenCenter: przy przewijaniu w dół środek wyżej
 * niż 70% wysokości), a zwykły warunek widoczności sprawdza dopiero po 4 próbach centrowania — każda z przesunięciem
 * i czekaniem na uspokojenie ekranu. Przyciski na końcu treści (Kalendarz: „Dodaj wydarzenie”, „Dodaj rutynę”) nie
 * mogą wejść w ten pas, więc krok przewija do limitu czasu i zgłasza „No visible element found”, choć przycisk widać
 * (04 na main od 71abed3). Koniec ruchu przed dotknięciem daje `waitForAnimationToEnd`.
 * Źródło: https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt
 */
const centered = (text: string) => steps(text).flatMap((step, i) => (/^- scrollUntilVisible/.test(step) && /centerElement:\s*true/.test(step) ? [i] : []));

describe('scenariusze Maestro — przewijanie bez centerElement', () => {
  it('wykrywa centerElement (wersja 04 z 71abed3)', () => {
    const before = ['appId: x', '---', '- scrollUntilVisible:', '    element:', '      id: "calendar-add-event"', '    direction: DOWN', '    centerElement: true', '- tapOn:', '    id: "calendar-add-event"'].join('\n');
    expect(centered(before)).toEqual([0]);
    expect(centered(before.replace('    centerElement: true\n', ''))).toEqual([]);
  });

  it.each(flows)('%s przewija bez centerElement', (f) => {
    expect(centered(readFileSync(join(DIR, f), 'utf8'))).toEqual([]);
  });

  it('04 i 08 dotykają „Dodaj wydarzenie” przez common/scroll-tap.yaml (nocny przebieg 38106362581: za paskiem zakładek)', () => {
    for (const f of ['04-event-form.yaml', '08-multi-day.yaml']) {
      const s = steps(readFileSync(join(DIR, f), 'utf8'));
      expect(s.filter((x) => /^- tapOn:\s*\n\s+id: "calendar-add-event"/.test(x))).toEqual([]);
      expect(s.some((x) => /^- runFlow:\s*\n\s+file: common\/scroll-tap\.yaml\s*\n\s+env:\s*\n\s+ID: "calendar-add-event"/.test(x))).toBe(true);
    }
  });
});

/**
 * Wpisywanie tekstu (przebieg e2e 57, 9.10.2026: 08 zapisało „O” zamiast „Obóz”). Maestro 2.11.0 wpisuje pierwszy znak
 * osobno, a resztę po 0,5 s, bo „characters after the first one are often skipped” (TextInputHelper.swift,
 * https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Helpers/TextInputHelper.swift).
 * Każde wpisanie idzie przez common/type.yaml: sprawdzenie, że pole ma cały tekst, i ponowienie (retry) — scenariusz
 * oblewa przy polu, nie trzy kroki dalej, i nie zależy od tego, czy Maestro zgubi znaki.
 */
const TYPE = readFileSync(join(DIR, 'common/type.yaml'), 'utf8');
const rawTyping = (text: string) => steps(text).flatMap((step, i) => (/^- inputText/.test(step) ? [i] : []));
const typedFields = (text: string) => steps(text).flatMap((step) => (/^- runFlow:\s*\n\s+file: common\/type\.yaml/.test(step) ? [[/FIELD: "([^"]+)"/.exec(step)?.[1], /TEXT: "([^"]+)"/.exec(step)?.[1]]] : []));

describe('scenariusze Maestro — wpisywanie tekstu ze sprawdzeniem pola', () => {
  it('wykrywa gołe inputText (wersja 08 sprzed poprawki)', () => {
    const before = ['appId: x', '---', '- tapOn:', '    id: "event-title"', '- inputText: "Obóz"', '- hideKeyboard'].join('\n');
    expect(rawTyping(before)).toEqual([1]);
    const after = ['appId: x', '---', '- runFlow:', '    file: common/type.yaml', '    env:', '      FIELD: "event-title"', '      TEXT: "Obóz"', '- hideKeyboard'].join('\n');
    expect(rawTyping(after)).toEqual([]);
    expect(typedFields(after)).toEqual([['event-title', 'Obóz']]);
  });

  it.each(flows)('%s wpisuje tekst tylko przez common/type.yaml, z polem i tekstem bez znaków wyrażeń regularnych', (f) => {
    const text = readFileSync(join(DIR, f), 'utf8');
    expect(rawTyping(text)).toEqual([]);
    for (const [field, value] of typedFields(text)) {
      expect(field).toMatch(/^[\w-]+$/);
      expect(value).toMatch(/^[\p{L} ]+$/u);
    }
  });

  it('common/type.yaml: wyczyszczenie, wpisanie i sprawdzenie wartości pola w retry', () => {
    const [retry, ...rest] = steps(TYPE);
    expect(rest).toEqual([]);
    expect(retry).toMatch(/^- retry:\s*\n\s+maxRetries: 2\s*\n\s+commands:/);
    const order = ['tapOn:\n          id: ${FIELD}', 'eraseText', 'inputText: ${TEXT}', 'assertVisible:\n          id: ${FIELD}\n          text: ${TEXT}'].map((x) => retry!.indexOf(x));
    expect(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1]!))).toBe(true);
  });

  it('scenariusze z wpisywaniem: 02, 04, 05, 07, 08', () => {
    expect(flows.filter((f) => typedFields(readFileSync(join(DIR, f), 'utf8')).length)).toEqual(['02-quick-add.yaml', '04-event-form.yaml', '05-shopping.yaml', '07-keyboard.yaml', '08-multi-day.yaml']);
  });
});

/**
 * Ekran Licencje (audyt 3, N-78): lista ma ponad 80 pozycji w kolejności alfabetycznej. Maestro 2.11.0 przewija
 * `scrollUntilVisible` krokami z czekaniem na uspokojenie ekranu; w E2E 65 (80ef39a) przez 20 s doszedł do ok. 20. pozycji
 * i nie znalazł „react-native” (69. pozycja). Scenariusz otwiera więc pozycję z początku listy — ta sama ścieżka
 * (lista → tekst licencji), bez zależności od szybkości runnera.
 */
const LICENSES = JSON.parse(readFileSync(join(__dirname, '../../licenses/third-party.json'), 'utf8')) as { packages: { name: string; kind: string }[] };
// `id:` w kroku albo `ID:` w env common/scroll-to.yaml.
const licenseRows = (text: string) => [...text.matchAll(/\b(?:id|ID): "license-(?!text")([^"]+)"/g)].map((m) => m[1]!);
const NEAR_TOP = 3;

describe('scenariusze Maestro — pozycje ekranu Licencje z początku listy', () => {
  it('wykrywa pozycję daleko na liście (wersja 06 z 80ef39a: react-native)', () => {
    const at = LICENSES.packages.findIndex((p) => p.name === 'react-native');
    expect(at).toBeGreaterThanOrEqual(NEAR_TOP);
    expect(licenseRows('- tapOn:\n    id: "license-react-native"')).toEqual(['react-native']);
  });

  it('06 otwiera pozycję z pierwszych na liście, która jest w pliku licencji', () => {
    const rows = licenseRows(readFileSync(join(DIR, '06-settings.yaml'), 'utf8'));
    expect(rows.length).toBeGreaterThan(0);
    for (const name of new Set(rows)) {
      const at = LICENSES.packages.findIndex((p) => p.name === name);
      expect(at >= 0 && at < NEAR_TOP ? name : `${name}: pozycja ${at}`).toBe(name);
    }
  });

  it.each(flows)('%s: każda pozycja ekranu Licencje z początku listy', (f) => {
    for (const name of licenseRows(readFileSync(join(DIR, f), 'utf8'))) expect(LICENSES.packages.findIndex((p) => p.name === name)).toBeLessThan(NEAR_TOP);
  });
});

/**
 * Przejście na zakładkę (E2E 65, 80ef39a: 08 dotknęło „Kalendarz”, aplikacja została na „Moich sprawach”, bo Kalendarz
 * i plan przypomnień były wtedy poza budżetem czasu — naprawione w 5c62b7a). Gołe dotknięcie zakładki przepuszczało to
 * do kolejnego kroku (przewijanie niewłaściwego ekranu, „No visible element found: calendar-add-event”). Każde przejście
 * idzie przez common/open-tab.yaml: dotknięcie i czekanie na ekran zakładki (bez ponawiania — zakładka, która się nie
 * otwiera, to błąd aplikacji). Pary zakładka → ekran sprawdzone z kodem (navigation.tsx: testID `tab-<nazwa>`).
 */
const OPEN_TAB = readFileSync(join(DIR, 'common/open-tab.yaml'), 'utf8');
const rawTabTaps = (text: string) => steps(text).flatMap((step, i) => (/^- tapOn:\s*\n\s+id: "tab-/.test(step) ? [i] : []));
const openedTabs = (text: string) => steps(text).flatMap((step) => (/^- runFlow:\s*\n\s+file: common\/open-tab\.yaml/.test(step) ? [[/TAB: "([^"]+)"/.exec(step)?.[1], /SCREEN: "([^"]+)"/.exec(step)?.[1]]] : []));
const SRC = join(__dirname, '../..');
const NAV = readFileSync(join(SRC, 'app/navigation.tsx'), 'utf8');
/** Ekran każdej zakładki: <Tab.Screen name="X" component={Y} /> i testID ekranu z pliku komponentu Y. */
const tabScreens = new Map(
  [...NAV.matchAll(/<Tab\.Screen name="(\w+)" component=\{(\w+)\}/g)].map(([, name, comp]) => {
    const file = new RegExp(`import \\{ ${comp} \\} from '\\.\\./([^']+)'`).exec(NAV)![1]!;
    const src = readFileSync(join(SRC, `${file}.tsx`), 'utf8');
    return [`tab-${name}`, /<Screen testID="(screen-[\w-]+)"/.exec(src)?.[1]];
  }),
);

describe('scenariusze Maestro — przejście na zakładkę ze sprawdzeniem ekranu', () => {
  it('wykrywa gołe dotknięcie zakładki (wersja 08 z 80ef39a)', () => {
    const before = ['appId: x', '---', '- runFlow: common/launch.yaml', '- tapOn:', '    id: "tab-Calendar"', '- scrollUntilVisible:', '    element:', '      id: "calendar-add-event"'].join('\n');
    expect(rawTabTaps(before)).toEqual([1]);
    const after = before.replace('- tapOn:\n    id: "tab-Calendar"', '- runFlow:\n    file: common/open-tab.yaml\n    env:\n      TAB: "tab-Calendar"\n      SCREEN: "screen-calendar"');
    expect(rawTabTaps(after)).toEqual([]);
    expect(openedTabs(after)).toEqual([['tab-Calendar', 'screen-calendar']]);
  });

  it('zakładki i ich ekrany z kodu aplikacji', () => {
    expect([...tabScreens]).toEqual([
      ['tab-Today', 'screen-today'],
      ['tab-Lists', 'screen-lists'],
      ['tab-Calendar', 'screen-calendar'],
      ['tab-Groups', 'screen-groups'],
    ]);
  });

  it.each(flows)('%s przechodzi na zakładkę tylko przez common/open-tab.yaml, z ekranem tej zakładki', (f) => {
    const text = readFileSync(join(DIR, f), 'utf8');
    expect(rawTabTaps(text)).toEqual([]);
    for (const [tab, screenId] of openedTabs(text)) expect([tab, screenId]).toEqual([tab, tabScreens.get(tab!)]);
  });

  it('common/open-tab.yaml: dotknięcie, potem czekanie na ekran zakładki, bez retry', () => {
    const s = steps(OPEN_TAB);
    expect(s[0]).toBe('- tapOn:\n    id: ${TAB}');
    expect(s[1]).toMatch(/^- extendedWaitUntil:\s*\n\s+visible:\s*\n\s+id: \$\{SCREEN\}\s*\n\s+timeout: \d+$/);
    expect(OPEN_TAB).not.toMatch(/^- retry:/m);
  });

  it('scenariusze z przejściem na zakładkę: 04, 05, 08', () => {
    expect(flows.filter((f) => openedTabs(readFileSync(join(DIR, f), 'utf8')).length)).toEqual(['04-event-form.yaml', '05-shopping.yaml', '08-multi-day.yaml']);
  });
});

/**
 * Zasłonięte elementy (nocny przebieg 38106362581, 11.10.2026). Maestro 2.11.0 liczy widoczność tylko względem ramki
 * ekranu (UiElement.getVisiblePercentage), więc element za paskiem zakładek, paskiem „Cofnij” albo pod klawiaturą jest
 * „widoczny”, a tapOn trafia w zasłonę (iPhone 17 Pro Max: „Dodaj wydarzenie” za paskiem — dotknięta zakładka
 * Kalendarz, formularz się nie otworzył). common/scroll-tap(-text).yaml: schowanie klawiatury, przewinięcie, jeszcze
 * 20% ekranu w górę, koniec ruchu, dotknięcie.
 * Źródło: https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-client/src/main/java/maestro/UiElement.kt
 */
describe('scenariusze Maestro — dotknięcie po przewinięciu nad zasłonami', () => {
  it.each([
    ['common/scroll-tap.yaml', 'id: ${ID}'],
    ['common/scroll-tap-text.yaml', 'text: ${TEXT}'],
  ])('%s: przeciągnięcie, kroki do elementu, kroki nad zakładki, dotknięcie pod górną krawędzią', (file, sel) => {
    const s = steps(readFileSync(join(DIR, file), 'utf8'));
    expect(s[0]).toMatch(/^- swipe:/);
    // Bez scrollUntilVisible (wymaga 100% elementu — wiersz przy AX5 jest wyższy niż ekran, przebieg 38171092887).
    expect(s.filter((x) => /^- scrollUntilVisible/.test(x))).toEqual([]);
    const loops = s.filter((x) => /^- repeat:/.test(x));
    expect(loops).toHaveLength(2);
    expect(loops[0]).toContain(sel);
    expect(loops[1]).toMatch(/above:\s*\n\s+id: "tab-Today"/);
    const tap = s[s.length - 1]!;
    expect(tap).toMatch(/^- tapOn:/);
    expect(tap).toContain(sel);
    expect(tap).toMatch(/point: "20,10"/);
  });

  it('bez hideKeyboard z Maestro (przesunięcie o 3% w 50 ms trafiało w pole „Miejsce”, przebieg 38171092887)', () => {
    for (const f of [...flows, 'common/scroll-tap.yaml', 'common/scroll-tap-text.yaml', 'common/scroll-to.yaml']) expect([f, steps(readFileSync(join(DIR, f), 'utf8')).filter((x) => /^- hideKeyboard/.test(x))]).toEqual([f, []]);
  });

  it('wspólny start nie czeka na wiersz danych poza pierwszym wierszem ekranu (AX5: wszystkie scenariusze oblewały na starcie)', () => {
    const s = steps(readFileSync(join(DIR, 'common/launch.yaml'), 'utf8'));
    const waits = s.filter((x) => /^- extendedWaitUntil/.test(x));
    expect(waits.map((x) => /visible:\s*\n?\s*(?:id: )?"([^"]+)"/.exec(x)?.[1])).toEqual(['screen-today', 'Stan synchronizacji: Przed chwilą']);
  });
});

/**
 * Długie strony stosu przy AX5 (E2E 38220289381, 12.10.2026): `scrollUntilVisible` przewija szybkim ruchem z rozpędem —
 * na iPhonie 17 Pro Max minął pozycję Licencji, na iPhonie 17e nie doszedł w 60 s do „Usuń konto”. Na ekranach bez
 * paska zakładek (Ustawienia i podstrony) przewijanie do elementu idzie przez common/scroll-to.yaml: wolne kroki,
 * aż element wejdzie na ekran, potem `scrollUntilVisible` z najmniejszą prędkością do całego elementu.
 */
const SCROLL_TO = readFileSync(join(DIR, 'common/scroll-to.yaml'), 'utf8');
const scrolledTo = (text: string) => steps(text).flatMap((step) => (/^- runFlow:\s*\n\s+file: common\/scroll-to\.yaml/.test(step) ? [/ID: "([^"]+)"/.exec(step)?.[1]] : []));
const fastScrolls = (text: string, ids: readonly string[]) =>
  steps(text).flatMap((step, i) => (/^- scrollUntilVisible/.test(step) && ids.some((id) => step.includes(`id: "${id}"`)) ? [i] : []));

describe('scenariusze Maestro — długie strony stosu przez common/scroll-to.yaml', () => {
  it('wykrywa szybkie przewijanie do „Usuń konto” (wersja 07 z ad9dfff)', () => {
    const before = ['appId: x', '---', '- scrollUntilVisible:', '    element:', '      id: "delete-start"', '    direction: DOWN', '    timeout: 60000', '- tapOn:', '    id: "delete-start"'].join('\n');
    expect(fastScrolls(before, ['delete-start'])).toEqual([0]);
    const after = ['appId: x', '---', '- runFlow:', '    file: common/scroll-to.yaml', '    env:', '      ID: "delete-start"', '- tapOn:', '    id: "delete-start"'].join('\n');
    expect(fastScrolls(after, ['delete-start'])).toEqual([]);
    expect(scrolledTo(after)).toEqual(['delete-start']);
  });

  it('common/scroll-to.yaml: wolne kroki do elementu, potem cały element najmniejszą prędkością', () => {
    const s = steps(SCROLL_TO);
    expect(s[0]).toMatch(/^- repeat:\s*\n\s+while:\s*\n\s+notVisible:\s*\n\s+id: \$\{ID\}/);
    expect(s[0]).toMatch(/duration: 700/);
    expect(s[1]).toMatch(/^- scrollUntilVisible:\s*\n\s+element:\s*\n\s+id: \$\{ID\}\s*\n\s+direction: DOWN\s*\n\s+speed: 10/);
    expect(s[1]).not.toMatch(/visibilityPercentage|centerElement/);
  });

  it('06 i 07: pozycja Licencji, „Usuń konto” i przycisk pod polem „Wpisz USUŃ” przez common/scroll-to.yaml', () => {
    const s06 = readFileSync(join(DIR, '06-settings.yaml'), 'utf8');
    const s07 = readFileSync(join(DIR, '07-keyboard.yaml'), 'utf8');
    expect(scrolledTo(s06)).toEqual(['license-@expo-google-fonts/atkinson-hyperlegible-next']);
    expect(scrolledTo(s07)).toEqual(['delete-start', 'delete-confirm']);
    expect(fastScrolls(s06, scrolledTo(s06) as string[])).toEqual([]);
    expect(fastScrolls(s07, ['delete-start', 'delete-confirm', 'delete-word'])).toEqual([]);
    // Pole wpisywane dopiero, gdy przycisk pod nim jest na ekranie.
    const st = steps(s07);
    const confirm = st.findIndex((x) => /ID: "delete-confirm"/.test(x));
    const typing = st.findIndex((x) => /FIELD: "delete-word"/.test(x));
    expect(confirm).toBeGreaterThan(-1);
    expect(typing).toBeGreaterThan(confirm);
  });

  it('06: tekst licencji sprawdzany po przewinięciu (przy AX5 jest pod tytułem, poza ekranem)', () => {
    const st = steps(readFileSync(join(DIR, '06-settings.yaml'), 'utf8'));
    const loop = st.findIndex((x) => /^- repeat:/.test(x) && /id: "license-text"/.test(x));
    expect(loop).toBeGreaterThan(-1);
    expect(st.findIndex((x) => /^- extendedWaitUntil/.test(x) && /id: "license-text"/.test(x))).toBe(-1);
    expect(st[loop + 1]).toMatch(/^- assertVisible:\s*\n\s+id: "license-text"/);
  });
});

/**
 * Pasek „Cofnij” po zapisie (D194: treść paska otwiera „Ostatnie zmiany”). Przy AX5 pasek jest wysoki, a przeciągnięcie
 * zaczęte i skończone na nim jest dotknięciem (E2E 38220289381, 08 na iPhonie 17 Pro Max: przewijanie Kalendarza w górę
 * otworzyło „Ostatnie zmiany”). Po zapisie wydarzenia scenariusz czeka, aż pasek zniknie, zanim przewinie.
 */
const scrollsUnderUndoBar = (text: string) => {
  let bar = false;
  const bad: number[] = [];
  steps(text).forEach((step, i) => {
    if (/^- tapOn:\s*\n\s+id: "event-save"/.test(step)) bar = true;
    else if (/^- extendedWaitUntil:\s*\n\s+notVisible:\s*\n\s+id: "undo-bar"/.test(step)) bar = false;
    else if (bar && /^- (scrollUntilVisible|swipe|runFlow:\s*\n\s+file: common\/scroll-)/.test(step)) bad.push(i);
  });
  return bad;
};

describe('scenariusze Maestro — przewijanie po zapisie dopiero bez paska „Cofnij”', () => {
  it('wykrywa przewijanie przy pasku (wersja 08 z ad9dfff)', () => {
    const before = ['appId: x', '---', '- tapOn:', '    id: "event-save"', '- extendedWaitUntil:', '    visible:', '      id: "screen-calendar"', '    timeout: 30000', '- scrollUntilVisible:', '    element:', '      id: "day-2026-10-08"', '    direction: UP'].join('\n');
    expect(scrollsUnderUndoBar(before)).toEqual([2]);
    const after = before.replace('- scrollUntilVisible', '- extendedWaitUntil:\n    notVisible:\n      id: "undo-bar"\n    timeout: 15000\n- scrollUntilVisible');
    expect(scrollsUnderUndoBar(after)).toEqual([]);
  });

  it.each(flows)('%s nie przewija przy pasku „Cofnij” po zapisie wydarzenia', (f) => {
    expect(scrollsUnderUndoBar(readFileSync(join(DIR, f), 'utf8'))).toEqual([]);
  });
});
