# 0026. „Przenieś zaległe na dziś” i poranne podsumowanie dnia (8.10.2026)

Porównanie z innymi aplikacjami (Structured, Domownik, Kalendarz – Planer Dnia) dało listę 5 kierunków.
Właściciel zdecydował: 1) oś dnia — najpierw makieta (oś czasu, linia metra, lista z przerwami); 2) plan lekcji
z tygodniami A/B — dorzucamy; 3) pytanie o nawyki i rutyny; 4) przepisy do backlogu bez priorytetu; 5) wdrażamy.
Ten zapis dotyczy punktu 5.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja |
|---|---|---|
| D110 | Poranne „zaplanuj dzień” | Wdrażamy |
| D111 | „Przenieś zaległe na dziś” | Wdrażamy |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **D110:** poranne przypomnienie już było („Rano: co na dziś”, D75), ale tylko dla spraw bez godziny. Teraz przychodzi zawsze, gdy dzień ma cokolwiek.
  - Treść: „5 spraw, w tym 1 zaległa: …” i pierwsze cztery: zaległe i bez godziny, potem z godziną („17:00 Tańce”).
  - Godzina jak dotąd w Ustawieniach (7:00, 8:00, 9:00 albo wyłączone).
  - Odrzucone: osobne drugie przypomnienie „zaplanuj dzień” (dwa poranne to szum).
- **D111:** przycisk w dzisiejszym dniu, gdy są zaległe z własnym terminem. Ustawia termin na dziś, godzina zostaje. Pasek „Cofnij” przywraca dawne terminy.
  - Pomijane: zakupy (termin listy) i zadania z terminem po rodzicu albo wydarzeniu — tam termin zmienia się u rodzica.
  - Logika w `src/domain/views/overdue.ts`.
