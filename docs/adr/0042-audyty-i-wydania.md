# 0042. Audyty i wydania

Data: 9.10.2026. Status: przyjęta (decyzja właściciela, wariant A z poprawką; obowiązuje we wszystkich aplikacjach właściciela do odwołania).

## Decyzja

1. Wydanie blokują tylko znaleziska krytyczne i wysokie (dane, awaria lub funkcja nie do użycia, błędne liczby lub
   twierdzenia, prywatność, bezpieczeństwo, sekrety, prawa autorskie, bariera dostępności, ryzyko odrzucenia przez
   Apple). Średnie i niskie idą do backlogu z przypisaną wersją.
2. Jeden audyt na wydanie, bez pętli; naprawy sprawdzają testy odtwarzające, pełne sprawdzenie i E2E.
3. Od startu audytu do wydania zakres jest zamrożony: tylko naprawy blokerów.
4. TestFlight: audyt zmian od poprzedniego wydania plus stała lista kontrolna; przed App Store i co ok. trzy wydania
   pełny audyt.
5. Bez limitu czasu; duża przebudowa blokera — właściciel wybiera naprawę albo wydanie bez tej funkcji.

## Zastosowanie do audytu 3

Build 23 po fali 1 (wszystkie 10 znalezisk wysokich), poprawce synchronizacji (pull w porcjach) i zielonym E2E.
Fale 2–4 (średnie i niskie) idą dalej jako praca do kolejnych wydań. Nowe funkcje z PK-32 czekają na backlog
(zamrożenie zakresu do wydania build 23).

## Odrzucone

- Wszystkie poprawki audytu 3 przed build 23 (wcześniejszy plan) — opóźnia poprawki wysokich na telefonie.
- Fale 2–4 wstrzymane do przeglądu backlogu — właściciel wybrał dalszą pracę.
