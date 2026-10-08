# 0021. Kalendarz iPhone'a w obie strony (8.10.2026)

Wybór właściciela z listy kierunków: „Kalendarz w obie strony”.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D95 | Co ma działać | Odczyt moich wydarzeń z kalendarza iPhone'a (też konta Google i Outlook dodane w iPhonie) w Kalendarzu i „Moich sprawach”. Do tego lustro: wydarzenia każdej grupy w osobnym kalendarzu „Organizer – grupa”, utrzymywane automatycznie. | Tylko odczyt; bezpośrednio przez API Google |
| D96 | Widoczność prywatnych wydarzeń | Tylko na moim telefonie | „Zajęty” dla grupy; kopiowanie wybranych wydarzeń do grupy |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Zgoda iOS i włączanie:**
   - Pełny dostęp do kalendarza o jedną zgodę iOS: przycisk „Połącz z kalendarzem” w Kalendarzu włącza obie funkcje.
   - Każdą można wyłączyć w Ustawieniach. Wyłączenie lustra usuwa kalendarze „Organizer” z iPhone'a.
   - „Dodaj do kalendarza” (D7) działa jak dotąd, z dostępem tylko do zapisu. Oba opisy uprawnień są w Info.plist (wtyczka expo-calendar ustawia jeden z nich, drugi dopisujemy w `ios.infoPlist`; test kontraktowy).
2. **Moje wydarzenia** są tylko w pamięci ekranu: bez lokalnej bazy, kolejki i serwera.
   - Okno: od 31 dni wstecz do 62 dni naprzód. Odświeżane przy każdym powrocie do aplikacji.
   - Kalendarze lustra są pomijane, żeby nie było dubli.
   - Całodniowe wydarzenia mają daty w strefie telefonu. Wydarzenia z godziną zamieniamy na czas warszawski (R2).
3. **Lustro:**
   - Każde wystąpienie to osobne wydarzenie bez reguły powtarzania, bo iPhone nie musi rozumieć naszych wyjątków.
   - Okno: od 7 dni wstecz do 90 dni naprzód, najwyżej 500 wystąpień najbliższych dzisiejszej dacie.
   - Nazwa zawiera osobę odpowiedzialną, w notatce jest nazwa grupy.
   - Stan (identyfikatory i skróty treści) jest w lokalnej bazie telefonu i zapisywany po każdym kroku, więc przerwanie nie zostawia dubli.
   - Kalendarz albo wydarzenie usunięte ręcznie w iPhonie zostaje odtworzone przy następnym przebiegu.
   - Przebieg uruchamia się 3 s po zmianie danych i przy powrocie do aplikacji.
   - Wszystkie liczby to wybory projektowe w `config.calendar`, bez źródła.
4. **Konto dla nowych kalendarzy:** takie jak w kalendarzu domyślnym (zwykle iCloud). Dokumentacja expo-calendar nie mówi, czy na iOS konto jest wymagane, więc pierwszy błąd idzie do zgłoszeń (D80). Otwarte pytanie O-074: sprawdzić na iPhonie.
5. **API:** klasy expo-calendar SDK 57 (`getCalendars`, `createCalendar`, `listEvents`, `ExpoCalendar.get`, `ExpoCalendarEvent.get`, `update`, `delete`), https://docs.expo.dev/versions/v57.0.0/sdk/calendar/.
