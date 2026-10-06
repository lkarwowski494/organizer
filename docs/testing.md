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
| Każda zmiana (push, PR) | typy, lint (0 ostrzeżeń), testy jednostkowe + własności + korpusy, pokrycie z progami, testy kontraktowe, Deno check/lint funkcji, aktualność korpusów, skan sekretów | `ci.yml`, Linux | ~2–5 min |
| Zmiana w `supabase/**` | migracje od zera, pgTAP (RLS, sync, triggery), kontrakt config ↔ SQL | `db.yml`, Linux (od Etapu 1) | ~5–10 min |
| Każdy push na `main` | E2E Maestro na symulatorze iOS | `e2e.yml`, macOS (od pierwszego ekranu) | ~20–40 min |
| Co noc | testy mutacyjne, pełny skan historii, audyt zależności; dalej: zrzuty ekranu, wydajność, długie symulacje synchronizacji, E2E na najmniejszym iPhonie i dużej czcionce | `nightly.yml` | ~30–60 min |
| Przed wydaniem do TestFlight | wszystko powyżej zielone na tym commicie | `ios-release.yml` (bramka) | — |

## Progi (D47 — maksymalne w logice)
| Obszar | Próg | Narzędzie |
|---|---|---|
| `src/domain`, `src/config` | 100% linii, gałęzi, funkcji, instrukcji | Jest `coverageThreshold` (`npm run test:coverage`) |
| `src/domain`, `src/config` | ≥ 90% wykrytych celowych usterek (mutation score) | Stryker (`npm run test:mutation`, nocą) |
| `src/sync`, `src/data` (od Etapu 1) | jak domena: 100% + ≥ 90% mutacji | Jest + Stryker |
| SQL (od Etapu 1) | każda tabela × rola × operacja w macierzy RLS; każda funkcja RPC z testem sukcesu i każdego kodu odrzucenia | pgTAP |
| Ekrany | każdy ekran ma test RNTL; każda funkcja ma scenariusz E2E | RNTL, Maestro |
| Lint | 0 ostrzeżeń | ESLint `--max-warnings 0` |
| Zależności | 0 nowych zgłoszeń high/critical względem `scripts/audit-baseline.json` | `npm run check:audit` (nocą) |

## Warstwy testów według aspektu
| Aspekt | Warstwa | Status |
|---|---|---|
| Logika domeny | testy przykładów + własności (fast-check) | ✅ |
| Wiedza dziedzinowa (język, kalendarz) | korpusy z **niezależną** implementacją oczekiwań (np. `scripts/gen-quickadd-corpus.py`, Python `datetime`) — test różnicowy | ✅ parser dat |
| Jakość samych testów | testy mutacyjne (Stryker) | ✅ nocą |
| Pokrycie | progi 100% w logice | ✅ |
| Jedno źródło prawdy | testy kontraktowe: `app.json` ↔ `src/config` ✅; `src/config` ↔ funkcje `private.*` w SQL | Etap 1 |
| Synchronizacja | symulator wielu klientów (fast-check, model-based): zbieżność, brak zgubionych operacji, idempotencja, utrata dostępu, zerwana / zduplikowana / opóźniona sieć | Etap 1 |
| Uprawnienia (RLS) | pgTAP: macierz ról (owner/admin/member/child/obcy) × tabela × odczyt/zapis/usunięcie; przecieki list `restricted` przez pull, aktywność i treść pusha | Etap 1 |
| Migracje | od zera; z każdej wydanej wersji schematu SQLite (zrzuty baz) | Etap 1 |
| Funkcje serwerowe (Edge) | `deno check` + `deno lint` ✅; testy jednostkowe w Deno; testy z udawanym APNs | częściowo |
| Ekrany | RNTL: zachowanie przez role i etykiety (wymusza dostępność) | od pierwszego ekranu |
| Dostępność | etykiety VoiceOver w RNTL; E2E przy największej czcionce Dynamic Type; kontrast kolorów w testach motywu | od pierwszego ekranu |
| Wygląd | porównanie zrzutów ekranu z symulatora (najmniejszy i największy wspierany iPhone, jasny/ciemny) | od pierwszego ekranu, nocą |
| Przepływy użytkownika | Maestro na symulatorze iOS: onboarding, szybkie dodanie, wspólna lista, wydarzenie cykliczne z przypiętym zadaniem, offline → online | od pierwszego ekranu |
| Teksty | brak tekstów poza `strings.pl.ts` (lint); odmiana przez `plural()` | od pierwszego ekranu |
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

## Stan na 6.10.2026
524 testy, pokrycie logiki 100%, mutation score 94,1% (próg 90%). Baza audytu: 2 zgłoszenia
(`braces`, `node-forge`) w narzędziach Expo/Jest, nie w kodzie aplikacji.
