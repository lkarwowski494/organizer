/**
 * Dostępność i oba tryby kolorów na każdym ekranie: audyt drzewa (a11y-audit.ts — role z cechą iOS, etykieta i cel
 * dotyku ≥ 44 pt, widoczny tekst w etykiecie, stany, kontrast tekstu i pól do tła, Dynamic Type, nagłówek), kolor tekstu
 * z palety bieżącego trybu i korpus par kontrastu kompletny względem ekranów (audyt 2, M-46, M-147).
 */
import { getStateFromPath, NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { contrastPairs, groupLines, palettes, type Scheme } from '../../config/theme';
import { inviteUrl, joinUrl } from '../../domain/invite-link';
import { SignInScreen } from '../../features/auth/SignInScreen';
import { linking, RootStack } from '../navigation';
import { audit } from './a11y-audit';
import { fakeAccount, ME, put, sampleBase, setup } from './harness';

/** Dane przykładowe + seria wydarzeń (środy 17:00, Tymek), żeby audyt objął ekrany wydarzeń. */
function baseWithEvent() {
  const t = sampleBase();
  put(t, 'events', 'ev', { id: 'ev', group_id: 'gf', title: 'Tańce', note: null, start_date: '2026-10-07', start_time: '17:00:00', end_time: '18:00:00', rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', location: 'Szkoła tańca, ul. Długa 5', deleted_at: null, version: 1 });
  put(t, 'event_participants', 'p', { id: 'p', event_id: 'ev', group_id: 'gf', member_id: 'tymek', deleted_at: null, version: 1 });
  // Przekazania (D70): jedno do mnie, jedno moje odrzucone — „Do potwierdzenia” i plakietka na zakładce.
  const h = { group_id: 'gf', entity: 'tasks', occurrence_date: null, closed: false, decided_at: null, version: 1, created_at: '2026-10-07T07:00:00Z', deleted_at: null };
  put(t, 'handoffs', 'h1', { ...h, id: 'h1', entity_id: 't-ala', from_member: 'ala', to_member: 'mf', status: 'pending' });
  put(t, 'handoffs', 'h2', { ...h, id: 'h2', entity_id: 't-kwiaty', from_member: 'mf', to_member: 'ala', status: 'declined' });
  return t;
}

/** Kolory tekstu z palety bieżącego trybu albo z palety linii grup (obie sprawdza test motywu). */
function outsidePalette(root: unknown, scheme: Scheme, where: string): string[] {
  const allowed = new Set([...Object.values(palettes[scheme]), ...groupLines.map((g) => g[scheme].ink)]);
  const out: string[] = [];
  const walk = (n: { type: unknown; props: Record<string, unknown>; children?: unknown[] } | string) => {
    if (typeof n === 'string' || !n) return;
    const color = (StyleSheet.flatten(n.props.style as never) as { color?: string } | undefined)?.color;
    if (n.type === 'Text' && color && !allowed.has(color)) out.push(`${where}: tekst w kolorze spoza palety ${color}`);
    for (const c of n.children ?? []) walk(c as never);
  };
  walk(root as never);
  return out;
}

function check(root: unknown, scheme: Scheme, where: string, opts: { screen?: boolean } = {}) {
  const r = audit(root, palettes[scheme], where, opts);
  for (const p of r.pairs) observed.set(`${scheme} ${p.kind} ${p.fg} ${p.bg}`, p.where);
  return [...outsidePalette(root, scheme, where), ...r.problems];
}

/**
 * Znane odstępstwa — każde z uzasadnieniem i z limitem `max` (dzisiejsza liczba trafień we wszystkich scenariuszach obu
 * trybów). Test oblewa każde inne, każde ponad limit (lista kurczy się także co do liczby — audyt 3, N-59) i znane,
 * które już nie występuje (wtedy usuń je z listy). Komunikat bez nazwy scenariusza.
 */
const KNOWN: { re: RegExp; why: string; max: number; hits: number }[] = [
  {
    re: /^etykieta „[^”]*” bez widocznych słów: (h|min|pon|wt|śr|czw|pt|sob|niedz)(, (h|min|pon|wt|śr|czw|pt|sob|niedz))*$/,
    why: 'M-263, N-65: skróty z dopisków aplikacji są w etykiecie słowami („1 h” → „1 godzina”, „śr.” → „środa”; spoken() w src/ui/a11y.ts), tytuł na początku etykiety jest widoczny; jak Sterowanie głosem dopasowuje takie etykiety — do sprawdzenia na iPhonie',
    max: 120,
    hits: 0,
  },
  {
    re: /^switch „Wysyłaj raporty błędów” ma 0 pt wysokości$/,
    why: 'Audyt 3 (N-74): systemowy przełącznik iOS w SwitchRow ma stały rozmiar — Apple, UISwitch init(frame:): „The size components of this rectangle are ignored.” (https://developer.apple.com/documentation/uikit/uiswitch/init(frame:)); wiersz ma 52 pt, VoiceOver przełącza dwukrotnym dotknięciem gdziekolwiek; cel dotyku palcem — do sprawdzenia na iPhonie (dotyczy każdego SwitchRow, ten jest pierwszym na ekranie z audytu)',
    max: 6,
    hits: 0,
  },
  {
    re: /^rola „alert” bez cechy iOS/,
    why: 'M-39: komunikat błędu ogłasza announce() (ErrorText); rola „alert” na iOS nie daje cechy ani słów w wartości (RN dopisuje je tylko dla „checkbox” i „radio”), zostaje dla testów (getByRole("alert"))',
    max: 6,
    hits: 0,
  },
];
const observed = new Map<string, string>();
/** Ile scenariuszy przeszło audyt — podsumowanie liczy się tylko po pełnym przebiegu (nie przy jestowym -t). */
let ran = 0;
function unexplained(problems: string[], where: string) {
  return problems.filter((p) => {
    const msg = p.startsWith(`${where}: `) ? p.slice(where.length + 2) : p;
    const k = KNOWN.find((x) => x.re.test(msg));
    if (k) k.hits++;
    return !k;
  });
}

const SCREENS: [string, (press: (l: string | RegExp) => Promise<void>) => Promise<void>][] = [
  ['Moje sprawy', async () => {}],
  ['Listy', async (p) => p('Listy')],
  ['Lista zakupów', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina, Zakupy, 1 do kupienia'))],
  ['Lista zadań', async (p) => (await p('Listy'), await p('Dom, Rodzina, Zadania, 3 otwarte'))],
  ['Lista zadań: dla kogo albo na kiedy', async (p) => {
    await p('Listy');
    await p('Dom, Rodzina, Zadania, 3 otwarte');
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'rosół');
    await p('Dodaj');
  }],
  ['Zadanie', async (p) => p(/^Odebrać paczkę(,|$)/)],
  ['Zadanie: przekazanie', async (p) => (await p(/^Odebrać paczkę(,|$)/), await p('Przekaż zadanie'))],
  ['Moje sprawy: tydzień', async (p) => p('Tydzień')],
  ['Pełny formularz zadania', async (p) => p('Więcej')],
  ['Pełny formularz: zadanie we wspólnej grupie z powtarzaniem', async (p) => (await p('Więcej'), await p('Rodzina'), await p('Jutro'), await p('Co tydzień'))],
  ['Pasek „Dodano · Zmień”', async (p) => {
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'basen jutro 19.00');
    await p('Dodaj');
  }],
  ['Moje sprawy: wczoraj', async (p) => p('Poprzedni dzień')],
  ['Pasek „Cofnij”', async (p) => p('Usuń: Odebrać paczkę')],
  ['Nowa lista', async (p) => (await p('Listy'), await p('Nowa lista'))],
  ['Nowa lista zakupów', async (p) => (await p('Listy'), await p('Nowa lista'), await p('Zakupy'), await p('Rodzina'))],
  ['Lista zakupów: planowanie zakupów', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina, Zakupy, 1 do kupienia'), await p('Zaplanuj zakupy'))],
  // Audyt 3 (N-193): rozwinięty mini kalendarz przy planowaniu zakupów (dni ≥ 44 pt — reguła 15 liczy szerokość od rodzica).
  ['Lista zakupów: planowanie zakupów, inny dzień', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina, Zakupy, 1 do kupienia'), await p('Zaplanuj zakupy'), await p('Inny dzień'))],
  ['Kalendarz', async (p) => p('Kalendarz')],
  ['Wydarzenie', async (p) => p('Tańce, 17:00–18:00, 1 godzina, Rodzina')],
  ['Wydarzenie: wybór zakresu', async (p) => (await p('Tańce, 17:00–18:00, 1 godzina, Rodzina'), await p('Zmień'))],
  ['Zmiana serii', async (p) => (await p('Tańce, 17:00–18:00, 1 godzina, Rodzina'), await p('Zmień'), await p('Całą serię'))],
  // Grupa wspólna: w osobistej nie ma „Kogo dotyczy” (audyt 2, P-53).
  ['Nowe wydarzenie', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Rodzina'), await p('Co tydzień'), await p('Dodaj wariant (inne dni albo godzina)'), await p('Wybrane osoby'))],
  ['Nowe wydarzenie co miesiąc', async (p) => (await p('Kalendarz'), await p('Dodaj wydarzenie'), await p('Co miesiąc'), await p('Do dnia'))],
  ['Grupy', async (p) => p('Grupy')],
  ['Grupa', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby, administrator'))],
  ['Osoba', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby, administrator'), await p('Tymek, dziecko'))],
  ['Nowa grupa', async (p) => (await p('Grupy'), await p('Nowa grupa'))],
  ['Zaproszenie', async (p) => (await p('Grupy'), await p('Dołącz do grupy'))],
  ['Grupa: zaproszenie gotowe', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby, administrator'), await p('Zaproś'))],
  ['Ustawienia', async (p) => p('Ustawienia')],
  ['Ustawienia: Powiadomienia', async (p) => (await p('Ustawienia'), await p('Powiadomienia'))],
  ['Ustawienia: Kalendarz i dojazd', async (p) => (await p('Ustawienia'), await p('Kalendarz i dojazd'))],
  ['Ustawienia: Wygląd', async (p) => (await p('Ustawienia'), await p('Wygląd'))],
  ['Ustawienia: Konto i dane', async (p) => (await p('Ustawienia'), await p('Konto i dane'))],
  ['Wyślij uwagę', async (p) => (await p('Ustawienia'), await p('Wyślij uwagę'))],
  ['Wprowadzenie', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'))],
  ['Wprowadzenie: start', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'), await p('Pomiń'))],
  ['Mini kalendarz przy dacie', async (p) => (await p('Więcej'), await fireEvent.press(await screen.findByTestId('form-date')), await p('Następny miesiąc'))],
  ['Plan lekcji', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby, administrator'), await p('Tymek, dziecko'), await p('Plan lekcji'), await p('Dodaj lekcję: poniedziałek'))],
  ['Nowa rutyna', async (p) => (await p('Kalendarz'), await p('Dodaj rutynę'), await p('Dodaj krok'))],
  ['Wybór godziny', async (p) => (await p('Kalendarz'), await p('Dodaj rutynę'), await p(/^Początek$/))],
  ['Twoje imię', async (p) => (await p('Ustawienia'), await p('Konto i dane'), await p('Twoje imię, Łukasz'))],
  ['Pełny formularz: wydarzenie (przełącznik Rodzaj)', async (p) => (await p('Więcej'), await p('Wydarzenie'))],
  ['Pasek „Dodano wydarzenie · Zmień”', async (p) => {
    fireEvent.changeText(await screen.findByTestId('quick-add'), 'basen jutro 17–18');
    await p('Dodaj');
  }],
  ['Odrzucone', async (p) => (await p('Ustawienia'), await p('Konto i dane'), await p('Odrzucone zmiany, 0 zmian'))],
  // Audyt 2 (M-46, A-63 pkt 11): ekrany i stany spoza pierwszego zestawu.
  ['Ostatnie zmiany', async (p) => (await p('Usuń: Odebrać paczkę'), await p('Grupy'), await p('Ostatnie zmiany'))],
  ['Wprowadzenie: krok 2', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'), await p('Dalej'))],
  ['Wprowadzenie: krok 3', async (p) => (await p('Ustawienia'), await p('Pokaż wprowadzenie'), await p('Dalej'), await p('Dalej'))],
  ['Lista zakupów: stałe zakupy', async (p) => (await p('Listy'), await p('Zakupy na weekend, Rodzina, Zakupy, 1 do kupienia'), await p('Zmień stałe'))],
  ['Osoba dorosła', async (p) => (await p('Grupy'), await p('Rodzina, 3 osoby, administrator'), await p(/^Ala, /))],
  ['Kalendarz: inny dzień', async (p) => (await p('Kalendarz'), await p(/^Czwartek, 8 października/))],
];

describe.each(['light', 'dark'] as Scheme[])('tryb %s', (scheme) => {
  it.each(SCREENS)('%s: etykiety, cele dotyku ≥ 44 pt, tło z palety', async (name, go) => {
    const s = setup({ scheme, base: baseWithEvent() });
    await s.renderApp(<RootStack />);
    await screen.findByTestId('screen-today');
    await go(async (label) => {
      await fireEvent.press(await screen.findByLabelText(label));
    });
    const root = screen.root!;
    expect(unexplained(check(root, scheme, name, { screen: true }), name)).toEqual([]);
    ran++;
    const bg = screen.getAllByTestId(/^screen-/);
    expect(bg.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(bg.at(-1)!.props.style).backgroundColor).toBe(palettes[scheme].ground);
  });
});

const RN = jest.requireActual<typeof import('react-native')>('react-native');
const P = palettes.light;

describe('audyt sam łapie błędy (kontrola testu)', () => {
  it('każda reguła łapie wstrzyknięty błąd', async () => {
    const { Pressable, Switch, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
    const p = palettes.light;
    await render(
      <View style={{ backgroundColor: p.ground }}>
        <Pressable accessibilityRole="button" style={{ height: 20, width: 30 }} onPress={() => {}} />
        <Pressable accessibilityRole="tab" accessibilityLabel="Zakładka" style={{ minHeight: 44, width: '10%' }} onPress={() => {}} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel="Pole" accessibilityState={{ checked: false }} style={{ minHeight: 44, width: 44, borderWidth: 2, borderColor: p.border }} onPress={() => {}} />
        <Pressable accessibilityRole="button" accessibilityLabel="Zapisz" style={{ minHeight: 44 }} onPress={() => {}}>
          <Text style={{ color: p.ink }}>Zapisz zmiany</Text>
        </Pressable>
        <Pressable style={{ minHeight: 44 }} onPress={() => {}} accessibilityLabel="Bez roli" />
        <Text style={{ color: '#123456' }}>x</Text>
        <Text>bez koloru</Text>
        <Text style={{ color: p.border }}>blady</Text>
        <Text style={{ color: p.ink }} allowFontScaling={false}>stały</Text>
        <Text style={{ color: p.ink, fontSize: 17 }} maxFontSizeMultiplier={1.5}>przycięty</Text>
        <Text style={{ color: p.ink, fontSize: 34 }} maxFontSizeMultiplier={60 / 34}>Tytuł do Large Title</Text>
        <View style={{ height: 20 }}>
          <Text style={{ color: p.ink }}>ciasno</Text>
        </View>
        <Switch accessibilityRole="switch" accessibilityLabel="Przełącznik" value />
        <Text style={{ color: p.ink }}>
          bez rozmiaru<Text style={{ color: p.ink }}>w środku</Text>
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="wybrany" accessibilityState={{ selected: true }} style={{ minHeight: 44, backgroundColor: p.inverseBg }} onPress={() => {}} />
      </View>,
    );
    const r = audit(screen.root!, p, 'próba', { screen: true });
    expect(outsidePalette(screen.root!, 'light', 'próba')).toEqual(['próba: tekst w kolorze spoza palety #123456']);
    expect(r.problems).toEqual(expect.arrayContaining([
      'próba: button bez etykiety',
      'próba: button „” ma 20 pt wysokości',
      'próba: button „” ma 30 pt szerokości',
      'próba: rola „tab” bez cechy iOS (Zakładka)',
      'próba: tab „Zakładka” ma 39 pt szerokości',
      'próba: tab „Zakładka” bez stanu „wybrane”',
      'próba: rola „checkbox” bez cechy iOS (Pole)',
      'próba: checkbox „Pole”: stan „checked” — RN dopisuje angielskie słowo (buttonA11y z src/ui/a11y.ts)',
      expect.stringMatching(/^próba: checkbox „Pole”: kontrast pola 1\.\d\d:1 \(< 3\)$/),
      'próba: etykieta „Zapisz” bez widocznych słów: zmiany',
      'próba: element dotykowy bez roli „Bez roli”',
      'próba: tekst „bez koloru” bez koloru',
      expect.stringMatching(/^próba: tekst „blady”: kontrast 1\.\d\d:1/),
      'próba: tekst „stały” bez skalowania (allowFontScaling={false})',
      'próba: tekst „przycięty” z maxFontSizeMultiplier 1.5',
      'próba: kontener tekstu „ciasno” ma stałą wysokość 20 pt (Dynamic Type)',
      'próba: ekran bez nagłówka (rola header)',
      // Audyt 2 (M-42, M-152): tekst bez rozmiaru z motywu; M-151 (PW-52 A, D198): zaznaczenie w kolorze przycisku głównego.
      'próba: tekst „bez rozmiaru w środku” bez rozmiaru',
      'próba: button „wybrany”: zaznaczenie w kolorze przycisku głównego',
    ]));
    expect(r.problems.filter((x) => x.includes('Tytuł do Large Title'))).toEqual([]);
    expect(r.pairs).toEqual(expect.arrayContaining([expect.objectContaining({ fg: p.border.toUpperCase(), bg: p.ground.toUpperCase(), kind: 'NON_TEXT' })]));
  });

  // Audyt 3 (N-59, N-202): błędy, przy których audyt zwracał pustą listę.
  it.each<[string, () => ReactElement, RegExp]>([
    ['pole tekstowe bez etykiety', () => <RN.TextInput placeholder="Tytuł" style={{ minHeight: 44, color: P.ink, fontSize: 17 }} />, /^x: pole tekstowe bez etykiety \(„Tytuł”\)$/],
    ['przycisk w środku elementu accessible', () => <RN.View accessible accessibilityLabel="Karta"><RN.Pressable accessibilityRole="button" accessibilityLabel="Usuń" style={{ minHeight: 44 }} onPress={() => {}}><RN.Text style={{ color: P.ink, fontSize: 17 }}>Usuń</RN.Text></RN.Pressable></RN.View>, /^x: button „Usuń” w środku elementu „Karta” — VoiceOver do niego nie dojdzie$/],
    ['accessible={false} na rodzicu nie ukrywa błędu dziecka', () => <RN.View accessible={false}><RN.Pressable accessibilityRole="button" accessibilityLabel="Mały" style={{ minHeight: 20 }} onPress={() => {}} /></RN.View>, /^x: button „Mały” ma 20 pt wysokości$/],
    ['zagnieżdżony tekst o słabym kontraście', () => <RN.View style={{ backgroundColor: P.ground }}><RN.Text style={{ color: P.ink, fontSize: 17 }}>Grupa <RN.Text style={{ color: P.border }}>Rodzina</RN.Text></RN.Text></RN.View>, /^x: tekst „Rodzina”: kontrast 1\.\d\d:1/],
    ['dwa przyciski o tej samej etykiecie', () => <RN.View>{[1, 2].map((k) => <RN.Pressable key={k} accessibilityRole="button" accessibilityLabel="Przyjmij" style={{ minHeight: 44, width: 60 }} onPress={() => {}} />)}</RN.View>, /^x: 2× ta sama etykieta elementu dotykowego „Przyjmij”$/],
    ['szerokość z procentu w zagnieżdżonej karcie', () => <RN.View style={{ padding: 40 }}><RN.View style={{ paddingHorizontal: 30, borderWidth: 1 }}><RN.Pressable accessibilityRole="button" accessibilityLabel="9" style={{ width: `${100 / 7}%`, minHeight: 44 }} onPress={() => {}} /></RN.View></RN.View>, /^x: button „9” ma 35 pt szerokości$/],
    ['N-67: stały rozmiar bez Large Content Viewer', () => <RN.Text allowFontScaling={false} style={{ color: P.ink, fontSize: 12 }}>Listy</RN.Text>, /^x: tekst „Listy” bez skalowania \(allowFontScaling=\{false\}\)$/],
    ['N-67: Large Content Viewer z tytułem bez napisu', () => <RN.Pressable accessibilityRole="button" accessibilityLabel="Listy" accessibilityShowsLargeContentViewer accessibilityLargeContentTitle="Zakładka" style={{ minHeight: 44 }} onPress={() => {}}><RN.Text allowFontScaling={false} style={{ color: P.ink, fontSize: 12 }}>Listy</RN.Text></RN.Pressable>, /^x: tekst „Listy” bez skalowania \(allowFontScaling=\{false\}, tytuł Large Content Viewer bez tego napisu\)$/],
    ['adjustsFontSizeToFit bez minimumFontScale', () => <RN.Text numberOfLines={1} adjustsFontSizeToFit style={{ color: P.ink, fontSize: 12 }}>Moje sprawy</RN.Text>, /^x: tekst „Moje sprawy” zmniejsza się do 0 pt/],
    ['stan „rozwinięte” po angielsku', () => <RN.Pressable accessibilityRole="button" accessibilityLabel="Dzień" accessibilityState={{ expanded: true }} style={{ minHeight: 44 }} onPress={() => {}}><RN.Text style={{ color: P.ink, fontSize: 17 }}>Dzień</RN.Text></RN.Pressable>, /^x: button „Dzień”: stan „expanded” — RN dopisuje angielskie słowo/],
    ['stan „zajęty” po angielsku', () => <RN.Pressable accessibilityRole="button" accessibilityLabel="Wyślij" accessibilityState={{ busy: false }} style={{ minHeight: 44 }} onPress={() => {}} />, /^x: button „Wyślij”: stan „busy”/],
    ['N-202: obwódka przycisku ze stanem „wybrane” sprawdzana bez roli „checkbox”', () => <RN.View style={{ backgroundColor: P.ground }}><RN.Pressable accessibilityRole="button" accessibilityLabel="Pole" accessibilityState={{ selected: false }} style={{ minHeight: 44, width: 44, borderWidth: 2, borderColor: P.border }} onPress={() => {}} /></RN.View>, /^x: button „Pole”: kontrast pola 1\.\d\d:1 \(< 3\)$/],
  ])('reguła audytu 3: %s', async (_name, ui, expected) => {
    await render(ui());
    expect(audit(screen.root!, P, 'x').problems).toEqual([expect.stringMatching(expected)]);
  });

  it('procent szerokości liczony od treści przewijanego ekranu; ukryte i accessible={false} nie liczą się do powtórzeń etykiet', async () => {
    await render(
      <RN.ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
        <RN.Pressable accessibilityRole="button" accessibilityLabel="Dzień" style={{ width: '12%', minHeight: 44 }} onPress={() => {}} />
        <RN.View accessibilityElementsHidden><RN.Pressable accessibilityRole="button" accessibilityLabel="Dzień" style={{ minHeight: 44 }} onPress={() => {}} /></RN.View>
        <RN.Pressable accessible={false} accessibilityRole="button" accessibilityLabel="Dzień" style={{ minHeight: 44 }} onPress={() => {}} />
        <RN.Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={11 / 16} style={{ color: P.ink, fontSize: 16 }}>12</RN.Text>
      </RN.ScrollView>,
    );
    // 12% z 350 pt (390 − 2 × 20) = 42 pt; od całego ekranu byłoby 46,8 pt i błąd by przepadł.
    expect(audit(screen.root!, P, 'x').problems).toEqual(['x: button „Dzień” ma 42 pt szerokości']);
  });

  it('tekst w wyłączonym elemencie nie liczy się do kontrastu (WCAG 1.4.3: „inactive user interface component”); przezroczystość tak', async () => {
    const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
    const p = palettes.light;
    await render(
      <View style={{ backgroundColor: p.ground }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dziś" accessibilityState={{ disabled: true }} style={{ minHeight: 44, opacity: 0.35 }} onPress={() => {}}>
          <Text style={{ color: p.ink, fontSize: 17 }}>Dziś</Text>
        </Pressable>
        <View style={{ opacity: 0.3 }}>
          <Text style={{ color: p.ink, fontSize: 17 }}>przygaszony</Text>
        </View>
        <Text accessibilityRole="header" style={{ color: p.ink, fontSize: 17 }}>Tytuł</Text>
      </View>,
    );
    expect(audit(screen.root!, p, 'próba', { screen: true }).problems).toEqual([expect.stringMatching(/^próba: tekst „przygaszony”: kontrast \d\.\d\d:1 .*widoczny #/)]);
  });
});

describe('logowanie', () => {
  it.each(['light', 'dark'] as Scheme[])('tryb %s: tylko Apple (D177), bez pola e-mail', async (scheme) => {
    const account = fakeAccount();
    const { wrap } = setup({ scheme, account });
    await render(wrap(<SignInScreen account={account} />));
    expect(screen.getByText('Organizer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('apple-sign-in'));
    expect(account.signInWithApple).toHaveBeenCalled();
    expect(screen.queryByTestId('email')).toBeNull();
    expect(screen.queryByTestId('send-link')).toBeNull();
    expect(screen.getByText('W wersji testowej logujesz się tylko przez Apple.')).toBeTruthy();
    // Audyt 2 (P-73): co to konto i że powstaje grupa osobista.
    expect(screen.getByText(/powstaje grupa osobista/)).toBeTruthy();
    expect(unexplained(check(screen.root!, scheme, 'Logowanie', { screen: false }), 'Logowanie')).toEqual([]);
  });

  it('błąd logowania Apple pokazuje komunikat', async () => {
    const account = fakeAccount({ signInWithApple: jest.fn(async () => Promise.reject(new Error('cancel'))) });
    const { wrap } = setup({ account });
    await render(wrap(<SignInScreen account={account} />));
    await fireEvent.press(screen.getByTestId('apple-sign-in'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
  });

  it('N-72: komunikat po usunięciu konta, ogłaszany VoiceOverowi', async () => {
    const spoken = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
    const { wrap } = setup({});
    await render(wrap(<SignInScreen account={fakeAccount()} notice="Konto zostało usunięte." />));
    expect(screen.getByText('Konto zostało usunięte.')).toBeTruthy();
    expect(spoken.mock.calls.map((c) => c[0])).toContain('Konto zostało usunięte.');
  });
});

describe('linki głębokie (D40)', () => {
  const state = (path: string) => getStateFromPath(path, linking.config) as unknown as { routes: { name: string; params?: object; state?: { routes: { name: string }[] } }[] };

  it('zaproszenie, lista, zadanie, zakładki', () => {
    const tok = 'cd'.repeat(32);
    expect(inviteUrl(tok).startsWith(linking.prefixes[0]!)).toBe(true);
    expect(state(inviteUrl(tok).slice(linking.prefixes[0]!.length)).routes.at(-1)).toMatchObject({ name: 'Invite', params: { token: tok } });
    expect(state('list/lz').routes.at(-1)).toMatchObject({ name: 'List', params: { listId: 'lz' } });
    expect(state('task/t1').routes.at(-1)).toMatchObject({ name: 'Task', params: { taskId: 't1' } });
    expect(state('calendar').routes[0]!.state!.routes[0]!.name).toBe('Calendar');
  });

  it('link ID + kod (D94): https ze strony zaproszeń i schemat aplikacji → Dołącz z wypełnionymi polami', async () => {
    const url = joinUrl({ joinId: '482913507', code: '731064' });
    expect(linking.prefixes).toContain('https://lkarwowski494.github.io');
    const path = url.slice('https://lkarwowski494.github.io/'.length);
    expect(state(path).routes.at(-1)).toMatchObject({ name: 'Invite', params: { g: '482913507', c: '731064' } });
    expect(state('join?g=482913507&c=731064').routes.at(-1)).toMatchObject({ name: 'Invite', params: { g: '482913507', c: '731064' } });
    const s = setup();
    await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'Invite', params: { g: '482913507', c: '731064' } }] } as never}><RootStack /></NavigationContainer>));
    expect((await screen.findByTestId('invite-join-id')).props.value).toBe('482 913 507');
    expect(screen.getByTestId('invite-code').props.value).toBe('731 064');
    await fireEvent.press(screen.getByTestId('invite-accept'));
    expect(s.account.joinGroup).toHaveBeenCalledWith('482913507', '731064', 'Łukasz');
  });

  it('zaproszenie z linku otwiera ekran bez pola wklejania', async () => {
    const s = setup();
    await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'Invite', params: { token: 'ef'.repeat(32) } }] } as never}><RootStack /></NavigationContainer>));
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
    expect(screen.queryByTestId('invite-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('invite-accept'));
    expect(s.account.acceptInvite).toHaveBeenCalledWith('ef'.repeat(32), 'Łukasz');
  });

  it('brakujące dane w trasie: ekrany pokazują błąd zamiast się wysypać', async () => {
    const s = setup();
    for (const [name, params, id] of [['List', { listId: 'nie-ma' }, 'screen-list-missing'], ['Task', { taskId: 'nie-ma' }, 'screen-task-missing'], ['Group', { groupId: 'nie-ma' }, 'screen-group-missing'], ['Member', { groupId: 'gf', memberId: 'nie-ma' }, 'screen-member-missing'], ['Event', { eventId: 'nie-ma', date: '2026-10-07' }, 'screen-event-missing'], ['EventEdit', { eventId: 'nie-ma' }, 'screen-event-edit-missing']] as const) {
      const r = await render(s.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name, params }] } as never}><RootStack /></NavigationContainer>));
      expect(await screen.findByTestId(id)).toBeTruthy();
      await r.unmount();
    }
    expect(ME).toBe('u-me');
    // Przed pierwszym pobraniem (brak grup) nie ma gdzie dodać wydarzenia.
    const empty = setup({ base: {} });
    await render(empty.wrap(<NavigationContainer initialState={{ routes: [{ name: 'Tabs' }, { name: 'EventEdit', params: {} }] } as never}><RootStack /></NavigationContainer>));
    expect(await screen.findByTestId('screen-event-edit-nogroups')).toBeTruthy();
  });
});

// Ostatni test pliku (Jest wykonuje testy pliku po kolei): podsumowanie wszystkich scenariuszy powyżej.
describe('podsumowanie scenariuszy (na końcu pliku)', () => {
  it('znane odstępstwa nadal występują, a każda para kolor–tło jest w korpusie', () => {
  // Znane odstępstwo, które już nie występuje — usuń je z KNOWN (lista ma się tylko kurczyć).
  const full = ran === SCREENS.length * 2;
  expect(full ? KNOWN.filter((k) => k.hits === 0 || k.hits > k.max).map((k) => `${k.hits}/${k.max}: ${k.why}`) : []).toEqual([]);
  // M-147: każda para kolor–tło z ekranów jest w korpusie contrastPairs (src/config/theme.ts, sprawdza go test motywu);
  // tekst w kolorze linii grupy ma osobny test (linie na tle i na kartach).
  const missing = [...observed].filter(([key]) => {
    const [scheme, kind, fg, bg] = key.split(' ') as [Scheme, 'TEXT' | 'NON_TEXT', string, string];
    const corpus = contrastPairs(palettes[scheme]).some((c) => c.kind === kind && c.fg.toUpperCase() === fg && c.bg.toUpperCase() === bg);
    const line = kind === 'TEXT' && groupLines.some((g) => g[scheme].ink.toUpperCase() === fg) && [palettes[scheme].ground, palettes[scheme].surface].some((x) => x.toUpperCase() === bg);
    return !corpus && !line;
  });
  expect(missing.map(([key, where]) => `${key} (${where})`)).toEqual([]);
  });
});
