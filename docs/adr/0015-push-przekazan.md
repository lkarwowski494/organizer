# 0015. Powiadomienia push o przekazaniach (7.10.2026)

Decyzja właściciela D70: przekazanie to „push + w aplikacji”. Ten dokument opisuje, jak działa push.

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Kto uruchamia wysyłkę: telefon strony, która działała.**
   - Po tym, jak serwer potwierdzi przekazanie albo decyzję, telefon woła funkcję `notify-handoff`.
   - Rozpoznaje to po polach, które wpisuje tylko serwer: nadawca, `created_at` i `decided_at`.
   - Odrzucone: wyzwalacz w bazie wołający funkcję przez `pg_net`. Byłby niezależny od telefonu, ale wymagałby trzymania w bazie adresu funkcji i wspólnego sekretu, a to dodatkowa konfiguracja i dodatkowy sekret.
   - Koszt wybranego rozwiązania: gdy telefon nadawcy zamknie się przed potwierdzeniem, push wyjdzie przy jego następnym uruchomieniu. Odbiorca i tak widzi przekazanie w aplikacji po synchronizacji.
2. **Kto dostaje i co: decyduje baza** (`handoff_push_claim`, wywoływane tylko kluczem tajnym).
   - Pytający musi być stroną przekazania. Nowe przekazanie zgłasza nadawca, decyzję zgłasza odbiorca.
   - Każdy stan przekazania powiadamia najwyżej raz (`push_sent_status`, blokada wiersza).
   - Audyt 2 (M-75): gdy APNs nie przyjął powiadomienia u żadnego urządzenia (500/503/429, wygasły token dostawcy, sieć), funkcja zwalnia zaznaczenie (`push_claim_release`, klucz `key` z odpowiedzi claim) i odpowiada 502; telefon ponawia przy powrocie do aplikacji albo przy następnym uruchomieniu. Zaznaczenie zostaje przy claim (nie dopiero po wysyłce), więc funkcja w starszej wersji i dwa wywołania naraz dalej powiadamiają najwyżej raz. Odrzucone: zaznaczanie dopiero po wysyłce (potwierdzenie, które nie dotrze, dałoby drugie powiadomienie) i kolejka ponowień w bazie (pg_cron — więcej pracy).
   - Przekazania i decyzje starsze niż `config.PUSH_MAX_AGE_H` (24 h) nie powiadamiają, żeby po instalacji nie przyszły powiadomienia o starych sprawach.
3. **Treść powiadomień:**
   - nowe przekazanie: „<imię> przekazuje Ci” z tytułem sprawy;
   - decyzja: „<imię> przyjmuje” albo „<imię> nie przyjmuje” z tytułem sprawy.

   W treści nie ma niczego poza tym, co odbiorca i tak widzi w aplikacji.
   Audyt 2 (M-138): teksty w jednym miejscu (`private.push_texts()` = `strings['push.text.*']`, test kontraktowy), termin
   serii z nazwą i dniem z wyjątku, dzień jak na karcie „Do potwierdzenia” („Basen – zawody (Czwartek, 15 października)”,
   `private.pl_long_date`). Dotknięcie otwiera skrzynkę „Do potwierdzenia” (PWD-16, `path` w odpowiedzi claim, w APNs pod
   kluczem `body`).
4. **Tokeny urządzeń** (`push_tokens`):
   - telefon tylko je rejestruje i wyrejestrowuje, nie odczytuje ich;
   - token przechodzi na nowe konto przy zmianie konta na tym samym telefonie;
   - token odrzucony przez APNs (410 albo BadDeviceToken) jest usuwany;
   - audyt 2 (M-65): telefon pamięta ostatni zarejestrowany token (pęk kluczy), więc wylogowanie zdejmuje go także po nieudanej rejestracji przy starcie; token zmieniony przez APNs w trakcie działania od razu trafia na serwer (`addPushTokenListener`); rejestracja ponawia się po powrocie do aplikacji (zgoda włączona w Ustawieniach iPhone'a). Bez internetu przy wylogowaniu token zostaje do zalogowania innego konta albo unieważnienia przez Apple (pytanie do właściciela).
5. **APNs:**
   - tylko `fetch` (ADR 0002);
   - token dostawcy JWT ES256, używany ponownie przez 30 minut w ciepłej instancji (Apple: nie częściej niż co 20 minut, nie dłużej niż godzinę);
   - wtyczka `expo-notifications` ustawia środowisko „production”, bo buildy idą przez TestFlight;
   - audyt 2 (M-197): telefon zgłasza środowisko tokenu z uprawnienia `aps-environment` podpisanego buildu (`expo-application`), a nie z `__DEV__` — build deweloperski z produkcyjnym uprawnieniem nie zapisuje już tokenu jako sandbox.
6. **Zgoda na powiadomienia:**
   - prośba to karta „Powiadomienia o przekazaniach” na „Dotyczy mnie”, tylko dla osób we wspólnej grupie; → zastąpione: karta dla każdego (ADR 0016, decyzja wykonawcza 1).
   - „Włącz” otwiera okno systemowe, „Nie teraz” chowa kartę na tym telefonie;
   - włączyć później można w Ustawieniach → Powiadomienia: „Włącz powiadomienia” (okno systemowe), a po odmowie „Otwórz Ustawienia iPhone’a” (audyt 2, M-32); zgoda od razu planuje przypomnienia (M-101).

   Odrzucone: okno systemowe zaraz po zalogowaniu. Apple zaleca pytać w kontekście, a odmowy w oknie nie da się potem cofnąć z aplikacji.

Koszt: APNs jest bezpłatne. Funkcje Supabase w planie Free mają limit 500 tys. wywołań miesięcznie, a jedno przekazanie to 1–2 wywołania.
