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
| D59 | Ochrona przed przypadkowym odhaczeniem | Systemowe okno „Zrobione?” przy odhaczaniu zadań. Pozycja zakupów trafia do koszyka bez pytania, z paskiem „Cofnij” — nie znika, tylko przechodzi do „W koszyku” (zmiana: decyzja właściciela z 8.10.2026, audyt 2, PW-15 A; wcześniej okno „Do koszyka?”). Cofnięcie odhaczenia działa bez pytania. | Dwa dotknięcia; bez pytania z paskiem „Cofnij” także przy zadaniach; przy zakupach okno „Do koszyka?” (do 8.10.2026) albo przełącznik w Ustawieniach |
| D60 | Usuwanie z listy | Przesunięcie wiersza w lewo odsłania „Usuń”, a usuwa dopiero dotknięcie tego przycisku. Potem widać pasek „Cofnij” (także po usunięciu listy), a pozycja trafia do kosza. Dziecko nie dostaje usuwania (D34). | Długie przytrzymanie z menu; usuwanie tylko z ekranu zadania |

Kolejność dnia (poprawka): w „Dziś”, „Jutro” i w dniu kalendarza wydarzenia i zadania tworzą jedną listę.
- Na górze są całodniowe: najpierw wydarzenia, potem zadania bez godziny.
- Dalej wszystko z godziną rosnąco (`src/domain/views/agenda.ts`).
- Wcześniej wydarzenia stały w osobnym bloku przed zadaniami.

Decyzja wykonawcza: przesuwanie zrobione na poziomym `ScrollView` z RN, bez nowej biblioteki natywnej.
- Odrzucone: react-native-gesture-handler. To nowa zależność natywna i trudniejsze testy.

## Do zrobienia później
- D13: zadania przypięte do wystąpienia wydarzenia (np. „spakować strój” przed tańcami). → zrobione w ADR 0008.
- Przypomnienia o wydarzeniach (push). → zrobione: przypomnienia lokalne D75 (ADR 0016) i push do osoby odpowiedzialnej D88 (ADR 0018).
