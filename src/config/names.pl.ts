/**
 * Nazwy, które aplikacja sama nadaje (audyt 2, M-158, D-31): jedno źródło dla domeny i dla src/i18n/strings.pl.ts
 * (domena nie importuje i18n, więc tekst mieszka tu, jak słowniki dat w calendar.pl.ts).
 *  - Ogólne listy zadań (D97): w grupie osobistej „Moje zadania”, we wspólnej „Zadania”.
 *  - Imię zastępcze konta bez imienia: serwer wpisuje to samo (`coalesce(…, 'Ja')` w funkcjach SQL, test kontraktowy).
 */
export const LIST_NAMES = { PERSONAL: 'Moje zadania', GENERAL: 'Zadania' } as const;

export const PLACEHOLDER_NAME = 'Ja';
