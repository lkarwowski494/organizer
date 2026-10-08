# Strategia testów — Organizer

Decyzja właściciela (6.10.2026): każda funkcja testowana automatycznie w najszerszym możliwym zakresie,
pod każdym względem. Ustalenia D46 (kiedy co się uruchamia) i D47 (progi) — rejestr decyzji.

## Zasada
Funkcja jest „zrobiona” dopiero wtedy, gdy ma testy we **wszystkich warstwach, które jej dotyczą**
(tabela niżej), progi są spełnione, a CI jest zielone. Brak warstwy wymaga jawnego uzasadnienia w PR/commicie.
Błąd znaleziony ręcznie albo przez użytkownika najpierw dostaje test, który go odtwarza, dopiero potem poprawkę.

## Kiedy co się uruchamia (D46 — hybryda)
| Moment | Co | Gdzie | Czas |
|---|---|---|---|
| Każda zmiana (push, PR) | typy, lint (0 ostrzeżeń), testy jednostkowe + własności + korpusy, pokrycie z progami, testy kontraktowe, Deno check/lint funkcji, aktualność korpusów parsera dat i kontrastu (`check:corpus`; korpusy RRULE i świąt generuje się ręcznie, wymagają python-dateutil), skan sekretów | `ci.yml`, Linux | ~2–5 min |
| Zmiana w `supabase/**` | migracje od zera, pgTAP (RLS, sync, triggery), kontrakt config ↔ SQL | `db.yml`, Linux | ~5–10 min |
| Każdy push na `main` | E2E Maestro na symulatorze iOS — **planowane, niezaimplementowane** (brak `e2e.yml` i scenariuszy; pozycja otwarta w backlogu, wymaga decyzji o minutach macOS) | `e2e.yml`, macOS | ~20–40 min |
| Co noc | testy mutacyjne, pełny skan historii, audyt zależności (działa); zrzuty ekranu, wydajność, długie symulacje synchronizacji, E2E na najmniejszym iPhonie i dużej czcionce — **planowane, niezaimplementowane** | `nightly.yml` | ~30–60 min |
| Przed wydaniem do TestFlight | `npm run check` na tym commicie (to samo co `ci.yml`, bez testów bazy, nocnych i E2E) | `ios-release.yml` (bramka) | — |

## Progi (D47 — maksymalne w logice)
| Obszar | Próg | Narzędzie |
|---|---|---|
| `src/domain`, `src/config`, `src/sync`, `src/data` | 100% linii, gałęzi, funkcji, instrukcji | Jest `coverageThreshold` (`npm run test:coverage`) |
| `src/domain`, `src/config`, `src/sync`, `src/data` | ≥ 90% wykrytych celowych usterek (mutation score) | Stryker (`npm run test:mutation`, nocą) |
| SQL | każda tabela × rola × operacja w macierzy RLS; każda funkcja RPC z testem sukcesu i każdego kodu odrzucenia | pgTAP |
| Ekrany | każdy ekran ma test RNTL (`src/app/__tests__/*.screens.test.tsx`); każda funkcja ma scenariusz E2E — E2E planowane, niezaimplementowane | RNTL, Maestro |
| Lint | 0 ostrzeżeń | ESLint `--max-warnings 0` |
| Zależności | 0 nowych zgłoszeń high/critical względem `scripts/audit-baseline.json` | `npm run check:audit` (nocą) |

## Warstwy testów według aspektu
| Aspekt | Warstwa | Status |
|---|---|---|
| Logika domeny | testy przykładów + własności (fast-check) | ✅ |
| Wiedza dziedzinowa (język, kalendarz) | korpusy z **niezależną** implementacją oczekiwań (`scripts/gen-quickadd-corpus.py`, `gen-rrule-corpus.py` — python-dateutil, `gen-holidays-corpus.py`, `gen-contrast-corpus.py`) — test różnicowy | ✅ parser dat, RRULE, święta, kontrast |
| Jakość samych testów | testy mutacyjne (Stryker) | ✅ nocą |
| Pokrycie | progi 100% w logice | ✅ |
| Jedno źródło prawdy | testy kontraktowe w `src/config/__tests__`: `app.json` ↔ `src/config`, `src/config` ↔ funkcje `private.*` w SQL, strona `site/` ↔ config | ✅ |
| Synchronizacja | symulator wielu klientów (fast-check, model-based): zbieżność, brak zgubionych operacji, idempotencja, utrata dostępu, zerwana / zduplikowana / opóźniona sieć (`sync-sim.test.ts`; telefony na prawdziwym SQL: `tests/db/phones-vs-sql.test.ts`) | ✅ |
| Uprawnienia (RLS) | pgTAP: macierz ról (owner/admin/member/child/obcy) × tabela × odczyt/zapis/usunięcie; przecieki list `restricted` przez pull, aktywność i treść pusha (`supabase/tests/*.test.sql`, w tym `role_matrix`) | ✅ (`db.yml`) |
| Migracje | SQL: od zera i z danymi sprzed migracji (`scripts/db/upgrade-*.sql`); SQLite na telefonie: kolejne wersje w `src/data/db/migrations.ts` (`store.test.ts`) | ✅ |
| Funkcje serwerowe (Edge) | `deno check` + `deno lint` + `deno test` (`*_test.ts`, z udawanym APNs i API Apple) | ✅ |
| Ekrany | RNTL: zachowanie przez role i etykiety (wymusza dostępność) | ✅ |
| Dostępność | etykiety VoiceOver w RNTL ✅; kontrast kolorów w testach motywu ✅; E2E przy największej czcionce Dynamic Type — planowane, niezaimplementowane | częściowo |
| Wygląd | porównanie zrzutów ekranu z symulatora (najmniejszy i największy wspierany iPhone, jasny/ciemny) | planowane, niezaimplementowane (otwarte w backlogu) |
| Przepływy użytkownika | Maestro na symulatorze iOS: onboarding, szybkie dodanie, wspólna lista, wydarzenie cykliczne z przypiętym zadaniem, offline → online | planowane, niezaimplementowane (otwarte w backlogu) |
| Teksty | wszystkie teksty w `strings.pl.ts`, odmiana przez `plural()` — pilnowane przeglądem kodu; reguły lint na teksty poza `strings.pl.ts` nie ma | częściowo |
| Wydajność | czas startu, rozwijanie 50 serii RRULE × 5 lat, lista 1 000 pozycji — progi w `src/config` | nocą, od Etapu 2 |
| Bezpieczeństwo | gitleaks przy każdej zmianie i na pełnej historii ✅; audyt zależności ✅; reguły workflow (bez `pull_request_target`, akcje przypięte do SHA) | ✅ |
| Prywatność | test, że raport błędów `client_errors` nie zawiera danych osobowych; brak SDK firm trzecich (lista dozwolonych zależności) | Etap 6 |

## Polecenia
```bash
npm run check           # wszystko szybkie: typy, lint, testy z progami pokrycia, funkcje Deno, korpusy
npm run test:mutation   # testy mutacyjne (ok. 2–3 min lokalnie)
npm run check:audit     # nowe podatności w zależnościach
python3 -I scripts/gen-quickadd-corpus.py > src/domain/__tests__/fixtures/quickadd.pl.json  # po zmianie reguł D42–D45
```

## Stan na 8.10.2026
`npm run check`: 2094 testy Jest (2090 przechodzi, 4 pominięte — testy na prawdziwym Postgresie bez `PGHOST`; uruchamia je
`npm run test:db` i `db.yml`) plus 11 testów Deno; pokrycie logiki 100%. Mutation score: ostatni pomiar 94,1% (6.10.2026,
próg 90%, nocny przebieg). Baza audytu z 6.10.2026: 2 zgłoszenia (`braces`, `node-forge`) w narzędziach Expo/Jest,
nie w kodzie aplikacji. Nie ma jeszcze: E2E (Maestro), porównania zrzutów ekranu, testów wydajności — planowane,
otwarte w backlogu.
