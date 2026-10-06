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

## Decyzja
D6 zostaje: push bezpośrednio do APNs z Edge Function. Docelowa implementacja używa `fetch`
(standardowe API, prostsze niż `node:http2`); `node:http2` pozostaje zapasem. Token dostawcy
buforowany i odnawiany co 20–60 minut (wymóg Apple: nie częściej niż co 20 min, nie starszy niż 1 h).

## Co zostaje otwarte
- Dostarczenie prawdziwego powiadomienia na iPhone (potrzebny token urządzenia z pierwszego buildu).
- Środowisko produkcyjne APNs (`api.push.apple.com`) — buildy z TestFlight używają produkcyjnego.
