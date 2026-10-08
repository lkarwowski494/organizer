# 0020. Zaproszenia jak w Zoom: ID grupy + kod 24 h, klikalny link (8.10.2026)

Propozycja właściciela: grupa ma stały identyfikator („Team ID”), a zaproszenie generuje tymczasowy kod ważny 24 h.
Dołącza się, wpisując ID i kod albo klikając link, czyli dwa sposoby, jak przy dołączaniu do spotkania w Zoom.

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D92 | ID grupy | 9 cyfr (np. 482 913 507), stałe; właściciel może je zmienić | Litery i cyfry (RDZ-7Q4K) |
| D93 | Kod | 6 cyfr, 24 h, dla wielu osób; limit nieudanych prób | Kod jednorazowy dla jednej osoby; dotychczasowe 7 dni i 10 osób |
| D94 | Link | https na GitHub Pages + Universal Links | Bez linku; link w schemacie aplikacji (nieklikalny w komunikatorach, D67) |

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
