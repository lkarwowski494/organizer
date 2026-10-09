# ADR 0003 — Polski parser szybkiego dodawania: zakres i reguły rozstrzygania (6.10.2026)

Status: przyjęte. Realizuje D18 (regułowy polski parser dat z chipem do odklikania).
Kod: `src/domain/quickadd.ts`, reguły i słownik: `src/config/quickadd.pl.ts`.

## Zakres MVP
dziś/dzisiaj, jutro, pojutrze (opcjonalnie z „na”); „w/we/na” + dzień tygodnia w bierniku; daty liczbowe
(15.10, 15.10.2027, 15/10) i słowne (15 października, 15 paź 2027); godziny (o 17, o 17:30, o 17.30,
o godz. 7, o godzinie 7, 17:30); „co tydzień” → `FREQ=WEEKLY;BYDAY=<dzień startu>`.
Rozpoznawanie ignoruje polskie znaki. Pierwszy fragment danego rodzaju wygrywa, kolejne zostają w tytule.
Poza MVP: „w przyszły piątek”, „za 3 dni”, „do piątku”, „rano/wieczorem”, „codziennie”, +osoba, #grupa (Faza 1).
„@imię” (D91) i „#grupa”, „@ja” (audyt 2, M-24) rozpoznaje osobno `domain/views/quick-target.ts`, poza parserem dat.

## Źródła językowe
- Nazwy miesięcy w dopełniaczu i skróty, nazwy dni: Unicode CLDR 48.2.3 (pl, ca-gregorian).
- „we” przed [w]/[f] + spółgłoska, oboczne „we środę/we czwartek”:
  https://sjp.pwn.pl/poradnia/haslo/we-wtorek;21155.html (prof. K. Kłosińska) oraz
  https://sjp.pwn.pl/poradnia/haslo/kiedy-w-kiedy-we;23528.html (dr hab. A. Wolański).
- Biernik: środę, sobotę, niedzielę — formy odmiany na sjp.pl (środa, sobota, niedziela).

## Decyzje właściciela (6.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D42 | „w piątek” wpisane w piątek | ten dzień za tydzień | dziś |
| D43 | godzina bez dopowiedzenia („o 7”) | najbliższa przyszła: dla 1–11 rano, chyba że minęła, a po południu nie; bez dnia — najbliższe wystąpienie (dziś albo jutro); przy dniu podanym wprost godzina zostaje w tym dniu | zawsze dosłownie |
| D44 | data bez roku, która już minęła | przyszły rok (najbliższy rok, w którym data istnieje, np. 29.02) | bieżący rok |
| D45 | sam dzień bez godziny | termin całodniowy (bez godziny) | domyślna godzina |

Dopowiedzenia (moje, w duchu D43): godziny 0 i 12–23 czytane dosłownie; seria „co tydzień” bez dnia
startuje dziś; nieistniejąca data (31.04) nie jest rozpoznawana i zostaje w tytule.

## Bezpiecznik dnia (audyt 2, 8.10.2026; decyzja wykonawcza Claude, właściciel może zawetować)
Problem: „dentysta w przyszły wtorek o 15” dawało termin dziś 15:00 (D43: godzina bez dnia), bo „przyszły wtorek”
nie jest w zakresie MVP — zły dzień bez ostrzeżenia.
- Reguła: gdy w tekście poza rozpoznanymi i odklikanymi fragmentami jest nazwa dnia tygodnia w dowolnej formie
  („piątek”, „środy”, „wtorki”) albo „przyszły/następny” w dowolnej formie, a żadnej daty nie rozpoznano, parser nie
  bierze godziny ani „co tydzień” (zostają w tytule) i zwraca ten fragment (`unrecognizedDay`; „przyszły/następny”
  razem ze słowem tuż po nim). Pole dodawania mówi wtedy: „Nie rozpoznano dnia „przyszły wtorek”, więc zadanie będzie
  bez terminu…”. Zakres godzin z takim dniem nie tworzy wydarzenia. Słowo dnia odklikane albo obok rozpoznanej daty
  nic nie zmienia.
- Formy: sjp.pl (hasła poniedziałek … niedziela, przyszły, następny), w `config/quickadd.pl.ts`.
- Znaczenie „przyszły wtorek” (pytanie językowe) — źródła się rozchodzą, więc parser go nie tłumaczy:
  prof. M. Bańko: „Myślę, że przyszły czwartek należy do przyszłego tygodnia”
  (https://sjp.pwn.pl/poradnia/haslo/przyszly-czwartek;8697.html); prof. K. Kłosińska: „nie ma jednoznacznych
  rozstrzygnięć co do zakresu użycia słów przyszły i ten”, „Jak wskazuje jednak praktyka, w tej funkcji [najbliższego
  poniedziałku] jest używany też przymiotnik przyszły”
  (https://sjp.pwn.pl/poradnia/haslo/Przyszly-poniedzialek-czy-ten-poniedzialek;21133.html). Ta sama odpowiedź:
  sam „poniedziałek” „w odniesieniu do najbliższego poniedziałku będzie jak najbardziej zrozumiałe” — stąd
  przykłady w aplikacji tylko z „w piątek”, „jutro o 17” i datą.
- Odrzucone: „przyszły X” = najbliższy X (sprzeczne z odpowiedzią prof. Bańki); = X w następnym tygodniu (sprzeczne
  z praktyką opisaną przez prof. Kłosińską); zostawić zgadywanie dziś/jutro (zły dzień bez ostrzeżenia); blokować
  dodanie do czasu poprawki (wolniejsze, a tekst i tak zostaje w nazwie).
- Otwarte (do zaległości, każde wymaga źródła): sam dzień bez przyimka („rachunek piątek”), „za tydzień”, „za 3 dni”,
  „w weekend”, „codziennie / co miesiąc / co roku”, „rano/wieczorem”.

## Testy
Korpus 766 fraz (przeliczone 8.10.2026 po bezpieczniku dnia: każda forma ze słownika z godziną i z „co tydzień”;
wcześniej 540, pierwotnie 470, uzupełniany m.in. w ADR 0009) w `src/domain/__tests__/fixtures/quickadd.pl.json` generowany przez
`scripts/gen-quickadd-corpus.py` z niezależną implementacją reguł na `datetime` Pythona (test różnicowy;
`npm run check:corpus` pilnuje, że plik jest aktualny). Do tego testy własności (fast-check): data → fraza →
parse = ta sama data; dzień tygodnia zawsze 1–7 dni naprzód; godzina bez dnia zawsze w ciągu 24 h w przyszłości;
tokeny zawsze wskazują swój tekst. Sprawdzenie mutacyjne: zmiana D42, D43 lub D44 w kodzie łamie 12–33 testy.

Ten sam korpus przechodzi drogę zapisu (`src/app/__tests__/quickadd.test.ts`: tekst → `quickAddOps` → wiersz).

## Audyt 3 (9.10.2026)
- N-28: „dziś/jutro/pojutrze” albo dzień tygodnia wygrywa z datą liczbową bez roku („raport 1.5 strony jutro” → jutro,
  „1.5” zostaje w nazwie). Data liczbowa bez roku, która wypada w przyszłym roku („1/2 kostki masła” → 1 lutego 2027),
  dostaje pod polem pełną datę z podpowiedzią, że chip można odkliknąć.
- N-124: pole podzadania nie rozpoznaje powtarzania („co tydzień” zostaje w nazwie — podzadanie się nie powtarza).
Korpus: 786 fraz (ze słowem dnia przy liczbie bez roku).

## Znane ograniczenia
„2.5 kg” bez słowa dnia zostanie odczytane jako 2 maja — pod polem stoi wtedy pełna data, użytkownik odklikuje chip
(w Moich sprawach i na liście zadań).
Lista zakupów nie używa parsera dat (audyt 2, M-20: wcześniej używała — „mąka 1.5 kg” stawała się „mąka kg”
z terminem 1 maja): tytuł zostaje dosłowny, ilość czyta tylko wyświetlanie (D77).
