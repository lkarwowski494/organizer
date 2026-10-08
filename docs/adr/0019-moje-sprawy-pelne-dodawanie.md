# 0019. „Moje sprawy”, szybkie i pełne dodawanie, „@imię” (8.10.2026)

Zgłoszenie właściciela:
- Napis „Dotyczy mnie” ma być zastąpiony.
- Potrzebne są dwa sposoby dodawania: szybkie oraz pełny arkusz parametrów.
- Przykład: wpisał „basen jutro 19.00”. Zadanie trafiło do grupy osobistej i nie dało się go przestawić na grupę rodzinną z żoną jako osobą odpowiedzialną.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D89 | Nazwa głównego ekranu | „Moje sprawy” | „Lista zadań” (myli się z zakładką „Listy”, a na ekranie są też wydarzenia); „Mój plan” |
| D90 | Szybkie i pełne dodawanie | Dwa przyciski: „+” dodaje od razu, „Więcej” otwiera pełny formularz wypełniony wpisanym tekstem. Po szybkim dodaniu pasek „Dodano … · Zmień” otwiera ten sam formularz. | Jedno pole z rozwijanym formularzem; tylko edycja po dodaniu |
| D91 | Mądrzejsze szybkie dodanie | „@imię” ustawia grupę i osobę. Przy kilku dopasowaniach aplikacja pyta, kogo chodzi. | Tylko formularz; ostatnio użyta grupa |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zmiana nazwy:**
   - Zmienione teksty w aplikacji, z odmianą („w „Moich sprawach””), komentarze, testy, README, CLAUDE.md i opis TestFlight.
   - Bez zmian zostały wydane migracje i wcześniejsze ADR, bo to zapis historii.
   - Zakładka na dole nadal nazywa się „Dziś”.
2. **Zmiana grupy istniejącego zadania:**
   - Serwer trzyma zadanie w jego grupie (granica bezpieczeństwa, D3). Formularz tworzy więc kopię w nowej grupie (z notatką), a oryginał idzie do kosza, skąd można go przywrócić. Ekran mówi o tym przed zapisem.
   - Zmiana listy w tej samej grupie to zwykłe przeniesienie (`move_task`), więc historia zostaje.
   - Odrzucone: przenoszenie między grupami po stronie serwera. Wymagałoby nowego RPC przenoszącego też historię i podzadania. Do rozważenia, gdy „Zmień” będzie dostępne dla starszych zadań.
3. **„@imię”:**
   - Działa jak początek imienia, bez wielkości liter i polskich znaków, bez odmiany: „@Alą” nie pasuje do „Ala”.
   - Nie pasuje do mnie samego ani do grup, w których jestem dzieckiem.
   - Bez dopasowania tekst zostaje w nazwie.
   - Parser dat (D18, korpus z niezależnym wzorcem) się nie zmienił. „@imię” jest rozpoznawane osobno (`domain/views/mention.ts`) i przed parsowaniem zastępowane spacjami, żeby odklikane fragmenty zachowały pozycje.
4. **Grupa bez listy zadań:** przy pierwszym zadaniu powstaje lista „Zadania” (nazwa projektowa, bez źródła).
