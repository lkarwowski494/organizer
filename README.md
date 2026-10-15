# Organizer 📋👨‍👩‍👧‍👦

> **„Wszystkie sprawy Twojej rodziny i bliskich w jednym miejscu — prosto, przejrzyście i zawsze pod ręką.”**

Aplikacja mobilna na system iOS do organizacji codzienności w wielu grupach (rodzina, dom, znajomi, projekty), stworzona w architekturze **100% Offline-First** z widokiem zbiorczym **„Moje sprawy”** integrującym zadania z podzadaniami, wspólne listy zakupów oraz kalendarz.

**Status projektu:** Wersja testowa w TestFlight (8.10.2026).  
**Stos technologiczny:** Expo SDK 57, React Native, TypeScript, SQLite (`expo-sqlite`, zwykły SQL), Supabase.

---

## 🌟 Główne Zasady Produktowe & Architektura

- **100% Offline-First (SQLite + pending_ops):** Ekrany czytają wyłącznie z lokalnej bazy SQLite (`expo-sqlite`, zwykły SQL w `src/data/db`). Każda modyfikacja (odznaczenie zadania, dodanie pozycji do listy zakupów) zapisuje się natychmiastowo w lokalnej transakcji bazodanowej wraz z wpisem do kolejki `pending_ops` (D2, R1). Aplikacja działa w pełni bez dostępu do sieci.
- **Grupa jako Kontener i Granica Bezpieczeństwa:** Pełna separacja spraw domowych, rodzinnych i towarzyskich. Trzy poziomy widoczności (`group` / `restricted` / `private`) gwarantują, że prywatne notatki nie trafiają do nieuprawnionych osób (D3).
- **Zero-Friction dla Bliskich (Profile bez Kont):** Domownicy, dzieci i seniorzy mogą uczestniczyć w życiu grupy jako profile lokalne (`member_id`) bez konieczności rejestracji, posiadania adresu e-mail czy smartfona (D10, D34).
- **Deterministyczna Synchronizacja Chmurowa:** Oparta o backend Supabase (Frankfurt, D1). Zmiany wysyłane są atomowo przez procedurę RPC `sync_push` pod ścisłą kontrolą Row-Level Security (RLS jako jedyna kontrola dostępu). Pobieranie zmian (pull) opiera się na kursorze wersji per grupa (D32), a sygnały Realtime Broadcast informują o zdarzeniach bez przesyłania wrażliwych treści.
- **Odporność na Konflikty (UUIDv7 & UUIDv5):** Każdy obiekt posiada unikalny, sortowalny czasowo identyfikator UUIDv7 nadawany lokalnie na telefonie (`src/domain/ids.ts`, R3). Dla cyklicznych instancji zadań i deklaracji obecności stosowane są deterministyczne identyfikatory UUIDv5, co eliminuje duble przy równoległej pracy wielu urządzeń.
- **Pojedyncze Źródło Prawdy (Single Source of Truth):** Wszystkie limity (w tym maksymalna głębokość podzadań `MAX_TASK_DEPTH = 2`, D4), stałe czasowe i reguły biznesowe zdefiniowane są centralnie w module `src/config/`, podlegając automatycznym testom kontraktowym.

---

## 📱 Moduły i Ekrany

1. **📋 Moje sprawy (Today / Dashboard):**
   - Inteligentne centrum dowodzenia zbierające wszystko ze wszystkich Twoich grup w jednym miejscu.
   - Zadania z bieżącym terminem, pilne sprawy, dedykowane obowiązki oraz dzisiejsze wydarzenia z kalendarza.
2. **✅ Zadania z Podzadaniami (Hierarchical Tasks):**
   - Hierarchiczne drzewo zadań z obsługą zagłębienia do 2 poziomów (`MAX_TASK_DEPTH`).
   - Przypisywanie odpowiedzialnych osób, terminy, priorytety, etykiety oraz natychmiastowe odznaczanie w SQLite.
3. **🛒 Wspólne Listy Zakupów (Shared Shopping Lists):**
   - Kategoryzowane pozycje z błyskawicznym wprowadzaniem produktów i odznaczaniem w sklepie.
   - Synchronizacja koszyka w czasie rzeczywistym między domownikami.
4. **📅 Wspólny Kalendarz & Wydarzenia (Calendar & Events):**
   - Kalendarz grupy z pełnym wsparciem reguł powtarzalności (standard RFC 5545 RRULE).
   - Terminy, deklaracje obecności uczestników z unikalnym UUIDv5 oraz obsługa dni świątecznych.
5. **⚡ Szybkie Dodawanie (QuickAdd Natural Language):**
   - Inteligentny parser języka naturalnego w języku polskim (`src/domain/quickadd.ts`).
   - Rozpoznaje w locie daty, godziny, powtarzalność, osoby oraz grupy bezpośrednio z pojedynczej linii tekstu.
6. **👥 Zarządzanie Grupami & Członkowie (Groups & Roles):**
   - Konteksty grupowe (Dom, Dalsza rodzina, Znajomi, Szkoła), bezpieczne linki zaproszeniowe oraz zarządzanie profilami.
7. **⚙️ Ustawienia, Synchronizacja i Bezpieczny Kosz:**
   - Monitor stanu kolejki offline (`pending_ops`), diagnostyka bazy oraz usuwanie z mechanizmem kosza (`KOSZ`) i natychmiastową możliwością cofnięcia (*Undo*).

---

## 🧪 9 Warstw Weryfikacji Jakości (Testing Rigor)

Projekt realizowany jest zgodnie z rygorystyczną definicją ukończenia (DoD):
- **100% Pokrycia Linii i Gałęzi:** Bezwzględny wymóg pełnego pokrycia testami dla logiki domenowej (`src/domain`, `src/config`, `src/sync`, `src/data`).
- **Testy Mutacyjne (Stryker):** Wymóg $\ge 90\%$ wykrytych mutacji kodu w warstwach kluczowych (`stryker.config.json`).
- **Testy Własnościowe (Property-Based):** Weryfikacja niezmienników z użyciem biblioteki `fast-check`.
- **Testy Niezależnych Korpusów:** Walidacja parsera QuickAdd, kontrastu kolorów WCAG, odmiany liczebników w języku polskim i przesunięć czasu (DST) z niezależnymi wzorcami generowanymi w Pythonie.
- **Testy Bazodanowe i RLS:** Weryfikacja transakcji SQLite oraz polityk dostępu Supabase RLS za pomocą testów pgTAP.
- **E2E & Wizualny Regres:** Automatyczne scenariusze Maestro na symulatorze iOS z rygorystycznym porównywaniem zrzutów ekranu (`pixelmatch`).

---

## 🛠️ Uruchomienie i Weryfikacja

Wymagane środowisko: Node.js 20+ oraz npm.

```bash
# Instalacja zależności
npm install

# Pełna weryfikacja projektu (typy, lint, testy z pokryciem, funkcje, korpusy, licencje)
npm run check

# Uruchomienie testów jednostkowych i integracyjnych Jest
npm test

# Szybkie testy jednostkowe tylko dla zmienionych plików
npm run test:fast

# Testy czystej logiki domenowej
npm run test:domain

# Uruchomienie testów mutacyjnych Stryker
npm run test:mutation

# Uruchomienie aplikacji w środowisku deweloperskim Expo
npm run start

# Uruchomienie aplikacji na symulatorze iOS
npm run ios
```

---

## 📂 Architektura Kodu

```text
organizer/
├── src/
│   ├── domain/                 # Czysty TypeScript: reguły biznesowe, QuickAdd, RRULE, UUIDv7, formatowanie
│   │   ├── sync-engine/        # Matematyczny model synchronizacji i rozwiązywania konfliktów
│   │   └── views/              # Projekcje i transformacje widoków
│   ├── features/               # Moduły funkcjonalne UI
│   │   ├── today/              # Widok zbiorczy „Moje sprawy” (agregacja międzygrupowa)
│   │   ├── lists/              # Zadania z podzadaniami oraz wspólne listy zakupów
│   │   ├── calendar/           # Kalendarz, siatka miesięcy i widok agendy
│   │   ├── events/             # Wydarzenia, reguły RRULE i obecności
│   │   ├── groups/             # Zarządzanie grupami, zaproszenia i uprawnienia
│   │   ├── auth/               # Uwierzytelnianie Apple & Supabase
│   │   ├── profile/            # Profile użytkowników i domowników bez kont
│   │   ├── handoffs/           # Przekazywanie spraw i opieki
│   │   └── settings/           # Ustawienia, stan kolejki pending_ops, diagnostyka
│   ├── sync/                   # Klient synchronizacji chmurowej: push/pull, retry, detekcja offline
│   ├── data/                   # Baza lokalna SQLite (expo-sqlite, czysty SQL, transakcje)
│   ├── config/                 # Pojedyncze źródło prawdy: limity, stałe, palety kolorów
│   └── i18n/                   # Polskie teksty i gramatyczna odmiana liczebników (plural.ts)
├── supabase/                   # Schemat bazy, migracje SQL, polityki RLS i Edge Functions (Deno)
├── .maestro/                   # Scenariusze testów E2E i wzorce screenshotów (pixelmatch)
├── scripts/                    # Narzędzia CI: generatory korpusów, audyty i weryfikacja licencji
└── docs/                       # Dokumentacja projektowa, wzorce interakcji i rejestr decyzji (docs/adr)
```

---

## 📖 Dokumentacja i Rejestr Decyzji

- **Zasady pracy i architektura:** [`CLAUDE.md`](CLAUDE.md)
- **Rejestr decyzji architektonicznych:** [`docs/adr/`](docs/adr)
- **Przepływy i nawigacja:** [`docs/01-przeplywy-i-nawigacja.md`](docs/01-przeplywy-i-nawigacja.md)
- **Definicja ukończenia (DoD):** [`docs/20-definicja-ukonczenia.md`](docs/20-definicja-ukonczenia.md)
- **Wzorce interakcji:** [`docs/32-wzorce-interakcji.md`](docs/32-wzorce-interakcji.md)
- **Strategia testów:** [`docs/testing.md`](docs/testing.md)
- **Limity systemowe:** [`docs/limits.md`](docs/limits.md)

---

## 📄 Status & Dystrybucja

- **Status:** Wersja testowa w Apple TestFlight (od 8.10.2026).
- **Zasady interakcji:** iOS Human Interface Guidelines, wsparcie VoiceOver, Dynamic Type i wysoki kontrast WCAG.
