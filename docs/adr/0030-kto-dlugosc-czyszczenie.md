# 0030. Kto i jak długo w wierszach, „Wyczyść dane na telefonie” (8.10.2026)

Zgłoszenie właściciela: nigdzie nie widać osoby odpowiedzialnej za zadanie i wydarzenie ani czasu trwania; potrzebny
przycisk „wyczyść dane” w Ustawieniach (podejrzenie danych ze starych wersji), bez usuwania członków grup.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D119 | Gdzie pokazać osobę | W wierszu zawsze: „dla: Ty” / „dla: Ala” przy zadaniu, „odpowiada: Ty” / „odpowiada: Ala” przy wydarzeniu — w Moich sprawach i Kalendarzu | Tylko gdy to ktoś inny; tylko w szczegółach |
| D120 | Jak pokazać czas trwania | Godziny + długość: „17:00–18:30 · 1 h 30 min” (wydarzenia; zadania nie mają długości, D99) | Sama długość; tylko w szczegółach |
| D121 | Co czyści „Wyczyść dane” | Telefon od nowa: usuwa kopię danych i kolejkę na tym iPhonie, pobiera wszystko z serwera; na serwerze nic nie znika; ostrzeżenie o niewysłanych zmianach | Sprzątanie osieroconych wpisów na serwerze; usunięcie moich zadań i wydarzeń |

## Źródła
- Zapis długości: BIPM, Broszura SI, wyd. 9 (https://doi.org/10.59161/AUEZ1291). Tabela 8: „hour h 1 h = 60 min = 3600 s”, „minute min 1 min = 60 s”. 5.4.3: „The numerical value always precedes the unit and a space is always used to separate the unit from the number”.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- „Ty”, gdy osoba to ja (`user_id` członka = moje konto; `src/domain/views/who.ts`). Bez przypisanej osoby wiersz nie pokazuje nikogo.
- Długość tylko przy wydarzeniu z początkiem i końcem (`lengthLabel`). Od D199 (ADR 0037) koniec nie później niż początek znaczy „następnego dnia” i długość liczy się przez północ („22:00–06:00 · 8 h”). Także w szczegółach wydarzenia i w etykiecie dostępności wiersza.
- Czyszczenie (`wipeSynced`): tabele danych, `pending_ops`, `rejected_ops`, kursory synchronizacji; zostają ustawienia telefonu (klucze `local:*`, m.in. lustro kalendarza i tryby dojazdu). Silnik synchronizacji startuje od pustego stanu i pobiera wszystko od zera.
