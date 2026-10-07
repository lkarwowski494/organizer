/**
 * Nazwy do wyświetlania dat. Źródło: Unicode CLDR 48.2.3, pl, ca-gregorian
 * (https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-dates-full/main/pl/ca-gregorian.json):
 * months/stand-alone/wide, days/format/wide, days/stand-alone/abbreviated; dateFormats/full = „EEEE, d MMMM y”.
 * Indeks dni: 0 = poniedziałek (jak isoWeekday w src/domain/civil-date.ts).
 */
export const MONTHS_NOMINATIVE = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
] as const;

export const WEEKDAYS_NOMINATIVE = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'] as const;

export const WEEKDAYS_ABBREVIATED = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'] as const;
