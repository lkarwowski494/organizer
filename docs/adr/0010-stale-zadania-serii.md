# 0010. Stałe zadania serii: kopie na najbliższe tygodnie (7.10.2026)

Właściciel: „Powinno się być w stanie dodać to samo zadanie jako oddzielny rekord dla każdego wydarzenia w serii (to, że w poniedziałek spakowałem strój, nie znaczy, że zrobię to w następny)”.

## Decyzja produktowa
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D65 | Jak zrobić to samo zadanie na każde spotkanie w serii | Kopie na najbliższe tygodnie: prawdziwe, osobne zadania na każde spotkanie, dokładane z wyprzedzeniem | Szablon na serii z wirtualnymi zadaniami, tworzonymi dopiero przy odhaczeniu albo zmianie |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Definicja jest w osobnej tabeli `event_task_series`** (seria, lista, tytuł), a kopie to zwykłe zadania z `series_id` i podpięciem do wystąpienia (D13).
   - Odrzucone: definicja w samym wydarzeniu, bo seria może mieć kilka stałych zadań na różnych listach.
2. **Kopie dokłada telefon** (`SeriesFiller`) na `config.SERIES_TASK_WEEKS` = 8 tygodni od dziś. To wybór projektowy, bez źródła zewnętrznego.
   - **Stały identyfikator:** id kopii = UUIDv5 (RFC 9562) ze stałej przestrzeni nazw i napisu „definicja|data wystąpienia”. Sprawdzone względem Pythona `uuid.uuid5`.
   - **Kilka telefonów naraz:** tworzą tę samą kopię, a serwer traktuje powtórne utworzenie jako powtórzenie (`apply_op`).
   - **Kopia usunięta (także w koszu) nie wraca:** wiersz o tym identyfikatorze już istnieje.
   - **Działa bez sieci i bez zadań serwera.** Dziecko nie dokłada kopii, bo serwer by je odrzucił.
   - Odrzucone: dokładanie na serwerze (pg_cron), bo zużywa limity i nie działa offline; losowe identyfikatory kopii, bo dwa telefony tworzyłyby duplikaty.
3. **Odwołanie wystąpienia usuwa jego niezrobione kopie bez pytania.** Należą do tamtego terminu. Pytanie D14 dotyczy tylko zadań podpiętych pojedynczo.
4. **Zmiana serii.**
   - „To i następne”: definicja przechodzi do nowej serii, a kopie z terminów, które zostają, idą razem z nią.
   - Kopie z terminów, które znikają, są usuwane; na nowe terminy telefon dołoży nowe kopie.
5. **„Zakończ”** usuwa definicję i niezrobione kopie od dziś. Zrobione i wcześniejsze zostają w historii.
6. **Widoczność jak zadania tej listy** (`can_see_list`), także w historii zmian i w `sync_fetch_scope`. Na telefonie zakres to lista, więc po utracie dostępu do listy ukrytej definicja znika razem z nią.
7. **Poprawka czyszczenia kosza.** `purge_tombstones` nie usuwa serii, na którą wskazuje zadanie albo definicja. Wcześniej przerywał się błędem klucza obcego (`tasks_event_id_fkey`, potwierdzone na bazie sprzed poprawki; pg_cron nie był jeszcze włączony, O-032).
