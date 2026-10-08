# 0023. „Dziś” na stałym miejscu, mini kalendarz przy dacie, chowanie klawiatury (8.10.2026)

Zgłoszenia właściciela ze zrzutów: przycisk „Dziś” pojawia się po przejściu do innego tygodnia i przesuwa strzałki;
datę trzeba wpisywać ręcznie; klawiatura słabo znika.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D101 | „Dziś” przesuwa strzałki | Stałe miejsce: zawsze widoczny, wyszarzony na bieżącym okresie | Przeniesienie do wiersza „Zakres”; dotknięcie nazwy okresu |
| D102 | Kiedy chować klawiaturę | Przy przewijaniu, po dotknięciu pustego miejsca i po dodaniu w szybkim dodawaniu | Tylko dotknięcie obok i „Gotowe”; pasek „Gotowe” nad klawiaturą |
| D103 | Wybór daty | Własny mini kalendarz pod polem (poniedziałek pierwszy, święta, kolory aplikacji) | Systemowy kalendarz iOS (nowa zależność natywna); własny + przyciski szybkich dni |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- Wspólna siatka miesiąca `src/domain/month-grid.ts` dla zakładki Kalendarz i mini kalendarza — jedno źródło (święta, początek tygodnia).
- `DateField` zastępuje wpisywanie daty w pięciu miejscach: formularz zadania, zadanie, wydarzenie (dzień i „ostatni dzień”), dzień zakupów.
- Kalendarz otwiera się na miesiącu wybranej daty (bez daty — na bieżącym) i zwija po wyborze. Dzisiejszy dzień ma obwódkę.
- Wybór daty nie otwiera klawiatury. Wpisywanie z ręki znika, więc znikają komunikaty o formacie RRRR-MM-DD. Walidacja w domenie zostaje.
- Pole „bez terminu” nadal ustawia przełącznik „Termin”.
