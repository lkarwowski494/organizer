/**
 * Teksty karty „Co nowego” (D84), od najnowszego. `fromBuild` = numer buildu TestFlight (run_number ios-release),
 * od którego dany wpis obowiązuje. Dopisz wpis przy buildzie z widocznymi zmianami; 2–4 krótkie punkty.
 */
import type { WhatsNewEntry } from '../domain/whats-new';

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    fromBuild: 22,
    items: [
      'Obecność przy wydarzeniu grupy: „Będę / Może / Nie będę” — za siebie i za dziecko bez konta. Godzinę wybierasz kafelkami, bez pisania.',
      'Lekcje dziecka to jeden wiersz w Moich sprawach („Kuba: 6 lekcji”) — dotknij, by rozwinąć. Plan lekcji otwiera się z obecnymi lekcjami i zmienia je od dziś.',
      'Zmiany w zadaniu zapisują się od razu, bez „Zapisz”. Jedno przypomnienie na wydarzenie albo zadanie, z listą podzadań.',
      'Kalendarz pokazuje też zrobione zadania, pojedynczy termin serii może być na cały dzień, a Ustawienia są podzielone na krótkie podstrony.',
    ],
  },
  {
    // Buildy 19 i 20 odrzucone przez Apple (ITMS-90683, D123) — pierwszy z tymi zmianami w TestFlight to 21.
    // Karta pokazuje wszystkie wpisy od ostatnio obejrzanego, więc pominięte buildy nie gubią nowości.
    fromBuild: 19,
    items: [
      'Zaległe przeniesiesz na dziś jednym przyciskiem (z cofnięciem), a poranne przypomnienie podsumowuje cały dzień.',
      'Plan lekcji z tygodniami A/B (Grupy → osoba) i rutyny z krokami (Kalendarz → „Dodaj rutynę”) z serią „ile razy z rzędu”.',
      'Wydarzenie może mieć miejsce: „Nawiguj” otwiera mapy, a z „Czasem dojazdu” w Ustawieniach widzisz „Wyjdź o …”.',
      'W wierszach widać, kto odpowiada („dla: Ty”, „odpowiada: Ala”) i ile trwa wydarzenie. Ustawienia → „Wyczyść dane na telefonie” pobiera wszystko od nowa.',
      'Dzień z przerwami: między sprawami widać „wolne 2 h 30 min”, a wydarzenia z iPhone’a stoją na swojej godzinie.',
    ],
  },
  {
    fromBuild: 18,
    items: [
      'Wydarzenia z iPhone’a wyglądają jak wydarzenia grup, tylko szare — bez kwadracika, który mylił się z polem do odhaczenia.',
      'Wydarzenie z iPhone’a, które powtarza wpis z aplikacji (ten sam dzień, podobna godzina i nazwa), jest ukrywane. W Ustawieniach wybierzesz, które kalendarze iPhone’a pokazywać.',
      'Treść nie wchodzi już pod zegar i baterię przy przewijaniu.',
    ],
  },
  {
    fromBuild: 17,
    items: [
      'Zadania przypięte do wydarzenia i podzadania stoją teraz pod rodzicem, z wcięciem i mniejszą kropką. Rodzic pokazuje, ile już zrobione („1/3 zrobione”).',
      'Gdy rodzica nie ma w tym dniu, podzadanie ma dopisek, np. „↳ Basen (wydarzenie)”.',
    ],
  },
  {
    fromBuild: 16,
    items: [
      'Kalendarz iPhone’a w obie strony: Twoje wydarzenia (także z Google i Outlooka dodanych w iPhonie) widać w Kalendarzu i w „Moich sprawach”.',
      'Wydarzenia grup same trafiają do osobnych kalendarzy „Organizer – nazwa grupy” w iPhonie i aktualizują się po każdej zmianie.',
      'Twoje prywatne wydarzenia zostają na telefonie — nikt z grupy ich nie widzi. Włączysz to w Kalendarzu, wyłączysz w Ustawieniach.',
      'Formularz „Więcej”: na górze wybierasz zadanie albo wydarzenie, nie trzeba wybierać listy. Zakres godzin w szybkim dodaniu („basen jutro 17–18”) tworzy wydarzenie.',
      'W grupach widać Twoje imię zamiast początku adresu e-mail — zmienisz je w Ustawieniach → „Twoje imię”.',
      'Dzień wybierasz w małym kalendarzu, bez wpisywania. Klawiatura chowa się po przewinięciu i po dodaniu, a „Dziś” nie przesuwa już strzałek.',
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
      'Obok pola dodawania jest „Więcej”: pełny formularz z grupą, osobą i powtarzaniem. Po szybkim dodaniu dotknij „Zmień”. Dopisz @imię, np. „basen jutro 19 @Ala”.',
      'Zakupy podzielone na działy, stałe zakupy jednym dotknięciem i podpowiedzi z wcześniejszych zakupów.',
      'Naprawione: pozycje listy zakupów nie znikają po synchronizacji. Nowe: powiadomienie, gdy ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie.',
    ],
  },
];
