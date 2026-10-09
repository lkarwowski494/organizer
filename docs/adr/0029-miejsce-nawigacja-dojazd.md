# 0029. Miejsce wydarzenia, „Nawiguj” i czas dojazdu z „Wyjdź o” (8.10.2026)

Pytanie właściciela: czy wydarzenie z adresem może mieć klikalne „Nawiguj” i czy dla dzisiejszych wydarzeń może się
pokazywać czas dojazdu (samochód, komunikacja, pieszo) i godzina wyjścia.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D116 | Skąd czas dojazdu | Mapy Apple na telefonie (MapKit) | Płatne API tras zewnętrznego dostawcy map (konto rozliczeniowe z kartą — źródło niżej; liczby z cennika usunięte 9.10.2026, bo nie miały przeczytanego cytatu, a wariant jest odrzucony); Apple Maps Server API (serwer, klucz Maps, położenie przez nasz serwer) |
| D115 | Czym „Nawiguj” | Wybór w Ustawieniach: Mapy Apple (domyślnie) albo aplikacja map innej firmy. **Zmienione 9.10.2026 (decyzja właściciela, ADR 0043): tylko Mapy Apple, bez wyboru w Ustawieniach.** | Pytanie za każdym razem; tylko Mapy Apple (przyjęte 9.10.2026) |
| D117 | Co przy dzisiejszym wydarzeniu | „Wyjdź o 16:35 · 25 min autem” (od D129, ADR 0035, w osobnej, wyróżnionej linii wiersza) + powiadomienie „Czas wyjść” zamiast stałego „30 min przed” | Tylko napis; tylko czas dojazdu |
| D118 | Środek transportu | Domyślny w Ustawieniach + zmiana przy wydarzeniu (tylko na moim telefonie) | Tylko w Ustawieniach; trzy czasy naraz |

## Źródła
- Mapy Apple, linki iOS 18.4+: `https://maps.apple.com/directions?destination=…&mode=driving|walking|transit|cycling` (https://developer.apple.com/documentation/mapkit/unified-map-urls). Starsze iOS: `?daddr=…&dirflg=…` (dawny opis Map Links: „only the daddr parameter is required”).
- MapKit `MKDirections.calculateETA`: liczą „the Apple servers”. Uwaga z dokumentacji: „Apps may receive an MKError.Code.loadingThrottled error if the device makes too many requests in too short a time period” (https://developer.apple.com/documentation/mapkit/mkdirections).
- Apple Maps Server API (odrzucone): „up to 25,000 service calls per day per team” (https://developer.apple.com/documentation/applemapsserverapi).
- API tras zewnętrznego dostawcy map (odrzucone): „must enable billing on each of your projects” (https://developers.google.com/maps/documentation/routes/usage-and-billing).

## Decyzje wykonawcze (Claude; właściciel może zawetować)
- **Dane:** `events.location` (tekst, do 300 znaków, `config.events.LOCATION_MAX_LENGTH`, test kontraktowy z SQL) — całej serii; „Tylko to” go nie zmienia. Migracja `20261008260000_event_location.sql`.
- **Moduł natywny** `modules/travel-time` (Swift, MapKit): czas dojazdu z położenia telefonu do współrzędnych celu. Położenie i adres → współrzędne: expo-location (zgoda tylko „podczas używania”; „zawsze” wyłączone — test kontraktowy Info.plist; opis ruchu dodany w D123, ADR 0032). Współrzędne celu zapamiętane na telefonie.
- **Kiedy liczymy:** wydarzenia (od audytu 2 także jutro po północy), które mnie dotyczą, z miejscem i godziną, od teraz do 12 h naprzód, najwyżej 8 (dławienie MapKit); lekcje dziecka — jeden cel na dziecko i dzień, pierwsza lekcja z miejscem (audyt 3, N-189). Odświeżanie co 15 min i przy powrocie do aplikacji. Zapas 5 min doliczony do „Wyjdź o” (`config.travel`, wybory projektowe bez źródła).
- **Powiadomienie:** „Czas wyjść: Basen” o godzinie wyjścia zastępuje przypomnienie „30 min przed”, jeśli dojazd jest policzony.
  Decyzje właściciela z 8.10.2026 (audyt 2): osobny przełącznik „Czas wyjść” w Ustawieniach → Powiadomienia, domyślnie
  włączony; wyłączony — zwykłe „N min przed” (PWD-17). Gdy wyjście już minęło (np. korki), a wydarzenie jeszcze nie — od
  razu „Masz N min spóźnienia — wyjdź teraz” (forma neutralna, 8.10.2026), raz na termin i nie po „Czas wyjść”, który już przyszedł (PW-24). Na termin
  z moją odpowiedzią „Nie będę” dojazdu nie liczymy i nie przypominamy (PW-23).
  - Plan powiadomień układa się, gdy aplikacja działa. Zmiana korków po zamknięciu aplikacji nie przesunie powiadomienia — ograniczenie powiadomień lokalnych.
- **Do sprawdzenia na iPhonie (otwarte):**
  - Czy MapKit podaje czas dojazdu komunikacją w Polsce. Apple w opisie MKDirections pisze o trasach pieszych i samochodowych. Jeśli komunikacja nie zadziała, zostaje „Nawiguj” z trybem komunikacji, a „Wyjdź o” się nie pojawi.
  - Moduł Swift kompiluje się dopiero w buildzie iOS (brak Xcode w środowisku rozwojowym).
- **Prywatność:** polityka prywatności uzupełniona. Etykieta prywatności w App Store Connect: lokalizacja przybliżona/dokładna „nie zbierana” przez nas (nie wychodzi poza telefon i Apple) — do potwierdzenia przez właściciela przy publikacji.

## Audyt 2 (8.10.2026)
- **PWD-3 (decyzja właściciela):** przy wydarzeniu z adresem i wyłączonym czasem dojazdu — „Pokaż, kiedy wyjść →” (włącza
  dojazd i pyta o lokalizację). Odrzucone: bez podpowiedzi.
- **Okno** (M-211): wydarzenia od teraz do 12 h naprzód także po północy (dziś i jutro), nie tylko z dzisiejszą datą.
- **Pora odjazdu** (M-106): pytamy MapKit o odjazd o porze wyjścia (start − poprzedni wynik − zapas), nie „teraz”; bez
  poprzedniego wyniku — drugie zapytanie od razu. Odrzucone: `arrivalDate` w module Swift (zmiana natywna do sprawdzenia
  na iPhonie).
- **Adres, którego Mapy nie znalazły** (M-106): zapamiętany z datą i sprawdzany znowu po `GEO_RETRY_H` = 24 h; najwyżej
  `GEO_MAX` = 200 adresów; ekran wydarzenia mówi „Nie znaleźliśmy tego adresu w Mapach”. Wybory projektowe bez źródła.
- **Wygasła zgoda „Pozwól raz”** (M-218): włączony dojazd bez zgody — „Zezwól na lokalizację” na ekranie wydarzenia
  i w Ustawieniach.
- **Błędy** geokodera i MapKit zgłaszamy bez komunikatu (mógłby zawierać adres) — M-159.

## Audyt 3 (9.10.2026)
- Odmowa lokalizacji: przy wydarzeniu i w Ustawieniach wyjaśnienie i „Otwórz Ustawienia iPhone’a” zamiast „Pokaż, kiedy
  wyjść →” (iOS nie zapyta drugi raz). Wydarzenie poza oknem 12 h: napis, że „Wyjdź o” pojawi się w oknie.
- Opis zgody i Ustawień: „najbliższe wydarzenia” (okno 12 h sięga jutra); bez „(z korkami)” — Apple o `departureDate`
  pisze tylko, że serwer „might consider alternatives to routes that are typically congested at that time”
  (https://developer.apple.com/documentation/mapkit/mkdirections/request/departuredate).
