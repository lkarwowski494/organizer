# ADR 0004 — Limity zaproszeń i usuwanie konta (7.10.2026)

Status: przyjęte.
- Kod: `supabase/migrations/20261007090000_invites.sql` (zaproszenia) i `supabase/migrations/20261007110000_account_deletion.sql` (usuwanie konta).
- Testy: `supabase/tests/invites.test.sql` i `supabase/tests/account_deletion.test.sql`.

## Decyzje właściciela (7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D48 | Ważność i limit linku zaproszenia | Domyślnie 7 dni i 10 użyć. Najwyżej 30 dni i 50 użyć (`config.invites`). → zastąpione dla nowych zaproszeń przez D92–D93 (ADR 0020: ID grupy + kod 24 h); stare tokeny działają dalej. | Link jednorazowy ważny 48 h: bezpieczniejszy, ale każdą osobę trzeba zapraszać osobno. |
| D49 | Co z grupą, której właściciel usuwa konto | Grupa przechodzi na dorosłego z najdłuższym stażem, najpierw na admina. Jeśli takiej osoby nie ma, grupa trafia do kosza na 30 dni. | Przed usunięciem konta trzeba ręcznie przekazać każdą grupę. |
| D49 | Historia zmian usuniętej osoby | Zostaje, podpisana „Usunięty użytkownik”. | Zostaje z imieniem. |

## Doprecyzowania wykonawcze (moje; właściciel może zawetować)
1. **Kto jest „dorosłym”.**
   - Dorosły to konto z rolą admin albo member.
   - Dziecko nie przejmuje grupy, także dziecko z własnym kontem (D34: rola child tylko odhacza zadania).
   - Remis stażu rozstrzyga `member_id`, żeby wynik był zawsze ten sam.
2. **Jeden kosz.** Grupa leży w koszu `config.sync.TOMBSTONE_DAYS` dni, tak samo jak usunięte listy i zadania. Liczba 30 opisuje to samo pojęcie („kosz 30 dni” z raportu architektury), więc nie dostała drugiej stałej.
3. **Grupa osobista** usuwanego konta jest kasowana od razu, z całą zawartością. Nikt poza właścicielem jej nie widział.
4. **Listy prywatne** usuwanego w grupach wspólnych idą do usuniętych (tombstone, potem `purge_tombstones`). Też widział je tylko on.
   - Listy wspólne i ograniczone zostają, bo należą do grupy.
5. **Zaproszenia**, które wystawił usuwany, zostają odwołane. Link od osoby, której już nie ma, nie powinien dalej wpuszczać do grupy.
6. **Imię znika wszędzie.** Usuwane są:
   - nazwa i kolor członka we wszystkich jego członkostwach, także w dawno opuszczonych grupach;
   - podpis w historii;
   - stare i nowe wartości `display_name` w zapisanych zmianach członka.

   Poprawione wiersze dostają nową wersję z licznika grupy, więc telefony innych członków je pobiorą.
7. **Jedna droga usunięcia.** Sprzątanie uruchamia wyzwalacz `before delete on auth.users`. Działa tak samo przy usunięciu przez `auth.admin.deleteUser` z funkcji serwerowej i z panelu Supabase.
   - Odrzucony wariant: jawne wywołanie `private.delete_account_data` przed usunięciem użytkownika. Ktoś mógłby je pominąć przy usuwaniu z panelu.
8. **Kosz grup czyści** `private.purge_deleted_groups()`, uruchamiane przez zadanie cykliczne tak jak `purge_tombstones`. Wywołać je może tylko `service_role`.

## Otwarte
- **Kto uruchamia usunięcie.** Do wyboru są funkcja serwerowa `delete-account` (sprawdza JWT i woła `auth.admin.deleteUser`) albo RPC SQL. Decyzja zapadnie razem z ekranem ustawień. → rozstrzygnięte: funkcja `delete-account` (ADR 0006, decyzja wykonawcza 4).
- **Sign in with Apple.** Usunięcie konta może wymagać unieważnienia tokenu Apple (REST API Apple). Trzeba to sprawdzić w wytycznych App Store i dokumentacji Apple przed implementacją; nie jest jeszcze zweryfikowane. → rozstrzygnięte: unieważniamy token przez REST API Apple (O-036, ADR 0016, decyzja wykonawcza 5).
