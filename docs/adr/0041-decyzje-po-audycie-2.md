# 0041. Decyzje po audycie 2 (8–9.10.2026)

Rejestr decyzji D144–D200 z audytu 2 i decyzji podjętych potem z upoważnienia właściciela. Pełny rejestr z uzasadnieniami
jest w dokumentach projektu właściciela („Rejestr decyzji”, folder „Organizer grup”); ten plik to jego kopia w repozytorium (jak ADR 0035 dla
D126–D143). Szczegóły wykonania są w ADR wskazanych w ostatniej kolumnie. Stan wdrożenia każdej decyzji prowadzi backlog
(04) — kolumna „Opis wykonania” mówi tylko, gdzie w repozytorium opisano, jak decyzja działa („—”: opisu w ADR jeszcze nie
ma; „kod:” — tylko komentarz w kodzie).

Dlaczego osobny plik, a nie dopisek do ADR 0035: 0035 to rejestr audytu 1 (D126–D143) z notatkami wykonania kolejnych
paczek; jedna tabela D144–D200 w jednym miejscu jest łatwiejsza do sprawdzenia i cofnięcia niż rozproszone akapity.
ADR 0035 odsyła tutaj.

## Zasada właściciela (8.10.2026, ok. 18:38 UTC)
„Musisz sam podejmować decyzje. Za każdym razem chcę żebyś wybrał rekomendowaną decyzję poza wyjątkiem - jeżeli któraś
pozycja nie jest rekomendowana bo wymaga sporo pracy ale ogólnie jest lepsza to wybierz tą decyzję. Nie boimy się ilości
pracy jeżeli niesie to coś dobrego. Możesz sprawdzić też czy przypadkiem w ciągu ostatnich 4 godzin nie podjąłem decyzji
sprzecznej z tą zasadą i ją zmienić jeżeli tak. […] Wszystko ma być spójne, intuicyjne i moc przejść najbardziej gorliwy
audyt.”

Przegląd decyzji z 14:16–18:31 UTC według tej zasady zmienił: D140 (odwrócona — ADR 0020), D150, D157, D165, D179, D194,
D199 i D200/PWD-33 (w tabeli jako „po zasadzie”). Bez zmian, bo alternatywa nie była „lepsza, tylko droższa”: D125 (kafelki
godzin — spójne z mini kalendarzem D102), D126, D128, D132, D138, D141, D147, D148, D152, D167, D172, D174, D177 (płatna
domena — zasada kosztów), D180, D184 i pozostałe. Właściciel może każdą decyzję zawetować.

## Decyzje D144–D200
| ID | Sprawa | Decyzja | Odrzucone | Opis wykonania |
|---|---|---|---|---|
| D144 | Powiadomienia przy otwartej aplikacji | Baner i dźwięk, bez plakietki | Tylko przypomnienia; bez dźwięku | ADR 0035 (D134, N-1); kod: `src/app/push.ts` |
| D145 | Podzadanie wcześniejsze niż rodzic | Przypomina samo, z dopiskiem rodzica | Jedno zbiorcze o najwcześniejszej porze | ADR 0035 (D134, wyjątek) |
| D146 | Obecność w podsumowaniu | „Tak: / Może: / Nie:” | „Będzie / Będą” z odmianą | kod: `strings.pl.ts` (`rsvp.list.*`, U-39) |
| D147 | Kto robi zakupy na liście „Tylko ja” | Właściciel listy albo nikt konkretny | Wybór pokazuje listę wybranej osobie; brak pola | kod: `src/domain/views/shopping-trip.ts` (R-3) |
| D148 | Zadanie dziecka bez konta | Widzą je wszyscy dorośli grupy z dopiskiem dziecka, z przypomnieniami | Wskazany opiekun; zakaz wyboru dziecka | — |
| D149 | Duże grupy | Ustawienie przy grupie „Wszystko / Przypisane do mnie i wydarzenia / Tylko przypisane do mnie”, domyślnie „Wszystko”, podpowiedź przy dołączaniu do dużej grupy | Reguła automatyczna według wielkości | — |
| D150 | Szybkie dodawanie: grupa (po zasadzie) | Chip z grupą (dotknięcie otwiera wybór), skróty „#Grupa” i „@ja”, „Grupa domyślna” w Ustawieniach (Ostatnio użyta — domyślnie — albo konkretna grupa; tylko na telefonie, osobno dla konta); plus rozpoznawanie produktów jako propozycja „Na listę zakupów”, nigdy automatycznie | Zawsze grupa z Ustawień; chip pamięta do zamknięcia aplikacji; bez rozpoznawania produktów | ADR 0019 |
| D151 | Kosz | Sekcja „Kosz” na ekranie Grupy: grupy, listy, zadania, pozycje zakupów, wydarzenia i osoby z 30 dni, z „Przywróć” | Osobny kosz w Ustawieniach; tylko dłuższy pasek | ADR 0040 |
| D152 | Powrót osoby usuniętej | Tylko z zaproszenia wystawionego po usunięciu; jej własne kody przestają działać | Lista zablokowanych; unieważnianie wszystkich kodów | ADR 0020 |
| D153 | Skąd wziąć aplikację | Publiczny link TestFlight w wiadomości z zaproszeniem (wiersz, gdy link istnieje) i w „Zaktualizuj aplikację” | Czekać na stronę zaproszeń (D94) | ADR 0020; docs/testflight-beta.md |
| D154 | Odhaczenie z niezrobionymi podzadaniami | Pytanie „odhacz też / zostaw”; powtarzanie kopiuje podzadania | Odhaczanie wszystkiego bez pytania; wygasanie podzadań | kod: `src/domain/views/task-repeat.ts` |
| D155 | Dziecko z kontem | Połączenie istniejącego profilu z kontem; dziecko widzi tylko swoje, nie wychodzi samo, role zmienia właściciel | Osobne zaproszenie dziecka; na razie bez | ADR 0035 |
| D156 | Do koszyka (zmienia D59) | Bez pytania, z „Cofnij” | Zostaje okno; przełącznik w Ustawieniach | ADR 0007, ADR 0035 (PW-15) |
| D157 | Zarządzanie listą (po zasadzie) | Komplet: nazwa, edycja pozycji zakupów, „Tylko ja”, „Kto widzi” (cała grupa / tylko ja / wybrane osoby) — „Kto widzi” po poprawkach synchronizacji | Na raz tylko część | ADR 0035 (PW-17) |
| D158 | Lista „Tylko ja” a D68 | Zadania bez osoby na liście „Tylko ja” idą do Moich spraw właściciela listy; „kiedyś, ktokolwiek” we wspólnej grupie dozwolone z dopiskiem | D68 także na liście prywatnej; zakaz | ADR 0012, ADR 0035 (PW-18) |
| D159 | Przypomnienia bez otwierania aplikacji | Ciche powiadomienia z serwera i przeplanowanie na telefonie (najlepszy wysiłek + zapasowe okno 14 dni) | Na razie okno 7 dni; zostawić i opisać | ADR 0016 |
| D160 | „Nie będę” | Bez przypomnienia, „Czas wyjść” i dojazdu dla tego terminu; za dziecko — gdy żadne z moich dzieci nie przyjdzie, a ja nie uczestniczę | Przypomnienie zostaje; bez zmian | ADR 0016, ADR 0033 |
| D161 | Spóźnienie | Od razu „Czas wyjść” z „Masz N min spóźnienia — wyjdź teraz” | Zwykłe „30 min przed”; cisza | ADR 0029 |
| D162 | Termin serii zmieniony bez godziny | Idzie za godziną serii | Pytanie przy zmianie serii; bez zmian (RFC 5545) | ADR 0007 (M-95) |
| D163 | Przekazanie zadania powtarzanego | Obejmuje kolejne terminy | Wygasa z informacją | kod: migracja `20261008330000_handoff_obligation.sql` |
| D164 | Role przy zapraszaniu | Opis ról pod przyciskami; w grupie z dziećmi domyślnie „Zaproś jako administratora” | Tylko opis | kod: `src/features/groups/GroupScreen.tsx` |
| D165 | Usunięcie osoby (po zasadzie) | „Cofnij” plus osoba w koszu na 30 dni (przywraca właściciel albo admin), kosz wspólny z D151 | Bez cofnięcia; samo „Cofnij” | ADR 0040 |
| D166 | Grupa z Pierwszych kroków | Listy „Zakupy” i „Zadania” + karta „Następne kroki”; kartę dostaje każda nowa grupa, listy tylko ta z Pierwszych kroków (koordynator, M-117) | Tylko karta | kod: `src/features/groups/NewGroupScreen.tsx` |
| D167 | Kody zaproszenia | Jeden aktywny kod na grupę i rolę; „Nowy kod” unieważnia poprzedni | Do 3 kodów z listą; pokazywanie istniejącego | ADR 0020 |
| D168 | Prywatne listy osoby, która odeszła | Do kosza na 30 dni, wracają przy powrocie | Zostają do powrotu | ADR 0007 |
| D169 | Kto zmienia imię i kolor dorosłego | Ta osoba albo właściciel grupy; admin — tylko profile dzieci | Bez zmian | ADR 0007 |
| D170 | E2E iOS | Tylko `main`, noc i PR z tego repozytorium; publikowane zrzuty i końcówka logu; bez artefaktów z buildów wydania | PR z etykietą | kod: `.github/workflows/e2e.yml` |
| D171 | Tydzień A planu lekcji | Zapamiętany przy dziecku | Przełącznik zamienia litery; ukrycie przełącznika | ADR 0027, ADR 0035 |
| D172 | Wylogowanie a kalendarz iPhone'a | Usuwa kalendarze „Organizer” z iPhone'a, baza aplikacji zostaje | Usuwanie też bazy; pytanie przy wylogowaniu | ADR 0021 |
| D173 | Duble z iPhone'a | Tylko przy tej samej nazwie albo wpisie Organizera, licznik „ukryto N” z podglądem | Ostrzejsza dawna reguła; bez zmian | ADR 0021, ADR 0025 |
| D174 | Lustro w iPhonie | Tylko sprawy, które mnie dotyczą, lekcje dziecka jednym wpisem dziennie, wybór grup | Przełączniki lekcji; wszystko z lekcjami na końcu | ADR 0021 |
| D175 | Ustawienia a konto | Ustawienia konta osobno dla konta, wygląd wspólny, zgody iOS z systemu | Wspólne dla telefonu | ADR 0035 |
| D176 | Zakres wylogowania | Tylko ten telefon | Wszystkie urządzenia | ADR 0035 |
| D177 | Logowanie w becie | Tylko „Zaloguj przez Apple”; logowanie e-mailem wyłączone w aplikacji i w panelu Supabase | CAPTCHA z limitem 2/h; własna domena + Resend (płatna) | ADR 0035 |
| D178 | Ekran edycji zadania | Jeden: „Zmień” otwiera ekran zadania z „Przenieś do grupy” | Dwa ekrany | ADR 0036 |
| D179 | Wyjście z formularza (po zasadzie) | Szkic na telefonie (tylko zmienione pola) przywracany przy ponownym otwarciu, z „Odrzuć”; nazwa grupy i imię zapisują się od razu | Pytanie „Odrzucić zmiany?”; wszystko od razu | ADR 0036 |
| D180 | „Dla kogo” a „Przekaż” | Obie drogi, z opisem różnicy przy polu | Zawsze przekazanie; bez przekazania | ADR 0036 |
| D181 | Zmiana dnia zadania powtarzanego | Pytanie „Tylko ten raz / Też kolejne”, gdy zmienia się cykl | Zawsze przestawia cykl; bez zmian | ADR 0036 |
| D182 | Usunięte wydarzenie z przypiętymi zadaniami | Po 30 dniach zadania dostają dzień terminu jako własny termin, wydarzenie znika | Wyczyścić treść; zmienić politykę | ADR 0035 |
| D183 | Nadużycia jednego konta | Twarde limity w bazie, liczby w `config.quotas` | Tylko monitoring | ADR 0035, docs/limits.md |
| D184 | Historia zmian | 90 dni na serwerze i na telefonach | Na żądanie | ADR 0035 |
| D185 | Limity darmowych usług | Nocny skrypt (Supabase Management API), ostrzeżenie przy 70%, podtrzymanie projektu; token API z zakresem (tylko odczyt, tylko ten projekt) w środowisku GitHub `monitor` (tylko main) wgrywa właściciel (audyt 3, N-85) | Ręczne sprawdzanie | wdrożony 9.10.2026; mierzy po dodaniu sekretu, bez niego ostrzeżenie, od `config.limits.monitorSecretRequiredFrom` błąd (audyt 3, N-83); egress i Realtime ręcznie raz w miesiącu (docs/limits.md) |
| D186 | Audyt dostępności | Automatyczny na symulatorze w `e2e.yml` | Ręczna lista | — |
| D187 | Kiedy pytać przy usuwaniu | Bez pytania, zawsze „Cofnij” i kosz; pytanie tylko przy nieodwracalnych i przy liście z zadaniami; wspólną listę usuwa każdy dorosły | Pytanie przy wszystkim, co dotyczy innych | ADR 0040 |
| D188 | Ustawienia | Ikona w prawym górnym rogu każdej zakładki; chip synchronizacji tylko informuje | Zakładka „Ja”; bez zmian | chip: ADR 0035 (M-9); ikona: — |
| D189 | Pasek po dodaniu | Z formularza „Dodano … · Cofnij”, po szybkim dodaniu „Dodano … · Zmień” | „Zmień · Cofnij” w jednym pasku | ADR 0040 |
| D190 | Odrzucone zmiany | Jednorazowy pasek „Serwer nie przyjął N zmian — Zobacz”, nazwy rzeczy, „Wyczyść listę” | Bez powiadamiania | ADR 0040 |
| D191 | Grupa w formularzach | Wydarzenie, rutyna i lista startują z „Grupy domyślnej” (D150) | Wspólna, gdy jedna; bez zmian | ADR 0019; kod: `src/domain/views/default-group.ts` |
| D192 | Chipy grup | Filtrują Moje sprawy i Kalendarz (pamiętane na telefonie), z widocznym znakiem filtra | Sama legenda | — |
| D193 | Pierwsza zakładka | „Moje sprawy”, przycisk „Dziś” zostaje | Zakładka „Dziś”; tylko etykieta VoiceOvera | — |
| D194 | Cofanie przy VoiceOverze (po zasadzie) | Lista „Ostatnie zmiany” z „Cofnij” bez limitu czasu (ze sprawdzeniem, czy rzecz się nie zmieniła), w bazie konta; pasek jako skrót; przy VoiceOverze pasek nie znika sam, dostaje fokus i ma „Zamknij” | Dłuższy pasek dla wszystkich | ADR 0040, ADR 0039 |
| D195 | Kafelki godzin | Panel na pełną szerokość pod parą pól | Pola jedno pod drugim; kolumny według ekranu | kod: `src/ui/TimeField.tsx` (`TimeFieldPair`) |
| D196 | Dziś w Kalendarzu | Liczba w kółku z obwódką, VoiceOver mówi „dziś” | Pogrubienie i kreska | kod: `src/ui/DateField.tsx` |
| D197 | „Zwiększ kontrast” w iOS | Wyraźniejsze obwódki | Ciemniejsze zawsze | kod: `src/config/theme.ts`, `src/ui/theme.tsx` |
| D198 | Zaznaczenie | Jeden wzór (ciemne tło, ✓ przy wyborze wielu), terakota tylko dla głównego przycisku | Terakota dla zaznaczeń | kod: `src/config/theme.ts`, `Segmented` w `src/ui/components.tsx` |
| D199 | Wydarzenia przez kilka dni i przez północ (po zasadzie) | Teraz, bez rozbijania na osobne wpisy | Do zaległości; tylko podpowiedź | ADR 0037 |
| D200 | 40 drobnych decyzji (PWD-1…PWD-40) | Według rekomendacji, z zasadą właściciela; zamiast rekomendacji: PWD-11 A (data zakupów zapisana, zrobione przekreślone w Kalendarzu), PWD-22 A (kreska i pogrubienie dla świąt), PWD-25 B (iPad od razu, ograniczona szerokość), PWD-38 B (pełna macierz zrzutów E2E 2×2×2); po zasadzie także PWD-33 („Dodaj do grupy” dla wydarzenia z iPhone'a — teraz) | Rekomendacje tańsze w pracy | ADR 0001 (iPad), ADR 0021 (PWD-33), ADR 0036 (PWD-6, PWD-37), ADR 0035 (PWD-14, PWD-19, PWD-34) |

## Decyzje koordynatora z upoważnienia właściciela (8.10.2026, wieczór)
Według zasady wyżej; właściciel może je zawetować.
- **„Zaktualizuj aplikację”:** przycisk do publicznego linku TestFlight z tego samego klucza konfiguracji co w zaproszeniu
  (D153), widoczny dopiero, gdy link istnieje. Minimalna wersja protokołu 2 — ok. dwa tygodnie po buildzie 22. Odrzucone:
  tylko tekst na stałe; podnoszenie minimum tylko przy potrzebie.
- **Pobranie grupy od zera** nie czyści ekranu dużej grupy — stare wiersze widoczne do pełnego nowego obrazu (ADR 0035,
  „odporność synchronizacji”).
- **„Zostaw” przy odhaczeniu (D154):** niezrobione podzadania odhaczonego zadania widoczne w swoim dniu, potem wygasają.
- **Chip grupy:** dotknięcie otwiera wybór; produkty dwuwyrazowe na razie ściśle; data przy produkcie z propozycji
  pomijana; grupa domyślna i ostatnio użyta — tylko na telefonie, osobno dla konta.
- **Wylogowanie bez internetu:** telefon wyrejestruje token starą sesją po powrocie internetu (ADR 0035, „konto i dane”).
- **„Co nowego” dla buildu 22** — tak.
- **Lista „Tylko ja”:** zakupy bez obowiązkowego terminu i osoby (spójne z D158).
- **E2E:** ręczne uruchamianie (`workflow_dispatch`) zostaje — potrzebne do ponowienia po „not acquired”. Ochrona tagów
  `v*` w ustawieniach repozytorium — akcja właściciela (backlog).
- **Konto dziecka:** dziecko odhacza tylko swoje sprawy i pozycje (ADR 0035, D155).
- **„Ostatnie zmiany”** w bazie konta, przeżywają ponowne uruchomienie (ADR 0040, D194 b).

## Decyzje Claude'a przy paczce dokumentacji (9.10.2026)
Merytoryczne i techniczne; każda z przeczytanym źródłem albo rachunkiem. Właściciel może je zawetować.

1. **Źródła reguł dziedzinowych w komentarzach (M-157).** Dopisane adresy i cytaty: Wielkanoc
   (`src/domain/holidays.ts` — opis algorytmu Meeus/Jones/Butcher i dokumentacja `dateutil.easter`), strefa
   Europe/Warsaw i zmiany czasu (`src/app/clock.ts` — ECMA-402 §6.5, plik `europe` bazy IANA, RFC 5545 §3.3.5 dla godzin
   nieistniejących i podwójnych), tydzień od poniedziałku (`src/domain/month-grid.ts` — CLDR `firstDay` dla PL; tekstu
   ISO 8601 nie czytaliśmy, jest płatny), zapis godzin i przedziałów (`src/domain/time-range.ts` — CLDR pl
   `timeFormats.short` „HH:mm” i `intervalFormats` „HH:mm–HH:mm”; półpauza w zakresie — zasada 93.12 SO PWN w omówieniu
   NCK), UUIDv7 i UUIDv5 (`src/domain/ids.ts` — RFC 9562 §5.7, §5.5), zamiana polskich liter w „@imię”
   (`src/domain/views/mention.ts` — UnicodeData: „ł” nie ma rozkładu kanonicznego, więc NFD go nie zmienia), globalny
   handler błędów (`src/app/diagnostics.tsx` — kod React Native 0.86, bo strony dokumentacji ErrorUtils nie ma), limit 64
   zaplanowanych powiadomień (`src/config/index.ts` — aktualny adres strony Apple). „Ilość bez jednostki 1–99” oznaczona
   jako wybór projektowy. Odrzucone: cytowanie numeru normy bez przeczytanego tekstu jako źródła.
2. **Pierwsza cyfra ID grupy (M-157, rachunek).** Dotąd `1 + (cyfra % 9)`: cyfry 0 i 9 dawały „1”, więc jedynka miała 2/10,
   a reszta 1/10. Teraz losujemy 9 cyfr i odrzucamy wynik z zerem na początku — rozkład równy na [10⁸, 10⁹), średnio
   10/9 losowania (`private.new_join_id`, migracja `20261008580000_join_id_first_digit.sql`, test
   `supabase/tests/join_id_first_digit.test.sql`). Istniejące ID zostają. Odrzucone: tylko opis nierówności (rachunek
   prosty, poprawka tania); `1 + floor(los · 9)` z liczby zmiennoprzecinkowej (`random()` nie jest losowością
   kryptograficzną).
3. **Najniższy iOS (M-162, D35).** `ios.deploymentTarget: "16.4"` w `app.json` = `config.IOS_MIN`, test kontraktowy
   sprawdza też minimum z `Expo.podspec`. Źródło: tabela wersji w https://docs.expo.dev/versions/v57.0.0/ („57.0.0 | 7+ |
   36 | 36 | 16.4+ | 26.4+”) i pole `ios.deploymentTarget` w https://docs.expo.dev/versions/v57.0.0/config/app/ („Sets the
   iOS deployment target (minimum iOS version)”). „Dodaj do kalendarza” na iOS 16: expo-calendar prosi o zwykły dostęp
   (ADR 0008). Odrzucone: `expo-build-properties` (nowa zależność dla tego samego pola); wyższe minimum, np. 17.0 (bez
   potrzeby wyklucza iPhone'y z iOS 16).
4. **Odtworzenie bazy serwera z kopii albo do punktu w czasie (M-180).** Po odtworzeniu telefony mają kursory grup dalej niż
   wersje w kopii i zdjęte z kolejki zmiany, które serwer potwierdził już po chwili kopii. Procedura (kopia w runbooku 06):
   1. Zatrzymać wdrożenia i poinformować testerów, że zmiany z okna utraty (od chwili kopii do awarii) przepadają.
   2. Odtworzyć bazę (z kopii albo do punktu w czasie — tym, co daje plan Supabase w chwili awarii).
   3. Od razu, jako `postgres` w edytorze SQL: `select private.new_epoch_after_restore();` — licznik wersji każdej grupy
      przesuwa się o 10⁹ (więcej, niż mogło przybyć w oknie utraty), a `purged_version` = nowa wersja. Każdy telefon
      z kursorem sprzed nowej epoki dostaje `resync` i pobiera grupę od nowa, więc pokazuje stan serwera
      (migracja `20261008581000_restore_epoch.sql`, test `supabase/tests/restore_epoch.test.sql`).
   4. Sprawdzić `db push --dry-run` (migracje z kopii = repozytorium) i jeden telefon testowy.
   Skutki: zmiany z okna utraty znikają też z telefonów (pobranie od nowa); numery operacji telefonu są wyżej niż
   `last_seq` z kopii, więc nowe zmiany serwer przyjmuje normalnie. Odrzucone: odzyskiwanie zmian z kolejek telefonów
   (telefon nie trzyma potwierdzonych operacji — wymagałoby zmiany protokołu); samo `purged_version = version` bez
   przesunięcia (kursor telefonu wyższy niż wersja z kopii nie dałby `resync`).
5. **Token powiadomień przy zmianie konta (M-184).** `register_push_token` przypisuje token konta, które go zgłasza — tak
   działa zmiana konta na tym samym telefonie. Dowodu posiadania tokenu nie wymagamy: token zna tylko ten telefon i APNs,
   a do wysyłki potrzebny jest klucz dostawcy, który żyje tylko w sekretach Supabase. Odrzucone: wyzwanie (jednorazowe
   ciche powiadomienie z kodem do potwierdzenia) — dodatkowa droga przez APNs przy każdej rejestracji, bez realnej korzyści
   przy tokenie, którego nikt poza telefonem nie zna.
6. **Przesuwanie a usuwanie na ekranie (M-239).** Audyt proponował zasadę „przesuwamy tylko rzeczy do zrobienia”. D187
   i ADR 0040 („Przesuwanie”) wybrały jedną regułę dla wszystkich wierszy: ten sam gest „Usuń” przy zadaniach, listach,
   osobach, grupach i wydarzeniach, zawsze z „Cofnij” i koszem. Zostaje ADR 0040 (spójność gestu, PWD-28).
7. **Sprostowania komentarzy w wydanych migracjach (M-272).** Wydanych migracji nie edytujemy, więc poprawka jest tutaj:
   - `20261006120000_core.sql` i `20261006120200_sync.sql` odsyłają do `supabase/tests/contract_config.test.sql` —
     takiego pliku nie ma; kontrakt liczb SQL ↔ `src/config` to `src/config/__tests__/sql.contract.test.ts`.
   - `20261008190000_feedback.sql` mówi o sprzątaniu „przy zapisie (bez pg_cron)” — od D82 (ADR 0018) sprząta też
     codzienny pg_cron.
