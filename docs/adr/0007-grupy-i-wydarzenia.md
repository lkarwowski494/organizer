# 0007. Edycja grup i wydarzenia cykliczne (7.10.2026)

Zgłoszenie właściciela po pierwszym buildzie: grup nie da się edytować ani usunąć. Brakuje też miejsca na powtarzające się wydarzenia, np. tańce córki w każdy poniedziałek o 18:00 i w każdą sobotę o 12:00. Zajęcia czasem się przesuwają, więc trzeba móc zmienić pojedyncze wydarzenie albo całą serię.

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D54 | Usuwanie grupy | Kosz na 30 dni. Usuwa tylko właściciel. Grupy osobistej nie da się usunąć. Przywrócenie z sekcji „Kosz” na ekranie Grupy. | Usunięcie od razu, na zawsze; archiwum bez usuwania |
| D55 | Co można edytować w grupie | Role członków (admin/członek), usuwanie członków, przekazanie własności, imiona dzieci | Tylko nazwa grupy |
| D56 | Kolor grupy | Wybiera właściciel spośród 8 kolorów linii. „Automatyczny” = kolejność grup jak dotąd | Kolor wybierany osobno przez każdą osobę |
| D57 | Zakres zmiany wydarzenia z serii | Pytanie przy zmianie i odwołaniu: „Tylko to wydarzenie”, „To i następne”, „Wszystkie w serii” | Tylko „to” i „wszystkie” |
| D58 | Kogo dotyczy wydarzenie | Do wyboru: cała grupa albo wybrane osoby z grupy | Zawsze cała grupa |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Reguła powtarzania to podzbiór RRULE z RFC 5545** (https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10): DAILY, WEEKLY, MONTHLY, YEARLY, INTERVAL, BYDAY (w MONTHLY także z numerem), BYMONTHDAY, COUNT, UNTIL, tydzień od poniedziałku.
   - Cytaty z RFC są w `src/domain/rrule.ts`.
   - Rozwijanie sprawdza korpus 409 przypadków (przeliczone z `rrule.json` 8.10.2026; wcześniej podane tu 436 nie zgadzało się z plikiem) z niezależnej implementacji, python-dateutil 2.9.0.post0 (`scripts/gen-rrule-corpus.py`).
   - Odrzucone: biblioteka rrule.js. Liczy na `Date` w UTC, a my trzymamy daty cywilne Europe/Warsaw (R2). Zmiana czasu nie może przesuwać zajęć.
2. **Różne godziny w różne dni to osobne serie.** Przykład: pon. 18:00 i sob. 12:00. Formularz pozwala dodać kilka terminów naraz, a każdy termin zapisuje się jako osobna seria.
   - Powód: RFC 5545 daje serii jedną godzinę startu (DTSTART).
   - Odrzucone: jedna seria z listą godzin per dzień. To poza standardem i utrudniłoby późniejszy eksport do kalendarza.
3. **Zmiana jednego wystąpienia to wiersz `event_overrides`**, którego kluczem jest data pierwotna. Wiersz może przenieść wystąpienie (dzień, godziny), zmienić tytuł albo je odwołać.
   - Jedna godzina może się zmienić tylko dla wystąpienia z godziną. Wydarzenie całodniowe pozostaje całodniowe, bo pusta godzina w wyjątku znaczy „bez zmiany”.
   - Przeniesione wystąpienie jest widoczne, jeśli przesunięto je najwyżej o 62 dni.
   - Odrzucone: kopia całego wydarzenia na każde wystąpienie. Zmiana całej serii przestałaby wtedy obejmować kopie.
4. **„To i następne” = koniec starej serii dzień wcześniej (UNTIL) + nowa seria od tego dnia.** Wyjątki od tego dnia przechodzą do nowej serii.
   - Wszystko idzie jedną paczką operacji zapisaną w jednej transakcji (`dispatch` przyjmuje listę), więc działa offline.
   - Zmiana od pierwszego wystąpienia oznacza zmianę całej serii.
   - Odrzucone: funkcja serwera „podziel serię”. Nie zadziała bez sieci (R1).
5. **„Dotyczy mnie” dla wydarzeń.** Wydarzenie trafia do widoku, gdy:
   - dotyczy całej grupy;
   - albo jestem uczestnikiem;
   - albo uczestnikiem jest dziecko z grupy, a ja jestem dorosłym (rodzic zawozi na zajęcia).

   Kalendarz pokazuje wszystkie wydarzenia z moich grup.

   Odrzucone: dziecko jako uczestnik oznacza tylko dziecko. Dzieci zwykle nie mają kont, więc takie wydarzenie nie trafiłoby do nikogo.
6. **Dzieci nie tworzą ani nie zmieniają wydarzeń.** To ta sama zasada co przy listach, pilnowana w strażniku SQL i w UI.
7. **COUNT z innych źródeł zamienia się na datę ostatniego wystąpienia** przy edycji. Formularz ma tylko „bez końca” albo „do dnia”.

## Dopisek: odhaczanie, usuwanie, kolejność dnia (7.10.2026, po teście na telefonie)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D59 | Ochrona przed przypadkowym odhaczeniem | Systemowe okno „Zrobione?” (zakupy: „Do koszyka?”) przy odhaczaniu zadań i pozycji zakupów. Cofnięcie odhaczenia działa bez pytania. | Dwa dotknięcia; bez pytania z paskiem „Cofnij”; zakupy bez potwierdzenia |
| D60 | Usuwanie z listy | Przesunięcie wiersza w lewo odsłania „Usuń”, a usuwa dopiero dotknięcie tego przycisku. Potem widać pasek „Cofnij” (także po usunięciu listy), a pozycja trafia do kosza. Dziecko nie dostaje usuwania (D34). | Długie przytrzymanie z menu; usuwanie tylko z ekranu zadania |

Kolejność dnia (poprawka): w „Dziś”, „Jutro” i w dniu kalendarza wydarzenia i zadania tworzą jedną listę.
- Na górze są całodniowe: najpierw wydarzenia, potem zadania bez godziny.
- Dalej wszystko z godziną rosnąco (`src/domain/views/agenda.ts`).
- Wcześniej wydarzenia stały w osobnym bloku przed zadaniami.

Decyzja wykonawcza: przesuwanie zrobione na poziomym `ScrollView` z RN, bez nowej biblioteki natywnej.
- Odrzucone: react-native-gesture-handler. To nowa zależność natywna i trudniejsze testy.

## Dopisek: „to i następne” jednym poleceniem, pojedyncze terminy (audyt 2, 8.10.2026)
Zmienia punkty 3 i 4 decyzji wykonawczych.
- **„To i następne” to jedno polecenie `split_event`** (migracja `20261008320000_event_split`). Paczka z punktu 4 była jedną transakcją tylko na telefonie: serwer stosuje każdą operację osobno, więc odrzucona nowa seria zostawiała uciętą starą i następne terminy znikały u wszystkich (M-3). Polecenie serwer wykonuje w całości albo wcale.
  - Ten sam algorytm działa na telefonie (`src/domain/event-split.ts`, wołany z `applyOp`), więc zmiana jest widoczna od razu i bez sieci (R1). Zgodność obu wersji sprawdza test różnicowy `tests/db/event-split.test.ts`.
  - Nowa seria wskazuje poprzedniczkę (`events.split_from`). Jej identyfikator to UUIDv5 z serii i dnia: dwa telefony dzielące ten sam termin nie zdublują serii, drugie polecenie tylko zmienia nową serię (ostatni zapis wygrywa). Telefon, który nie wie o wcześniejszym podziale, dzieli właściwą część łańcucha.
  - Do nowej serii przechodzą z tymi samymi identyfikatorami: wyjątki, odpowiedzi o obecności wszystkich osób (M-12), przekazania, zadania (także zrobione) i definicje stałych zadań (gdy nowa seria jest ostatnia w łańcuchu). Wyjątki z terminów, których nowa seria nie ma, idą do kosza; podgląd skutków podaje ich liczbę.
  - Telefony z buildem 21 dzielą dalej po staremu (osobne operacje) i serwer je przyjmuje.
  - Odrzucone: najpierw nowa seria, potem ucięcie starej (dalej dwie operacje: po odrzuceniu ucięcia zostają dwie serie z tymi samymi terminami); zależności między operacjami w `sync_push` (zmiana protokołu dla wszystkich zapisów); znacznik dla strażników (trzeba by przedefiniować trzech strażników).
- **„Tylko to” wysyła tylko zmienione pola.** Godziny trafiają do wyjątku tylko wtedy, gdy różnią się od godzin serii: termin ze zmienioną nazwą, osobą albo dniem dalej idzie za godziną serii (M-95, decyzja właściciela z 8.10.2026, wariant A). Pełne godziny z buildu 21 serwer zamienia na „jak w serii” (wyzwalacz), a stare wyjątki poprawił jednorazowo według historii zmian.
- **W jednym terminie można wybrać „nikt konkretny”** (`event_overrides.responsible_cleared`, M-94); wskazana osoba wygrywa ze znacznikiem. To zmienia punkt 2 ADR 0011.
- **Odwołany termin można przywrócić** z ekranu wydarzenia.

## Do zrobienia później
- D13: zadania przypięte do wystąpienia wydarzenia (np. „spakować strój” przed tańcami). → zrobione w ADR 0008.
- Przypomnienia o wydarzeniach (push). → zrobione: przypomnienia lokalne D75 (ADR 0016) i push do osoby odpowiedzialnej D88 (ADR 0018).
