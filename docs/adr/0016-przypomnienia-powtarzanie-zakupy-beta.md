# 0016. Przypomnienia, powtarzanie zadań, ilości w zakupach, przygotowanie szerokich testów (7.10.2026)

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D75 | Przypomnienia | Na telefonie: 30 min przed sprawą z godziną i o 8:00 zbiorcze dla spraw bez godziny. Osoba zmienia to w Ustawieniach. → poranne zbiorcze zastąpione przez D110 (ADR 0026: podsumowanie całego dnia); przy wydarzeniu z policzonym dojazdem „Czas wyjść” zamiast 30 min przed (D117, ADR 0029). | Wybór przy każdej sprawie; push z serwera (pg_cron) |
| D76 | Powtarzanie i historia | Proste powtarzanie: codziennie, co tydzień w wybrane dni, co miesiąc, co N dni lub tygodni od wykonania. Historia „kto, co, kiedy” na ekranie zadania. | Ogólny kanał „Co nowego” |
| D77 | Zakupy | Ilości przy pozycjach i zakupy w Kalendarzu. Lista stałych zakupów do backlogu. | Działy sklepu; podpowiedzi z historii (na później) |
| O-048 | Szerokie testy | Publiczny link TestFlight | Tylko zaproszenia e-mailem |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Przypomnienia to powiadomienia lokalne** planowane z widoku „Dotyczy mnie”.
   - Plan obejmuje 3 dni naprzód, najwyżej 40 powiadomień naraz, i odświeża się po każdej zmianie danych.
   - Limit iOS na liczbę zaplanowanych powiadomień nie jest potwierdzony w przeczytanej dokumentacji Apple. To otwarte pytanie, dlatego zapas.
   - Sprawy bez terminu (przypięte) nie dostają przypomnień, bo codziennie to samo byłoby szumem.
   - Karta zgody pokazuje się teraz każdemu, nie tylko osobom we wspólnej grupie.
2. **Powtarzanie: kolejne zadanie zamiast przesuwania terminu.**
   - Odhaczenie tworzy następne zadanie ze stałym id (uuidv5), więc dwa telefony nie zrobią duplikatu. Odhaczone zostaje jako historia.
   - Według kalendarza następny termin to pierwszy dzień reguły po późniejszym z: termin, dzień wykonania. Reguła to RRULE, ten sam podzbiór co wydarzenia.
   - Dni nieistniejące są pomijane zgodnie z RFC 5545, np. „co miesiąc 31.” przeskakuje luty.
   - Podzadania nie są kopiowane.
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
