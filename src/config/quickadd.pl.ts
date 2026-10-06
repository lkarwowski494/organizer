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
