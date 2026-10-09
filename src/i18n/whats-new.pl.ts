/**
 * Teksty karty „Co nowego” (D84), od najnowszego. `fromBuild` = numer buildu TestFlight (run_number ios-release),
 * od którego dany wpis obowiązuje. Dopisz wpis przy buildzie z widocznymi zmianami; 2–4 krótkie punkty (zbiorczy najwyżej 8).
 * Karta pokazuje wszystkie wpisy od ostatnio obejrzanego, więc starsze wpisy muszą opisywać aplikację taką, jaka jest
 * (audyt 2, M-136): ścieżki „Ustawienia → …” i cytowane przyciski pilnuje src/app/__tests__/texts.test.ts.
 */
import type { WhatsNewEntry } from '../domain/whats-new';

export const whatsNewEntries: readonly WhatsNewEntry[] = [
  {
    // Build 23: poprawki audytu 3 (9.10.2026). „Nawiguj” tylko w Mapach Apple — ADR 0043.
    fromBuild: 23,
    items: [
      '„Nawiguj” przy wydarzeniu otwiera zawsze Mapy Apple, więc wybór aplikacji map zniknął z Ustawień.',
    ],
  },
  {
    // Build 22: zmiany od buildu 21 (D124–D135, D199) i poprawki audytu 2 z 8.10.2026 — jedna karta, najwyżej 8 punktów.
    fromBuild: 22,
    items: [
      'Wydarzenie może trwać kilka dni (obóz, wyjazd) albo przez północ. Obecność: „Będę / Może / Nie będę” — za siebie i za dziecko bez konta. Godzinę wybierasz kafelkami.',
      'Usunięte rzeczy trafiają na 30 dni do Kosza (Grupy → Kosz), a każdą zmianę cofniesz w Grupy → Ostatnie zmiany. Przy usuwaniu zamiast pytania jest „Cofnij”.',
      'Szybkie dodawanie pokazuje, do której grupy trafi wpis („Do: Rodzina”), rozumie „#Rodzina” i „@ja”, a przy samym produkcie podpowiada „Na listę: Zakupy”. Nie zgaduje dnia, którego nie rozpoznało.',
      'Zadanie: zmiany zapisują się od razu, „Przenieś do grupy” przenosi je z podzadaniami, a niezapisany formularz wraca po powrocie. Odhaczenie z niezrobionymi podzadaniami pyta, co z nimi.',
      'Dziecko może mieć własne konto: przy jego profilu „Połącz z kontem dziecka”. Zobaczy i odhaczy tylko swoje sprawy. Lekcje dziecka to jeden wiersz w Moich sprawach, a zmiany planu obowiązują od jutra.',
      'Powiadomienia otwierają sprawę, której dotyczą, przypomnienia nadążają za zmianami innych bez otwierania aplikacji, a „Czas wyjść” ma osobny przełącznik (Ustawienia → Powiadomienia).',
      'Kalendarz iPhone’a: w kalendarzach „Organizer” tylko Twoje sprawy, z wyborem grup (Ustawienia → Kalendarz i dojazd). Wydarzenie z iPhone’a dodasz do grupy przyciskiem „Dodaj do grupy”.',
      'Zakupy trafiają do koszyka bez pytania, nazwę listy i pozycję zmienisz na miejscu. Synchronizacja nie gubi zmian bez sieci i z dwóch telefonów, a odrzucone przez serwer pokazuje z nazwą.',
    ],
  },
  {
    // Buildy 19 i 20 odrzucone przez Apple (ITMS-90683, D123) — pierwszy z tymi zmianami w TestFlight to 21.
    // Karta pokazuje wszystkie wpisy od ostatnio obejrzanego, więc pominięte buildy nie gubią nowości.
    fromBuild: 19,
    items: [
      'Zaległe przeniesiesz na dziś jednym przyciskiem (z cofnięciem), a poranne przypomnienie podsumowuje cały dzień.',
      'Plan lekcji z tygodniami A/B (Grupy → grupa → dziecko → „Plan lekcji”) i rutyny z krokami (Kalendarz → „Dodaj rutynę”) z licznikiem „N razy z rzędu”.',
      'Wydarzenie może mieć miejsce: „Nawiguj” otwiera mapy, a gdy włączysz „Czas dojazdu do najbliższych wydarzeń” (Ustawienia → Kalendarz i dojazd), widzisz „Wyjdź o …”.',
      'W wierszach widać, kto odpowiada („dla Ciebie”, „odpowiada: Ala”) i ile trwa wydarzenie. „Wyczyść dane na telefonie” (Ustawienia → Konto i dane) pobiera wszystko od nowa.',
      'Dzień z przerwami: między sprawami widać „wolne 2 h 30 min”, a wydarzenia z iPhone’a stoją na swojej godzinie.',
    ],
  },
  {
    fromBuild: 18,
    items: [
      'Wydarzenia z iPhone’a wyglądają jak wydarzenia grup, tylko szare — bez kwadracika, który mylił się z polem do odhaczenia.',
      'Wydarzenie z iPhone’a, które powtarza wpis z aplikacji (ten sam dzień, podobna godzina i nazwa), jest ukrywane. Które kalendarze iPhone’a pokazywać, wybierzesz w Ustawienia → Kalendarz i dojazd.',
      'Treść nie wchodzi już pod zegar i baterię przy przewijaniu.',
    ],
  },
  {
    fromBuild: 17,
    items: [
      'Zadania podpięte do wydarzenia i podzadania stoją teraz pod rodzicem, z wcięciem i mniejszą kropką. Rodzic pokazuje, ile już zrobione („1/3 zrobione”).',
      'Gdy rodzica nie ma w tym dniu, podzadanie ma dopisek, np. „↳ Basen (wydarzenie)”.',
    ],
  },
  {
    fromBuild: 16,
    items: [
      'Kalendarz iPhone’a w obie strony: Twoje wydarzenia (także z innych kont dodanych w iPhonie) widać w Kalendarzu i w Moich sprawach.',
      'Wydarzenia grup same trafiają do osobnych kalendarzy „Organizer – nazwa grupy” w iPhonie i aktualizują się po każdej zmianie.',
      'Twoje prywatne wydarzenia zostają na telefonie — nikt z grupy ich nie widzi. Włączysz i wyłączysz to w Ustawienia → Kalendarz i dojazd.',
      'Formularz „Więcej”: na górze wybierasz zadanie albo wydarzenie, nie trzeba wybierać listy. Zakres godzin w szybkim dodaniu („basen jutro 17–18”) tworzy wydarzenie.',
      'W grupach widać Twoje imię zamiast początku adresu e-mail — zmienisz je w Ustawienia → Konto i dane → Twoje imię.',
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
      'Ekran „Dotyczy mnie” to teraz ekran „Moje sprawy”.',
      'Obok pola dodawania jest „Więcej”: pełny formularz z grupą, osobą i powtarzaniem. Po szybkim dodaniu dotknij „Zmień”. Dopisz @imię, np. „basen jutro 19 @Ala”.',
      'Zakupy podzielone na działy, stałe zakupy jednym dotknięciem i podpowiedzi z wcześniejszych zakupów.',
      'Naprawione: pozycje listy zakupów nie znikają po synchronizacji. Nowe: powiadomienie, gdy ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie.',
    ],
  },
];
