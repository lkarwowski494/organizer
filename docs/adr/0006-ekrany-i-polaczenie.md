# ADR 0006 — Ekrany, tryb ciemny i połączenie z Supabase (7.10.2026)

Status: przyjęte. Commity: 9753bab, 617081d, dbb3390.

## Decyzje właściciela (7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D51 | Tryb ciemny | Od pierwszej wersji. Obie palety sprawdza ten sam test kontrastu. | Najpierw tylko jasny, ciemny w Etapie 6 |
| D52 | Od którego ekranu zacząć | Wszystkie ekrany MVP naraz. | Najpierw logowanie; najpierw „Dotyczy mnie” |

## Decyzje wykonawcze (moje; właściciel może zawetować)
1. **Sesja w pęku kluczy iOS.** Sesję przechowuje `expo-secure-store`:
   - zapis w kawałkach po 1800 znaków, bo dokumentacja SDK 57 mówi, że część wersji iOS odrzucała wartości powyżej ok. 2048 bajtów;
   - dostęp `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, więc sesja nie przechodzi do kopii na inny telefon.

   Odrzucone: `localStorage` na expo-sqlite. Jest prostsze, ale bez szyfrowania pęku kluczy.
2. **Baza telefonu osobna dla każdego konta** (`organizer-<userId>.db`). Po zmianie konta nic nie przecieka między osobami.

   Odrzucone: jedna baza czyszczona przy wylogowaniu. Jest ryzyko, że czyszczenie zostanie przerwane.
3. **Klucz publikowalny Supabase przychodzi ze zmiennej środowiska `ios-release`** (`SUPABASE_PUBLISHABLE_KEY`), nie z repozytorium.
   - Klucz jest jawny z założenia, dane chroni RLS.
   - Trzymamy go poza repozytorium, żeby skanery sekretów nie zgłaszały fałszywych alarmów.
   - Build nie startuje bez tej zmiennej.
4. **Usuwanie konta przez funkcję serwerową `delete-account`.** Funkcja sprawdza JWT przez `/auth/v1/user`, a potem woła `DELETE /auth/v1/admin/users/{id}` kluczem tajnym. Dane sprząta wyzwalacz z ADR 0004.

   Odrzucone: RPC SQL z prawami właściciela, który usuwa wiersz `auth.users`. Szersze uprawnienia w bazie.
5. **Odbiór sygnałów Realtime.** Polityka RLS na `realtime.messages` przepuszcza wiersz, gdy spełnione są trzy warunki:
   - temat kanału to `user:<moje id>` albo `group:<moja grupa>`;
   - temat wiersza jest równy tematowi kanału;
   - rozszerzenie to broadcast.

   Test wykazał, że bez warunku na temat wiersza dołączenie do własnego kanału odsłaniało wiersze innych tematów.
6. **Paleta i dostępność.**
   - Tryb ciemny ma 8 kolorów linii o tym samym kontraście co jasny.
   - Każdy ekran przechodzi audyt w obu trybach: etykiety, cel dotyku ≥ 44 pt, kolory tekstu tylko z palety.

## Otwarte (produktowe, do właściciela)
- **Reguła „Dotyczy mnie”.** Obecnie pokazuje:
  - zadania przypisane do mnie;
  - nieprzypisane z grupy osobistej;
  - nieprzypisane z terminem z każdej grupy.

  Sekcje: zaległe, przypięte, dziś, jutro.
- **Kolor grupy.** Obecnie przydzielany automatycznie według kolejności grup u danej osoby.
- **Imię z Apple.** Apple podaje imię tylko przy pierwszym logowaniu. Dziś trafia do sesji, ale nie do profilu na serwerze.
- **Unieważnienie tokenu Sign in with Apple przy usuwaniu konta.** Do sprawdzenia w dokumentacji Apple (ADR 0004).
- **Intl w Hermesie na iPhonie** (strefa Europe/Warsaw). Wymaga spike'u S3 na urządzeniu.
