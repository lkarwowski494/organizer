# Klikalny link zaproszenia (D94) — kroki właściciela

Zaproszenie to **ID grupy (9 cyfr) + kod (6 cyfr, 24 h)**. ID i kod działają od razu, bez żadnej konfiguracji.
Klikalny link `https://lkarwowski494.github.io/j/?g=…&c=…` wymaga dwóch kroków po Twojej stronie.

## Krok 1. Strona zaproszeń (GitHub, ~2 min)
1. GitHub → **New repository**.
2. Nazwa dokładnie: `lkarwowski494.github.io`, **Public**, bez README (puste).
3. Daj znać — wgram stronę z katalogu `site/` tego repozytorium (ja nie mogę zakładać repozytoriów).
4. W nowym repozytorium: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   gałąź `main`, katalog `/ (root)` → **Save**.

Po tym kroku strona pokazuje ID i kod z instrukcją. Przycisku z linkiem w schemacie aplikacji
(`io.github.lkarwowski494.organizer://join…`) nie ma (audyt 3, N-259): ten sam schemat może zarejestrować inna aplikacja
i przejąć kod — Apple: „If multiple apps register the same scheme, the app the system targets is undefined”
(https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app). Aplikację otwiera sam link
https po kroku 2.

Do wiadomości z zaproszeniem link trafia dopiero po przestawieniu `config.invites.LINK_LIVE` na `true` i nowym buildzie
(D141 — do tego czasu wiadomość ma tylko ID grupy i kod), i dopiero **po kroku 2** (decyzja Q23 A, 9.10.2026): bez
Universal Links link otwiera tylko stronę. Pilnuje tego test `src/config/__tests__/site.contract.test.ts` (`LINK_LIVE`
wymaga `ios.associatedDomains` z `applinks:lkarwowski494.github.io` w `app.json`).
Koszt: zero (GitHub Pages dla repozytoriów publicznych).

## Krok 2. Otwieranie aplikacji prosto z linku (Apple Developer, ~1 min)
1. https://developer.apple.com/account/resources/identifiers/list → **io.github.lkarwowski494.organizer**.
2. Zaznacz **Associated Domains** → **Save** (bez dodatkowej konfiguracji na tej stronie).
3. Daj znać — uruchomię `match-bootstrap` z `renew_profile` (nowy profil z tą możliwością), dopiszę domenę
   do aplikacji i wypuszczę build.

Bez kroku 2 build z domeną nie podpisze się, dlatego domena trafia do aplikacji dopiero po nim.

Źródło wymagań Apple: https://developer.apple.com/documentation/xcode/supporting-associated-domains
(„You must host the file using HTTPS with a valid certificate and with no redirects”; od iOS 14 plik pobiera CDN Apple).
