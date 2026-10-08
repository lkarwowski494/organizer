# 0029. Miejsce wydarzenia, „Nawiguj” i czas dojazdu z „Wyjdź o” (8.10.2026)

Pytanie właściciela: czy wydarzenie z adresem może mieć klikalne „Nawiguj” i czy dla dzisiejszych wydarzeń może się
pokazywać czas dojazdu (samochód, komunikacja, pieszo) i godzina wyjścia.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D116 | Skąd czas dojazdu | Mapy Apple na telefonie (MapKit) | Google Routes API (konto rozliczeniowe z kartą; 10 000 zapytań/mies. w Essentials, potem od 5 USD/1000); Apple Maps Server API (serwer, klucz Maps, położenie przez nasz serwer) |
| D115 | Czym „Nawiguj” | Wybór w Ustawieniach: Mapy Apple (domyślnie) albo Google Maps | Pytanie za każdym razem; tylko Mapy Apple |
| D117 | Co przy dzisiejszym wydarzeniu | „Wyjdź o 16:35 · 25 min autem” + powiadomienie „Czas wyjść” zamiast stałego „30 min przed” | Tylko napis; tylko czas dojazdu |
| D118 | Środek transportu | Domyślny w Ustawieniach + zmiana przy wydarzeniu (tylko na moim telefonie) | Tylko w Ustawieniach; trzy czasy naraz |

## Źródła
- Mapy Apple, linki iOS 18.4+: `https://maps.apple.com/directions?destination=…&mode=driving|walking|transit|cycling` (https://developer.apple.com/documentation/mapkit/unified-map-urls). Starsze iOS: `?daddr=…&dirflg=…` (dawny opis Map Links: „only the daddr parameter is required”).
- Google Maps: `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=…`. Cytat: „If the Google Maps app for iOS is installed, the URL launches Google Maps” (https://developers.google.com/maps/documentation/urls/get-started).
- MapKit `MKDirections.calculateETA`: liczą „the Apple servers”. Uwaga z dokumentacji: „Apps may receive an MKError.Code.loadingThrottled error if the device makes too many requests in too short a time period” (https://developer.apple.com/documentation/mapkit/mkdirections).
- Apple Maps Server API (odrzucone): „up to 25,000 service calls per day per team” (https://developer.apple.com/documentation/applemapsserverapi).
- Google Routes API (odrzucone): „must enable billing on each of your projects” (https://developers.google.com/maps/documentation/routes/usage-and-billing).

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **Dane:** `events.location` (tekst, do 300 znaków, `config.events.LOCATION_MAX_LENGTH`, test kontraktowy z SQL) — całej serii; „Tylko to” go nie zmienia. Migracja `20261008260000_event_location.sql`.
- **Moduł natywny** `modules/travel-time` (Swift, MapKit): czas dojazdu z położenia telefonu do współrzędnych celu. Położenie i adres → współrzędne: expo-location (zgoda tylko „podczas używania”; „zawsze” i ruch wyłączone — test kontraktowy Info.plist). Współrzędne celu zapamiętane na telefonie.
- **Kiedy liczymy:** dzisiejsze wydarzenia, które mnie dotyczą, z miejscem i godziną, od teraz do 12 h naprzód, najwyżej 8 (dławienie MapKit). Odświeżanie co 15 min i przy powrocie do aplikacji. Zapas 5 min doliczony do „Wyjdź o” (`config.travel`, wybory projektowe bez źródła).
- **Powiadomienie:** „Czas wyjść: Basen” o godzinie wyjścia zastępuje przypomnienie „30 min przed”, jeśli dojazd jest policzony.
  - Plan powiadomień układa się, gdy aplikacja działa. Zmiana korków po zamknięciu aplikacji nie przesunie powiadomienia — ograniczenie powiadomień lokalnych.
- **Do sprawdzenia na iPhonie (otwarte):**
  - Czy MapKit podaje czas dojazdu komunikacją w Polsce. Apple w opisie MKDirections pisze o trasach pieszych i samochodowych. Jeśli komunikacja nie zadziała, zostaje „Nawiguj” z trybem komunikacji, a „Wyjdź o” się nie pojawi.
  - Moduł Swift kompiluje się dopiero w buildzie iOS (brak Xcode w środowisku rozwojowym).
- **Prywatność:** polityka prywatności uzupełniona. Etykieta prywatności w App Store Connect: lokalizacja przybliżona/dokładna „nie zbierana” przez nas (nie wychodzi poza telefon i Apple) — do potwierdzenia przez właściciela przy publikacji.
