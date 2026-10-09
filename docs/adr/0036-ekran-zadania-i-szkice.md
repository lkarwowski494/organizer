# 0036. Ekran zadania, szkice formularzy i ostatni dzień miesiąca (audyt 2, 8.10.2026)

## Decyzje właściciela
| ID | Sprawa (audyt 2) | Decyzja | Odrzucone |
|---|---|---|---|
| D178 | M-122 / PW-19: dwa ekrany zmiany zadania | Jeden: „Zmień” po szybkim dodaniu otwiera ekran zadania, który ma „Przenieś do grupy” | Dwa ekrany zapisujące od razu |
| D179 | M-123 / PW-20: wyjście z formularza z „Zapisz” | Szkic na telefonie (tylko zmienione pola), przywracany przy ponownym otwarciu z „Odrzuć”; nazwa grupy i imię zapisują się od razu | Pytanie „Odrzucić zmiany?”; wszystko od razu |
| D180 | M-116 / PW-21: „Dla kogo” a „Przekaż” | Obie drogi zostają, z krótkim opisem różnicy przy „Dla kogo” | Zawsze przekazanie; bez przekazania |
| D181 | M-86 / PW-32: zmiana dnia zadania powtarzanego | Pytanie „Tylko ten raz / Też kolejne”, gdy nowy dzień zmienia cykl | Zawsze przestawia cykl; bez zmian |
| PWD-6 | M-275: „Anuluj” w formularzach | Bez „Anuluj” w formularzu zadania (gest i „Wróć”) | „Anuluj” wszędzie |
| PWD-37 | M-87, M-306: koniec miesiąca | Opcja „ostatniego dnia miesiąca” w zadaniach i wydarzeniach | Tylko ostrzeżenie przy dniu ≥ 29 |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Przeniesienie do grupy (D178):** grupa to granica bezpieczeństwa (D3), a pobieranie liczy wersje osobno w każdej
   grupie (D32) — wiersz przeniesiony między grupami nie dotarłby jako usunięty do osób z pierwszej grupy. Dlatego
   „Przenieś do grupy” robi kopię zadania **z podzadaniami** w nowej grupie (ogólna lista, D97) i oryginał do kosza,
   w jednej transakcji, z paskiem „Cofnij” (`domain/views/task-move.ts`). Osoba: to samo konto w nowej grupie, inaczej
   „nikt konkretny” (D132); termin z wydarzenia staje się własnym terminem. Historia zmian zostaje przy oryginale.
   Tylko zadanie główne, nie w trakcie przekazania. Odrzucone: RPC serwera zmieniające grupę (wymaga zmiany protokołu
   synchronizacji); kopia bez podzadań (gubiła je w koszu).
2. **Szkic (D179):** `app/form-draft.tsx` + `domain/drafts.ts`, jeden mechanizm dla nowego zadania, wydarzenia (także
   zmiany), rutyny, planu lekcji, nowej listy i nowej grupy. Szkic to tylko pola zmienione względem chwili otwarcia,
   w lokalnej bazie telefonu, osobno dla konta; przy zmianie istniejącej rzeczy nakłada się na jej obecne dane.
   Przepada po `config.forms.DRAFT_MAX_DAYS` (7 dni, wybór projektowy). Formularz otwarty z wpisanym tekstem
   („Więcej”, przełącznik rodzaju) startuje z tego tekstu; stary szkic zastępuje dopiero pierwsza zmiana, a pola
   przeniesione przełącznikiem rodzaju są od razu szkicem formularza docelowego (audyt 3, N-138).
   Audyt 3: przywrócony szkic traci wybory, których już nie ma — grupę (wraca domyślna), osobę spoza grupy („nikt
   konkretny”, D132) i miniony dzień (pusty; w wydarzeniu dzień z otwarcia) — z napisem; ta sama reguła przy „Zapisz”
   daje komunikat zamiast odrzucenia przez serwer (N-32, N-144; `domain/views/form-choices.ts`). Szkic planu lekcji
   pamięta znacznik planu, na którym powstał: plan zmieniony w międzyczasie (przy przywróceniu albo przy otwartym
   ekranie) daje pytanie „Pokaż obecny plan / Zapisz mój plan” (N-31).
3. **Pola zapisywane od razu:** jeden mechanizm `ui/live-text.ts` (tytuł i notatka zadania, nazwa listy, pozycja zakupów,
   nazwa grupy, imię osoby): niepoprawny tekst (np. pusty) się nie zapisuje — pole wraca do zapisanej wartości
   i pokazuje komunikat (audyt 2, M-202). Zapis także przy przejściu do innej aplikacji (audyt 3, N-139).
4. **Termin w jednym kształcie** (M-245): „Kiedy” — Dziś · Jutro · Inny dzień · Bez terminu (w podzadaniu na początku
   „Jak zadanie nadrzędne”, M-204) i pole „Inny dzień”; godzina bez dnia jest nieaktywna z napisem (M-89), ręcznie
   wpisywana sprawdza się dopiero w pełnym kształcie albo po wyjściu z pola (M-206) — `ui/DueFields.tsx`.
5. **Zmiana dnia zadania powtarzanego (D181):** pytanie tylko, gdy zmienia się cykl: co tydzień — inny dzień tygodnia,
   co miesiąc — inny dzień miesiąca (termin już przeniesiony poza cykl nie pyta). „Tylko ten raz” trzyma cykl (D137),
   „Też kolejne” zamienia dzień w regule (`cycleChange`).
6. **Ostatni dzień miesiąca (PWD-37):** `BYMONTHDAY=-1`. RFC 5545 §3.3.10 (https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10):
   „Valid values are 1 to 31 or -31 to -1. For example, -10 represents the tenth to the last day of the month”;
   przykład „Monthly on the first and last day of the month … BYMONTHDAY=1,-1”. Opcja jest, gdy termin to ostatni dzień
   miesiąca (DTSTART musi być wystąpieniem). Dzień ≥ 29 bez tej opcji pokazuje „Miesiące bez N. dnia zostaną pominięte”
   — reguła liczenia bez zmian, bo RFC: „Such recurrence instances MUST be ignored” (M-87). Serwer (`private.rrule_ok`,
   CHECK `tasks.repeat`) już przyjmował tę regułę; test kontraktowy w `src/config/__tests__/sql.contract.test.ts`,
   korpus python-dateutil uzupełniony o przypadki końca miesiąca.
7. **Pole dodawania na liście zadań** rozumie „@imię” (osoba, która widzi listę) i „@ja” jak Moje sprawy; „#…” nie zmienia
   grupy listy — podpowiedź pod polem (`resolveListQuick`).
