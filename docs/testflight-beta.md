# Szerokie testy: publiczny link TestFlight (O-048, decyzja właściciela z 7.10.2026)

Krok po kroku dla właściciela, w App Store Connect: Apps → Organizer grup PL → TestFlight.
Źródło: https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/

## 1. Test Information (lewy panel → Test Information)

**Beta App Description** (wymagane), PL:
> Organizer to wspólne listy, zakupy i kalendarz dla rodziny i znajomych. Widok „Moje sprawy” zbiera z wszystkich grup to, co jest na Tobie: zadania, wydarzenia i zakupy. Możesz przekazać sprawę innej osobie, a ona przyjmuje albo odrzuca. Wersja testowa — dane mogą się zmienić.

EN (dla recenzji Apple):
> Organizer is a shared to-do, shopping and calendar app for families and friends. The "Moje sprawy" (My things) view collects everything assigned to you across groups. You can hand a task over to another adult, who accepts or declines it. The app is in Polish.

**Feedback Email:** adres, na który testerzy mają pisać — wybierz sam (do repozytorium go nie wpisuję).

**Privacy Policy URL:** link do `docs/privacy-policy.md` w publicznym repozytorium
(https://github.com/lkarwowski494/organizer/blob/main/docs/privacy-policy.md) — po Twoim zatwierdzeniu treści.

## 2. Beta App Review Information
- Contact: imię, nazwisko, telefon, e-mail — Twoje dane (tylko w App Store Connect).
- Sign-in required: **tak**. Nie trzeba konta demo: recenzent loguje się przez **Sign in with Apple** (w becie jedyny
  sposób logowania — decyzja D177 z 8.10.2026; logowanie linkiem e-mail jest wyłączone w aplikacji, a dostawcę Email
  w Supabase Auth wyłączasz po wydaniu tego buildu — O-110).
- Notes:
  > Sign-in is with Sign in with Apple only (use any Apple ID). To test: type a task such as "dentysta jutro o 17" (dentist, tomorrow at 5 pm) in the quick-add field on the first tab — no list is needed, the task goes to the group shown on the chip next to the field. Groups: Grupy → Nowa grupa. Handoffs need a second account in the same group (Grupy → group → Zaproś gives a group ID and a 6-digit code).

  Przed wysyłką do recenzji sprawdź, czy nazwy w notatce (zakładki, przyciski) zgadzają się z bieżącym buildem
  (`src/i18n/strings.pl.ts`: `tabs.*`, `groups.new`, `groups.invite`).

## 3. Grupa zewnętrzna i link
1. External Testing → „+” → nazwa np. „Testy publiczne”.
2. Add build → najnowszy build → What to Test (poniżej) → Submit for Review (pierwszy raz Apple sprawdza betę, zwykle 1–2 dni).
3. Po akceptacji: Testers → **Create Public Link** → Open to Anyone (możesz ustawić limit, np. 50 osób).
4. Skopiowany link (`https://testflight.apple.com/join/…`) wpisz do `config.invites.TESTFLIGHT_LINK` w `src/config/index.ts`
   (dziś `null`): wiadomość z zaproszeniem do grupy dopisze wtedy „Nie masz jeszcze aplikacji? Zainstaluj ją przez
   TestFlight: …” (decyzja PW-7 A z 8.10.2026).

**What to Test**, PL:
> Sprawdź: dodawanie szybkim polem („dentysta jutro o 17”), listy zakupów z dniem i osobą, przekazanie zadania drugiej osobie, przypomnienia i poranne podsumowanie dnia (Ustawienia → Powiadomienia), powtarzanie zadań, tryb jasny i ciemny. Uwagi wysyłaj zrzutem ekranu z TestFlight.

## 4. Pierwsze uruchomienie na iPhonie (O-037) — lista kontrolna
- [ ] Kroje: nagłówki Bricolage Grotesque, tekst Atkinson Hyperlegible (nie systemowe).
- [ ] Godziny w czasie polskim (Intl w Hermesie, spike S3): wydarzenie 17:00 pokazuje 17:00.
- [ ] Baza na telefonie (expo-sqlite, S4): po zamknięciu i otwarciu dane są, offline też.
- [ ] Logowanie: tylko Apple (D177); imię z Apple w profilu i w grupach (M-186).
- [ ] Wylogowanie (D176): drugi iPhone/iPad tego konta zostaje zalogowany.
- [ ] Wylogowanie bez internetu (tryb samolotowy), potem sieć: powiadomienia starego konta przestają przychodzić.
- [ ] Usunięcie konta: okno Apple (świeży kod), po usunięciu plik bazy konta znika (M-64, M-303); ekran logowania mówi
      „Konto zostało usunięte.”, a zamknięcie okna Apple krzyżykiem nie pokazuje błędu (audyt 3, N-72).
- [ ] Sekrety Sign in with Apple (audyt 3, N-99): w panelu Supabase → Edge Functions → Secrets są `APPLE_SIWA_KEY_P8`,
      `APPLE_SIWA_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`; po pierwszym usunięciu konta testowego w logach funkcji
      `delete-account` nie ma „not_configured”, a w tabeli `client_errors` nie ma wpisu „delete-account: apple not_configured”
      (wtedy token Apple został unieważniony — odpowiedź `apple: "revoked"`).
- [ ] Usunięcie konta z przerwaniem sieci zaraz po naciśnięciu (audyt 3, N-228): po powrocie sieci ponowna próba kończy
      się ekranem „Konto zostało usunięte.”, a nie błędem.
- [ ] Pęk kluczy po usunięciu aplikacji (M-165, W): zainstaluj ponownie — sesja i wygląd mogą zostać (Expo: „will persist
      across app uninstallations … not guaranteed”), ustawienia konta (wprowadzenie, przypomnienia) zaczynają od zera,
      bo są w bazie konta. Zapisz wynik.
- [ ] Powiadomienia: karta zgody, przypomnienie 30 min przed (przy wydarzeniu i zadaniu z podzadaniami jedno zbiorcze,
      D134), poranne podsumowanie dnia o 8:00 (D110), push o przekazaniu i przypisaniu.
