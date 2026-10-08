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
- Sign-in required: **tak**. Nie trzeba konta demo: recenzent loguje się przez **Sign in with Apple** albo linkiem e-mail.
- Notes:
  > Sign in with Apple. To test: create a group (Grupy → Nowa grupa), add a list and a task such as "dentysta jutro o 17" (dentist, tomorrow 5 pm) in the quick-add field, then open "Dziś". Handoffs need a second account in the same group (invite code from Grupy → group → Zaproś).

## 3. Grupa zewnętrzna i link
1. External Testing → „+” → nazwa np. „Testy publiczne”.
2. Add build → najnowszy build → What to Test (poniżej) → Submit for Review (pierwszy raz Apple sprawdza betę, zwykle 1–2 dni).
3. Po akceptacji: Testers → **Create Public Link** → Open to Anyone (możesz ustawić limit, np. 50 osób).

**What to Test**, PL:
> Sprawdź: dodawanie szybkim polem („dentysta jutro o 17”), listy zakupów z dniem i osobą, przekazanie zadania drugiej osobie, przypomnienia (Ustawienia → Przypomnienia), powtarzanie zadań, tryb jasny i ciemny. Uwagi wysyłaj zrzutem ekranu z TestFlight.

## 4. Pierwsze uruchomienie na iPhonie (O-037) — lista kontrolna
- [ ] Kroje: nagłówki Bricolage Grotesque, tekst Atkinson Hyperlegible (nie systemowe).
- [ ] Godziny w czasie polskim (Intl w Hermesie, spike S3): wydarzenie 17:00 pokazuje 17:00.
- [ ] Baza na telefonie (expo-sqlite, S4): po zamknięciu i otwarciu dane są, offline też.
- [ ] Logowanie: Apple i link e-mail; imię z Apple w grupach.
- [ ] Powiadomienia: karta zgody, przypomnienie 30 min przed, poranne o 8:00, push o przekazaniu.
