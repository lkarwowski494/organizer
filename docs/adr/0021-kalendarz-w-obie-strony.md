# 0021. Kalendarz iPhone'a w obie strony (8.10.2026)

Wybór właściciela z listy kierunków: „Kalendarz w obie strony”.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D95 | Co ma działać | Odczyt moich wydarzeń z kalendarza iPhone'a (też z innych kont dodanych w iPhonie) w Kalendarzu i „Moich sprawach”. Do tego lustro: wydarzenia każdej grupy w osobnym kalendarzu „Organizer – grupa”, utrzymywane automatycznie. | Tylko odczyt; bezpośrednio przez API zewnętrznego dostawcy kalendarza |
| D96 | Widoczność prywatnych wydarzeń | Tylko na moim telefonie | „Zajęty” dla grupy; kopiowanie wybranych wydarzeń do grupy |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zgoda iOS i włączanie:**
   - Pełny dostęp do kalendarza o jedną zgodę iOS: przycisk „Połącz z kalendarzem” w Kalendarzu włącza obie funkcje.
   - Każdą można wyłączyć w Ustawieniach. Wyłączenie lustra usuwa kalendarze „Organizer” z iPhone'a.
   - „Dodaj do kalendarza” (D7) działa jak dotąd, z dostępem tylko do zapisu. Oba opisy uprawnień są w Info.plist (wtyczka expo-calendar ustawia jeden z nich, drugi dopisujemy w `ios.infoPlist`; test kontraktowy).
2. **Moje wydarzenia** są tylko w pamięci ekranu: bez lokalnej bazy, kolejki i serwera.
   - Okno: od 31 dni wstecz do 62 dni naprzód (`config.calendar.READ_DAYS_BACK`, `READ_DAYS_AHEAD`). Odświeżane przy każdym powrocie do aplikacji.
   - Kalendarze lustra są pomijane, żeby nie było dubli.
   - Całodniowe wydarzenia mają daty w strefie telefonu. Wydarzenia z godziną zamieniamy na czas warszawski (R2).
3. **Lustro:**
   - Każde wystąpienie to osobne wydarzenie bez reguły powtarzania, bo iPhone nie musi rozumieć naszych wyjątków.
   - Okno: od 7 dni wstecz do 90 dni naprzód, najwyżej 500 wystąpień (`config.calendar.MIRROR_DAYS_BACK`, `MIRROR_DAYS_AHEAD`, `MIRROR_MAX`) najbliższych dzisiejszej dacie.
   - Nazwa zawiera osobę odpowiedzialną, w notatce jest nazwa grupy.
   - Stan (identyfikatory i skróty treści) jest w lokalnej bazie telefonu i zapisywany po każdym kroku, więc przerwanie nie zostawia dubli.
   - Kalendarz albo wydarzenie usunięte ręcznie w iPhonie zostaje odtworzone przy następnym przebiegu.
   - Przebieg uruchamia się 3 s po zmianie danych i przy powrocie do aplikacji.
   - Wszystkie liczby to wybory projektowe w `config.calendar`, bez źródła.
4. **Konto dla nowych kalendarzy:** takie jak w kalendarzu domyślnym (zwykle iCloud). Dokumentacja expo-calendar nie mówi, czy na iOS konto jest wymagane, więc pierwszy błąd idzie do zgłoszeń (D80). Otwarte pytanie O-074: sprawdzić na iPhonie.
5. **API:** klasy expo-calendar SDK 57 (`getCalendars`, `createCalendar`, `listEvents`, `ExpoCalendar.get`, `createEvent`, `update`, `delete`), https://docs.expo.dev/versions/v57.0.0/sdk/calendar/; zmiana, usunięcie i sprawdzenie wydarzenia — `expo-calendar/legacy` (audyt 3, niżej).

## Audyt 2 (8.10.2026): decyzje właściciela i wykonanie
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D172 (PW-5) | Co znika z telefonu przy wylogowaniu | Kalendarze „Organizer – …” tego telefonu (też przy usunięciu konta i zalogowaniu innego konta); baza aplikacji zostaje | Usuwać też bazę; pytać przy wylogowaniu |
| D174 (PW-26) | Co trafia do lustra | Sprawy, które mnie dotyczą (reguła Moich spraw), lekcje dziecka jednym wpisem na dzień, wybór grup w Ustawieniach → Kalendarz i dojazd | Przełączniki lekcji; wszystko z lekcjami na końcu limitu |
| PWD-2 | „Dodaj do kalendarza” przy lustrze | Zamiast przycisku „Jest w kalendarzu iPhone’a „Organizer – grupa””, gdy wystąpienie jest w lustrze | Przycisk z ostrzeżeniem |
| D200 (PWD-33) | Wydarzenie z iPhone'a → grupa | „Dodaj do grupy” przy wierszu: formularz nowego wydarzenia (nazwa, dzień, godziny, miejsce, wybór grupy) z dopiskiem o kopii; oryginał ukrywa D173 | Do zaległości |

Wykonanie (Claude; właściciel może zawetować):
- **Kalendarze tego telefonu** (`pref.calendarMirrorOwned`, pęk kluczy): lista identyfikatorów kalendarzy lustra
  utworzonych na tym telefonie dowolnym kontem. Usuwa je `removeMirrorCalendars` (wołane w `Root.tsx` przy braku sesji
  i przy zmianie konta, jak czyszczenie przypomnień). `runMirror` usuwa kalendarz z listy, którego nie zna stan
  zalogowanego konta (pozostałość po innym koncie albo reinstalacji), zamiast tworzyć drugi o tej samej nazwie.
  Kalendarzy spoza listy (np. iPada z tym samym iCloud) nie usuwamy nigdy — odrzucone: usuwanie po nazwie „Organizer – ”
  (przełączające się usuwanie między iPhone'em a iPadem) i przejmowanie po nazwie (dwa urządzenia pisałyby do jednego
  kalendarza). Kalendarze „Organizer – …” spoza stanu konta nie są czytane jako „moje wydarzenia” (po nazwie).
- **Nazwa i kolor kalendarza** nadążają za grupą (`ExpoCalendar.update` — modyfikowalne `title` i `color`, dokumentacja
  SDK 57); stan pamięta zapisany wygląd (`looks`).
- **Wpis lustra** ma miejsce wydarzenia i w notatce dopisek „Dodane przez aplikację Organizer” (D173). Lekcje dziecka:
  nazwa jak w Moich sprawach („Tymek: 5 lekcji”), od pierwszej do ostatniej lekcji, lista lekcji w notatce; wspólna lekcja
  rodzeństwa w bloku każdego dziecka.
- **Przebieg** zmiany w trakcie nie gubi (drugi przebieg po zakończeniu) i kończy się po bieżącym kroku przy nowszych
  danych, wyłączeniu lustra albo wylogowaniu (stan zapisany po każdym kroku).
- **Zgoda tylko na dodawanie** (iOS 17+, po „Dodaj do kalendarza”) to osobny stan `writeOnly` z „Połącz z kalendarzem”
  (iOS pyta o pełny dostęp przy pierwszej takiej prośbie); odmowa — „Otwórz Ustawienia iPhone’a”. Ustawienia → Kalendarz
  i dojazd zawsze mają sekcję kalendarza (po „Nie teraz” na karcie).
- **Całodniowe** zapisujemy od północy telefonu (w podróży nie przesuwają się o dzień); z godziną — według Warszawy (R2),
  koniec nigdy przed początkiem (godzina nieistniejąca wiosną). Zachowanie EventKit w innej strefie — do sprawdzenia na iPhonie.
- **Błędy** kalendarza zgłaszamy bez komunikatu (tylko nazwa, kod i ramki stosu), bo mógłby zawierać nazwę kalendarza albo tytuł.

## Audyt 3 (9.10.2026): wykonanie (Claude; właściciel może zawetować)
- **Lista kalendarzy tego telefonu** jest naprawdę w pęku kluczy (`AppServices.devicePrefs`): build 22 zapisywał ją w bazie
  konta, a wylogowanie czytało pęk kluczy, więc kalendarze „Organizer – …” zostawały. Przy starcie raz przenosimy listę
  z bazy konta (suma list). Wylogowanie i usunięcie konta czekają na koniec przebiegu lustra; wyłączenie lustra też
  (kalendarz założony w trakcie znika razem z resztą).
- **Identyfikator wydarzenia:** `id` z expo-calendar 57.0.5 to `calendarItemIdentifier`, a `ExpoCalendarEvent.get` szuka
  przez `event(withIdentifier:)` (czyli `eventIdentifier` według Apple). Zmiana, usunięcie i sprawdzenie idą przez
  `expo-calendar/legacy` (`calendarItem(withIdentifier:)`, ten sam magazyn EventKit). Nieudana zmiana albo usunięcie
  wydarzenia, które nadal jest, zostaje do ponowienia; nowe tworzymy tylko, gdy starego na pewno nie ma. Na urządzeniu do
  sprawdzenia (W-1).
- **Konto kalendarza lustra:** domyślne, a gdy się nie da — iCloud, potem „Na moim iPhonie”; nieudany przebieg —
  komunikat w Ustawieniach. „Jest w kalendarzu” tylko dla wpisów, które lustro zapisało.
- **„Połącz z kalendarzem”** nie włącza lustra wyłączonego świadomie; karta zachęty tylko bez pełnej zgody. Na iPadzie
  lustro domyślnie wyłączone z dopiskiem (Q21 cz. 1 A). Po zmianie zgody z pełnej — komunikat, że kalendarze „Organizer”
  się nie aktualizują (Q21 cz. 2 A).
- **Nazwa wpisu z osobą odpowiedzialną:** „Basen · odpowiada: Ala” (słownik), gdy odpowiadam ja — sama nazwa.
