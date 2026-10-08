# 0031. Widok dnia: lista z przerwami (8.10.2026)

Wybór właściciela z makiety (O-083, https://claude.ai/artifact/1ZNbpQR4xdNLDJy5G2QBz2).

## Decyzja produktowa (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D122 | Jak pokazać dzień | Lista z przerwami: dotychczasowe wiersze, wydarzenia z iPhone'a na swojej godzinie, między sprawami „wolne 2 h 30 min” | Linia metra (gęsta przy wielu grupach); oś czasu z blokami proporcjonalnymi do długości (dużo przewijania, słabo z zadaniami bez godziny) |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- Logika w `src/domain/views/day-plan.ts` (100% pokrycia). Najpierw sprawy bez godziny (aplikacja, potem całodniowe z iPhone'a), dalej po godzinie; przy tej samej godzinie sprawa aplikacji przed wpisem z iPhone'a.
- Zajęte od początku do końca; zadanie z godziną i wydarzenie bez końca to chwila; nakładające się sprawy łączą się (zajęte do najpóźniejszego końca). Podzadania pod rodzicem (D104) nie wpływają na przerwy.
- Przerwa od `config.day.GAP_MIN` = 30 min (wybór projektowy, bez źródła; do zmiany po używaniu). Dziś liczona od teraz, więc minione przerwy znikają.
- Przerwy tylko w widoku dnia „Moich spraw” i w wybranym dniu Kalendarza (dziś i później). W tygodniu, miesiącu i w minionych dniach — bez przerw, ale wydarzenia z iPhone'a też stoją na swojej godzinie.
- Zapis długości przerwy jak długości wydarzenia (D120, BIPM).
