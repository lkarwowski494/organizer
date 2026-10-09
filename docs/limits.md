# Limity darmowych planów i progi ostrzeżeń

Wartości progów: `src/config/index.ts` → `config.limits` (jedno źródło prawdy). Ta tabela opisuje źródła.
Sprawdzone 5–6.10.2026; przed każdą zmianą planu sprawdź ponownie.

| Zasób | Limit | Próg | Źródło |
|---|---|---|---|
| Baza Supabase | 500 MB | 350 MB | https://supabase.com/pricing |
| Transfer Supabase | 5 GB/mies. | 3,5 GB | https://supabase.com/pricing |
| Wiadomości Realtime | 2 mln/mies. | 1,4 mln | https://supabase.com/pricing |
| Połączenia Realtime | 200 | 140 | https://supabase.com/pricing |
| Wywołania Edge Functions | 500 tys./mies. | 350 tys. | https://supabase.com/pricing; https://supabase.com/docs/guides/functions/pricing. Szacunek D159: prośba o ciche powiadomienia to jedno wywołanie na serię zmian (30 s ciszy albo wyjście z aplikacji) i ewentualne ponowienie; rodzina 4 osób po ~20 serii dziennie ≈ 80–160/dzień ≈ 2,5–5 tys./mies. (≤ 1% limitu), 50 rodzin ≈ 250 tys. |
| Pauza projektu | po 1 tygodniu bezczynności | 5 dni bez ruchu | https://supabase.com/pricing |
| E-maile logowania | 2/h (wbudowany SMTP) | nie dotyczy w becie: logowanie e-mailem wyłączone (D177), dostawca Email do wyłączenia w Supabase (O-110) | https://supabase.com/docs/guides/auth/rate-limits |
| GitHub Actions — repo prywatne | 2000 min/mies., macOS ×10 | każdy job macOS w repo prywatnym | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| GitHub Actions — repo publiczne | standardowe runnery bez opłat | — | jw. |
| Cache Actions | 10 GB/repo | 8 GB | https://docs.github.com/en/actions/reference/limits |
| Build TestFlight | wygasa po 90 dniach | 80 dni | https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers |
| Token `organizer-match` (fine-grained PAT) | wygasa po 1 roku od utworzenia (6.10.2026) | 30 dni przed wygaśnięciem | ustawienie właściciela |
| Ciche pushe | 2–3/h zalecane | > 2/h na urządzenie | https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app |

## Limity na konto i retencja (audyt 2, D183, D184, 8.10.2026)
Żeby jedno konto nie zapełniło bazy Free ani nie wyczerpało Realtime i Edge Functions, serwer egzekwuje twarde limity
(`config.quotas`, test kontraktowy z `private.max_*()`; migracja `20261008482000_quotas.sql`): 50 grup wspólnych (także
w koszu), 20 aktywnych zaproszeń na grupę, 10 tokenów push (nadmiarowy najstarszy wypada), 20 instalacji (jw.),
120 wywołań `sync_push` na minutę, 120 próśb o powiadomienie na godzinę. Wartości to wybory projektowe z zapasem nad zwykłym
użyciem, bez źródła zewnętrznego. Codzienne sprzątanie (`call private.run_daily_maintenance()`, pg_cron 03:17 UTC) trzyma
dane w granicach z `config.retention` (historia 90 dni, zrobione zakupy 90, rozstrzygnięte przekazania 90, zaproszenia 30 po wygaśnięciu,
dziennik dostępu 30, instalacje 180). Wynik każdego przebiegu: `private.maintenance_runs`; problem (pominięta grupa,
przebieg niedokończony) — wpis `kind = 'diagnostic'`, `screen = 'daily_maintenance'` w `public.client_errors`.
