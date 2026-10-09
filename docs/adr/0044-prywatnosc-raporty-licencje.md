# 0044. Raporty błędów z przełącznikiem, polityka prywatności na stronie, licencje w aplikacji (9.10.2026)

Audyt 3, paczka PK-25 (N-74, N-75, N-76, N-77, N-78, N-229). Decyzje właściciela: Q3 A (raporty), Q4 A (strona
polityki, administrator z imieniem i nazwiskiem i osobnym adresem, treść RODO pisana samodzielnie — prawnik to decyzja
kosztowa właściciela), Q22 A (licencje w aplikacji). Pozostałe rozstrzygnięcia merytoryczne niżej, ze źródłami.

## Decyzja
- **Raporty błędów i samosprawdzenie** wysyłamy tylko przy włączonym przełączniku „Wysyłaj raporty błędów” (Ustawienia →
  Konto i dane; domyślnie włączony, ustawienie konta na tym telefonie — klucz `local:errorReports`). Każde zgłoszenie
  przechodzi przez `gatedReport` (`src/app/diagnostics.tsx`), także granice błędów ekranów; ekran awarii przy
  wyłączonych raportach nie obiecuje zgłoszenia. Ekran logowania mówi o raportach jednym zdaniem. Apple 5.1.1(ii): „Apps
  must also provide the customer with an easily accessible and understandable way to withdraw consent.”
  (https://developer.apple.com/app-store/review/guidelines/). „Wyślij uwagę” to świadoma wysyłka — bez przełącznika.
- **Podstawa prawna raportów: prawnie uzasadniony interes (RODO art. 6 ust. 1 lit. f), przełącznik = sprzeciw (art. 21).**
  Włączenie domyślne nie jest zgodą w rozumieniu RODO — motyw 32: „Milczenie, okienka domyślnie zaznaczone lub
  niepodjęcie działania nie powinny zatem oznaczać zgody.” (Dz.U. UE L 119 z 4.5.2016,
  https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679). Apple dopuszcza tę drogę: ten sam punkt 5.1.1(ii)
  mówi o aplikacjach, które „collect data for a legitimate interest without consent by relying on the terms of the
  European Union’s General Data Protection Regulation”.
- **Polityka prywatności** ma jedno źródło: `docs/privacy-policy.md`; strona `site/privacy/index.html` (GitHub Pages,
  adres `config.privacy.POLICY_URL`) powstaje z niego skryptem `scripts/site/privacy-html.cjs`. Link „Polityka
  prywatności” w Ustawieniach → Konto i dane i na ekranie logowania. Apple 5.1.1(i): „All apps must include a link to
  their privacy policy in the App Store Connect metadata field and within the app in an easily accessible manner.”
- **Treść według RODO art. 13 i 14:** administrator (`config.privacy.CONTROLLER`; adres `CONTACT_EMAIL` = `null`, dopóki
  właściciel nie założy osobnej skrzynki — do tego czasu „Wyślij uwagę” i adres z TestFlight), cele i podstawy przy
  każdym rodzaju danych (umowa — art. 6 ust. 1 lit. b; prawnie uzasadniony interes — lit. f), odbiorcy (Supabase Pte.
  Ltd. jako podmiot przetwarzający na podstawie DPA: „Supabase shall only Process Covered Data on behalf of and under the
  instructions of Customer”, https://supabase.com/legal/customer-resources/data-processing-addendum; Apple), przekazanie
  poza EOG (DPA: „acceptance of the Agreement shall have the same effect as signing the SCCs”; Apple: standardowe
  klauzule umowne, https://www.apple.com/pl/legal/privacy/pl/), okresy z `src/config`, prawa, skarga do Prezesa UODO
  (adres z https://uodo.gov.pl/pl/p/kontakt), dobrowolność, brak zautomatyzowanych decyzji. Dane osób wpisanych przez
  innych (dzieci bez kont): źródło i podstawa (art. 14; lit. f — interes osób w grupie).
- **Konto dziecka:** podstawą jest prawnie uzasadniony interes rodziców i dziecka (art. 6 ust. 1 lit. f, który każe
  ważyć interesy „w szczególności gdy osoba, której dane dotyczą, jest dzieckiem”), a nie zgoda dziecka — art. 8 ust. 1
  dotyczy tylko sytuacji, gdy „zastosowanie ma art. 6 ust. 1 lit. a)”. Konto dziecka łączy z profilem dorosły (D155).
- **Licencje:** Ustawienia → Licencje z pełnymi tekstami licencji pakietów z paczki iOS, krojów i bibliotek natywnych.
  Lista `src/licenses/third-party.json` powstaje z mapy źródeł prawdziwej paczki (`scripts/licenses/gen-licenses.mjs`),
  CI sprawdza zgodność (`npm run check:licenses`), test kontraktowy — wersje, licencje, zależności, importy, kroje
  i podspeki. MIT: „The above copyright notice and this permission notice shall be included in all copies or substantial
  portions of the Software.”; SIL OFL 1.1 pkt 2: „…provided that each copy contains the above copyright notice and this
  license.”
- Pilnują tego: `src/config/__tests__/privacy-policy.contract.test.ts`, `licenses.contract.test.ts`,
  `src/app/__tests__/privacy.screens.test.tsx`.

## Odrzucone
- **Pytanie o zgodę przy pierwszym uruchomieniu (Q3 B)** — wybór właściciela A; prawnie uzasadniony interes ze sprzeciwem
  spełnia oba wymagania bez dodatkowego okna.
- **Zgoda jako podstawa raportów przy włączeniu domyślnym** — sprzeczne z motywem 32.
- **Zgoda (art. 6 ust. 1 lit. a) jako podstawa danych dziecka z kontem** — wymagałaby weryfikacji zgody rodzica
  (art. 8 ust. 2) i nie pasuje do aplikacji, której używa cała rodzina; dorosły i tak łączy konto dziecka.
- **Polityka jako ekran w aplikacji (Q4 B)** — Apple i tak wymaga adresu; dwa egzemplarze do pilnowania.
- **Licencje na stronie zamiast w aplikacji (Q22 B)** — nie wiadomo, czy link spełnia „included in all copies”.

## Decyzje właściciela z 9.10.2026
- **Publikacja:** GitHub Pages tego publicznego repozytorium, adres https://lkarwowski494.github.io/organizer/privacy/
  (`config.privacy.POLICY_URL`). Workflow `.github/workflows/pages.yml`: push na `main` ze zmianą `site/**` albo ręcznie;
  akcje przypięte do SHA, token domyślnie `contents: read`, zapis `pages: write` i `id-token: write` tylko w zadaniu
  deploy (środowisko `github-pages`, bez sekretów; wymóg z https://github.com/actions/deploy-pages); przed wgraniem
  sprawdza, że strona polityki jest aktualna. Krok właściciela: Settings → Pages → Source: GitHub Actions.
- **Build 23 bez adresu e-mail** (świadomy wyjątek): `CONTACT_EMAIL` = `null`, polityka ma zdanie przejściowe
  (kontakt przez „Wyślij uwagę” w aplikacji). **Adres trzeba dodać przed publikacją w App Store** — wtedy zdanie
  przejściowe znika; test kontraktowy oblewa adres obok zdania przejściowego, adres w polityce bez `CONTACT_EMAIL`
  i brak obu.

## Otwarte (do decyzji właściciela)
- Osobny adres e-mail administratora (`config.privacy.CONTACT_EMAIL`) — przed App Store (wyżej).
- Ocena prawna (podstawy, konto dziecka, ewentualny regulamin usługi) — prawnik to koszt; treść napisana według RODO.
