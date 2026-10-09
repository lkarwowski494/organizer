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
| Każda zmiana (push, PR) | typy, lint (0 ostrzeżeń), testy jednostkowe + własności + korpusy, pokrycie z progami, testy kontraktowe, Deno check/lint funkcji, aktualność korpusów parsera dat i kontrastu (`check:corpus`; korpusy RRULE, następnego terminu zadania (`gen-nextdue-corpus.py`) i świąt generuje się ręcznie, wymagają python-dateutil), skrypty CI i kontrakty workflow (`node --test ".github/scripts/*.test.mjs"`), skan sekretów z testem reguł | `ci.yml`, Linux | ~2–5 min |
| Zmiana w `supabase/**`, `scripts/db/**`, `tests/db/**` albo w kodzie, który te testy importują (`src/domain/**`, `src/config/**` — testy reguł i podziału serii importują widoki domeny; pilnuje tego kontrakt w `.github/scripts/ci-scripts.test.mjs`); co noc; ręcznie | migracje od zera, pgTAP (RLS, sync, triggery), kontrakt config ↔ SQL, telefony i FakeServer na prawdziwym SQL (`tests/db`) | `db.yml`, Linux | ~5–25 min |
| Każdy push na `main`, PR z tego repozytorium i ręcznie (D143; PR z forka — tylko składnia scenariuszy, decyzja właściciela 8.10.2026, M-79) | E2E Maestro na symulatorze iOS (build z `EXPO_PUBLIC_E2E=1`, scenariusze `.maestro/`), zrzuty ekranu porównane z wzorcami — różnica tylko w podsumowaniu przebiegu; wcześniej składnia scenariuszy na Linuksie | `e2e.yml`, macOS (standardowy runner, w repo publicznym bez opłat) | ~30–50 min |
| Co noc | testy mutacyjne w 8 równoległych częściach z progiem liczonym na całości, pełny skan historii, audyt zależności (`nightly.yml`); testy bazy (`db.yml`); E2E z porównaniem zrzutów, które **oblewa** przebieg przy różnicy (`e2e.yml`, harmonogram); wydajność, długie symulacje synchronizacji, E2E na najmniejszym iPhonie, w ciemnym wyglądzie i przy dużej czcionce — **planowane, niezaimplementowane** | `nightly.yml`, `db.yml`, `e2e.yml` | ~30–60 min |
| Przed wdrożeniem bazy i funkcji | zadanie `gate` bez sekretów i bez środowiska: zielone `ci.yml` i `db.yml` dla tego samego commitu na `main` (`.github/scripts/require-green-runs.sh`; trwający przebieg poczeka); sekrety tylko w krokach CLI, hasło bazy przez `SUPABASE_DB_PASSWORD` (audyt 2, M-155) | `supabase-deploy.yml` (bramka) | do 30 min czekania |
| Przed wydaniem do TestFlight | zadanie `gate` na Linuksie, bez sekretów: commit z `main` (tag `v*` na commicie spoza `main` odrzucony, M-193) i zielony `db.yml` dla tego commitu (decyzja właściciela 8.10.2026, PWD-40 A); potem `npm run check` na tym commicie. E2E na razie tylko informacyjnie; **następny krok, jeszcze niewdrożony:** po tygodniu zielonych przebiegów `e2e.yml` także on będzie warunkiem wydania | `ios-release.yml` (bramka) | do 30 min czekania |

## Progi (D47 — maksymalne w logice)
| Obszar | Próg | Narzędzie |
|---|---|---|
| `src/domain`, `src/config`, `src/sync`, `src/data` | 100% linii, gałęzi, funkcji, instrukcji | Jest `coverageThreshold` (`npm run test:coverage`) |
| `src/domain`, `src/config`, `src/sync`, `src/data` | ≥ 90% wykrytych celowych usterek (mutation score) | Stryker (`npm run test:mutation`; nocą w częściach, próg na scalonym wyniku: `.github/scripts/mutation-merge.mjs`) |
| SQL | każda tabela × rola × operacja w macierzy RLS; każda funkcja RPC z testem sukcesu i każdego kodu odrzucenia | pgTAP |
| Ekrany | każdy ekran ma test RNTL (`src/app/__tests__/*.screens.test.tsx`); każda funkcja ma scenariusz E2E — na razie 6 scenariuszy (lista niżej), pozostałe funkcje do uzupełnienia | RNTL, Maestro |
| Lint | 0 ostrzeżeń | ESLint `--max-warnings 0` |
| Zależności | 0 nowych zgłoszeń high/critical względem `scripts/audit-baseline.json` | `npm run check:audit` (nocą) |

## Warstwy testów według aspektu
| Aspekt | Warstwa | Status |
|---|---|---|
| Logika domeny | testy przykładów + własności (fast-check) | ✅ |
| Wiedza dziedzinowa (język, kalendarz) | korpusy z **niezależną** implementacją oczekiwań (`scripts/gen-quickadd-corpus.py`, `gen-rrule-corpus.py` i `gen-nextdue-corpus.py` — python-dateutil, `gen-holidays-corpus.py`, `gen-contrast-corpus.py`) — test różnicowy | ✅ parser dat, RRULE, święta, kontrast |
| Jakość samych testów | testy mutacyjne (Stryker, tylko z testami logiki — `jest.mutation.config.js`); nocą 8 części (`.github/scripts/mutation-shards.mjs`, `stryker.shard.config.mjs`), wynik i próg ze scalonych raportów (ta sama funkcja wyniku co w Strykerze) | częściowo: od 8.10.2026 nocny pomiar się nie kończył (audyt 2, M-47); pierwszy przebieg w częściach do sprawdzenia |
| Pokrycie | progi 100% w logice | ✅ |
| Jedno źródło prawdy | testy kontraktowe w `src/config/__tests__`: `app.json` ↔ `src/config`, `src/config` ↔ funkcje `private.*` w SQL, strona `site/` ↔ config | ✅ |
| Synchronizacja | symulator wielu klientów (fast-check, model-based): zbieżność, brak zgubionych operacji, idempotencja, utrata dostępu, zerwana / zduplikowana / opóźniona sieć; od audytu 2 także czyszczenie kosza z resync porcjami, role i ich zmiana (dziecko), zawężenie widoczności listy i przeniesienie zadania do ukrytej listy, powrót do grupy, ponowne uruchomienie telefonu (stan z SQLite, także z wyzerowanymi kursorami), odrzucenie po zgubionej odpowiedzi, odtworzenie telefonu z kopii iCloud, nieudane pobranie udostępnionej listy, generatory kopii powtórzeń na widoku telefonu (kopia odrzucona nie wraca); każda pętla „do ciszy” ma górną granicę obrotów, a statystyka pilnuje, że te sytuacje naprawdę zachodzą (`sync-sim.test.ts`; model = SQL: `tests/db/fake-vs-sql.test.ts`; telefony na prawdziwym SQL z czyszczeniem kosza i zmianą roli: `tests/db/phones-vs-sql.test.ts`; protokół 2 w pgTAP: `supabase/tests/sync_protocol_v2.test.sql`) | ✅ |
| Uprawnienia (RLS) | pgTAP: macierz ról (owner/admin/member/child/obcy) × tabela × odczyt/zapis/usunięcie; przecieki list `restricted` przez pull, aktywność i treść pusha (`supabase/tests/*.test.sql`, w tym `role_matrix`) | ✅ (`db.yml`) |
| Migracje | SQL: od zera i z danymi sprzed migracji (`scripts/db/upgrade-*.sql`); SQLite na telefonie: kolejne wersje w `src/data/db/migrations.ts` (`store.test.ts`) | ✅ |
| Funkcje serwerowe (Edge) | `deno check` + `deno lint` + `deno test` (`*_test.ts`, z udawanym APNs i API Apple) | ✅ |
| Ekrany | RNTL: zachowanie przez role i etykiety (wymusza dostępność) | ✅ |
| Dostępność | etykiety VoiceOver w RNTL ✅; ogłoszenia i przenoszenie fokusu VoiceOvera — wywołania atrapy `AccessibilityInfo` (`voiceover.screens.test.tsx`) ✅; kontrast kolorów w testach motywu ✅; E2E przy największej czcionce Dynamic Type — planowane, niezaimplementowane | częściowo |
| Wygląd | porównanie zrzutów ekranu z symulatora piksel po pikselu (`scripts/e2e/compare-screenshots.mjs`, pixelmatch) z wzorcami `.maestro/baselines/` | **jeszcze nie działa**: wzorców brak, a żaden przebieg E2E na macOS się nie skończył (8.10.2026); najpierw iPhone 17 w jasnym wyglądzie, warianty — decyzja właściciela |
| Przepływy użytkownika | Maestro na symulatorze iOS (`.maestro/`): „Moje sprawy” z danymi, szybkie dodanie na jutro, obecność na wydarzeniu cyklicznym, nowe wydarzenie z kafelkami godzin, lista zakupów, Ustawienia | częściowo ✅; onboarding, przypięte zadanie, offline → online — planowane |
| Teksty | wszystkie teksty w `strings.pl.ts`, odmiana przez `plural()` — pilnowane przeglądem kodu; reguły lint na teksty poza `strings.pl.ts` nie ma | częściowo |
| Wydajność | czas startu, rozwijanie 50 serii RRULE × 5 lat, lista 1 000 pozycji — progi w `src/config` | nocą, od Etapu 2 |
| Bezpieczeństwo | gitleaks przy każdej zmianie i na pełnej historii ✅, reguły projektu (klucz `.p8`, `service_role`, `sb_secret_`, token dostępu `sbp_`) sprawdzane na fałszywych sekretach tworzonych w czasie testu (`.github/scripts/test-gitleaks-rules.sh`) ✅; audyt zależności ✅; reguły workflow (bez `pull_request_target`, akcje przypięte do SHA; kontrakty: `e2e-flag.test.ts`, `.github/scripts/*.test.mjs`) | ✅ |
| Prywatność | test, że raport błędów `client_errors` nie zawiera danych osobowych; brak SDK firm trzecich (lista dozwolonych zależności) | Etap 6 |

## Polecenia
```bash
npm run check           # wszystko szybkie: typy, lint, testy z progami pokrycia, funkcje Deno, korpusy
npm run test:mutation   # testy mutacyjne naraz (tylko projekt „domain”; 8.10.2026 — kilka godzin, nocą w częściach)
npx stryker run stryker.shard.config.mjs --mutate "$(node .github/scripts/mutation-shards.mjs 0 8)"  # jedna z 8 nocnych części
node --test ".github/scripts/*.test.mjs"   # skrypty CI i kontrakty workflow
.github/scripts/test-gitleaks-rules.sh     # reguły .gitleaks.toml (gitleaks w PATH albo GITLEAKS=…, jq)
npm run check:audit     # nowe podatności w zależnościach
python3 -I scripts/gen-quickadd-corpus.py > src/domain/__tests__/fixtures/quickadd.pl.json  # po zmianie reguł D42–D45
```

## E2E i zrzuty ekranu (D143)
**Jak to działa.** `e2e.yml` buduje aplikację dla symulatora z flagą `EXPO_PUBLIC_E2E=1`. Wtedy `appDeps()` w
`src/app/wiring.ts` podaje korzeniowi aplikacji atrapy z `src/app/e2e.ts` zamiast Supabase i modułów natywnych:
zalogowana osoba demo, „serwer” w pamięci z semantyką `sync_push`/`sync_pull` (wersje grup, kursory, duplikaty),
świeża baza SQLite w pamięci przy każdym starcie, zegar od środy 7.10.2026 08:00 UTC (dalej płynie), wyłączone
powiadomienia, kalendarz bez zapisu, bez dojazdu, wprowadzenie i „Co nowego” już obejrzane. Dane demo: grupa
osobista i „Rodzina” (ja i Ala — dorośli, Kuba — profil dziecka bez konta), zadania, cotygodniowy „Basen Kuby” (środa
17:00–18:00) i lista „Zakupy”. Ekrany, pętla synchronizacji i baza działają naprawdę — atrapy mają tylko sieć i system.

**Bezpieczeństwo flagi.** (1) Ustawia ją wyłącznie krok buildu w `e2e.yml` (i `scripts/e2e/build-ios.sh`); test
kontraktowy `src/app/__tests__/e2e-flag.test.ts` oblewa CI, jeśli flaga pojawi się w `ios-release.yml`, fastlane,
`app.json`, `eas.json`, `package.json` albo plikach `.env*`, oraz pilnuje zasad workflow (bez `pull_request_target`,
akcje przypięte do SHA, `contents: read`). (2) Nawet z flagą sesja demo powstaje tylko na symulatorze
(`Application.getIosApplicationReleaseTypeAsync() === SIMULATOR`); na telefonie zostaje ekran logowania bez działającego
logowania. Artefakt `e2e.yml` (decyzja właściciela 8.10.2026, M-79): zrzuty scenariuszy, obrazy różnic, zrzuty z chwili
błędu Maestro, opis symulatora i 200 ostatnich wierszy logu xcodebuild bez wierszy `export` — bez pełnego logu, raportu
i logów Maestro, nigdy plik `.app`; 7 dni. Zadanie macOS nie rusza dla PR z forka (tylko składnia scenariuszy).

**Scenariusze** (`.maestro/`, każdy od czystej instalacji przez `common/launch.yaml`, kończy się `takeScreenshot`):
`01-today` (dane demo na „Moich sprawach”), `02-quick-add` („Kupić mleko jutro” widać jutro), `03-event-rsvp` („Będę”
na wydarzeniu cyklicznym), `04-event-form` (nowe wydarzenie, kafelki `event-start-0-h-18` / `-m-30` z `TimeField`),
`05-shopping` (produkt do listy i do koszyka — bez pytania, z paskiem „Cofnij”, D59), `06-settings`, `07-keyboard` (pole „Wpisz USUŃ” na dole ekranu nad klawiaturą, audyt 2 M-41). Selektory: `id` = `testID`, tekst =
etykieta VoiceOver (wyrażenie regularne w całości; na iOS wiersz to jeden element). Te same kroki na RNTL przechodzi
`src/app/__tests__/e2e.screens.test.tsx` w zwykłym CI — błąd w danych demo, tekstach albo `testID` wychodzi od razu,
bez macOS. Nowy scenariusz: plik `NN-opis.yaml`, kroki dopisane też w tym teście, `npm run e2e:check`.

**Uruchomienie lokalnie** (Mac z Xcode 26.4+, Java 17+):
```bash
scripts/e2e/install-maestro.sh                          # Maestro w przypiętej wersji (suma SHA-256), potem PATH: ~/.maestro-cli/maestro/bin
udid=$(scripts/e2e/boot-simulator.sh "iPhone 17")       # symulator: pasek stanu 9:41, jasny wygląd, bez autokorekty
npm run e2e:build -- "$udid"                            # expo prebuild + xcodebuild Release dla symulatora z EXPO_PUBLIC_E2E=1
npm run e2e:run -- "$udid" ios/build/e2e/Build/Products/Release-iphonesimulator/Organizer.app
npm run e2e:compare                                     # porównanie z .maestro/baselines (wyniki w e2e-artifacts/)
npm run e2e:check                                       # sama składnia scenariuszy (działa też na Linuksie)
```

**Wzorce zrzutów** (`.maestro/baselines/NN-opis.png`). Porównanie liczy piksele różniące się ponad próg koloru
pixelmatch (0,1) i oblewa zrzut, gdy jest ich więcej niż 0,1% (`--max-ratio`); inny rozmiar (inny symulator) też jest
błędem, a zrzut bez wzorca — tylko „new”. Przy push i PR wynik jest w podsumowaniu przebiegu (z obrazami różnic
`*.diff.png` w artefakcie), w nocy różnica oblewa przebieg. Dopóki wzorców nie ma, przebieg tylko zapisuje zrzuty.
Przyjęcie wzorców (pierwsze albo po zamierzonej zmianie wyglądu): pobierz artefakt `e2e-<numer>-<próba>` zielonego
przebiegu na `main`, obejrzyj zrzuty, `npm run e2e:accept -- <rozpakowany artefakt>/screenshots` i zatwierdź
`.maestro/baselines/` osobnym commitem (z `device.txt` — urządzenie i wersja iOS, na których powstały). Zmiana obrazu
symulatora albo Xcode na runnerze może wymagać przyjęcia wzorców od nowa.

**Bramki wdrożenia i wydania.** `db.yml` rusza tylko przy zmianie swoich ścieżek; gdy commit, który chcesz wdrożyć albo
wydać, ich nie zmienił, bramka zatrzyma przebieg z komunikatem — uruchom `db.yml` ręcznie na `main` (workflow_dispatch)
i ponów po zielonym wyniku (nocny przebieg `db.yml` też tworzy wynik dla bieżącego `main`).

**Brak maszyny macOS** (audyt 2, M-48). Gdy GitHub nie przydzieli runnera w ok. 15 min, zadanie `ios` kończy się bez
żadnego kroku, z adnotacją „The job was not acquired by Runner of type hosted even after multiple attempts” — to brak
maszyny, nie błąd testów: uruchom `e2e.yml` ponownie (ręcznie). 8.10.2026 tak skończyły się 3 z 9 przebiegów
(15:21–17:35 UTC), a 6 zastąpił w kolejce kolejny push; ten sam `macos-26` w `ios-release.yml` dostawał maszynę w 7–82 s.

## Stan na 8.10.2026
`npm run check`: 2207 testów Jest (2203 przechodzi, 4 pominięte — testy na prawdziwym Postgresie bez `PGHOST`; uruchamia je
`npm run test:db` i `db.yml`) plus 11 testów Deno; pokrycie logiki 100%. Mutation score: ostatni pełny pomiar 95,38%
(7.10.2026, próg 90%; wtedy 7 plików). 8.10.2026 zakres to 64 pliki i 8537 mutantów (1512 statycznych) — kilka godzin na
jednym runnerze; nocny przebieg z 8.10 przerwany po 60 min (1113 z 5207 mutantów), a zadanie przerwane po limicie GitHub
oznacza jako „cancelled”, więc próg nie był egzekwowany. Od 9.10.2026 nocą 8 części i próg na całości (audyt 2, M-47) —
wynik pierwszego takiego przebiegu do sprawdzenia. Baza audytu z 6.10.2026: 2 zgłoszenia (`braces`, `node-forge`) w narzędziach Expo/Jest,
nie w kodzie aplikacji. E2E (Maestro, 6 scenariuszy) i porównanie zrzutów: zaimplementowane w `e2e.yml` (D143) — 8.10.2026
żaden przebieg na macOS się nie skończył (wyżej: „Brak maszyny macOS”), wzorców zrzutów brak. Nie ma jeszcze testów wydajności — planowane, otwarte w backlogu.
