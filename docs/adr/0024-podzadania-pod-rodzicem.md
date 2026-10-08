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
- Audyt 2 (M-82, M-83): na ekranie listy niezrobione podzadanie zrobionego (albo minionego) rodzica stoi w otwartych
  z dopiskiem rodzica (jak D105), a w zamkniętych się nie powtarza; pole jest zaznaczone tylko przy odhaczonym, minione
  (D61) ma „minęło” bez ptaszka. Licznik listy (ekran List, grupa, nagłówek listy, „N do kupienia” w Moich sprawach)
  liczy wiersze otwartych — wszędzie ta sama liczba (`src/domain/views/list-tree.ts`). Na liście zakupów pozycje nie
  mają terminów (D73), więc otwarte = niekupione. Odrzucone: podzadanie w obu sekcjach.
