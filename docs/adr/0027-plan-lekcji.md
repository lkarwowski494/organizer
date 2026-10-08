# 0027. Plan lekcji z tygodniami A/B (8.10.2026)

Z porównania z Domownikiem (plan zajęć domownika z tygodniami A/B). Właściciel: „Dorzucamy”, wariant
„Plan osoby jako seria wydarzeń”. Odrzucone: osobny ekran planu bez wydarzeń; seria wydarzeń + tabela tygodnia.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **D112:** wejście z ekranu osoby (Grupy → grupa → osoba → „Plan lekcji”), tylko w grupie wspólnej i nie dla roli dziecka.
- **Zapis:** lekcje pon.–pt. z godzinami i wyborem „Co tydzień / Tydzień A / Tydzień B” stają się zwykłymi wydarzeniami cyklicznymi.
  - Osoba jest uczestnikiem, więc dziecko jako uczestnik dotyczy też dorosłych (D58).
  - A/B = co 2 tygodnie (`INTERVAL=2`), liczone od pierwszego wystąpienia (RFC 5545, DTSTART).
  - Który tydzień jest A, mówi użytkownik o bieżącym tygodniu.
  - Ta sama lekcja w kilka dni to jedna seria.
  - Opcjonalnie „Do dnia”.
  - Cofnięcie usuwa utworzone serie.
- **Edycja potem:** każdą lekcję zmienia się jak wydarzenie (ten, następne, wszystkie — D57). Osobnej tabeli planu nie ma, zgodnie z wyborem.
- **Otwarte pytanie:** daty końca roku szkolnego nie wpisujemy domyślnie. Zależy od rozporządzenia na dany rok, bez przeczytanego źródła; użytkownik podaje „Do dnia” sam.
- Logika w `src/domain/views/timetable.ts`, ekran `src/features/groups/TimetableScreen.tsx`.
