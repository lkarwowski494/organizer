# 20. Definicja ukończenia funkcjonalności — pełen zakres testów automatycznych

Zasada właściciela z 06.10.2026: „każda funkcjonalność ma mieć przy wdrażaniu full scope zautomatyzowanych testów każdych przypadków i każdego rodzaju”.
Funkcjonalność (nowa albo zmieniona) w projekcie Organizer jest skończona dopiero, gdy posiada wszystkie rodzaje testów z matrycy poniżej, które jej dotyczą.
Pominięcie któregoś rodzaju testu wymaga wyraźnie zapisanego powodu w rejestrze zmian / dokumentacji (np. „funkcja bez UI — nie dotyczy testów ekranu”).

## Matryca rodzajów testów

| # | Rodzaj | Co sprawdza | Gdzie w projekcie |
|---|---|---|---|
| 1 | Logika domenowa | Czyste funkcje TypeScript: zwykły przypadek, puste dane, wartości graniczne, niepoprawne formaty, parsery NLP (szybkie dodawanie), reguły cykliczności (RRULE, DST), odmiana językowa (`plural.ts`). 100% pokrycia linii i gałęzi, ≥ 90% wykrytych mutacji Stryker. | `src/domain/**/__tests__/*.test.ts`, `src/config/**/__tests__/*.test.ts` |
| 2 | Ekran i widoki (UI) | Każdy nowy element interfejsu, dialog, formularz i komunikat renderuje się w środowisku RNTL (React Native Testing Library), a naciśnięcie lub wprowadzenie tekstu wywołuje właściwą mutację stanu i bazy. | `src/features/**/__tests__/*.test.tsx`, `src/ui/**/__tests__/*.test.tsx` |
| 3 | Scenariusz i synchronizacja | Pełny przepływ użytkownika: operacje w trybie offline (zapis do SQLite i kolejki `pending_ops`), wznowienie sieci, wywołanie `sync_push`, odbiór zmian przez pull z kursorem wersji grupy, symulacja konfliktów i scalania. | `src/sync/**/__tests__/*.test.ts`, `src/app/**/__tests__/*.test.tsx` |
| 4 | Macierz ról i motywów | Nowe funkcje przetestowane w kombinacji ról w grupie (`admin`, `member`, profil dziecka), poziomów widoczności (`group`, `restricted`, `private`), motywu jasnego i ciemnego (kontrast WCAG AAA), kontrakt braku marek (`brands.contract.test.ts`). | `src/config/**/__tests__/*.test.ts`, testy macierzowe |
| 5 | Niezmienniki (Property-based) | Testy z generatorami `fast-check`: losowe sekwencje operacji, niezmienniki UUIDv7 / UUIDv5, brak możliwości duplikacji zadań stałych, idempotencja operacji w kolejce `pending_ops`. | `src/domain/**/__tests__/*.property.test.ts` |
| 6 | Baza danych i migracje | Spójność transakcyjna SQLite (`better-sqlite3` w testach, `expo-sqlite` w aplikacji); migracje schematu idempotentne; testy polityk RLS w Postgres / Supabase za pomocą pgTAP (`npm run test:db`). | `src/data/**/__tests__/*.test.ts`, `tests/db/**/*.test.ts` |
| 7 | Język i dostępność | Wszystkie teksty w `src/i18n/strings.pl.ts`, odmiana gramatyczna przez `plural.ts`, etykiety VoiceOver (`accessibilityLabel`), role (`accessibilityRole`), rozmiar dotyku ≥ 44 pt, czytelność fontów (Atkinson Hyperlegible Next / Bricolage Grotesque). | `src/i18n/**`, testy kontrastu i dostępności |
| 8 | Regresja | Każdy zgłoszony błąd otrzymuje najpierw test automatyczny, który go wiernie odtwarza (czerwony przed wdrożeniem poprawki, zielony po wdrożeniu). | `src/**/__tests__/*regress*.test.ts` lub plik testu modułu |
| 9 | E2E na symulatorze iOS | Rzeczywisty przepływ użytkownika na symulatorze iPhone'a: scenariusze Maestro (`.maestro/*.yaml`) weryfikujące widoczne interakcje i porównania zrzutów ekranu (`pixelmatch`). | `.maestro/*.yaml`, `e2e/`, `scripts/e2e/` |

## Automatyczne bramki jakościowe

- **Przed każdym commitem (`npm run check`):**
  - Sprawdzenie typów: `npm run typecheck` (`tsc --noEmit`).
  - Linter bez ostrzeżeń: `npm run lint` (`eslint . --max-warnings 0`).
  - Pokrycie testami: `npm run test:coverage` (100% dla logiki `src/domain`, `src/config`, `src/data`, `src/sync`).
  - Weryfikacja funkcji brzegowych: `npm run check:functions` (Deno lint, check i testy z pokryciem).
  - Weryfikacja korpusów niezależnych: `npm run check:corpus` (kontrast, przejścia czasu DST, intro, quickadd NLP).
  - Kontrakt licencji: `npm run check:licenses`.
  - Kontrakt braku marek: `brands.contract.test.ts` (zakaz nazw innych aplikacji i firm).
- **Szybka pętla programisty (`npm run test:fast`):**
  - Uruchomienie tylko zmienionych testów w Jest (`jest --onlyChanged`).
- **Przed przygotowaniem wydania TestFlight:**
  - E2E na symulatorze iOS (`scripts/e2e/run-flows.sh`) zielone.
  - Sprawdzenie audytowe (`npm run check:audit`).
  - Brak sekretów w historii i commitach (gitleaks).
