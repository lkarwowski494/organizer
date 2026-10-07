/**
 * Dni wolne od pracy w Polsce — jedyne źródło reguł.
 * Źródło pierwotne: ustawa z dnia 18 stycznia 1951 r. o dniach wolnych od pracy, tekst jednolity
 * Dz. U. 2025 poz. 296 (obwieszczenie Marszałka Sejmu z 6.03.2025), art. 1 pkt 1 lit. a–m:
 * https://api.sejm.gov.pl/eli/acts/DU/2025/296/text/O/D20250296.pdf
 *  - lit. b „6 stycznia – Święto Trzech Króli” — od 1.01.2011 (ustawa z 24.09.2010, Dz. U. 2010 poz. 1459, art. 2 i 4),
 *  - lit. ka „24 grudnia – Wigilia Bożego Narodzenia” — od 1.02.2025 (ustawa z 6.12.2024, Dz. U. 2024 poz. 1965, art. 1 i 5).
 * Niedziele (art. 1 pkt 2) nie są tu wymieniane — to cecha każdej niedzieli, nie święto w kalendarzu.
 * Nazwy dosłownie z ustawy.
 */
export type FixedHoliday = { kind: 'fixed'; month: number; day: number; name: string; since?: string };
/** Święto ruchome: liczba dni od pierwszego dnia Wielkiej Nocy (niedziela). */
export type EasterHoliday = { kind: 'easter'; offset: number; name: string };
/** Jednorazowy dzień wolny ustanowiony osobną ustawą. Przyszłych nie da się przewidzieć — dopisujemy po ogłoszeniu. */
export type SingleHoliday = { kind: 'single'; date: string; name: string };

/** Najwcześniejszy rok, dla którego reguły są kompletne (Święto Trzech Króli wolne od 2011). */
export const HOLIDAYS_FROM_YEAR = 2011;

export const HOLIDAYS_PL: readonly (FixedHoliday | EasterHoliday | SingleHoliday)[] = [
  { kind: 'fixed', month: 1, day: 1, name: 'Nowy Rok' },
  // Wolne od 1.01.2011 — pokrywa to HOLIDAYS_FROM_YEAR, więc bez osobnego „since”.
  { kind: 'fixed', month: 1, day: 6, name: 'Święto Trzech Króli' },
  { kind: 'easter', offset: 0, name: 'pierwszy dzień Wielkiej Nocy' },
  { kind: 'easter', offset: 1, name: 'drugi dzień Wielkiej Nocy' },
  { kind: 'fixed', month: 5, day: 1, name: 'Święto Państwowe' },
  { kind: 'fixed', month: 5, day: 3, name: 'Święto Narodowe Trzeciego Maja' },
  // Zielone Świątki: 50. dzień okresu wielkanocnego licząc Wielkanoc jako pierwszy, czyli Wielkanoc + 49 dni
  // (niedziela). Boże Ciało: czwartek po uroczystości Trójcy Świętej (niedziela po Zielonych Świątkach), czyli
  // Wielkanoc + 60 dni. Przesunięcia sprawdzone różnicowo z niezależną biblioteką Python „holidays”.
  { kind: 'easter', offset: 49, name: 'pierwszy dzień Zielonych Świątek' },
  { kind: 'easter', offset: 60, name: 'dzień Bożego Ciała' },
  { kind: 'fixed', month: 8, day: 15, name: 'Wniebowzięcie Najświętszej Maryi Panny' },
  { kind: 'fixed', month: 11, day: 1, name: 'Wszystkich Świętych' },
  { kind: 'fixed', month: 11, day: 11, name: 'Narodowe Święto Niepodległości' },
  { kind: 'fixed', month: 12, day: 24, name: 'Wigilia Bożego Narodzenia', since: '2025-02-01' },
  { kind: 'fixed', month: 12, day: 25, name: 'pierwszy dzień Bożego Narodzenia' },
  { kind: 'fixed', month: 12, day: 26, name: 'drugi dzień Bożego Narodzenia' },
  // Ustawa z 7.11.2018 (Dz. U. 2018 poz. 2117), art. 2: „Dzień 12 listopada 2018 r. jest dniem wolnym od pracy.”
  // https://api.sejm.gov.pl/eli/acts/DU/2018/2117/text/O/D20182117.pdf — brak wykryty testem różnicowym.
  { kind: 'single', date: '2018-11-12', name: 'Święto Narodowe z okazji Setnej Rocznicy Odzyskania Niepodległości Rzeczypospolitej Polskiej' },
];
