# 0016. Przypomnienia, powtarzanie zadań, ilości w zakupach, przygotowanie szerokich testów (7.10.2026)

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D75 | Przypomnienia | Na telefonie: 30 min przed sprawą z godziną i o 8:00 zbiorcze dla spraw bez godziny. Osoba zmienia to w Ustawieniach. → poranne zbiorcze zastąpione przez D110 (ADR 0026: podsumowanie całego dnia); przy wydarzeniu z policzonym dojazdem „Czas wyjść” zamiast 30 min przed (D117, ADR 0029); wydarzenie i zadanie z podzadaniami mają jedno zbiorcze przypomnienie, podzadania bez własnych poza wyjątkiem D145 (D134, ADR 0035). | Wybór przy każdej sprawie; push z serwera (pg_cron) |
| D76 | Powtarzanie i historia | Proste powtarzanie: codziennie, co tydzień w wybrane dni, co miesiąc, co N dni lub tygodni od wykonania. Historia „kto, co, kiedy” na ekranie zadania. | Ogólny kanał „Co nowego” |
| D77 | Zakupy | Ilości przy pozycjach i zakupy w Kalendarzu. Lista stałych zakupów do backlogu. → Zrobione w D86 (ADR 0018). | Działy sklepu; podpowiedzi z historii (na później) |
| O-048 | Szerokie testy | Publiczny link TestFlight | Tylko zaproszenia e-mailem |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Przypomnienia to powiadomienia lokalne** planowane z widoku „Dotyczy mnie”.
   - Plan obejmuje 3 dni naprzód, najwyżej 40 powiadomień naraz (stan z 7.10.2026; dziś `config.reminders.DAYS_AHEAD`, `MAX_SCHEDULED`), i odświeża się po każdej zmianie danych. → od 8.10.2026 (D159): 14 dni i najwyżej 64 najbliższe — limit iOS: „the system keeps the soonest-firing 64 notifications … and discards the rest” (https://developer.apple.com/documentation/uikit/uilocalnotification; dawny adres archiwalny przekierowuje tutaj).
   - Sprawy bez terminu (przypięte) nie dostają przypomnień, bo codziennie to samo byłoby szumem.
   - Audyt 2: dzień naprzód liczony tak, jak aplikacja pokaże go tego dnia — poranne podsumowanie jutra liczy zaległe (M-88); planowanie po kolei (nowszy plan zastępuje starszy), bez pozycji bliższych niż 5 s, błąd jednej pozycji nie przerywa reszty i jest zgłaszany raz (M-100); stan zgody odświeżany po powrocie do aplikacji (M-101); dotknięcie przypomnienia otwiera sprawę (PWD-16). Plan liczy jedna funkcja bez Reacta (`reminderPlan` w `src/app/reminders.tsx`) — także w tle (D159 niżej).
   - **D159 (decyzja właściciela 8.10.2026, PW-22 A): przypomnienia aktualne bez otwierania aplikacji.** Po moich zmianach, które mogą zmienić czyjeś przypomnienia (`src/domain/reminder-wake.ts`: sprawy z terminem w oknie planu, wydarzenia, obecność, członkowie, widoczność list), telefon po 30 s ciszy albo przy wyjściu z aplikacji prosi `notify-handoff` (`groups`) o ciche powiadomienia dla członków grup. Serwer (`private.wake_push_claim`) wysyła do urządzenia najwyżej jedno na 20 min (Apple: „don't try to send more than two or three per hour”), zmiana w przerwie czeka i wychodzi przy ponowieniu z telefonu albo następnej prośbie. Budzony telefon (zadanie `organizer-reminders-refresh`, `src/app/background.ts`) pobiera zmiany — przez pętlę działającej aplikacji albo wprost do bazy konta — i planuje przypomnienia od nowa z ustawień w bazie konta i ostatniego policzonego dojazdu (bez pytania o położenie). Ciche powiadomienia nie mają gwarancji dostarczenia (Apple: „the system doesn't guarantee their delivery”; aplikacja zamknięta gestem przez użytkownika nie jest budzona), dlatego plan sięga 14 dni. Wymaga nowego buildu (tryb tła „Remote notification”, expo-task-manager).
   - D160: termin, który dotyczy mnie tylko przez dzieci, gdy każde z nich „nie będzie” — bez przypomnienia, „Czas wyjść” i dojazdu, jak moje „nie będę” (`silencedForMe`, `src/domain/views/rsvp.ts`).
   - Karta zgody pokazuje się teraz każdemu, nie tylko osobom we wspólnej grupie.
2. **Powtarzanie: kolejne zadanie zamiast przesuwania terminu.**
   - Odhaczenie tworzy następne zadanie ze stałym id (uuidv5), więc dwa telefony nie zrobią duplikatu. Odhaczone zostaje jako historia.
   - Według kalendarza następny termin to pierwszy dzień reguły po późniejszym z: termin, dzień wykonania. Reguła to RRULE, ten sam podzbiór co wydarzenia. → Uzupełnione: następny termin powstaje też po przeminięciu „Tylko tego dnia” (D133), powtarzanie miesięczne pamięta dzień miesiąca (D137, oba ADR 0035), zmiana dnia pyta „Tylko ten raz / Też kolejne” (D181, ADR 0036), podzadania są kopiowane (D154, ADR 0041).
   - Dni nieistniejące są pomijane zgodnie z RFC 5545, np. „co miesiąc 31.” przeskakuje luty.
   - Podzadania nie są kopiowane. → zmienione 8.10.2026 (decyzja właściciela, audyt 2): następne dostaje kopie podzadań (ADR 0024, dopisek).
   - Bez terminu nie ma powtarzania (ograniczenie w bazie). Zdjęcie terminu zdejmuje też regułę.
   - Odrzucone: przesuwanie terminu tego samego zadania. Traci historię i daje konflikty przy synchronizacji.
3. **Ilości są tylko wyświetlaniem** (parseQuantity): w bazie zostaje to, co wpisano. Bez jednostki rozpoznajemy tylko liczby 1–99, żeby „mleko 3,2%” czy „Pepsi 0,5” nie stały się ilością.
4. **Kalendarz pokazuje wszystkie zaplanowane zakupy grupy**, tak jak zadania grupy. „Dotyczy mnie” pokazuje tylko moje.
5. **O-036:**
   - imię z Apple (tylko przy pierwszym logowaniu) trafia do profilu;
   - przy usuwaniu konta z Apple unieważniamy token przez Sign in with Apple REST API, zgodnie z wymogiem Apple (https://developer.apple.com/support/offering-account-deletion-in-your-app/);
   - nieudane unieważnienie nie blokuje usunięcia konta;
   - wymaga klucza Sign in with Apple w sekretach Supabase (krok właściciela).
6. **Polityka prywatności** to szkic w `docs/privacy-policy.md` (publiczne repozytorium = darmowy adres). Do zatwierdzenia przez właściciela.

## Wdrożenia bazy (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D78 | Zatwierdzanie wdrożeń Supabase na etapie rozwoju | Bez zatwierdzania: środowisko `supabase-prod` tylko z gałęzi `main`, wdrożenie uruchamia Claude po zielonych testach bazy, zawsze `apply`. | Automatycznie po każdym pushu; zostaje zatwierdzanie, rzadziej |

Zabezpieczenia, które zostają: testy pgTAP w CI (`db.yml`) przed wdrożeniem, zakaz edycji wydanych migracji, podgląd migracji w logu każdego przebiegu, sekrety tylko w środowisku. Do powrotu do zatwierdzania przed publicznym wydaniem w App Store (otwarte).
