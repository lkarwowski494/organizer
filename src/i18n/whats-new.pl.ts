/**
 * Teksty karty „Co nowego” (D84), od najnowszego. `fromBuild` = numer buildu TestFlight (run_number ios-release),
 * od którego dany wpis obowiązuje. Dopisz wpis przy buildzie z widocznymi zmianami; 2–4 krótkie punkty.
 */
import type { WhatsNewEntry } from '../domain/whats-new';

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    fromBuild: 14,
    items: [
      '„Dotyczy mnie” nazywa się teraz „Moje sprawy”.',
      'Obok pola dodawania jest „Więcej”: pełny formularz z grupą, listą, osobą i powtarzaniem. Po szybkim dodaniu dotknij „Zmień”. Dopisz @imię, np. „basen jutro 19 @Ala”.',
      'Zakupy podzielone na działy, stałe zakupy jednym dotknięciem i podpowiedzi z wcześniejszych zakupów.',
      'Naprawione: pozycje listy zakupów nie znikają po synchronizacji. Nowe: powiadomienie, gdy ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie.',
    ],
  },
];
