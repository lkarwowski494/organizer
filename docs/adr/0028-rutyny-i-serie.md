# 0028. Rutyny z krokami i serie (8.10.2026)

Pytanie właściciela: „Co z habit tracker i routines?”. Wybór: „Oba” — rutyny z krokami i serie.
Odrzucone: tylko rutyny; tylko nawyki z serią; nie teraz.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **D113 Rutyna:** wydarzenie cykliczne (dni, godzina, opcjonalnie osoby) plus stałe zadania serii (D65) jako kroki.
  - Bez migracji i nowej tabeli.
  - Kroki pojawiają się na każde wystąpienie, stoją pod rutyną (D104), a niezrobione po dniu mijają (D61), więc rutyna nie zostawia zaległości.
  - Kroki trafiają na ogólną listę grupy (D97). Siedem dni to `FREQ=DAILY`.
  - Wejście: Kalendarz → „Dodaj rutynę”. Zmiana potem jak wydarzenie, kroki na ekranie wydarzenia („stałe zadania”).
  - Odrzucone: nowa encja „rutyna” (migracja, druga ścieżka synchronizacji) i powtarzane zadanie z kopiowaniem podzadań. Niezrobione zadanie powtarzane nie tworzy następnego, więc pominięty dzień zatrzymałby rutynę.
- **D114 Seria:** licznik od 2 z rzędu („seria: 5 z rzędu”) przy rutynie i zadaniu powtarzanym w „Moich sprawach”.
  - Rutyna: wystąpienia z rzędu ze wszystkimi krokami zrobionymi. Dzisiejsze liczy się po zrobieniu, a niezrobione dziś serii nie przerywa.
  - Zadanie powtarzane: powtórzenia z rzędu odhaczone najpóźniej w dniu terminu (łańcuch kopii po identyfikatorze następnego).
  - Okno 400 dni (wybór projektowy). Licznik nie ocenia ani nie nagradza. Punkty i nagrody dla dzieci (Domownik) to osobna decyzja.
- Logika w `src/domain/views/routines.ts`, ekran `src/features/events/RoutineScreen.tsx`.
