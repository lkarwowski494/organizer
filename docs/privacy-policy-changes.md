# Polityka prywatności: zmiany do akceptu (D142, ADR 0035, 8.10.2026)

Zmieniony plik: `docs/privacy-policy.md` (wersja 7.10.2026 → 8.10.2026). Każde zdanie sprawdzone w kodzie 8.10.2026.
Odwołania wskazują symbole (funkcja, tabela, plik), nie numery linii — numery się przesuwają. Funkcję SQL definiuje
ostatnia migracja, która ją tworzy albo zmienia (`grep -l "function private.<nazwa>" supabase/migrations/*`).

## Co się zmieniło i dlaczego

1. **Powiadomienia nie tylko o przekazaniach.** Doszły przypisania zadań i zakupów oraz osoba odpowiedzialna za wydarzenie;
   opisana treść powiadomienia (imię + nazwa, przy wydarzeniu dzień), która przechodzi przez APNs.
   - Serwer: `private.assignment_push_claim` (przypisania i osoba odpowiedzialna; wysyła tylko, gdy odbiorca widzi listę)
     i `private.handoff_push_claim` (przekazania).
   - Wywołanie z telefonu: `src/app/HandoffNotifier.tsx`, `notifyAssignment` i `notifyHandoff` w `src/sync/supabase.ts`.
2. **Wyciszenia grup i dziennik wysyłki są na serwerze.** Tabela `public.push_mutes`; `private.push_log` z samym kluczem
   `assign|<id wpisu>` i czasem. Retencja dziennika 7 dni: `private.push_log_retention_days()`, kasowanie
   w `private.daily_maintenance()`.
3. **Samosprawdzenie raz na wersję.** Nowy punkt. `reportSelfCheck` w `src/app/self-check.ts` (rodzaj `diagnostic`,
   w `stack` JSON z wynikami: hermes, timezone, upper_pl, sqlite_version, sqlite_json, sqlite_rollback), dopuszczenie
   w bazie: ograniczenie `client_errors_kind_check` (`20261008220000_client_diagnostic.sql`).
4. **Zgłoszenia błędów i uwagi są przypisane do konta, uwagi wysyłają też nazwę ekranu.** Kolumna `user_id` w tabelach
   `public.client_errors` i `public.app_feedback` (`20261008190000_feedback.sql`); ekran w uwadze: `'Settings'`
   w `src/features/settings/FeedbackScreen.tsx`, `sendFeedback` w `src/sync/supabase.ts`. Ekrany w błędach: `'travel'`
   (`src/app/travel.tsx`), `'render'` (`src/app/diagnostics.tsx`), `'calendar-*'` (`src/app/calendar-sync.tsx`),
   `'selfcheck'`. Dopisane, że czyta je tylko autor (telefon nie ma uprawnień odczytu: `revoke all on public.client_errors,
   public.app_feedback from anon, authenticated` w `20261008190000_feedback.sql`).
5. **Odpowiedzi o obecności widzi cała grupa**, z tym, kto odpowiedział (dorosły za dziecko).
   Polityka `event_rsvps_select`, strażnik zapisu „za siebie; za dziecko bez konta — tylko dorosły” i kolumna
   `answered_by` (`20261008270000_event_rsvps.sql`).
6. **Kto co widzi.** Listy group/restricted/private: `private.can_see_list`; wydarzenia cała grupa: polityki `*_select`
   tabel wydarzeń (`20261008100000_events.sql`); przekazania tylko strony: polityka `handoffs_select`; historia zmian:
   polityka `activity_select`.
7. **Grupa bez innego dorosłego trafia do kosza na 30 dni** przy usunięciu konta, potem znika z zawartością.
   `private.delete_account_data` (gałąź właściciela), czyszczenie w `private.daily_maintenance()`
   (`private.hard_delete_group_safe` → `private.hard_delete_group`). Dopisane też: listy „Tylko ja” do kosza, unieważnienie zaproszeń, wpisy zostają z podpisem
   „Usunięty użytkownik” (`private.deleted_user_label()`) — ta sama funkcja; token, wyciszenia, zgłoszenia, uwagi, profil
   i dane synchronizacji znikają kaskadą (`on delete cascade` w `push_tokens`, `push_mutes`, `client_errors`,
   `app_feedback`, `profiles`, `private.sync_clients`).
8. **Okresy przechowywania z kodu:**
   - kosz 30 dni: `config.sync.TOMBSTONE_DAYS` (= SQL, test kontraktowy); sprzątanie codziennie o 3:17 UTC
     (`cron.schedule('organizer-daily-maintenance', '17 3 * * *', …)`, `20261008210000_maintenance.sql`);
   - błędy, samosprawdzenie, uwagi 90 dni: `config.feedback.RETENTION_DAYS` = `private.feedback_retention_days()`;
     kasowanie przy zapisie i codziennie (`private.daily_maintenance()`);
   - limity 50 błędów / 20 uwag dziennie: `config.feedback.ERRORS_PER_DAY`, `config.feedback.PER_DAY` (= SQL);
   - nieudane próby dołączenia: tabela `private.join_attempts`, kasowanie raz na dobę wpisów starszych niż dzień (w praktyce
     do 2 dni) i z kontem (`private.delete_account_trash`);
   - dziennik wysyłki 7 dni: punkt 2;
   - token powiadomień bez terminu, usuwany przy odrzuceniu przez APNs (`public.drop_push_token`, wołane z
     `supabase/functions/notify-handoff/handler.ts`), przechodzi na nowe konto (`public.register_push_token`).
9. **Lokalizacja nigdy nie trafia na nasz serwer.** Dopisane wprost, plus geokoder Apple dla adresu i „Nawiguj” do Map Apple
   (od 9.10.2026 tylko Map Apple, ADR 0043). `expoTravel` w `src/app/travel-service.ts`, `modules/travel-time/ios/TravelTimeModule.swift`,
   `navigationUrl` w `src/domain/travel.ts`, `src/app/travel.tsx`. Brak innych wywołań lokalizacji ani `fetch` w `src/`.
   Cache współrzędnych na telefonie: klucz `travelGeo` w `src/app/travel.tsx`.
10. **Opis czujnika ruchu** tylko z powodu biblioteki: `motionUsagePermission` (wtyczka expo-location) w `app.json`, ADR 0032 (D123).
11. **Kalendarz.** Dokładne okna z `config.calendar` (odczyt 31/62 dni, lustro 7/90 dni); co trafia do lustra:
    `mirrorItems` w `src/domain/views/calendar-sync.ts` (tytuł z osobą odpowiedzialną, dzień, godziny, nazwa grupy
    w notatce); lustro na koncie domyślnego kalendarza: `getDefaultCalendarSync().source` w `src/app/device-calendar.ts`.
12. **Nowe, drobniejsze:** imię i nazwisko z Apple w metadanych konta (`full_name` w `src/sync/supabase.ts`); zaproszenia
    i kod (`public.invites`, `20261007090000_invites.sql`, `20261008250000_join_codes.sql`); dane techniczne synchronizacji
    (`private.sync_clients`, `private.access_events`); lokalna baza `organizer-<userId>.db` (`dbName` w
    `src/app/wiring.ts`) zostaje po wylogowaniu, a po usunięciu konta znika z telefonu (M-64, ADR 0035).

## Do potwierdzenia przez właściciela

1. **Kontakt:** w polityce nadal „adres z TestFlight”. Przed publikacją potrzebny jawny adres e-mail.
2. **RODO:** polityka nie podaje podstaw prawnych ani prawa skargi do PUODO. Nie dopisałem ich, bo to sprawa prawna, a nie
   kodu. Czy dodać przed publikacją (i na czyjej podstawie)?
3. **Komunikaty błędów są dowolnym tekstem** (`toClientError` w `src/app/diagnostics.tsx`, `err.message`). → Dla
   kalendarza i dojazdu rozwiązane w kodzie (M-159, niżej „kalendarz iPhone'a i dojazd”, pkt 4). Kod nie dołącza danych z tabel,
   ale nie da się zagwarantować, że np. komunikat geokodera albo MapKit (`TravelTimeModule.swift`, `localizedDescription`)
   nigdy nie zawiera adresu. Dlatego piszę „aplikacja nie dołącza”, a nie „nigdy nie zawiera”. Do akceptu albo do
   poprawki w kodzie.
4. **Ekran uwag mówił „Dołączymy wersję aplikacji — nic więcej”**, a wysyłana jest też nazwa ekranu i uwaga jest
   powiązana z kontem. → Poprawione: `feedback.info` w `src/i18n/strings.pl.ts` mówi o wersji, nazwie ekranu i koncie.
5. **Token powiadomień przy wylogowaniu** — naprawione 8.10.2026 (D131, audyt 2): wylogowanie wywołuje
   `unregister_push_token` także dla tokenu z poprzedniego uruchomienia (zapamiętanego na telefonie). Bez internetu
   token zostaje na serwerze do zalogowania innego konta albo unieważnienia przez Apple — w polityce: „gdy jest internet”.
6. **`private.access_events` i `private.sync_clients` nie mają okresu przechowywania**: znikają dopiero z kontem
   (kaskada przy usunięciu konta). → Rozstrzygnięte w audycie 2 (M-68): dziennik dostępu 30 dni, dane techniczne
   synchronizacji 180 dni od ostatniego użycia (niżej „retencja”, pkt 3).
7. **Lokalna kopia po usunięciu konta** zostawała w pliku `organizer-<userId>.db` do usunięcia aplikacji. → Rozstrzygnięte
   w audycie 2 (M-64): po usunięciu konta plik bazy konta znika z telefonu. „Wyczyść dane na telefonie” zostawia klucze
   `local:*` (`wipeSynced` w `src/data/store.ts`).
8. **Imię i nazwisko z Apple (`full_name`)** zostaje w metadanych konta także po zmianie imienia w aplikacji
   (`setMyName` w `src/sync/supabase.ts` zmienia tylko `display_name`). Usuwane z kontem. Czy w ogóle zapisywać nazwisko?
9. **Adres e-mail przy logowaniu przez Apple** i dzienniki platformy (adresy IP, logi zapytań i logowania) przechowuje
   Supabase Auth i Supabase według własnych zasad. Nasz kod tego nie konfiguruje, więc w polityce nie podałem terminów.
   Do sprawdzenia w dokumentacji Supabase przed publikacją.
10. **Lustro kalendarza na iCloud albo innym koncie:** kalendarze „Organizer” powstają na koncie domyślnego kalendarza
    (`getDefaultCalendarSync().source` w `src/app/device-calendar.ts`, komentarz: „zwykle iCloud”). Wydarzenia grup trafiają więc do tego dostawcy.
    Napisałem to wprost. Do akceptu.
11. **Opis zgody „tylko zapis” w `app.json`** (`NSCalendarsWriteOnlyAccessUsageDescription`, dawniej „Nie odczytuje kalendarza”) jest
    prawdziwy tylko dla „Dodaj do kalendarza” bez połączenia. Przy pełnym połączeniu iOS pokazuje opis `calendarPermission` (wtyczka expo-calendar). → Audyt 2 (M-160): opis „tylko zapis” brzmi
    „Ta zgoda nie daje dostępu do Twoich wpisów”, a opis pełnego dostępu mówi, że wydarzenia grup trafiają do kalendarza
    iPhone’a (zwykle iCloud).

## Zmiany z audytu 2 — grupy (8.10.2026), do akceptu
1. **Kod zaproszenia zapisany na serwerze** (dotąd tylko skrót): `invites.code`, `supabase/migrations/20261008362000_join_codes_v2.sql`
   (decyzja PW-41 A: „Zaproś” pokazuje bieżący kod). Bez uprawnień odczytu dla telefonu; czyta go funkcja dla owner/admin.
2. **Kod po zbyt wielu nieudanych próbach przestaje działać** (D140 odwrócona): ten sam plik, `private.join_group`.
3. **Wyjście albo usunięcie z grupy:** listy „Tylko ja” do kosza na 30 dni i z powrotem przy powrocie; osoba usunięta
   do przywrócenia przez 30 dni; jej zaproszenia przestają działać: `20261008361000_member_departure.sql`,
   `20261008360000_member_names_roles.sql` (`removed_at`).

## Zmiany z audytu 2 — kalendarz iPhone'a i dojazd (8.10.2026), do akceptu
1. **Wylogowanie, usunięcie konta i inne konto usuwają kalendarze „Organizer”** utworzone na tym telefonie (D172):
   `src/app/calendar-mirror.ts` (`removeMirrorCalendars`, wołane w `src/app/Root.tsx`). Ich identyfikatory są w pęku kluczy
   telefonu (`pref.calendarMirrorOwned`), żeby usunąć je także po zmianie konta i ponownej instalacji.
2. **Lustro tylko ze sprawami, które mnie dotyczą,** z wybranych grup, z miejscem wydarzenia; lekcje dziecka jednym wpisem
   z listą lekcji w notatce (D174): `src/domain/views/calendar-sync.ts` (`mirrorItems`).
3. **Dopisek „Dodane przez aplikację Organizer” w notatce** wpisów lustra i „Dodaj do kalendarza” (D173): `withMark`
   w `src/app/device-calendar.ts`.
4. **Błędy kalendarza i dojazdu bez komunikatu** (punkt 3 wyżej rozwiązany w kodzie dla tych źródeł, M-159): `toClientError`
   z `{ private: true }` w `src/app/diagnostics.tsx`.
5. **Pamięć adresów:** najwyżej 200, nieznaleziony adres sprawdzany znowu po dobie (`config.travel.GEO_MAX`, `GEO_RETRY_H`).

## Zmiany z audytu 2 — retencja (8.10.2026), do akceptu
1. **Kosz naprawdę „znika na zawsze”** (M-67): przy czyszczeniu kosza znika też historia zmian usuniętej rzeczy (listy,
   wydarzenia, wyjątki terminów, odpowiedzi, uczestnicy, definicje stałych zadań, wpisy dostępu); usunięte wydarzenie
   z przypiętymi zadaniami po 30 dniach znika, a zadania dostają dzień terminu jako własny termin (decyzja PW-42 A, D182):
   `supabase/migrations/20261008480000_retention.sql` (`private.purge_group`).
2. **Historia zmian 90 dni** na serwerze i na telefonach (PW-47 A, D184): ten sam plik; telefon
   `src/domain/sync-engine/retention.ts`.
3. **Nowe terminy retencji** (M-68): rozstrzygnięte przekazania 90 dni, zaproszenia 30 dni po wygaśnięciu albo
   unieważnieniu, dziennik dostępu 30 dni, dane techniczne synchronizacji 180 dni od ostatniego użycia instalacji
   (`private.purge_logs`); liczby w `src/config` (`retention`, test kontraktowy).
4. **Nieudane próby dołączenia** znikają z kontem i „do 2 dni” (sprzątanie raz na dobę): `private.delete_account_trash`.
5. **Grupa w koszu po usunięciu konta właściciela** przechodzi na dorosłego z najdłuższym stażem (M-183), jak grupa
   poza koszem: ten sam plik.
6. **Nowe dane (audyt 2, P13, 9.10.2026):** zrobione zakupy (lista, kiedy, na kiedy, kto) widoczne dla osób widzących
   listę, trzymane 90 dni (`config.retention.TRIP_DAYS`); zakres Moich spraw w grupie — ustawienie konta, widoczne tylko
   dla tego konta, znika po wyjściu z grupy: `supabase/migrations/20261008570000_my_scopes_trips.sql`.

## Zmiana z audytu 3 — retencja na telefonie (9.10.2026), do akceptu
1. **Telefon trzyma najwyżej tyle co serwer** (N-89): rzeczy wyczyszczone z kosza (po 30 dniach) i zrobione zakupy po
   90 dniach znikają także z bazy na telefonie przy pobraniu, dzień po terminie serwera (`src/domain/sync-engine/retention.ts`).
   Dotąd zostawały na telefonie, który je wcześniej pobrał.

## Zmiany z audytu 2 — przypomnienia bez otwierania aplikacji (D159, 8.10.2026), do akceptu
1. **Ciche powiadomienia bez treści** do urządzeń członków grupy po zmianie, która może zmienić przypomnienia
   (`supabase/functions/notify-handoff/handler.ts`, `sendBackground` w `supabase/functions/_shared/apns.ts`: tylko
   `content-available`). Przez APNs nie idzie żadna treść spraw.
2. **Stan budzenia przy tokenie** (`private.wake_state`: token, chwila ostatniego wysłania, „czeka zmiana”),
   `supabase/migrations/20261008490000_reminder_wake.sql`. Kasowany z tokenem (wylogowanie, token odrzucony przez Apple,
   usunięcie konta — kaskada).
3. **Ostatni policzony czas dojazdu** zapisany w bazie konta na telefonie (`travelResults`, `src/app/travel.tsx`), żeby
   „Czas wyjść” działał przy planowaniu w tle. Nie opuszcza telefonu.

## Zmiany z audytu 2 — dokładność polityki (9.10.2026), do akceptu
1. **E-mail z konta Apple** (M-164): aplikacja prosi Apple o imię i e-mail (`requestedScopes: FULL_NAME, EMAIL`
   w `src/app/wiring.ts`); Apple: „Apple provides the user’s email address in the identity token”
   (https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple). Strona
   Supabase o logowaniu Apple (https://supabase.com/docs/guides/auth/social-login/auth-apple) nie mówi, czy adres jest
   zapisywany, więc polityka mówi „może go zapisać”. Do sprawdzenia w panelu Supabase (Authentication → Users: czy konto
   Apple ma adres) i wtedy „może” zamienić na „zapisuje” albo usunąć zdanie.
   Otwarte pytanie: czy przestać prosić Apple o e-mail (aplikacja z niego nie korzysta). Kod serwera logowania
   (github.com/supabase/auth, `internal/api/provider/oidc.go` › `parseAppleIDToken`: adres z tokenu, także pusty, trafia
   do danych jako `Verified: true`; `internal/models/linking.go` › `DetermineAccountLinking` łączy konta po zweryfikowanym
   adresie) nie pozwala potwierdzić bez próby, że dwa konta Apple bez adresu nie zostałyby powiązane po pustym adresie.
   Zakres EMAIL zostaje do próby na koncie testowym (nie na produkcji).
2. **„Wysyłamy najwyżej 50 dziennie” → „zapisujemy najwyżej 50 zgłoszeń na dobę”** — limit liczy serwer (wiersze
   `client_errors` z ostatnich 24 h, `private.client_errors_per_day()`), telefon wysyła dalej.
3. **Kto czyta zgłoszenia i uwagi:** „autor aplikacji w panelu serwera; dostęp techniczny ma też dostawca serwera”
   (zamiast „tylko autor”).
4. **Pełniejsza lista nazw części aplikacji w zgłoszeniach** (`render`, `travel`, `calendar-read`, `calendar-mirror`,
   `selfcheck`; ponadto `calendar-mirror-off`).
5. **Połączenie na żywo (Realtime) i profil** w „Danych technicznych synchronizacji”: sygnał z numerem wersji grupy albo
   zmianą dostępu, bez treści spraw (`realtime.send` w migracjach synchronizacji); imię w `public.profiles`.
6. **„Nawiguj”** otwiera Mapy Apple (`navigationUrl` w `src/domain/travel.ts`); wybór map innej firmy i strona map
   w przeglądarce usunięte 9.10.2026 (ADR 0043).

## Zmiany z audytu 3 — usunięcie konta (9.10.2026), do akceptu
1. **„Usuń też moje wpisy w grupach”** (decyzja Q5 C, N-71): nowy punkt w części „Usunięcie konta”. Wybór zapisuje
   `public.prepare_account_deletion` (wołana przez funkcję `delete-account` z sesją użytkownika), wykonuje
   `private.delete_account_entries` w wyzwalaczu `on_auth_user_a_entries` przed usunięciem `auth.users`
   (`20261010240000_account_delete_entries.sql`); testy `supabase/tests/account_delete_entries.test.sql`. Bez wyboru
   zachowanie jak dotąd (wpisy zostają z podpisem „Usunięty użytkownik”).

## Zmiany z audytu 3 — zaproszenia (9.10.2026), do akceptu
1. **Wyjście, usunięcie z grupy i utrata roli administratora** (decyzja Q7 A, N-39): przestają działać tylko zaproszenia
   osobiste tej osoby (kody profili dzieci, dawne linki z tokenem); wspólny kod roli grupy działa dalej do wygaśnięcia.
   Kod: `private.group_members_departure`, `private.group_members_role_invites` (`20261010100000_invites_membership.sql`).
2. **Usunięcie konta** (decyzja Q1 B koordynatora): to samo — osobiste zaproszenia przestają działać, wspólny kod grupy
   zostaje, a wystawiającym wszystkich zaproszeń tej osoby w grupie (także unieważnionych) staje się bieżący właściciel
   grupy, więc żadne zaproszenie nie wskazuje już członkostwa usuniętej osoby. Grupa bez następcy idzie do kosza i żaden jej
   kod nie działa (wystawiającym zostaje podpis „Usunięty użytkownik” bez konta; zaproszenia znikają z grupą po 30 dniach).
   Kod: `private.account_invites_handover`, wołana z `private.delete_account_data` i `private.delete_account_trash`
   (`20261010101000_account_deletion_invites.sql`); testy `supabase/tests/account_deletion_invites.test.sql`.
   Wcześniej polityka mówiła: „Linki zaproszeń, które wystawiłeś, przestają działać” — zdanie zastąpione.
