# 0014. Zakupy na liście zakupów, motyw „Wstążki” (7.10.2026)

Zgłoszenie właściciela:
- Stworzenie listy zakupów ma tworzyć zadanie „Zakupy” z terminem i osobą odpowiedzialną wybranymi przez tworzącego.
- Lista zakupów ma być wpięta w to zadanie.
- Odhaczanie zakupów z potwierdzeniem (jest od D59; od 8.10.2026 pozycja trafia do koszyka bez pytania, z „Cofnij” — zmiana D59).
- Motyw i ikona: „Wstążki” (makieta C).

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D72 | Motyw i ikona | „Wstążki”: fioletowy akcent, jasnofioletowe tło, Bricolage Grotesque w nagłówkach, ikona z kolorowych wstążek w „O” | A · Mapa metra, B · Rozkład jazdy |
| D73 | Jak zbudować „Zakupy” | Lista zakupów sama ma termin i osobę odpowiedzialną i pojawia się w „Dotyczy mnie” jako „Zakupy: <nazwa>”; dotknięcie otwiera listę | Osobne zadanie z linkiem do listy (dwa obiekty do pilnowania) |
| D73 | Koniec zakupów | Ręczne odhaczenie z potwierdzeniem; gdy coś zostało: „Zostaw na następne zakupy” / „Oznacz wszystko jako kupione” / „Anuluj” | Samo, gdy wszystko w koszyku |
| D73 | Obowiązkowość | We wspólnej grupie osoba albo dzień obowiązkowe (jak D68); w osobistej opcjonalne | Oba zawsze obowiązkowe; opcjonalne |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Kolumny na liście:** `due_date`, `due_time`, `responsible_member_id`.
   - Tylko na listach zakupów (ograniczenie w bazie).
   - Godzina tylko z dniem.
   - Osoba: aktywny dorosły, który widzi listę.
2. **Zakupy zrobione:**
   - kupione pozycje idą do kosza (30 dni), a dzień i osoba się czyszczą;
   - audyt 3 (decyzje właściciela Q8 A, Q9 B, 9.10.2026): przycisk jest też bez planu, gdy w koszyku coś leży (historia
     dostaje dzień zrobienia); kupione nie stoją w Koszu, tylko na liście w zwiniętej sekcji „Kupione w ostatnich
     zakupach” z „Kup jeszcze raz” (wraca jako niekupiona); dopisanie produktu, który już czeka albo leży w koszyku,
     pyta „już jest na liście” / „jest już w koszyku” („Dodaj jeszcze raz”, „Wyjmij z koszyka”);
   - lista zostaje, gotowa na następne zakupy („Zaplanuj zakupy”);
   - oczekujące przekazanie zakupów jest anulowane;
   - potem pasek „Cofnij” (D60; audyt 2, M-225): pozycje, dzień i osoba wracają, anulowane przekazanie zostaje anulowane.
3. **„Dotyczy mnie”:** zakupy dotyczą mnie na zasadach zadania.
   - Dotyczą mnie: moja osoba, albo bez osoby z dniem, albo bez osoby w grupie osobistej.
   - Bez dnia: przypięte.
   - Po dniu: zaległe na czerwono.
4. **Obowiązkowość pilnuje telefon, nie baza.** Powód jak w D68: starsze buildy tworzą listy bez tych pól.
5. **Przekazanie (D70) obejmuje zakupy** (`handoffs.entity = 'lists'`).
6. **Kontrast w motywie „Wstążki”:** kolory grup zostają z „Linii”, bo jaśniejsze z makiety (np. #FF8A3D) nie dają 3:1 z tłem. Zielona linia jest ciemniejsza: #15803D, nazwa #166534.
7. **Zakupów nie ma w zakładce Kalendarz.** Są tylko w „Dotyczy mnie” i na liście. Do decyzji właściciela, jeśli potrzebne. → zastąpione przez D77 (ADR 0016, decyzja wykonawcza 4: zakupy w Kalendarzu).

## Zmiana koloru (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D74 | Fiolet w „Wstążkach” nie pasuje — na co zmienić | Ciepły piasek + terakota (jasny: tło #F7F2EA, akcent #B4471F; ciemny: tło #17140F, akcent #E07A4F). Kształty „Wstążek” zostają. | Grafit bez akcentu; granat + niebieski; zieleń butelkowa |
