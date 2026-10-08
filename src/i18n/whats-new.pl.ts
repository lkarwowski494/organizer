/**
 * Teksty karty „Co nowego” (D84), od najnowszego. `fromBuild` = numer buildu TestFlight (run_number ios-release),
 * od którego dany wpis obowiązuje. Dopisz wpis przy buildzie z widocznymi zmianami; 2–4 krótkie punkty.
 */
import type { WhatsNewEntry } from '../domain/whats-new';

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    fromBuild: 16,
    items: [
      'Kalendarz iPhone’a w obie strony: Twoje wydarzenia (także z Google i Outlooka dodanych w iPhonie) widać w Kalendarzu i w „Moich sprawach”.',
      'Wydarzenia grup same trafiają do osobnych kalendarzy „Organizer – nazwa grupy” w iPhonie i aktualizują się po każdej zmianie.',
      'Twoje prywatne wydarzenia zostają na telefonie — nikt z grupy ich nie widzi. Włączysz to w Kalendarzu, wyłączysz w Ustawieniach.',
    ],
  },
  {
    fromBuild: 15,
    items: [
      'Nowe zaproszenia: grupa ma stałe ID (9 cyfr), a „Zaproś” daje 6-cyfrowy kod ważny 24 godziny dla wielu osób.',
      'Dołączasz, wpisując ID grupy i kod w Grupy → „Dołącz do grupy”, albo wklejając wiadomość z zaproszeniem.',
      'Właściciel może zmienić ID grupy — wysłane kody przestają wtedy działać.',
    ],
  },
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
