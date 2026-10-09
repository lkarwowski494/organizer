# 0034. Wybór godziny kafelkami; audyt 8.10.2026 (8.10.2026)

## Decyzja produktowa (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D125 | Pole godziny (podpowiedź „07:00” wyglądała jak wpisana godzina, klawiatura literowa) | Własny wybór kafelkami: godziny 0–23, minuty co `config.time.MINUTE_STEP` (5), ręczne wpisanie w panelu, „Bez godziny” w polu opcjonalnym (`src/ui/TimeField.tsx`); para „Początek/Koniec” ma jeden panel kafelków na pełnej szerokości pod obydwoma polami, kafelek ≥ 44 pt (`TimeFieldPair`, audyt 2: D195) | Pole z klawiaturą cyfr i automatycznym dwukropkiem; systemowe bębenki iOS (nowa biblioteka natywna) |

Minuty wybrane bez godziny przyjmują 12 (wybór projektowy, bez źródła) — pole i tak pokazuje wynik.

## Audyt (właściciel: „naprawiam od razu oczywiste”, zakres: logika, serwer, sens, dokumentacja)
Cztery przeglądy z dowodami (testy odtwarzające). Naprawione — commity 8.10.2026 „Audyt…”, migracja
`20261008280000_audit_fixes.sql` (+ `supabase/tests/audit_fixes.test.sql`). Sprawy produktowe A–O czekają na
decyzję właściciela (lista w rozmowie 8.10.2026, backlog O-098).
