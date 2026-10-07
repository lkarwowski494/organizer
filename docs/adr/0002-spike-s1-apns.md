# ADR 0002 — Spike S1: push do APNs bezpośrednio z Edge Function Supabase (6.10.2026)

Status: przyjęte (potwierdza D6 bez zmian).

## Pytanie
Czy Edge Function Supabase (Deno) może wysyłać żądania do APNs, które wymagają HTTP/2 i tokenu JWT ES256
(https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)?

## Metoda
Funkcja `supabase/functions/apns-spike` (bez zależności zewnętrznych): JWT podpisywany WebCrypto
(ECDSA P-256, SHA-256), wysyłka dwiema drogami — `fetch` i `node:http2` — na fałszywy token urządzenia
(64 zera). Odpowiedź `400 BadDeviceToken` oznacza, że APNs przyjął połączenie i token dostawcy, a odrzucił
tylko token urządzenia; `403 InvalidProviderToken` oznaczałby zły klucz lub identyfikatory.

## Wynik
| Środowisko | Klucz | fetch | node:http2 |
|---|---|---|---|
| Lokalnie, Deno 2.9.7 | wygenerowany, fałszywy | 403 InvalidProviderToken (653 ms) | 403 InvalidProviderToken (367 ms) |
| Supabase Edge Function, projekt `rkokujgrziaaxabtxnlo` (Frankfurt), APNs sandbox | prawdziwy (Key ID MAW7TZPHU7) | 400 BadDeviceToken (583 ms) | 400 BadDeviceToken (470 ms) |
| To samo, APNs produkcyjny (`api.push.apple.com`), 7.10.2026 | prawdziwy | 400 BadDeviceToken (467 ms) | 500 z funkcji: „Cannot read properties of undefined (reading 'error')” — błąd wewnątrz `node:http2` środowiska Edge, nie odpowiedź Apple |

## Decyzja
D6 zostaje: push bezpośrednio do APNs z Edge Function. Docelowa implementacja używa wyłącznie `fetch`
(standardowe API; działa w obu środowiskach APNs). `node:http2` odpada jako zapas: na produkcji zawiódł
wewnątrz środowiska Edge (wcześniejsze 500 przy wariancie „both” miało tę samą przyczynę). Token dostawcy
buforowany i odnawiany co 20–60 minut (wymóg Apple: nie częściej niż co 20 min, nie starszy niż 1 h).

## Co zostaje otwarte
- Dostarczenie prawdziwego powiadomienia na iPhone (potrzebny token urządzenia z pierwszego buildu).
- ~~Środowisko produkcyjne APNs~~ — potwierdzone 7.10.2026 (fetch, 400 BadDeviceToken).
- Funkcja `apns-spike` do usunięcia z projektu Supabase (kod zostaje w repozytorium jako zapis spike'a).
