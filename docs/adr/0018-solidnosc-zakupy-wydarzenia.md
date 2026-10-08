# 0018. Solidność przed testami, lepsze zakupy, powiadomienie o osobie odpowiedzialnej za wydarzenie (8.10.2026)

Prośba właściciela: „co jeszcze możemy dopracować”. Z czterech zaproponowanych kierunków wybrał trzy: solidność
przed testami, lepsze zakupy, wydarzenia (push i przypomnienia). Widżet na ekranie głównym (O-005) został w backlogu.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D84 | Ekran „Co nowego” | Krótka karta raz po aktualizacji (2–4 punkty, „Wyślij uwagę”). | Pełna historia w Ustawieniach; bez ekranu (tylko TestFlight) |
| D85 | Działy zakupów | Nagłówki działów; dział zgadywany z nazwy, ręczna zmiana zapamiętana w grupie. | Samo sortowanie z ikoną, bez ręcznej poprawki |
| D86 | Stałe zakupy | Lista stałych przy liście zakupów i przycisk „Dodaj stałe”. | Automatyczny powrót stałych po odhaczeniu zakupów |
| D88 | Wydarzenia | Przypomnienia jak przy zadaniach dla tego, co mnie dotyczy; push do osoby odpowiedzialnej. | Osobny czas przypomnień dla wydarzeń; tylko osoba odpowiedzialna |

Sprostowanie: przy pytaniu o D88 napisałem, że przypomnienia działają tylko przy zadaniach. To nieprawda — od D75
plan przypomnień obejmuje wszystko z „Dotyczy mnie”, także wydarzenia z godziną (test `reminders.test.ts`). Wybrana
opcja („jak zadania”) jest więc stanem obecnym; nowe w D88 jest tylko powiadomienie push.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **D82 Sprzątanie bazy (O-032):**
   - Jedno codzienne zadanie pg_cron (3:17 UTC): kosz po 30 dniach, grupy z kosza, zgłoszenia i uwagi po 90 dniach, dziennik push po 7 dniach.
   - Drugie zadanie (3:27 UTC) czyści historię `cron.job_run_details` po 7 dniach. Dokumentacja Supabase Cron mówi, że nie czyści się sama (https://supabase.com/docs/guides/cron/quickstart).
   - pg_cron działa w bazie, bez opłat; wgrane na projekt Free 8.10.2026 (supabase-deploy #16).
2. **Test telefonów na prawdziwym serwerze:** `tests/db/phones-vs-sql.test.ts`, 150 losowych przebiegów, zawodna sieć, wszystkie nowsze rodzaje danych.
3. **D83 Samosprawdzenie telefonu (S3, S4):** raz na wersję zgłoszenie „diagnostic”: strefa czasowa przy zmianach czasu, polskie litery, wersja SQLite, JSON, wycofanie transakcji. Wynik w tabeli `client_errors` w panelu Supabase.
4. **D85 Działy:**
   - Lista i kolejność działów to konwencja aplikacji, nie twierdzenie o układzie sklepów.
   - Strony sklepów internetowych (Frisco, Auchan, Carrefour, Biedronka) nie dały się przeczytać. Otwarte pytanie O-059: porównać nazwy działów z drzewem kategorii polskiego sklepu.
   - Słownik to heurystyka podpowiedzi, poprawiana ręcznie.
   - Ręczny wybór zapisany w pozycji (`tasks.category`). Pamięć grupy to najnowszy ręczny wybór dla tej samej nazwy, bez osobnej tabeli.
   - Audyt 2 (M-110): pamięć i podpowiedzi biorą też pozycje z kosza (po „Zakupy zrobione”); telefon trzyma je do
     wyczyszczenia kosza (30 dni), starsze wybory znikają. „Najnowszy wybór” to chwila zmiany działu z historii
     (activity), nie ostatnia zmiana wiersza (np. odhaczenie). Odrzucone teraz: osobna, trwała tabela pamięci grupy
     (migracja i nowa encja synchronizacji) — do zaległości.
   - Audyt 2 (M-230): „masło orzechowe” → Spiżarnia (źródła w `src/config/shopping.pl.ts`); tofu i napoje roślinne
     zostają w O-059.
5. **D86 Stałe zakupy:** kolumna `lists.staples` (tekst[], najwyżej 50 pozycji po 200 znaków; wybór projektowy). Podpowiedzi z list zakupów grupy, najwyżej 5.
   - Audyt 2 (M-111): dodanie i usunięcie stałej pozycji to polecenia `staple_add` / `staple_remove`
     (migracja 20261008370000) — zmieniają jedną nazwę pod blokadą wiersza, więc zmiany z dwóch telefonów się sumują;
     telefon liczy ten sam skutek od razu. Stary telefon dalej wysyła całą tablicę. Odrzucone: łączenie tablic na
     telefonie. Migrację trzeba wdrożyć przed wydaniem buildu, który wysyła te polecenia (stary serwer: `unknown_cmd`).
6. **D87 Naprawa błędu:** serwer od pierwszej migracji odrzucał każdą pozycję listy zakupów (`invalid_list:kind`).
   - Pozycje zakupów to zadania na liście „shopping”. Warunek rodzaju listy został tylko dla przenosin.
   - Odrzucona alternatywa: osobna tabela pozycji zakupów (przebudowa całego telefonu).
   - Regresja w `phones-vs-sql`.
7. **D88 Push wydarzeń:** ten sam mechanizm co D81 (wpis aktywności, `assignment_push_claim`), dla `events.responsible_member_id` i `event_overrides.responsible_member_id`.
