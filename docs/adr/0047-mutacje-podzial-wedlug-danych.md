# 0047. Nocne testy mutacyjne: podział na części według danych (11.10.2026)

Status: wdrożone na gałęzi `fix3/mutshards` (rola Integrator, diagnoza czerwonego `nightly.yml`); do akceptacji właściciela.
Zasady właściciela, z których wynika: „Limity czasu w testach i CI rosną z danymi, nie są stałe”, „Testy mutacyjne ≥ 90%”,
standardowe maszyny GitHub Actions (repozytorium publiczne — bez opłat), bez płatnych „larger runners”.

## Przyczyna
Nocny przebieg 38102198765 (11.10.2026, commit sprzed przepisania historii 3c33bb6 = 1da4223): części mutation 1, 3, 5 i 6
zakończone kodem 124 po 110 min (`timeout` kroku), części 2, 4, 7 i 8 przeszły w 61–102 min. Ostatni zielony pomiar
mutacyjny (7.10.2026) miał 7 plików; 8.10.2026 — 64 pliki i 8 537 mutantów (1 512 statycznych); 11.10.2026 — 91 plików
i 18 863 mutanty (3 021 statycznych). Stałe 8 części z plikami rozdanymi według rozmiaru pliku nie śledziły kosztu:
- mutant statyczny (wykonywany przy wczytaniu modułu) przeładowuje i uruchamia wszystkie testy powiązane ze swoim plikiem
  (@stryker-mutator/core 10, mutants/mutant-test-planner.js), a Stryker wykonuje je na końcu części
  (process/4-mutation-test-executor.js, reloadEnvironmentLast). Stąd część 1: 2 190 z 2 476 mutantów po 108 min,
  a postęp Strykera „24%” (pozostałe to 268 mutantów statycznych);
- `src/config/shopping.pl.ts` (słownik działów zakupów) to 999 mutantów statycznych, każdy z 50 powiązanymi plikami
  testów (ok. 39 s testów) — sam ten plik to ok. 3,5 h jednej części;
- czas mutanta zależy od czasu testów, które go pokrywają, i od liczby wczytywanych plików testów, a nie od rozmiaru pliku.
Pomiar lokalny (plan Strykera dla wszystkich plików, 4 procesy): przewidywana praca ok. 20 h maszyny na noc.

## Decyzja
1. **Plan według danych** (`.github/scripts/mutation-plan.mjs`, zadanie `mutation-plan`, ok. 4 min): plan Strykera
   dla wszystkich plików (reporter „plan”: które mutanty są statyczne, szacowany czas testów każdego), testy powiązane
   z każdym plikiem (`jest --findRelatedTests`), model kosztu mutanta (czas testów + narzut uruchomienia) skalibrowany
   pomiarem poprzedniej nocy (reporter „timing” w każdej części, artefakt `mutation-timings`, współczynnik
   zmierzony/model dla pliku albo całości). Liczba części = najmniejsza, przy której każda mieści się w 90 min
   przewidywanego czasu; limit kroku = 2 × przewidywanie (limit zadania = krok + 10 min, poniżej 6 h GitHub).
2. **Dzielenie dużych plików** zakresami `--mutate plik:w:k-w:k` tylko między „korzeniami” (mutant, który nie leży
   w innym mutancie, ze wszystkimi mutantami w nim) — Stryker bierze mutant tylko, gdy cały leży w zakresie
   (instrumenter 10, locationIncluded), więc cięcie między korzeniami nie gubi mutantów. Największy niepodzielny
   korzeń dziś: tablica w `shopping.pl.ts` (500 mutantów statycznych, ok. 108 min).
3. **Kompletność**: scalanie (`mutation-merge.mjs`) porównuje klucze mutantów (plik, położenie, mutator, zamiana)
   z planem — każdy mutant z planu dokładnie raz, nic spoza planu; próg 90% bez zmian, na wyniku całości.
4. **Budżet czasu widoków (`perf-budget.test.ts`) poza testami mutacyjnymi** (`jest.mutation.config.js`): mierzy czas
   procesora, a kod z wszystkimi mutantami jest wolniejszy — 11.10.2026 oblał przebieg wstępny planu (289 ms przy
   budżecie 150 ms), a w części mógłby „zabijać” mutanty samym narzutem instrumentacji (zawyżony wynik). Budżet nadal
   pilnuje `npm run check` na kodzie bez mutantów.

## Odrzucone warianty
- **A. Liczba części z liczby mutantów, pliki według liczby mutantów** — prosty i bez pomiaru, ale mutant statyczny
  kosztuje do kilkudziesięciu razy więcej niż zwykły (część 5 z 11.10.2026 miała 40% mutantów statycznych, część 7 — 7%),
  więc części dalej byłyby nierówne; nie dzieli pliku dłuższego niż jedna część (`shopping.pl.ts`).
- **C. Tryb przyrostowy Strykera (`--incremental`) z plikiem wyników poprzedniej nocy** — najmniej pracy na noc, ale:
  Stryker nie wykrywa zmian poza plikami mutowanymi i testami (zależności, konfiguracja), więc stary wynik mógłby ukryć
  regres; zmiana w pliku importowanym wszędzie (konfiguracja, `plural.ts`) i tak wymusza prawie pełny przebieg, który musi
  się zmieścić w częściach; wynik zależałby od artefaktu z poprzedniej nocy (7 dni przechowywania). Do rozważenia później
  jako dodatek do tego podziału (pełny przebieg np. raz w tygodniu), nie zamiast niego.
- **`ignoreStatic`** (pominięcie mutantów statycznych) — skraca przebieg o ok. ¾, ale wynik nie obejmowałby 3 021 mutantów
  (m.in. słowników w `src/config`); sprzeczne z „wynik obejmuje całą logikę”. Decyzja właściciela, gdyby chciał.
- **Większe maszyny** — płatne („larger runners”), wykluczone.
- **Skalowanie budżetu czasu przy Strykerze** zamiast wyłączenia — budżet pod instrumentacją nie mierzy wydajności
  aplikacji, a próg trzeba by zgadywać.
