# 0012. Adresat zadania we wspólnej grupie (7.10.2026)

Zgłoszenie właściciela: nie widzi zadań, które żona dodała w grupie Rodzina, na liście „Dzisiaj”. Przyczyna: zadania nie miały ani terminu, ani osoby, a nazwa listy nie jest dla aplikacji terminem. Według reguły „Dotyczy mnie” takie zadanie z grupy wspólnej nie trafia do nikogo.

Właściciel zapytał, czy nie zrobić pól obowiązkowych. Moja opinia: twarde pola psują szybkie dodawanie (D18) i sprawy „na kiedyś” (D16). Lepsze jest pytanie po dodaniu. Właściciel wybrał wariant obowiązkowy.

## Decyzja produktowa (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D68 | Jak dopilnować adresata zadania we wspólnej grupie | Obowiązkowe: zadanie musi mieć osobę albo termin. Bez tego aplikacja go nie zapisze i prosi o wybór („Dla: …”, „Na dziś”, „Na jutro”). | Pytanie po dodaniu, które można pominąć; domyślnie autor; przełącznik listy „Pokazuj w Dotyczy mnie” |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zakres reguły:** zadania główne na listach zadań grup wspólnych.
   - Poza regułą: grupa osobista, zakupy i podzadania, które mają kontekst rodzica.
   - Termin ze spotkania (D13) i termin dziedziczony liczą się jako termin.
2. **Regułę pilnuje telefon:**
   - przy dodawaniu na liście;
   - w zadaniu, gdzie nie da się zdjąć ostatniego adresata („Usuń termin” albo „Dla każdego”).

   Odrzucone: strażnik w bazie. Starsze wersje aplikacji (buildy 1–5) wciąż wysyłają zadania bez adresata. Serwer by je odrzucał, a ludzie widzieliby „Odrzucone zmiany” bez wyjaśnienia. Do rozważenia, gdy wszyscy będą na nowej wersji.
3. **Istniejące zadania bez adresata zostają.** Lista pokazuje przy nich czerwony dopisek „bez osoby i terminu — nikt tego nie widzi w Dotyczy mnie”, a ekran zadania podpowiada, co ustawić.
