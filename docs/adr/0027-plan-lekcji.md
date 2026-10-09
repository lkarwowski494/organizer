# 0027. Plan lekcji z tygodniami A/B (8.10.2026)

Z porównania z Domownikiem (plan zajęć domownika z tygodniami A/B). Właściciel: „Dorzucamy”, wariant
„Plan osoby jako seria wydarzeń”. Odrzucone: osobny ekran planu bez wydarzeń; seria wydarzeń + tabela tygodnia.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **D112:** wejście z ekranu osoby (Grupy → grupa → osoba → „Plan lekcji”), tylko w grupie wspólnej i nie dla roli dziecka. → Zmienione przez D128 (ADR 0035): przycisk tylko przy dzieciach, ekran pokazuje istniejący plan do edycji.
- **Zapis:** lekcje pon.–pt. z godzinami i wyborem „Co tydzień / Tydzień A / Tydzień B” stają się zwykłymi wydarzeniami cyklicznymi.
  - Osoba jest uczestnikiem, więc dziecko jako uczestnik dotyczy też dorosłych (D58). → Zmienione: lekcje bez obecności (D126) i u dorosłych jednym zwiniętym wierszem na dzień, bez przypomnień (D127, oba ADR 0035).
  - A/B = co 2 tygodnie (`INTERVAL=2`), liczone od pierwszego wystąpienia (RFC 5545, DTSTART).
  - Który tydzień jest A, mówi użytkownik o bieżącym tygodniu. → Zmienione przez D171 (niżej): tydzień A zapisany przy osobie.
  - Ta sama lekcja w kilka dni to jedna seria.
  - Opcjonalnie „Do dnia”.
  - Cofnięcie usuwa utworzone serie. → Zmienione przez D128 (ADR 0035) i M-14 (niżej): zapis zmienia plan od jutra, cofnięcie przywraca stary plan.
- **Edycja potem:** każdą lekcję zmienia się jak wydarzenie (ten, następne, wszystkie — D57). Osobnej tabeli planu nie ma, zgodnie z wyborem.
- **Otwarte pytanie:** daty końca roku szkolnego nie wpisujemy domyślnie. Zależy od rozporządzenia na dany rok, bez przeczytanego źródła; użytkownik podaje „Do dnia” sam.
- Logika w `src/domain/views/timetable.ts`, ekran `src/features/groups/TimetableScreen.tsx`.

## Audyt 2 (8.10.2026)
- **D171 (decyzja właściciela, PW-9 B):** który tydzień jest A, zapisuje się przy osobie — `group_members.week_a`, poniedziałek
  jakiegoś tygodnia A (migracja `20261008430000_member_week_a`; zmienia ją dorosły z grupy, dziecko nie). Litery A/B są stałe
  i zgodne ze szkołą; parzystość liczona z różnicy dni, więc rok z 53 tygodniami ISO jej nie psuje. Przełącznik „Ten tydzień
  to A/B” zmienia tylko nazwy tygodni (litery lekcji zamieniają się razem z nim), nie przesuwa lekcji; zapis ustawia kotwicę.
  Plan sprzed D171 (bez kotwicy): ten tydzień to A, jak dotąd. Odrzucone: zamiana liter bez zapisu (litery dalej „pływają”
  co tydzień), ukrycie przełącznika przy edycji (niezgodne z nazwami szkoły).
- **Edycja planu od jutra (M-14, zmienia D128):** seria bez zmian zostaje nietknięta; zmieniona (para ze starą: ta sama
  nazwa albo te same dni i godziny) przechodzi poleceniem `split_event` jak „to i następne” — od jutra z odwołaniami,
  zmianami terminów, obecnością, przekazaniami, zadaniami i stałymi zadaniami; kopie stałych zadań z terminów, których
  nowa seria nie ma, do kosza. Gdy zapis zabiera zadaniom termin albo kasuje zmienione pojedynczo terminy, najpierw ten
  sam podgląd co przy „to i następne” (`SeriesPreview`, wybór: najbliższy termin albo odpięcie); bez takich skutków —
  zapis od razu (decyzja koordynatora 8.10.2026). Nierozpoczęta
  seria zmienia się w miejscu; usunięta lekcja kończy się dziś (nierozpoczęta do kosza). Dzisiejsza lekcja zostaje, jak
  była. Odrzucone: nowa seria od dziś z utratą wyjątków i zadań (stan sprzed audytu), osobne operacje przenoszenia
  (nieatomowe, audyt 2 M-3).
- **Lekcja z rodzeństwem (M-213):** zmiana albo usunięcie w planie jednego dziecka dotyczy tylko jego — seria trwa dla
  pozostałych (`split_event` z tymi samymi polami bez tej osoby), a zmieniona lekcja tego dziecka to nowa seria. Sobota
  i niedziela są w planie, gdy mają lekcje.
- **Cofnięcie (M-215):** liczone w chwili cofnięcia (z kopiami stałych zadań dołożonymi w międzyczasie). Świadome ryzyko:
  zmiana tej samej serii z innego telefonu w czasie paska „Cofnij” zostaje nadpisana — okno kilku sekund.
- **Wejścia (PWD-26 A):** rutyna także jako „Rodzaj: Rutyna” w pełnym formularzu („Więcej”, nowe wydarzenie), a rutyna
  i plan lekcji każdego dziecka także z ekranu grupy.
