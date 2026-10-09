# 0033. Potwierdzanie obecności przy wydarzeniu (8.10.2026)

## Decyzja produktowa (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D124 | Co robimy dalej | Potwierdzanie obecności: „Będę / Może / Nie będę” przy terminie wydarzenia grupy | Szablony wydarzeń; tryb „w sklepie”; widżet (do backlogu) |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **Dane:** tabela `event_rsvps` (migracja `20261008270000_event_rsvps.sql`, pgTAP `event_rsvps.test.sql`): jedna odpowiedź na osobę i termin (data wystąpienia według reguły, jak `event_overrides`), `answer` ∈ yes / no / maybe, `answered_by` ustawia serwer. Bez wpisów aktywności.
- **Kto odpowiada:** za siebie; dorosły także za dziecko bez konta (profil D10/D34); dziecko z kontem tylko za siebie — strażnik `event_rsvps_guard` i to samo w `src/domain/views/rsvp.ts`.
- **Kogo pytamy:** uczestników, gdy wydarzenie jest dla wybranych osób; inaczej całą grupę. Tylko grupy wspólne i terminy od dziś.
- **Identyfikator:** UUIDv5(„https://github.com/lkarwowski494/organizer/event-rsvp”, wydarzenie|data|osoba) — dwa telefony piszą ten sam wiersz. Gdy telefon nie zna wiersza, wysyła utworzenie i zmianę (powtórzone utworzenie serwer pomija, zmiana zapisuje odpowiedź).
- **Widok:** sekcja „Obecność” na ekranie wydarzenia (moja odpowiedź, odpowiedzi za dzieci, listy „Będą / Może / Nie będą”, „Bez odpowiedzi: N”); w wierszach „Moich spraw” i Kalendarza „będą 2, nie 1”. → Zmienione przez D129 (ADR 0035): w wierszu tylko przy „nie” (tekst „2 tak, 1 nie” w strings.pl.ts); podsumowanie „Tak: / Może: / Nie:” (D146, ADR 0041).
- **Lokalna baza v5:** tabela lustrzana + wyzerowanie kursorów, bo starsza wersja aplikacji dostawała już odpowiedzi z serwera, ale nie mogła ich zapisać.
- **„Co nowego”:** karta zbiera wszystkie wpisy od ostatnio obejrzanego buildu (wcześniej tylko najnowszy) — pominięty albo odrzucony build nie gubi nowości.
- **Poza zakresem (backlog):** powiadomienie push do osoby odpowiedzialnej o odpowiedzi „nie będę”.
- **„Nie będę” a przypomnienia** (PW-23, decyzja właściciela z 8.10.2026): moja odpowiedź „nie będę” na termin — bez
  przypomnienia, „Czas wyjść”, liczenia dojazdu i miejsca w porannym podsumowaniu; wiersz zostaje (D129), zmiana odpowiedzi
  przywraca przypomnienia, a zadania tego terminu przypominają same. Odpowiedź dorosłego za dziecko nie wycisza przypomnień
  (pytanie do właściciela).
