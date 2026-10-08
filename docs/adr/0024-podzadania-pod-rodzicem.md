# 0024. Podzadania pod rodzicem w „Moich sprawach” i Kalendarzu (8.10.2026)

Zgłoszenie właściciela (zrzut): zadania przypięte do wydarzenia wyglądają jak samodzielne, więc łatwo pomylić zadanie
samodzielne z podzadaniem wydarzenia albo innego zadania.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D104 | Jak pokazać podzadania | Wcięcie pod rodzicem, mniejsza kropka, cieńsza wstążka; rodzic z licznikiem „1/3 zrobione” | Karta z rodzicem; zwinięte z licznikiem |
| D105 | Rodzica nie ma w tym dniu | Podzadanie na swoim miejscu z dopiskiem „↳ Basen (wydarzenie)” / „↳ Spakować torbę” | Dokładanie wyszarzonego rodzica |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- Logika w `src/domain/views/nesting.ts`, wspólna dla „Moich spraw” (dni i przypięte) i dnia w Kalendarzu.
- Kolejność dnia bez zmian (agenda.ts). Dzieci przenoszone są tuż pod rodzica, w ich kolejności, w głąb do 2 poziomów zadań (D4) plus wydarzenie. Wcięcie wizualne najwyżej 3 poziomy.
- Rodzic „jest w tym dniu”, gdy jego wiersz jest wśród wpisów dnia. Podzadanie z terminem w innym dniu niż rodzic dostaje dopisek.
- Licznik liczy wszystkie nieusunięte podzadania widoczne w telefonie (także cudze), bo rodzic jest wspólny.
  - Dla wydarzenia: zadania tego wystąpienia (bez ich podzadań).
- Dane z cyklem (błąd) nie gubią wierszy — zostają płasko.

## Dopisek: odhaczenie zadania z niezrobionymi podzadaniami (decyzja właściciela z 8.10.2026, audyt 2)
- Odhaczenie pyta tak jak zakupy z niekupionymi pozycjami: „Zrobione? — Sprzątanie: zostały 2 niezrobione podzadania”,
  do wyboru „Zostaw podzadania” albo „Oznacz wszystko jako zrobione”. To samo okno wszędzie, gdzie się odhacza (Moje
  sprawy, lista, ekran zadania, Kalendarz, wydarzenie) — `useTaskActions` w `src/app/task-actions.ts`.
- „Oznacz wszystko jako zrobione” odhacza zadanie i jego niezrobione podzadania (wszystkie poziomy) w jednej paczce;
  pasek „Cofnij” przywraca wszystko naraz (jak odznaczenie zadania: następny termin znika, jeśli nietknięty).
- Zadanie powtarzane: następny termin dostaje kopie wszystkich podzadań (niezrobione; tytuły, notatki, kolejność, osoba,
  jeśli widzi listę). Id kopii = uuidv5(id podzadania + „|next”) — dwa telefony nie zrobią dubli. Termin: „jak nadrzędne”
  i „bez terminu” zostają, własny przesuwa się o tyle dni co zadanie, „ze spotkania” staje się „jak nadrzędne”.
  Cofnięcie odhaczenia zdejmuje kopię razem z jej podzadaniami, ponowne odhaczenie przywraca te, które poszły z nią.
- Po „Zostaw podzadania” niezrobione podzadania zrobionego zadania w dniu terminu jeszcze są (z dopiskiem rodzica),
  potem mijają (D61, jak „Tylko tego dnia”) — nie wiszą jako zaległe bez końca. Bez terminu zostają przypięte.
  Odrzucone: odhaczanie podzadań bez pytania (można odhaczyć coś niezrobionego), wygaszanie ich od razu (kroki znikają
  bez śladu).
- Zmiana grupy w formularzu „Zmień”: kopia w nowej grupie jest bez podzadań; komunikat mówi, ile podzadań pójdzie do
  kosza z oryginałem (audyt 2, T-33). Odrzucone: kopiowanie podzadań do innej grupy (osoby i spotkania są z innej
  grupy), bo formularz z istniejącym zadaniem otwiera się tylko przez kilka sekund po szybkim dodaniu.
