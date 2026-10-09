# Limity darmowych planów i progi ostrzeżeń

Wartości progów: `src/config/index.ts` → `config.limits` (jedno źródło prawdy; kolumna „Próg” podaje klucz, nie liczbę).
Ta tabela opisuje źródła limitów. Nocny pomiar (D185, sekcja niżej) działa od 9.10.2026, ale mierzy dopiero po dodaniu
sekretu `SUPABASE_MONITOR_TOKEN`; bez sekretu niczego nie mierzy ani nie podtrzymuje projektu (od
`config.limits.monitorSecretRequiredFrom` nocny przebieg jest wtedy czerwony). Egress i Realtime API nie podaje — te
zasoby sprawdza człowiek raz w miesiącu. Limity sprawdzone 5–6.10.2026 (Supabase ponownie 8.10.2026, GitHub
i TestFlight 9.10.2026); przed każdą zmianą planu sprawdź ponownie.

| Zasób | Limit | Próg | Źródło |
|---|---|---|---|
| Baza Supabase | 500 MB | `supabaseDbBytesWarn` | https://supabase.com/pricing |
| Transfer Supabase | 5 GB/mies. | `supabaseEgressBytesPerMonthWarn` | https://supabase.com/pricing |
| Wiadomości Realtime | 2 mln/mies. | `realtimeMessagesPerMonthWarn` | https://supabase.com/pricing |
| Połączenia Realtime | 200 | `realtimeConcurrentConnectionsWarn` | https://supabase.com/pricing |
| Wywołania Edge Functions | 500 tys./mies. | `edgeFunctionInvocationsPerMonthWarn` | https://supabase.com/pricing; https://supabase.com/docs/guides/functions/pricing. Szacunek D159: prośba o ciche powiadomienia to jedno wywołanie na serię zmian (30 s ciszy albo wyjście z aplikacji) i ewentualne ponowienie; rodzina 4 osób po ~20 serii dziennie ≈ 80–160/dzień ≈ 2,5–5 tys./mies. (≤ 1% limitu), 50 rodzin ≈ 250 tys. |
| Pauza projektu | po 1 tygodniu bezczynności | `supabaseIdleDaysWarn` | https://supabase.com/pricing |
| E-maile logowania | 2/h (wbudowany SMTP) | nie dotyczy w becie: logowanie e-mailem wyłączone (D177), dostawca Email do wyłączenia w Supabase (O-110) | https://supabase.com/docs/guides/auth/rate-limits |
| GitHub Actions — repo prywatne | 2000 min/mies. (GitHub Free: „Minutes (per month) … 2,000”); strona nie podaje już mnożnika dla macOS, tylko stawkę za minutę | każdy job macOS w repo prywatnym (repo jest publiczne od 6.10.2026 — wiersz historyczny) | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| GitHub Actions — repo publiczne | standardowe runnery bez opłat: „GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners” | — | jw. |
| Cache Actions | 10 GB/repo | `actionsCacheBytesWarn` | https://docs.github.com/en/actions/reference/limits |
| Artefakty Actions | 500 MB (GitHub Free: „Artifact storage … 500 MB”, wspólne z GitHub Packages); czy dotyczy repo publicznego — do potwierdzenia: strona mówi, że limity dostaje się „For private repositories”, a użycie repo publicznego jest „free”, ale nie wymienia osobno miejsca na artefakty | `actionsArtifactsBytesWarn` (mierzony nocą); E2E trzyma artefakty 7 dni nocą i ręcznie, 2 dni przy push i PR | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Build TestFlight | wygasa po 90 dniach: „Internal testers can download and test all builds for 90 days” | `testflightBuildAgeDaysWarn` | https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers |
| Token `organizer-match` (fine-grained PAT) | wygasa po 1 roku od utworzenia (6.10.2026) | 30 dni przed wygaśnięciem | ustawienie właściciela |
| Ciche pushe | 2–3/h zalecane | serwer wysyła do urządzenia najwyżej jedno na `config.wake.MIN_GAP_MIN` minut (D159) — bez osobnego progu | https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app |

## Limity na konto i retencja (audyt 2, D183, D184, 8.10.2026)
Żeby jedno konto nie zapełniło bazy Free ani nie wyczerpało Realtime i Edge Functions, serwer egzekwuje twarde limity
(`config.quotas`, test kontraktowy z `private.max_*()`; migracja `20261008482000_quotas.sql`): 50 grup wspólnych (także
w koszu), 20 aktywnych zaproszeń na grupę, 10 tokenów push (nadmiarowy najstarszy wypada), 20 instalacji (jw.),
120 wywołań `sync_push` na minutę, 120 próśb o powiadomienie na godzinę. Wartości to wybory projektowe z zapasem nad zwykłym
użyciem, bez źródła zewnętrznego. Codzienne sprzątanie (`call private.run_daily_maintenance()`, pg_cron 03:17 UTC) trzyma
dane w granicach z `config.retention` (historia 90 dni, zrobione zakupy 90, rozstrzygnięte przekazania 90, zaproszenia 30 po wygaśnięciu,
dziennik dostępu 30, instalacje 180). Wynik każdego przebiegu: `private.maintenance_runs`; problem (pominięta grupa,
przebieg niedokończony) — wpis `kind = 'diagnostic'`, `screen = 'daily_maintenance'` w `public.client_errors`.

## Nocny pomiar i podtrzymanie projektu (D185, audyt 2 M-78)
Zadanie `free-limits` w `nightly.yml` (`.github/scripts/free-limits.mjs`) co noc: mierzy rozmiar bazy (zapytanie
tylko do odczytu przez Supabase Management API — to samo zapytanie podtrzymuje projekt Free przed uśpieniem po tygodniu
bez ruchu), wywołania Edge Functions z ostatnich 24 h (× 30 — szacunek miesiąca; API logów przyjmuje najwyżej 24 h)
oraz pamięć podręczną i artefakty Actions; porównuje je z progami `config.limits`. Próg przekroczony albo pomiar
nieudany oblewa zadanie (GitHub wysyła powiadomienie o nieudanym nocnym przebiegu). Ruchu wychodzącego (egress)
i wiadomości Realtime API nie podaje — sprawdzaj je ręcznie raz w miesiącu na stronie zużycia organizacji w panelu
Supabase (Usage); pierwszego dnia miesiąca nocny przebieg przypomina o tym ostrzeżeniem.

**Sekret `SUPABASE_MONITOR_TOKEN`** (audyt 3, N-83 i N-85). Dopóki go nie ma, zadanie niczego nie mierzy i nie podtrzymuje
projektu: do dnia `config.limits.monitorSecretRequiredFrom` kończy się ostrzeżeniem, od tego dnia błędem (czerwony nocny
przebieg). Kroki właściciela:
1. Supabase → Account → Access Tokens → nowy **token z zakresem** (scoped, nie „Legacy”), nazwa np. „organizer-limits”,
   z datą wygaśnięcia: tylko projekt `organizer`, uprawnienia **Database → Read** (zapytanie o rozmiar bazy przez
   `database/query/read-only`, w specyfikacji API zakres `database:read`) i **Logs → Read** (wywołania Edge Functions
   przez `analytics/endpoints/logs`, zakres `analytics:read`, https://api.supabase.com/api/v1-json); nic więcej. Supabase:
   „A classic PAT, shown as Legacy in the dashboard, carries the same privileges as your user account … Prefer scoped
   PATs” (https://supabase.com/docs/reference/api/introduction); tabela uprawnień endpointów:
   https://supabase.com/docs/guides/platform/personal-access-tokens.
2. GitHub → Settings → Environments → New environment `monitor` → Deployment branches and tags: **Selected branches
   and tags**, reguła `main` (bez zatwierdzania). Środowisko trzeba założyć przed pierwszym przebiegiem z
   `environment: monitor` — inaczej GitHub utworzy je sam, bez reguły gałęzi.
3. W środowisku `monitor` → Environment secrets → `SUPABASE_MONITOR_TOKEN` (sekret środowiska, nie repozytorium:
   przebieg z innej gałęzi niż main go nie dostanie).

Używa go tylko krok pomiaru (zmienna na poziomie kroku, skrypt jej nie wypisuje). Token wygasa — przypomnienie jak przy
`organizer-match` (30 dni wcześniej).
