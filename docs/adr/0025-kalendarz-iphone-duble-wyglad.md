# 0025. Wydarzenia z iPhone'a: wybór kalendarzy, ukrywanie dubli, wygląd; pas pod zegarem (8.10.2026)

Zgłoszenie właściciela (zrzut Kalendarza): wydarzenia z iPhone'a wyglądają dziwnie (kwadracik jak pole wyboru, szare
kwadraciki prawie w każdym dniu siatki) i dublują wpisy wprowadzone w aplikacji („Dzieci – basen” z kalendarza
„Łukasz Karwowski” obok zadania „Kuba i Róża – Basen”). Do tego treść przewija się pod zegarem i baterią.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D106 | Dublowanie z wpisami aplikacji | Wybór kalendarzy iPhone'a w Ustawieniach | Tylko wybór; „Przenieś do grupy” przy każdym |
| D107 | (jw.) | Plus ukrywanie dubli: ten sam dzień, godzina ±30 min albo obie bez godziny, wspólne słowo nazwy | — |
| D108 | Wygląd | Jak wiersz wydarzenia grupy, wyciszony (szary znacznik i nazwa); w siatce szara kropka | Osobna sekcja „Z iPhone'a” |
| D109 | Treść pod paskiem stanu | Pas w kolorze tła pod zegarem na każdym ekranie | Bez zmian |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- Kalendarze do wyboru są brane z pobranych wydarzeń (bez nowego wywołania iOS). Kalendarz bez wydarzeń w oknie odczytu nie ma czego ukrywać. Wybór zostaje na tym telefonie (prefs `calendarSkip`).
- Dubel (`isDuplicate`, `src/domain/views/calendar-sync.ts`): słowa nazwy bez polskich znaków, co najmniej 4 litery, bez samych liczb.
  - Parametry: `config.calendar.DUPLICATE_WINDOW_MIN` = 30, `DUPLICATE_MIN_WORD` = 4. To wybory projektowe bez źródła.
  - Kolejne dni wydarzenia wielodniowego („cd.”) nigdy nie są dublami.
  - Dubel jest ukrywany na liście dnia (Moje sprawy, Kalendarz) i nie daje kropki w siatce.
- Ryzyko: rzadko ukryje wydarzenie, które nie było dublem (ta sama godzina i wspólne słowo, np. „Basen”). Wtedy można wyłączyć… nic — ukrywanie nie ma wyłącznika. Otwarte pytanie: czy dać przełącznik „Ukrywaj duble” (decyzja produktowa, do właściciela, jeśli zdarzy się w praktyce).

## Audyt 2 (8.10.2026): D173 zastępuje regułę wspólnego słowa (PW-25 A)
- Dubel: wpis z iPhone'a ze znacznikiem Organizera w notatce (kopia z „Dodaj do kalendarza” albo z lustra) albo o tej
  samej nazwie po ujednoliceniu (małe litery, bez polskich znaków, znaki inne niż litery i cyfry jako spacja) co wpis
  aplikacji tego dnia, przy godzinie ±30 min albo obu bez godziny. „Urodziny Ani” przy „Urodziny babci” już nie znika,
  a „Bal” i „WF” z obu źródeł są dublami. Odrzucone: ostrzejsza reguła słów (dalej fałszywe trafienia); bez zmian.
- Pod listą dnia (Moje sprawy, Kalendarz) wiersz „Ukryto N dubli z iPhone’a” — dotknięcie pokazuje ukryte (bez „Dodaj
  do grupy”). `DUPLICATE_MIN_WORD` usunięty z `config.calendar`. Otwarte pytanie o przełącznik „Ukrywaj duble” — nieaktualne
  (nic nie znika bez śladu).
