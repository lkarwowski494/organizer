/**
 * Reguły szybkiego dodawania z polskim parserem dat (D18) — jedyne źródło słownika i reguł.
 * Decyzje produktowe właściciela z 6.10.2026: D42–D45 (rejestr decyzji, docs/adr/0003).
 */

/**
 * Nazwy miesięcy w dopełniaczu („15 października”) i ich skróty („15 paź”).
 * Źródło: Unicode CLDR 48.2.3, pl, calendars/gregorian/months/format (wide, abbreviated):
 * https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-dates-full/main/pl/ca-gregorian.json
 */
export const MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
] as const;

export const MONTHS_ABBREVIATED = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
] as const;

/**
 * Dni tygodnia w bierniku po przyimku „w/we” („w środę”, „we wtorek”), indeks 0 = poniedziałek.
 * Mianownik: CLDR 48.2.3 pl days/format/wide. Biernik rodzaju żeńskiego (środę, sobotę, niedzielę):
 * formy odmiany w https://sjp.pl/środa, https://sjp.pl/sobota, https://sjp.pl/niedziela; rzeczowniki
 * męskie nieżywotne mają biernik równy mianownikowi.
 * Przyimek: „We używamy w połączeniu z wyrazami zaczynającymi się od spółgłoski [w] lub [f], po której
 * następuje inna spółgłoska (we wtorek …). Czasami pojawia się też przed wyrazami, które na początku
 * mają dwie inne spółgłoski, np. we środę, we czwartek (obok także poprawnych: w środę, w czwartek)”
 * — https://sjp.pwn.pl/poradnia/haslo/we-wtorek;21155.html
 * Parser przyjmuje obie formy przyimka przy każdym dniu (tolerancja na literówki, np. „w wtorek”).
 */
export const WEEKDAYS_ACCUSATIVE = [
  'poniedziałek',
  'wtorek',
  'środę',
  'czwartek',
  'piątek',
  'sobotę',
  'niedzielę',
] as const;

/**
 * Bezpiecznik dnia (audyt 2, M-23): słowa, po których widać, że tekst wskazuje dzień, choć parser go nie rozpoznał
 * („w przyszły wtorek”, „rachunek piątek”, „w następną sobotę”, „w środy”). Wtedy nie zgadujemy dnia z samej godziny
 * (D43) ani startu serii „co tydzień” — godzina zostaje w tytule, a ekran mówi, że dnia nie rozpoznano.
 * Nazwy dni we wszystkich formach (hasło i jego odmiana) ze słownika sjp.pl: https://sjp.pl/poniedziałek,
 * https://sjp.pl/wtorek, https://sjp.pl/środa, https://sjp.pl/czwartek, https://sjp.pl/piątek, https://sjp.pl/sobota,
 * https://sjp.pl/niedziela (znaczenie: „pierwszy” … „siódmy dzień tygodnia”).
 */
export const WEEKDAY_FORMS = [
  ['poniedziałek', 'poniedziałkiem', 'poniedziałkowi', 'poniedziałku', 'poniedziałków', 'poniedziałkach', 'poniedziałkami', 'poniedziałkom', 'poniedziałki'],
  ['wtorek', 'wtorkiem', 'wtorkowi', 'wtorku', 'wtorków', 'wtorkach', 'wtorkami', 'wtorkom', 'wtorki'],
  ['środa', 'środą', 'środę', 'środo', 'środy', 'środzie', 'środach', 'środami', 'środom', 'śród'],
  ['czwartek', 'czwartkiem', 'czwartkowi', 'czwartku', 'czwartków', 'czwartkach', 'czwartkami', 'czwartkom', 'czwartki'],
  ['piątek', 'piątkiem', 'piątkowi', 'piątku', 'piątków', 'piątkach', 'piątkami', 'piątkom', 'piątki'],
  ['sobota', 'sobocie', 'sobotą', 'sobotę', 'soboto', 'soboty', 'sobotach', 'sobotami', 'sobotom', 'sobót'],
  ['niedziela', 'niedziele', 'niedzielą', 'niedzielę', 'niedzieli', 'niedzielo', 'niedzielach', 'niedzielami', 'niedzielom', 'niedziel'],
] as const;

/**
 * „Przyszły” i „następny” we wszystkich formach (sjp.pl: https://sjp.pl/przyszły, https://sjp.pl/następny; bez form
 * z „nie-” i bez przysłówka „następnie”) — w bezpieczniku razem ze słowem, które po nich stoi („przyszłym tygodniu”).
 * Parser ich nie tłumaczy, bo nie mają jednego znaczenia: „Myślę, że przyszły czwartek należy do przyszłego tygodnia”
 * (prof. M. Bańko, https://sjp.pwn.pl/poradnia/haslo/przyszly-czwartek;8697.html), ale „nie ma jednoznacznych
 * rozstrzygnięć co do zakresu użycia słów przyszły i ten”, a „Jak wskazuje jednak praktyka, w tej funkcji [najbliższego
 * poniedziałku] jest używany też przymiotnik przyszły” (prof. K. Kłosińska,
 * https://sjp.pwn.pl/poradnia/haslo/Przyszly-poniedzialek-czy-ten-poniedzialek;21133.html).
 */
export const NEXT_FORMS = [
  'przyszły', 'przyszłego', 'przyszłemu', 'przyszłych', 'przyszłym', 'przyszłymi', 'przyszli', 'przyszła', 'przyszłą', 'przyszłe', 'przyszłej',
  'następny', 'następnego', 'następnemu', 'następnych', 'następnym', 'następnymi', 'następni', 'następna', 'następną', 'następne', 'następnej',
] as const;

/** Kody dni tygodnia w RRULE (RFC 5545, sekcja 3.3.10, „weekday”), indeks 0 = poniedziałek. */
export const RRULE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export const QUICKADD_RULES = {
  /**
   * D42: dzień tygodnia równy dzisiejszemu („w piątek” w piątek) oznacza ten dzień za tydzień.
   * Liczba dni dodawana, gdy wskazany dzień tygodnia to dziś.
   */
  SAME_WEEKDAY_OFFSET_DAYS: 7,

  /**
   * D43: godziny 1..AMBIGUOUS_HOUR_MAX bez dopowiedzenia czytamy jako najbliższą przyszłą:
   * rano, chyba że ta godzina już minęła, a ta sama po południu (+12 h) jeszcze nie.
   * Bez podanego dnia termin to najbliższe wystąpienie godziny (dziś albo jutro).
   */
  AMBIGUOUS_HOUR_MAX: 11,
} as const;
// D44 (data bez roku, która już minęła → przyszły rok) i D45 (sam dzień → termin bez godziny)
// to reguły bez parametrów liczbowych — zapisane w src/domain/quickadd.ts i pokryte testami.
