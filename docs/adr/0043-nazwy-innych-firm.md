# 0043. Bez nazw innych firm i aplikacji; „Nawiguj” tylko w Mapach Apple (9.10.2026)

Decyzja właściciela z 9.10.2026. Repozytorium jest publiczne, a aplikacja idzie do App Store, gdzie wytyczne nie pozwalają
używać cudzych znaków towarowych w metadanych i treści bez zgody (App Review 2.3.7, 5.2.1) ani wymieniać innych
platform mobilnych (2.3.10) — https://developer.apple.com/app-store/review/guidelines/.

## Decyzja
- Nazw innych aplikacji i marek nie używamy w kodzie, komentarzach, tekstach aplikacji, danych (także w danych
  testowych), opisie w sklepie ani w dokumentacji pisanej przez nas.
- Wyjątki: nazwy platformy Apple, na której działa aplikacja (iPhone, kalendarz iPhone’a, Mapy Apple, iCloud,
  „Zaloguj się przez Apple”), adresy źródeł w komentarzach (np. github.com/google/fonts) i identyfikatory paczek
  (np. `@expo-google-fonts/…` — nazwa zależności). Zachowanie innej platformy w komentarzu opisujemy ogólnie („poza iOS”).
- „Nawiguj” otwiera zawsze Mapy Apple. Wybór aplikacji map w Ustawieniach (Mapy Apple albo mapy innej firmy, D115 w
  ADR 0029) usunięty. Telefony z buildami 21–22 mogą mieć zapisany dawny wybór (`navApp`): aplikacja go nie czyta,
  a przy starcie usuwa z konta i z pęku kluczy (`src/app/account-prefs.ts`) — „Nawiguj” otwiera Mapy Apple.
- Konta kalendarza dodane w iPhonie opisujemy ogólnie: „także z innych kont dodanych w iPhonie”.
- Pilnuje tego test kontraktowy `src/config/__tests__/brands.contract.test.ts` (lista nazw, wyjątki z powodem).

## Odrzucone
- **Google Maps jako wyjątek** (zostawić wybór map innej firmy, bo to tylko link): nazwa marki w Ustawieniach to
  dokładnie to, czego dotyczy 2.3.7; Mapy Apple są na każdym iPhonie i obsługują te same środki transportu.
- **Mapy w przeglądarce** (link do strony map innej firmy zamiast aplikacji): dalej cudza usługa z nazwą w opisie
  i w polityce prywatności, adres wydarzenia trafiałby do kolejnej firmy; nic nie daje wobec Map Apple.
- **Usunąć nazwy tylko z tekstów aplikacji, a zostawić w kodzie i dokumentacji**: repozytorium jest publiczne, a reguła
  właściciela obejmuje też kod i komentarze.

## Co zostaje (i dlaczego)
- Istniejące migracje SQL (komentarze w `20261007090000_invites.sql`, `20261008250000_join_codes.sql`): migracji na
  produkcji nie zmieniamy.
- Szablon `supabase/config.toml` z narzędzia Supabase (lista dostawców logowania w komentarzach).
- Domeny dostawców poczty w regule gitleaks `personal-email` i jej próbka testowa — reguła musi je znać.
- Ścieżka `android/` w `.gitignore` i `eslint.config.js` — katalog generowany przez `expo prebuild`.
- Nazwy zależności (`@expo-google-fonts/…`, paczki w `Gemfile.lock`) — identyfikatory, nie nasz tekst.
