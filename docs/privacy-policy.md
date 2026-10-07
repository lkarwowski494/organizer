# Organizer — polityka prywatności (wersja testowa, 7.10.2026)

> Szkic do zatwierdzenia przez właściciela (ADR 0016). Opisuje, co aplikacja naprawdę robi z danymi
> w tej wersji kodu. Nie jest poradą prawną.

**Kto odpowiada za dane:** autor aplikacji Organizer (kontakt: adres e-mail podany w TestFlight jako „Feedback Email”).

## Jakie dane zbieramy i po co
- **Konto:** identyfikator z Sign in with Apple albo adres e-mail (logowanie linkiem) — żeby zalogować i rozpoznać osobę. Przy logowaniu przez Apple zapisujemy imię, jeśli Apple je przekaże.
- **To, co wpisujesz:** grupy, osoby w grupach (także imiona dzieci bez kont), listy, zadania, zakupy, wydarzenia, przekazania i historia zmian — żeby działała aplikacja i widziały je osoby z Twoich grup.
- **Token powiadomień** urządzenia (jeśli włączysz powiadomienia) — żeby wysłać powiadomienie o przekazaniu.
- **Zgłoszenia błędów:** gdy aplikacja napotka błąd, wysyła jego opis techniczny (komunikat, miejsce w kodzie, nazwę ekranu, wersję aplikacji) — bez treści Twoich list, zadań i imion. Najwyżej 50 dziennie, przechowywane 90 dni.
- **Uwagi:** tekst, który sam wyślesz z Ustawień („Wyślij uwagę”), z wersją aplikacji. Przechowywane 90 dni.
- **Kalendarz iPhone'a:** tylko zapis wybranego wydarzenia, gdy dotkniesz „Dodaj do kalendarza”. Nie odczytujemy kalendarza.

Nie ma reklam, analityki ani śledzenia. Nie sprzedajemy i nie udostępniamy danych nikomu poza osobami z Twoich grup.

## Gdzie są dane
- Na serwerze Supabase w regionie Frankfurt (UE) i w bazie na Twoim telefonie.
- Powiadomienia przechodzą przez Apple Push Notification service.
- Przypomnienia planuje sam telefon.

## Jak długo
- Do usunięcia przez Ciebie. Usunięte listy, zadania i grupy leżą 30 dni w koszu, potem znikają.
- **Usunięcie konta** (Ustawienia → Usuń konto) usuwa je z serwera:
  - Twoja grupa osobista znika.
  - Grupy wspólne przechodzą na innego dorosłego.
  - W historii zmian zamiast Twojego imienia zostaje „Usunięty użytkownik”.
  - Przy koncie Apple unieważniamy też token Sign in with Apple.

## Twoje prawa
Możesz poprawić swoje dane w aplikacji, usunąć konto w aplikacji albo napisać na adres kontaktowy z pytaniem o swoje dane.
