# Polityka prywatności: zmiany do akceptu (D142, ADR 0035, 8.10.2026)

Zmieniony plik: `docs/privacy-policy.md` (wersja 7.10.2026 → 8.10.2026). Każde zdanie sprawdzone w kodzie.

## Co się zmieniło i dlaczego

1. **Powiadomienia nie tylko o przekazaniach.** Doszły przypisania zadań i zakupów oraz osoba odpowiedzialna za wydarzenie;
   opisana treść powiadomienia (imię + nazwa, przy wydarzeniu dzień), która przechodzi przez APNs.
   - `supabase/migrations/20261008200000_assign_push.sql:47` (przypisania), `20261008240000_event_push.sql:96` (wydarzenia),
     ostatnia wersja `20261008280000_audit_fixes.sql:357` (tylko gdy odbiorca widzi listę) i `:412` (przekazania).
   - Wywołanie z telefonu: `src/app/HandoffNotifier.tsx:22-33`, `src/sync/supabase.ts:143`.
2. **Wyciszenia grup i dziennik wysyłki są na serwerze.** `public.push_mutes` (`20261008200000_assign_push.sql:6`),
   `private.push_log` z samym kluczem `assign|<id wpisu>` i czasem (`:16`, `:68`). Retencja dziennika 7 dni:
   `20261008210000_maintenance.sql:12`, kasowanie `20261008250000_join_codes.sql:206`.
3. **Samosprawdzenie raz na wersję.** Nowy punkt. `src/app/self-check.ts:80-95` (rodzaj `diagnostic`, w `stack` JSON
   z wynikami: hermes, timezone, upper_pl, sqlite_version, sqlite_json, sqlite_rollback), dopuszczenie w bazie
   `20261008220000_client_diagnostic.sql:4`.
4. **Zgłoszenia błędów i uwagi są przypisane do konta, uwagi wysyłają też nazwę ekranu.** `user_id` w obu tabelach:
   `20261008190000_feedback.sql:11` i `:23`; ekran w uwadze: `src/features/settings/FeedbackScreen.tsx:24` (`'Settings'`),
   `src/sync/supabase.ts:156`. Ekrany w błędach: `src/app/travel.tsx:109` („travel”), `src/app/diagnostics.tsx:50`
   („render”), `src/app/calendar-sync.tsx:68`. Dopisane, że czyta je tylko autor (brak GRANT dla telefonu: `20261008190000_feedback.sql:33`).
5. **Odpowiedzi o obecności widzi cała grupa**, z tym, kto odpowiedział (dorosły za dziecko).
   `20261008270000_event_rsvps.sql:55` (polityka select), `:41-44` (za dziecko bez konta), `:45` (`answered_by`).
6. **Kto co widzi.** Listy group/restricted/private: `20261006120100_lists_tasks.sql:36-48`; wydarzenia cała grupa:
   `20261008100000_events.sql:100`; przekazania tylko strony: `20261008150000_handoffs.sql:111-112`;
   historia zmian: `20261006120100_lists_tasks.sql:360-362`.
7. **Grupa bez innego dorosłego trafia do kosza na 30 dni** przy usunięciu konta, potem znika z zawartością.
   `20261007110000_account_deletion.sql:57-64`, czyszczenie `20261008280000_audit_fixes.sql:304-321` i `hard_delete_group` `:283-301`.
   Dopisane też: listy „Tylko ja” do kosza (`20261007110000_account_deletion.sql:71-72`), unieważnienie zaproszeń (`:74-75`),
   wpisy zostają z podpisem „Usunięty użytkownik” (`:83-92`), a token, wyciszenia, zgłoszenia, uwagi, profil i dane
   synchronizacji znikają kaskadą (`on delete cascade`: `20261008170000_push.sql:8`, `20261008200000_assign_push.sql:7`,
   `20261008190000_feedback.sql:11,23`, `20261006120000_core.sql:51,59`).
8. **Okresy przechowywania z kodu:**
   - kosz 30 dni: `20261006120000_core.sql:18`, `src/config/index.ts:124`; sprzątanie codziennie o 3:17 UTC:
     `20261008210000_maintenance.sql:49`;
   - błędy, samosprawdzenie, uwagi 90 dni: `20261008190000_feedback.sql:7`, `src/config/index.ts:18`; kasowanie przy zapisie
     (`20261008190000_feedback.sql:42,56`) i codziennie (`20261008250000_join_codes.sql:202,204`);
   - limity 50 błędów / 20 uwag dziennie: `20261008190000_feedback.sql:5-6`, `src/config/index.ts:18`;
   - nieudane próby dołączenia 1 dzień: `20261008250000_join_codes.sql:123-127` (co zapisujemy), `:208` (kasowanie);
   - dziennik wysyłki 7 dni: punkt 2;
   - token powiadomień bez terminu, usuwany przy odrzuceniu przez APNs (`20261008170000_push.sql:86-87`,
     `supabase/functions/notify-handoff/handler.ts:62`), przechodzi na nowe konto (`20261008170000_push.sql:22-24`).
9. **Lokalizacja nigdy nie trafia na nasz serwer.** Dopisane wprost, plus geokoder Apple dla adresu i „Nawiguj” do Map Apple
   albo Google. `src/app/travel-service.ts:33-43`, `modules/travel-time/ios/TravelTimeModule.swift`,
   `src/domain/travel.ts:20-26`, `src/app/travel.tsx:176`. Brak innych wywołań lokalizacji ani `fetch` w `src/`.
   Cache współrzędnych na telefonie: `src/app/travel.tsx:23` (`travelGeo`).
10. **Opis czujnika ruchu** tylko z powodu biblioteki: `app.json:49`, ADR 0032 (D123).
11. **Kalendarz.** Dokładne okna z `src/config/index.ts:80` (odczyt 31/62 dni, lustro 7/90 dni); co trafia do lustra:
    `src/domain/views/calendar-sync.ts:128-136` (tytuł z osobą odpowiedzialną, dzień, godziny, nazwa grupy w notatce);
    lustro na koncie domyślnego kalendarza: `src/app/device-calendar.ts:69-71`.
12. **Nowe, drobniejsze:** imię i nazwisko z Apple w metadanych konta (`src/sync/supabase.ts:78-81`); zaproszenia i skrót
    kodu (`20261007090000_invites.sql:14-25`, `20261008250000_join_codes.sql:1-4`); dane techniczne synchronizacji
    (`private.sync_clients` `20261006120000_core.sql:57-62`, `private.access_events` `:64-72`); e-mail logowania wysyła
    Supabase (`docs/limits.md:14`); lokalna baza `organizer-<userId>.db` zostaje po wylogowaniu i usunięciu konta
    (`src/app/wiring.ts:65`).

## Do potwierdzenia przez właściciela

1. **Kontakt:** w polityce nadal „adres z TestFlight”. Przed publikacją potrzebny jawny adres e-mail.
2. **RODO:** polityka nie podaje podstaw prawnych ani prawa skargi do PUODO. Nie dopisałem ich, bo to sprawa prawna, a nie
   kodu. Czy dodać przed publikacją (i na czyjej podstawie)?
3. **Komunikaty błędów są dowolnym tekstem** (`src/app/diagnostics.tsx:21`, `err.message`). Kod nie dołącza danych z tabel,
   ale nie da się zagwarantować, że np. komunikat geokodera albo MapKit (`TravelTimeModule.swift`, `localizedDescription`)
   nigdy nie zawiera adresu. Dlatego piszę „aplikacja nie dołącza”, a nie „nigdy nie zawiera”. Do akceptu albo do
   poprawki w kodzie.
4. **Ekran uwag mówi „Dołączymy wersję aplikacji — nic więcej”** (`src/i18n/strings.pl.ts:552`), a wysyłana jest też nazwa
   ekranu i uwaga jest powiązana z kontem. Tekst w aplikacji do poprawy (poza zakresem tej zmiany).
5. **Token powiadomień przy wylogowaniu** — naprawione 8.10.2026 (D131, audyt 2): wylogowanie wywołuje
   `unregister_push_token` także dla tokenu z poprzedniego uruchomienia (zapamiętanego na telefonie). Bez internetu
   token zostaje na serwerze do zalogowania innego konta albo unieważnienia przez Apple — w polityce: „gdy jest internet”.
6. **`private.access_events` i `private.sync_clients` nie mają okresu przechowywania**: znikają dopiero z kontem
   (`20261007110000_account_deletion.sql:94` i kaskada). Nie podałem terminu. Czy ustalić retencję?
7. **Lokalna kopia po usunięciu konta** zostaje w pliku `organizer-<userId>.db` do usunięcia aplikacji (`src/app/wiring.ts:65`;
   „Wyczyść dane na telefonie” zostawia klucze `local:*`, `src/data/store.ts:94-101`). Opisane w polityce. Czy kasować ją przy usunięciu konta?
8. **Imię i nazwisko z Apple (`full_name`)** zostaje w metadanych konta także po zmianie imienia w aplikacji
   (`setMyName` zmienia tylko `display_name`, `src/sync/supabase.ts:99-103`). Usuwane z kontem. Czy w ogóle zapisywać nazwisko?
9. **Adres e-mail przy logowaniu przez Apple** i dzienniki platformy (adresy IP, logi zapytań i logowania) przechowuje
   Supabase Auth i Supabase według własnych zasad. Nasz kod tego nie konfiguruje, więc w polityce nie podałem terminów.
   Do sprawdzenia w dokumentacji Supabase przed publikacją.
10. **Lustro kalendarza na iCloud / Google:** kalendarze „Organizer” powstają na koncie domyślnego kalendarza
    (`src/app/device-calendar.ts:69-71`, komentarz: „zwykle iCloud”). Wydarzenia grup trafiają więc do tego dostawcy.
    Napisałem to wprost. Do akceptu.
11. **Opis zgody „tylko zapis” w `app.json:25`** („Nie odczytuje kalendarza”) jest prawdziwy tylko dla „Dodaj do kalendarza”
    bez połączenia. Przy pełnym połączeniu iOS pokazuje opis z `app.json:39`. Zostawiam bez zmian, tylko informuję.

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
