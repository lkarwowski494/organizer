# 0020. Zaproszenia jak w Zoom: ID grupy + kod 24 h, klikalny link (8.10.2026)

Propozycja właściciela: grupa ma stały identyfikator („Team ID”), a zaproszenie generuje tymczasowy kod ważny 24 h.
Dołącza się, wpisując ID i kod albo klikając link, czyli dwa sposoby, jak przy dołączaniu do spotkania w Zoom.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D92 | ID grupy | 9 cyfr (np. 482 913 507), stałe; właściciel może je zmienić | Litery i cyfry (RDZ-7Q4K) |
| D93 | Kod | 6 cyfr, 24 h, dla wielu osób; limit nieudanych prób | Kod jednorazowy dla jednej osoby; dotychczasowe 7 dni i 10 osób |
| D94 | Link | https na GitHub Pages + Universal Links → link ukryty w wiadomości, dopóki strona nie działa (D141, ADR 0035: `config.invites.LINK_LIVE`); w wiadomości link TestFlight (D153) | Bez linku; link w schemacie aplikacji (nieklikalny w komunikatorach, D67) |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Kod to zwykłe zaproszenie** (`public.invites`, nowy rodzaj `code`).
   - W bazie leży skrót SHA-256 tekstu „ID:kod”. Przyjęcie idzie tą samą drogą co dotąd (strażnik członkostw), więc role i limit użyć (`invite_max_uses_limit()` = 50) działają bez zmian.
2. **Zgadywanie (rachunek, szczebel 1):**
   - Kodów jest 10⁶.
   - Po 5 nieudanych próbach osoby albo 20 na ID grupy w ciągu godziny kolejne próby są odrzucane.
   - Przez 24 h ważności jest więc najwyżej 20 · 24 = 480 prób na ID, czyli szansa trafienia ≤ 480 / 10⁶ = 0,048% na jeden ważny kod.
   - Nieudana próba jest zapisywana bez wyjątku SQL (wyjątek wycofałby zapis), a błąd wraca w treści odpowiedzi.
   - Dla złego ID i złego kodu błąd jest ten sam, więc nie zdradzamy, czy grupa istnieje.
3. **Rozdział dróg:** kod przyjmuje tylko `join_group` (z limitem), a stary token tylko `accept_invite`.
   - Inaczej „ID:kod” podany jako token omijałby limit. Lukę wykrył test pgTAP przed wydaniem.
4. **Zmiana ID grupy** (tylko właściciel) unieważnia wszystkie kody grupy. Członkowie zostają.
5. **ID losowane** z `gen_random_uuid` (pg_strong_random). Pierwsza cyfra 1–9, żeby zero na początku nie ginęło przy dyktowaniu.
6. **Stare zaproszenia** (64 znaki) działają nadal, wklejone albo z linku `invite/<token>`. Nowe zaproszenia to wyłącznie ID + kod.
7. **Strona** `lkarwowski494.github.io/j/?g=…&c=…`:
   - Źródło jest w `site/` (test kontraktowy z config, app.json i fastlane).
   - Bez zewnętrznych skryptów, bez zapisywania danych, bez wstawiania HTML z adresu.
   - Repozytorium strony zakłada właściciel (integracja nie może tworzyć repozytoriów; kroki w `docs/join-links.md`).
8. **Universal Links w dwóch etapach.** Wpis `associatedDomains` trafi do aplikacji dopiero po włączeniu Associated Domains w App ID i odnowieniu profilu (`match-bootstrap` → `renew_profile`, `force: true`). Wcześniej build by się nie podpisał.
   - Do tego czasu link otwiera stronę z przyciskiem „Otwórz w aplikacji” (schemat aplikacji z Safari działa).

## Sprostowanie (8.10.2026, audyt dokumentacji)
Komentarz w wydanej migracji `20261008250000_join_codes.sql` (`private.random_digits`) mówi o „122 losowych bitach” i liczbie z 2^60. Funkcja bierze 15 pierwszych znaków szesnastkowych UUID z `gen_random_uuid` (wersja 4, RFC 9562), a 13. znak to stała cyfra wersji „4”. Losowych jest więc 56 bitów (14 znaków), nie 60. Wniosek się nie zmienia: przesunięcie modulo dla 10⁹ wynosi najwyżej 10⁹ / 2⁵⁶ ≈ 1,4 · 10⁻⁸, czyli jest pomijalne. Wydanych migracji nie edytujemy, więc poprawka jest tylko tutaj.

## Audyt 2 (8.10.2026): zmiany
Migracja `20261008362000_join_codes_v2.sql`, testy `supabase/tests/join_codes_v2.test.sql`.
- **D140 odwrócona (limit prób, zmienia D93 pkt 2).** Limit 20 nieudanych prób na ID grupy na godzinę blokował też
  poprawny kod (cudze błędy wystarczały, żeby nikt nie dołączył). Teraz: limit tylko na konto (5 na godzinę, bez zmian),
  a kod, który od utworzenia zebrał `config.invites.JOIN_FAILS_PER_CODE` = 100 nieudanych prób na swoje ID grupy, przestaje
  działać (zapraszający tworzy nowy). Rachunek (szczebel 1): każda nieudana próba to jeden strzał w aktywne kody grupy
  (najwyżej dwa — członka i admina), więc szansa odgadnięcia kodu w całym jego życiu ≤ 100 / 10⁶ = 0,01% (któregoś
  z dwóch ≤ 0,02%; dotąd ≤ 480 / 10⁶ = 0,048% na kod). Zepsucie komuś kodu kosztuje 100 nieudanych prób, czyli 20 kont
  × 1 h, a skutkiem jest prośba o nowy kod, nie blokada wszystkich. Próby starsze niż doba kasujemy, a kod żyje 24 h, więc
  liczą się wszystkie z jego życia. Odrzucone: limit grupy tylko z kont z udanym logowaniem Apple (B-9, wariant A —
  więcej pracy, a cudze próby nadal blokowałyby poprawny kod).
- **Jeden aktywny kod na grupę i rolę (PW-41 A).** „Zaproś” pokazuje bieżący ważny kod tej roli (także na drugim
  telefonie), nowy powstaje tylko, gdy ważnego nie ma; „Nowy kod” (`renew_join_code`) unieważnia poprzedni. Dlatego kod
  6-cyfrowy jest zapisany w `invites.code` (bez uprawnień odczytu dla telefonu; czyta go tylko funkcja dla owner/admin).
  Bezpieczeństwo bez zmian: przy 10⁶ kodów sam skrót bez sekretu i tak nie chronił przy wycieku bazy (B-20). Długich
  tokenów nadal nie zapisujemy.
- **Kolizja skrótu z dawnym kodem grupy (B-8):** losujemy ponownie (do 10 prób) zamiast błędu 23505.
- **Powrót osoby usuniętej (PW-6 A, D152):** osoba usunięta przez owner/admin (`group_members.removed_at`) wraca tylko
  z zaproszenia wystawionego po usunięciu (`invite_removed`); jej zaproszenia przestają działać przy usunięciu.
  Samodzielne wyjście jak dotąd. Przy powrocie imię wpisane przy dołączaniu zastępuje dawne (R-25).
- **Skąd wziąć aplikację (PW-7 A):** wiadomość ma wiersz z publicznym linkiem TestFlight, gdy
  `config.invites.TESTFLIGHT_LINK` jest ustawiony (do tego czasu bez wiersza; `docs/testflight-beta.md`, krok 4).

## Audyt 3 (9.10.2026): zmiany
Migracja `20261010100000_invites_membership.sql`, testy `supabase/tests/invites_membership.test.sql`.
- **Kod roli należy do grupy (decyzja Q7 A).** Odejście, usunięcie albo utrata roli administratora nie unieważnia kodów ról
  (wspólnych — widzą je owner i admin). Unieważnia tylko zaproszenia osobiste tej osoby: kody profili dzieci, które
  wystawiła, i dawne linki z tokenem. Usunięcie konta nadal unieważnia wszystkie zaproszenia, które ta osoba wystawiła.
- **„Zaproś” po usunięciu osoby daje nowy kod** (N-38): bieżący kod roli tylko, gdy powstał po ostatnim usunięciu kogoś
  z grupy; starszy ważny kod działa dalej dla innych do wygaśnięcia (≤ 24 h), więc przez dobę po usunięciu w grupie mogą
  działać dwa kody tej roli (szansa odgadnięcia rośnie liniowo: ≤ k × 0,01%). „Nowy kod” unieważnia wszystkie kody roli.
- **Już jestem w grupie** (N-157, N-158): aktywny członek z kodem swojej grupy (także starym) dostaje „Już jesteś w tej
  grupie” — z rolą, gdy kod jest na wyższą; nie traci próby z limitu. Dołączenie, przekazanie własności i nocne sprzątanie
  wysyłają sygnał grupie (N-90).
- **Pkt 8 zmieniony (N-259, decyzja Q23 A):** strona nie ma przycisku z linkiem w schemacie aplikacji (inna aplikacja może
  zarejestrować ten sam schemat). Link https trafia do wiadomości (`LINK_LIVE`) dopiero razem z Universal Links
  (`associatedDomains` w `app.json`) — pilnuje tego `src/config/__tests__/site.contract.test.ts`.
