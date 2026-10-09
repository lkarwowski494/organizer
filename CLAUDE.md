# Organizer — instrukcje dla Claude

Aplikacja iOS (Expo / React Native, TypeScript) do organizacji codzienności w wielu grupach
(rodzina, dalsza rodzina, znajomi) z widokiem zbiorczym „Moje sprawy” (dawniej „Dotyczy mnie”, D89). Właściciel produktu: Łukasz.
Claude prowadzi kod i dokumentację; decyzje produktowe podejmuje właściciel.

Dokumentacja projektu (Google Drive, folder „Organizer grup”):
- Rejestr decyzji: https://docs.google.com/document/d/1ta-8A-_mhrFnvrv3GJY0QAKwOF0USgl9MZu5CglBYyk/edit
- Roadmapa: https://docs.google.com/document/d/1RD4HBt8hhX7rDYekSRtnFGtyVS6x6rmlJbVksWb8Pqo/edit
- Architektura i plan MVP: https://docs.google.com/document/d/1BiNrwQwPbpwOXcc8FHXmLpvTEwitrwj_TeMxK8bowxg/edit
- Backlog (04): https://docs.google.com/spreadsheets/d/1SLCMD_fkNWtyhay6jTnVtxGTCgkxzCzFuWbLvDSAb5g/edit
- Changelog (05, najnowsze na górze): https://docs.google.com/document/d/1e2vVbgaAqKORL4_jXKBmg6DVR8v2musxJyRHNMXnxvU/edit

Po każdej istotnej zmianie aktualizuj backlog i changelog.

Kopia decyzji w repozytorium: `docs/adr/`.

## Zasada źródeł i rejestr decyzji (obowiązkowa)

Wszystko, czego aplikacja uczy albo co twierdzi (treść, liczby, zalecenia, reguły i mechaniki oparte na
wiedzy z danej dziedziny), musi mieć merytoryczne podstawy. Każde twierdzenie ma przeczytane źródło
(adres i cytat), wybrane według hierarchii: rachunek i dane pierwotne, potem wyniki badań i narzędzi
eksperckich, potem książki i publikacje uznanych autorów, na końcu uznane serwisy specjalistyczne.
Wyższy szczebel wygrywa. Streszczenie z wyszukiwarki nie jest źródłem. Czego nie da się potwierdzić,
trafia do otwartych pytań, nie do aplikacji. Kwestie merytoryczne w dziedzinie, w której właściciel nie
jest ekspertem, rozstrzyga ta hierarchia, nie on. Właściciela pytaj o sprawy produktowe (zakres, funkcje,
wygląd, koszty, kolejność prac), zawsze z co najmniej dwiema opcjami. Każdą decyzję merytoryczną zapisz
w rejestrze projektu z uzasadnieniem i odrzuconymi wariantami. Właściciel może ją zawetować.

W kodzie: reguła oparta na wiedzy dziedzinowej (np. odmiana liczebników, święta, strefy czasowe, RRULE)
ma w komentarzu adres źródła.

## Zasady procesu

- Przy każdej zmianie mechaniki, naprawie błędu czy decyzji architektonicznej: co najmniej dwie realne
  opcje z kompromisami; rekomendacja dozwolona, decyzja należy do właściciela. Jeśli alternatywy
  naprawdę nie ma — powiedz to wprost i dlaczego.
- Jedno źródło prawdy: wszystkie liczby i reguły w `src/config`. Nie kopiuj liczb do innych miejsc;
  generuj albo importuj. Limity SQL muszą zgadzać się z `src/config` (test kontraktowy).
- „Udokumentowane” ≠ „zaimplementowane”. Przy wątpliwości uruchom i sprawdź.
- Nowa funkcja nie może psuć istniejących: `npm run check` (typy, lint bez ostrzeżeń, testy) musi
  przechodzić przed każdym commitem.
- Usuwając mechanikę, przeszukaj cały projekt (kod, komentarze, dokumentację) pod kątem jej nazwy.
- Liczby nieznanego pochodzenia oznaczaj jako otwarte pytanie, nie wymyślaj uzasadnień.

## Testy (obowiązkowe — decyzja właściciela z 6.10.2026, szczegóły: docs/testing.md)

- Każda funkcja testowana automatycznie w najszerszym możliwym zakresie, we wszystkich warstwach, które
  jej dotyczą (logika, własności, korpusy z niezależnym wzorcem, mutacje, kontrakty, synchronizacja, RLS,
  migracje, ekrany, dostępność, wygląd, E2E, wydajność, bezpieczeństwo). Bez testów funkcja nie jest zrobiona.
- Progi: logika (`src/domain`, `src/config`, `src/sync`, `src/data`) 100% pokrycia linii i gałęzi
  oraz ≥ 90% wykrytych mutacji; każdy ekran ma test RNTL, każda funkcja scenariusz E2E.
- Błąd najpierw dostaje test, który go odtwarza, potem poprawkę.
- Oczekiwania w korpusach liczy niezależna implementacja (inny język lub biblioteka), nie testowany kod.
- Kod nieosiągalny usuń zamiast wyłączać z pokrycia; `istanbul ignore` tylko z uzasadnieniem w komentarzu.

## Architektura (skrót — szczegóły w dokumencie „Architektura i plan MVP”)

- Ekrany czytają wyłącznie z lokalnej bazy SQLite (expo-sqlite, zwykły SQL w `src/data/db`; Drizzle z D25 nie został użyty). Każda zmiana zapisuje się
  lokalnie w jednej transakcji z wpisem w kolejce `pending_ops` (D2, R1).
- Serwer: Supabase Free, Frankfurt (D1). Push zmian: RPC `sync_push` (SECURITY INVOKER, RLS jako jedyna
  kontrola dostępu). Pull: kursor = wersja per grupa (D32). Realtime Broadcast wyłącznie jako sygnał bez treści
  spraw (numer wersji grupy albo znacznik zmiany dostępu).
- Grupa jest kontenerem i granicą bezpieczeństwa; widoczność group/restricted/private (D3).
- Każdy obiekt ma UUIDv7 nadawany na telefonie (`src/domain/ids.ts`, R3); kopie stałych zadań serii i odpowiedzi
  o obecności mają UUIDv5 liczony z treści, żeby dwa telefony nie zrobiły dubla; zmiany wysyłane per pole.
- Członek grupy: `member_id` z opcjonalnym `user_id` (profile dzieci bez kont, D10/D34).
- Podzadania do `config.MAX_TASK_DEPTH` (= 2, D4).

## Struktura katalogów

- `src/domain/` — czysty TypeScript, bez Reacta/Expo (pilnuje tego ESLint). Zależności wstrzykiwane.
- `src/features/` — moduły funkcji (zadania, zakupy, kalendarz, „Moje sprawy”, grupy).
- `src/sync/` — kolejka, push/pull, wyzwalacze, wskaźnik stanu.
- `src/config/` — jedyne źródło liczb i reguł.
- `src/i18n/strings.pl.ts` — wszystkie teksty (D30), odmiana przez `src/domain/plural.ts`.
- `supabase/` — migracje SQL, polityki RLS, Edge Functions, testy pgTAP (od Etapu 1).
- `docs/adr/` — rejestr decyzji w repozytorium.

Nawigacja: React Navigation (D26), linki głębokie konfigurowane ręcznie i testowane.
Natywne katalogi `ios/` i `android/` nie trafiają do repozytorium — generuje je `expo prebuild` w CI.

## Polecenia

```bash
npm run check        # typy + lint (0 ostrzeżeń) + wszystkie testy
npm run test:domain  # tylko testy logiki (Node)
npx expo install <pakiet>   # zawsze zamiast npm install dla pakietów z kodem natywnym
```

Przed użyciem jakiegokolwiek API Expo/React Native sprawdź dokumentację dla wersji z `package.json`
(SDK 57): https://docs.expo.dev/versions/v57.0.0/ — nie polegaj na pamięci.

## Bezpieczeństwo (repozytorium jest publiczne)

- Sekrety nigdy w repozytorium: pliki `.p8`, `.p12`, `.mobileprovision`, `.env`, hasła, tokeny.
  Klucz APNs żyje wyłącznie w sekretach Supabase; klucze App Store Connect i fastlane match wyłącznie
  w środowisku GitHub `ios-release` (bez zatwierdzania, tylko gałąź `main` i tagi `v*` — D53, 7.10.2026; buildy
  uruchamia też Claude). Środowisko `supabase-prod` też bez zatwierdzania (D78, 7.10.2026, na czas rozwoju): tylko gałąź `main`, wdrożenia uruchamia Claude po zielonych testach bazy (`db.yml`), zawsze w trybie `apply` z podglądem w logu.
- gitleaks w CI przy każdym pushu na `main` i każdym PR, nocą na całej historii. Nowy typ sekretu → reguła w `.gitleaks.toml`.
- Workflow: tylko `pull_request` (nigdy `pull_request_target` z kodem z PR), akcje przypięte do pełnego SHA,
  `permissions: contents: read` domyślnie, brak artefaktów z buildów wydania iOS (E2E publikuje tylko zrzuty ekranu
  i końcówkę logu — D170, 8.10.2026).
- Commity podpisane adresem noreply: `336954459+lkarwowski494@users.noreply.github.com`.
- Repozytorium jest publiczne od 6.10.2026, po audycie całej historii (gitleaks + drugi skaner), e-maili w commitach,
  ustawień workflow i logów przebiegów (`docs/audits/2026-10-06-przed-upublicznieniem.md`). Ten sam audyt — z wynikami
  dla właściciela przed przełączeniem — przed upublicznieniem każdego innego repozytorium projektu.

## Treści cudze i nazwy innych firm (repozytorium jest publiczne; decyzja właściciela 9.10.2026)

- Cytat z cudzego tekstu: krótki urywek (do ok. 300 znaków), tylko po to, żeby uzasadnić regułę, zawsze z adresem
  źródła i autorem albo instytucją (art. 29 i 34 ustawy o prawie autorskim). Nie kopiujemy całych stron, tabel,
  grafik ani przykładowych tekstów; ten sam cytat w jednym miejscu, gdzie indziej odsyłacz.
- Teksty aplikacji i opisy dla App Store piszemy sami. Nie tłumaczymy ich zdanie po zdaniu ze stron innych firm.
- Grafiki, ikony i kroje: tylko własne albo na licencji pozwalającej na dystrybucję w aplikacji; licencja zapisana
  w repo, a biblioteki i kroje z paczki wymienione na ekranie „Licencje” (test kontraktowy).
- Nowa zależność: sprawdź licencję. Bez GPL/AGPL/LGPL w paczce aplikacji i bez licencji nieznanej.
- Nazwy innych firm i produktów (Apple, Google, Outlook) tylko opisowo („otwórz w Google Maps”), nigdy w nazwie
  aplikacji, podtytule ani słowach kluczowych (App Review 2.3.7, 5.2.1); nazw innych platform mobilnych nie używamy
  w tekstach aplikacji (2.3.10). W danych (np. słownik działów zakupów) nie używamy marek — tylko nazwy ogólne.
- Dane osobowe: w repo, testach, danych demo i zrzutach tylko zmyślone osoby i wpisy (Ala, Jan Kowalski,
  example.com). Zgłoszenia właściciela (zrzuty, wpisy z kalendarza) opisujemy po anonimizacji, bez prawdziwych imion,
  nazw kalendarzy i godzin zajęć (App Review 2.3.9). Prywatne adresy e-mail blokuje reguła gitleaks `personal-email`.
- Badania konkurencji (opisy, ceny, zrzuty innych aplikacji) trzymamy na prywatnym Drive, nie w repozytorium.

## Koszty i limity (właściciel płaci tylko za Apple Developer)

Przed uruchomieniem czegokolwiek, co zużywa limit (CI, buildy, usługi), sprawdź limity i uprzedź
właściciela przy ok. 70% limitu. Progi są w `src/config` (`limits`) i `docs/limits.md`;
nocny strażnik `free-limits` (D185) mierzy zużycie po dodaniu sekretu `SUPABASE_MONITOR_TOKEN` w środowisku `monitor`; bez sekretu nic
nie mierzy, a od 16.10.2026 oblewa nocny przebieg. Transferu (egress) i Realtime nie mierzy — sprawdzaj je ręcznie.
Repozytorium jest publiczne: standardowe maszyny GitHub Actions (także macOS) są bez opłat — „GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners” (https://docs.github.com/en/billing/concepts/product-billing/github-actions). Płatne „larger runners” — nie używamy.
