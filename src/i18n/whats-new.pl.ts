/**
 * Teksty karty „Co nowego” (D84), od najnowszego. `fromBuild` = numer buildu TestFlight (run_number ios-release),
 * od którego dany wpis obowiązuje. Dopisz wpis przy buildzie z widocznymi zmianami; 2–4 krótkie punkty.
 */
import type { WhatsNewEntry } from '../domain/whats-new';

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    fromBuild: 14,
    items: [
      'Zakupy podzielone na działy sklepu. Dział możesz zmienić — grupa go zapamięta.',
      'Stałe zakupy: zapisz je raz, potem „Dodaj stałe” jednym dotknięciem. Aplikacja podpowiada też wcześniej kupowane rzeczy.',
      'Powiadomienie, gdy ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie (np. zawiezienie na zajęcia).',
      'Naprawione: pozycje dodane do listy zakupów nie znikają już po synchronizacji.',
    ],
  },
];
