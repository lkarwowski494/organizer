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
    → zmienione 8.10.2026 (audyt 2, T-11, P-56): zakupy z terminem przenoszą się jak zadania (poranne podsumowanie
    i tak je liczy); pomijane są zadania z terminem po rodzicu albo wydarzeniu i grupy, w których jestem dzieckiem
    (serwer odrzuciłby zmianę). Liczba na przycisku i pasku to liczba spraw, nie operacji.
  - Przenoszone tylko moje: przypisane do mnie i z grupy osobistej (decyzja właściciela z 8.10.2026, audyt 2). Wspólne
    nieprzypisane i zadania dziecka mają termin dla wszystkich, więc zostają zaległe.
  - Odhaczenie zaległego „codziennie” daje następne jutro — dzisiejsze nie powstaje osobno (decyzja właściciela
    z 8.10.2026: zostaje jak jest, zgodnie z zasadą „zaległe nie wraca w przeszłość”).
  - Logika w `src/domain/views/overdue.ts`.
