/**
 * Jedyne źródło liczb i reguł aplikacji (zasada „jedno źródło prawdy”).
 * Każda zmiana wartości tutaj wymaga wpisu w rejestrze decyzji (docs/adr).
 * Limity po stronie serwera (SQL) muszą być z nimi zgodne — pilnuje tego test kontraktowy
 * src/config/__tests__/sql.contract.test.ts (funkcje private.* w supabase/migrations).
 */
export const config = {
  /** D4: maksymalna głębokość zagnieżdżenia podzadań (0 = zadanie główne, 2 = pod-podzadanie). */
  MAX_TASK_DEPTH: 2,

  /** Jak długo widać pasek „Cofnij” po usunięciu (ms). Wybór projektowy, bez źródła zewnętrznego. */
  UNDO_MS: 6000,

  /**
   * VoiceOver (audyt 2: M-44, M-269; src/ui/a11y.ts): po ilu ms przenosimy fokus na nowo pokazany element (widok musi być
   * już na ekranie) i jak długo po pokazaniu paska „Cofnij” ma on pierwszeństwo przed tytułem nowego ekranu (przejście
   * na stosie trwa ok. 0,35 s). SYNC_CALM_MS (audyt 3, N-198): powrót synchronizacji do normy po problemie (offline,
   * błąd) ogłaszamy dopiero, gdy trwa tyle ms bez nowego problemu — przy „migającej” sieci (metro) bez ogłoszenia
   * każdego przejścia. Wybory projektowe bez źródła zewnętrznego — do sprawdzenia na iPhonie z VoiceOverem.
   */
  a11y: { FOCUS_DELAY_MS: 100, PIN_MS: 1500, SYNC_CALM_MS: 10_000 },

  /**
   * „Ostatnie zmiany” (D194): ile ostatnich zmian z „Cofnij” pamięta aplikacja od uruchomienia i ile wpisów jednej
   * sekcji kosza (D151) widać przed „Pokaż wszystkie”. Wybory projektowe, bez źródła zewnętrznego.
   */
  RECENT_MAX: 30,
  TRASH_PREVIEW: 5,

  /**
   * Zgłaszanie błędów i opinii (D80). Serwer egzekwuje te same liczby (private.client_errors_per_day,
   * feedback_per_day, feedback_retention_days; test kontraktowy). Wybory projektowe, bez źródła.
   * Długości pól zgłoszenia błędu (ERROR_*; ograniczenia kolumn client_errors i obcięcie w report_client_error, także
   * screen i app_version opinii — audyt 2, M-154, D-23; kontrakt z bazą: tests/db/config-sql.test.ts).
   */
  feedback: { ERRORS_PER_DAY: 50, PER_DAY: 20, RETENTION_DAYS: 90, MAX_LENGTH: 2000, ERROR_MESSAGE_MAX: 500, ERROR_STACK_MAX: 4000, SCREEN_MAX: 100, VERSION_MAX: 40 },

  /**
   * Zakupy (D85, D86): ile podpowiedzi przy wpisywaniu, ile stałych pozycji na liście i ich długość
   * (SQL: private.staples_max(), private.staple_max_length(); test kontraktowy). Wybory projektowe, bez źródła.
   */
  shopping: { SUGGESTIONS: 5, STAPLES_MAX: 50, STAPLE_MAX_LENGTH: 200 },

  /**
   * Ekran listy (audyt 3, N-52): zrobione z ostatnich DONE_RECENT_DAYS dni po rozwinięciu „Zrobione (N)”, starsze dopiero
   * po „Pokaż starsze”. Tyle co kosz (sync.TOMBSTONE_DAYS) — wybór projektowy, bez źródła.
   */
  lists: { DONE_RECENT_DAYS: 30 },

  /**
   * Imię (D100): najdłuższe imię w profilu i w grupach — z ograniczeń kolumn display_name w SQL (profiles,
   * group_members; test kontraktowy). Wartość z pierwszej migracji, wybór projektowy bez źródła.
   */
  profile: { NAME_MAX_LENGTH: 100 },

  /**
   * Najdłuższe nazwy (audyt 2, M-228): z ograniczeń kolumn w SQL — groups.name i lists.name do 200 znaków, tasks.title
   * do 500 (test kontraktowy). Pole nie przyjmie więcej (maxLength) i mówi o tym, zamiast odrzucenia zmiany po
   * synchronizacji. Wartości z pierwszych migracji, wybór projektowy bez źródła.
   * Także (audyt 2, M-154; kontrakt z bazą: tests/db/config-sql.test.ts): EVENT_TITLE — tytuł wydarzenia i wyjątku
   * (events, event_overrides), NOTE — notatka zadania i wydarzenia; tytuł serii zadań przy wydarzeniu to TASK_TITLE (z serii
   * powstają zadania); PUSH_TOKEN_MIN/MAX — token APNs (cyfry szesnastkowe, push_tokens_token_check).
   * SORT_KEY (audyt 3, N-2): najdłuższy klucz kolejności zadania i listy (tasks/lists.sort_key, ograniczenia
   * *_sort_key_length) — klucze telefonu mają kilka znaków ('a0'), zapas na klucze wstawiane między dwa istniejące;
   * bez limitu jedna porcja pobrania mogła ważyć dziesiątki MB. Wybór projektowy, bez źródła.
   */
  lengths: { GROUP_NAME: 200, LIST_NAME: 200, TASK_TITLE: 500, EVENT_TITLE: 200, NOTE: 10_000, PUSH_TOKEN_MIN: 64, PUSH_TOKEN_MAX: 200, SORT_KEY: 128 },

  /**
   * Zakres dat (audyt 3, N-1): serwer przyjmuje dzień od MIN do MAX (każda kolumna date w public, ograniczenia
   * <tabela>_<kolumna>_range), godzinę przed 24:00, a chwilę zrobienia (completed_at, done_at) od MIN 00:00 UTC do końca
   * MAX. Dotąd przechodziły np. 'infinity' i rok p.n.e., na których telefon (parseIsoDate) padał u całej grupy. Wybór
   * projektowy, bez źródła: MIN mieści daty urodzin najstarszych członków rodziny (urodziny jako wydarzenie co rok), MAX —
   * każdy plan; kontrakt z bazą: tests/db/config-sql.test.ts.
   */
  dates: { MIN: '1900-01-01', MAX: '2199-12-31' },

  /**
   * Reguła powtarzania wydarzenia (RRULE, D57): najdłuższy zapis, największy odstęp (INTERVAL) i liczba wystąpień
   * (COUNT) — telefon (src/domain/rrule.ts) i serwer (private.rrule_ok) te same (audyt 2, M-154; kontrakt z bazą:
   * tests/db/config-sql.test.ts, zgodność reguł: tests/db/rrule-contract.test.ts). Wybory projektowe, bez źródła.
   */
  rrule: { MAX_LENGTH: 200, INTERVAL_MAX: 99, COUNT_MAX: 1000 },

  /**
   * Wydarzenia. LOCATION_MAX_LENGTH (miejsce wydarzenia, ADR 0029): najdłuższy adres — z ograniczenia SQL private.event_location_max_length()
   * (test kontraktowy). MOVE_WINDOW_DAYS (ADR 0007): o ile dni wolno przenieść jedno wystąpienie — tyle zapasu bierze
   * rozwijanie serii; dalsze przeniesienie formularz odrzuca (audyt 8.10.2026). MAX_DAYS (D199): najdłuższe wydarzenie
   * całodniowe w dniach (obóz, wakacje u dziadków) — z ograniczenia SQL private.event_max_days() (test kontraktowy); tyle
   * dni wstecz widoki dnia szukają wydarzeń, które zaczęły się wcześniej. Wybory projektowe, bez źródła.
   * INTERVAL_MAX: największy odstęp powtarzania („co 99 tygodni”) — to samo sprawdza private.rrule_ok (test kontraktowy).
   */
  events: { LOCATION_MAX_LENGTH: 300, MOVE_WINDOW_DAYS: 62, MAX_DAYS: 31, INTERVAL_MAX: 99 },

  /**
   * Zadania na spotkaniu (D13, D14; ADR 0008): jak daleko naprzód szukamy kolejnego wystąpienia serii (przepinanie,
   * podgląd zmiany serii) i ile dni obejmuje lista spotkań do wyboru przy „Przepnij na inne spotkanie”.
   * Wybory projektowe, bez źródła.
   */
  eventTasks: { LOOKAHEAD_DAYS: 400, PICKER_DAYS: 62 },

  /**
   * Powtarzanie zadań (D76, ADR 0016): jak daleko naprzód szukamy następnego terminu reguły kalendarzowej.
   * Wybór projektowy, bez źródła (rok z zapasem obejmuje każdą regułę z formularza, także „co rok”).
   */
  repeat: {
    NEXT_SEARCH_DAYS: 400,
    /**
     * Audyt 2 (T-12): ile dni wstecz telefon dorosłego dokłada brakujące następne zadanie po odhaczeniu przez dziecko.
     * Wybór projektowy, bez źródła; musi być mniejszy niż sync.TOMBSTONE_DAYS (pilnuje test), żeby kopia usunięta
     * celowo i wyczyszczona z kosza nie wróciła.
     */
    MISSING_COPY_DAYS: 7,
  },

  /**
   * Seria „N z rzędu” (D114, ADR 0028): okno wstecz w dniach i od ilu z rzędu licznik się pokazuje.
   * Wybory projektowe, bez źródła.
   */
  streak: { DAYS: 400, MIN_SHOWN: 2 },

  /**
   * Czas dojazdu (D116, D117): zapas doliczany do „wyjdź o”, co ile minut odświeżać, na ile godzin naprzód liczyć
   * (wydarzenia z miejscem zaczynające się w tym oknie, także po północy — audyt 2, M-211) i najwięcej zapytań naraz
   * (MapKit dławi zbyt wiele zapytań — MKError.loadingThrottled); adres, którego Mapy nie znalazły, sprawdzamy znowu po
   * GEO_RETRY_H godzinach, a zapamiętanych adresów jest najwyżej GEO_MAX (audyt 2, M-106). Wybory projektowe, bez źródła.
   */
  travel: { BUFFER_MIN: 5, REFRESH_MIN: 15, AHEAD_HOURS: 12, MAX_EVENTS: 8, GEO_RETRY_H: 24, GEO_MAX: 200 },

  /**
   * Widok dnia „lista z przerwami” (D122): najkrótsza przerwa między sprawami z godziną, którą pokazujemy jako
   * „wolne …”. Wybór projektowy, bez źródła (krótsze przerwy to zwykle tylko przejście między sprawami).
   */
  day: { GAP_MIN: 30 },

  /**
   * Szkic formularza z „Zapisz” na telefonie (D179, audyt 2 M-123): po ilu dniach przepada. Wybór projektowy, bez źródła
   * (tydzień przerwy to raczej porzucony zamiar niż wpis do dokończenia).
   */
  forms: { DRAFT_MAX_DAYS: 7 },

  /**
   * Zakres Moich spraw w dużej grupie (PW-2 A, audyt 2 M-35): od ilu osób grupa dostaje podpowiedź ustawienia „W Moich
   * sprawach” (po dołączeniu i utworzeniu) — liczą się wszyscy członkowie, także dzieci. Wybór osoby z wyszukiwaniem
   * (PWD-30 A, M-299): od ilu osób do wyboru zamiast rzędu przycisków. Wybory projektowe, bez źródła (rodzina mieści
   * się poniżej obu progów, klasa i grupa znajomych — powyżej).
   */
  myDays: { LARGE_GROUP_MEMBERS: 10 },
  people: { PICKER_SEARCH_FROM: 7 },

  /** Wybór godziny kafelkami (D125): krok minut. Wybór projektowy, bez źródła (inne minuty wpisuje się ręcznie). */
  time: { MINUTE_STEP: 5 },

  /**
   * Kalendarz iPhone'a w obie strony (D95, D96): okno odczytu moich wydarzeń i okno lustra grup (dni wstecz /
   * naprzód), limit wystąpień w lustrze, opóźnienie po zmianie danych; dubel z wpisem aplikacji (D173): różnica godzin
   * przy tej samej nazwie; długość wydarzenia bez godziny końca zapisywanego w iPhonie („Dodaj do kalendarza”,
   * ADR 0008, min). Wybory projektowe, bez źródła.
   */
  calendar: { DEFAULT_EVENT_MINUTES: 60, READ_DAYS_BACK: 31, READ_DAYS_AHEAD: 62, MIRROR_DAYS_BACK: 7, MIRROR_DAYS_AHEAD: 90, MIRROR_MAX: 500, MIRROR_DEBOUNCE_MS: 3000, DUPLICATE_WINDOW_MIN: 30 },

  /** Ile ostatnich wpisów historii pokazuje ekran zadania (D76). Wybór projektowy, bez źródła. */
  HISTORY_LIMIT: 15,

  /** Na ile tygodni naprzód telefon dokłada kopie stałych zadań serii (D65). Wybór projektowy, bez źródła. */
  SERIES_TASK_WEEKS: 8,

  /**
   * Powiadomienie o przekazaniu (D70) tylko dla przekazań/decyzji z ostatnich N godzin — żeby po instalacji wersji
   * z push nie przyszły powiadomienia o starych sprawach. Wybór projektowy, bez źródła. Ta sama wartość w funkcji
   * supabase/functions/notify-handoff (test kontraktowy).
   */
  PUSH_MAX_AGE_H: 24,

  /**
   * Przypomnienia na telefonie (D75, decyzja właściciela z 7.10.2026): domyślnie 30 min przed sprawą z godziną
   * i poranne podsumowanie o 8:00 — od D110 (ADR 0026) z całym dniem, nie tylko ze sprawami bez godziny; wydarzenie
   * i zadanie z podzadaniami mają jedno zbiorcze przypomnienie (D134, ADR 0035). Osoba zmienia to w Ustawieniach.
   * Wybory projektowe, bez źródła.
   */
  reminders: {
    LEAD_MIN: 30,
    LEAD_OPTIONS: [0, 10, 30, 60] as const,
    MORNING: '08:00',
    MORNING_OPTIONS: ['off', '07:00', '08:00', '09:00'] as const,
    /** „Czas wyjść” (D117) — osobny przełącznik, domyślnie włączony jak dotąd (PWD-17, decyzja właściciela 8.10.2026). */
    LEAVE: true,
    /**
     * Ile dni naprzód planuje telefon. Plan odświeża się przy każdej zmianie danych, uruchomieniu i cichym powiadomieniu
     * z serwera (D159, `wake` niżej); ciche powiadomienia nie mają gwarancji dostarczenia, więc okno jest długie — zapas
     * na dni bez otwierania aplikacji. Najbliższe MAX_SCHEDULED pozycji i tak wygrywa. Wybór projektowy, bez źródła.
     */
    DAYS_AHEAD: 14,
    /**
     * Najwyżej tyle zaplanowanych powiadomień naraz = limit iOS: „An app can have only a limited number of scheduled
     * notifications; the system keeps the soonest-firing 64 notifications (with automatically rescheduled notifications
     * counting as a single notification) and discards the rest.” (Apple, UILocalNotification,
     * https://developer.apple.com/documentation/uikit/uilocalnotification, przeczytane 9.10.2026; dawny adres archiwalny
     * przekierowuje tutaj). Klasa jest przestarzała od iOS 10 na rzecz UNNotificationRequest; strony UNNotificationRequest,
     * UNUserNotificationCenter.add i „Scheduling a notification locally from your app” (przeczytane tego dnia) liczby
     * nie podają, więc to jedyna przeczytana liczba Apple.
     * Plan bierze najbliższe, więc nadmiar i tak by przepadł.
     */
    MAX_SCHEDULED: 64,
    /** Ile spraw wymienia poranne podsumowanie z nazwy (D110, ADR 0026: „pierwsze cztery”); reszta jako „i N innych”. Wybór projektowy, bez źródła. */
    MORNING_LIST_MAX: 4,
    /**
     * Przypomnienia bliższe niż tyle od chwili planowania nie dostają wyzwalacza czasu (audyt 2, N-7) — idą od razu, jeśli
     * nie są już zaplanowane (audyt 3, N-112; src/app/push.ts): iOS odrzuca wyzwalacz z odstępem ≤ 0
     * („This value must be greater than zero”, Apple: UNTimeIntervalNotificationTrigger,
     * https://developer.apple.com/documentation/usernotifications/untimeintervalnotificationtrigger/init(timeinterval:repeats:)),
     * a datę ucina do sekundy.
     * 5 s — zapas na czas między policzeniem planu a zaplanowaniem; wybór projektowy.
     */
    SCHEDULE_MARGIN_MS: 5_000,
  },

  /**
   * Ciche powiadomienia „odśwież przypomnienia” (D159, ADR 0016): po zmianie, która może zmienić czyjeś przypomnienia,
   * telefon prosi serwer (funkcja notify-handoff, `groups`), a serwer budzi telefony członków grupy; budzony telefon
   * pobiera zmiany i planuje przypomnienia od nowa. Apple: „The system treats background notifications as low priority
   * … the system doesn't guarantee their delivery … don't try to send more than two or three per hour”
   * (https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).
   */
  wake: {
    /**
     * Najmniejszy odstęp między cichymi powiadomieniami do jednego urządzenia (minuty): 20 min = najwyżej 3 w każdej
     * godzinie, górna granica zalecenia Apple. Ta sama wartość w private.wake_push_claim (test kontraktowy).
     */
    MIN_GAP_MIN: 20,
    /** Telefon zbiera zmiany przez tyle ms po ostatniej, zanim poprosi serwer (seria edycji = jedno powiadomienie); wyjście z aplikacji wysyła od razu. Wybór projektowy. */
    DEBOUNCE_MS: 30_000,
    /** Najwyżej tyle grup w jednej prośbie (funkcja i baza odrzucają więcej — test kontraktowy). Wybór projektowy. */
    MAX_GROUPS: 20,
    /** Ponowienie po błędzie sieci albo APNs: nie wcześniej niż po tylu ms. Wybór projektowy. */
    RETRY_MS: 60_000,
    /**
     * Odświeżenie w tle (src/app/background.ts) kończy się najpóźniej po tylu ms — Apple: „Your app has 30 seconds to
     * perform any tasks and call the provided completion handler” (strona wyżej); 5 s zapasu na zapis planu.
     */
    TASK_BUDGET_MS: 25_000,
    /** Najwięcej porcji pobrania w jednym odświeżeniu w tle (resztę pobierze otwarta aplikacja). Wybór projektowy. */
    PULL_PAGES_MAX: 10,
  },

  /**
   * Konto: ponawianie zaległego wyrejestrowania tokenu push po wylogowaniu bez sieci (src/sync/supabase.ts,
   * finishSignOut) — co minutę, gdy aplikacja działa. Wybór projektowy, bez źródła: odczyt pęku kluczy jest tani,
   * a minuta to dość szybko, by powiadomienia starego konta przestały przychodzić zaraz po powrocie sieci.
   */
  account: { SIGNOUT_RETRY_MS: 60_000 },

  /**
   * Synchronizacja (architektura: protokół synchronizacji). Serwer egzekwuje te same wartości funkcjami
   * private.* w migracjach SQL — zgodność pilnuje test kontraktowy src/config/__tests__/sql.contract.test.ts.
   * Źródło wartości: raport „Organizer grup architektura MVP” (paczka do ok. 100 operacji, porcja pull
   * ok. 1 000 wierszy, kosz 30 dni) — to wybrane limity projektowe, nie wymogi zewnętrzne.
   */
  sync: {
    PUSH_BATCH_MAX: 100,
    PULL_LIMIT_MAX: 1000,
    TOMBSTONE_DAYS: 30,
    /**
     * Wersja protokołu synchronizacji tej aplikacji (wysyłana w sync_push i sync_pull). 2 = kursor z epoką, listy
     * widoczne i zadania przeniesione poza wzrok, filtr encji (audyt 2, M-1, M-54, M-58; migracja 20261008310000).
     * Zasada: podbijamy, gdy zmienia się znaczenie zapytania albo odpowiedzi; serwer zachowuje stare znaczenie dla
     * starszych wersji, dopóki nie podniesiemy MIN_SCHEMA_VERSION.
     */
    SCHEMA_VERSION: 2,
    /**
     * Najstarsza wersja protokołu, którą serwer jeszcze obsługuje (private.schema_version() — test kontraktowy); starsza
     * dostaje upgrade_required, a aplikacja pokazuje „Zaktualizuj aplikację”. Podniesienie wyłącza stare buildy u testerów,
     * więc to decyzja właściciela (build 21 mówi protokołem 1).
     */
    MIN_SCHEMA_VERSION: 1,
    /**
     * Pętla synchronizacji (raport architektury, „Ograniczenie R1”): wysyłka ok. 1 s po lokalnej zmianie,
     * timer co 30–60 s, gdy kolejka nie jest pusta (wybrane 30 s), ponawianie z opóźnieniem 1 s → 60 s.
     * Mnożnik 2 to mój wybór (standardowe podwajanie), bez źródła zewnętrznego.
     */
    PUSH_DEBOUNCE_MS: 1000,
    PENDING_TIMER_MS: 30_000,
    BACKOFF_MIN_MS: 1000,
    BACKOFF_MAX_MS: 60_000,
    BACKOFF_FACTOR: 2,
    /**
     * Wartości domyślne kolumn z wartością domyślną, które telefon może zmieniać (patch_cols w private.sync_entities).
     * Wiersz utworzony na telefonie nie ma tych pól, dopóki nie wróci z serwera, więc „Cofnij” zmiany takiego pola
     * wpisuje tę wartość — nie null, który kolumna NOT NULL odrzuca (audyt 2, M-59). Zgodność z bazą: tests/db
     * (patch-defaults.test.ts czyta information_schema).
     */
    PATCH_DEFAULTS: {
      event_overrides: { all_day: false, cancelled: false, responsible_cleared: false },
      events: { audience: 'group', days: 1 },
      group_members: { role: 'member' },
      handoffs: { closed: false, status: 'pending' },
      lists: { sort_key: 'a0', staples: [], visibility: 'group' },
      tasks: { deadline_mode: 'none', rollover: true, sort_key: 'a0' },
    } as { readonly [entity: string]: { readonly [column: string]: unknown } },
    /**
     * „Przeciągnij, by odświeżyć” (PWD-10 A): najkrótszy czas kółka, żeby szybkie pobranie też dało znak. Wybór
     * projektowy, bez źródła.
     */
    REFRESH_SPIN_MS: 600,
  },

  /**
   * Zaproszenia. Nowe zaproszenia to wyłącznie ID grupy + kod (D92–D94, niżej); kod działa dla MAX_USES_LIMIT osób.
   * DEFAULT_TTL_HOURS, MAX_TTL_HOURS i DEFAULT_MAX_USES to dawne zaproszenia linkiem z tokenem (D48, 7.10.2026:
   * 7 dni, maks. 30, 10 użyć) — zastąpione przez D93 (ADR 0020); zostają, bo serwer nadal przyjmuje stare tokeny
   * (private.invite_*, test kontraktowy).
   */
  invites: {
    /**
     * Dołączanie jak do wideospotkania (D92–D94, decyzja właściciela z 8.10.2026): ID grupy 9 cyfr, kod 6 cyfr ważny 24 h,
     * limit nieudanych prób osoby na godzinę. D140 odwrócona (8.10.2026): zamiast limitu na ID grupy (cudze próby
     * blokowały poprawny kod) kod przestaje działać po JOIN_FAILS_PER_CODE nieudanych próbach na swoje ID grupy — szansa
     * odgadnięcia ≤ 100 / 10^6 na kod (rachunek w migracji 20261008362000_join_codes_v2). SQL: private.join_* (test
     * kontraktowy).
     */
    JOIN_ID_DIGITS: 9,
    CODE_DIGITS: 6,
    CODE_TTL_HOURS: 24,
    JOIN_FAILS_PER_USER: 5,
    JOIN_FAILS_PER_CODE: 100,
    /** Strona z linkiem zaproszenia (GitHub Pages, D94). Universal Links dla /j/ dopiero po krokach z docs/join-links.md (bez associatedDomains w app.json). */
    JOIN_LINK: 'https://lkarwowski494.github.io/j/',
    /** D141: link w wiadomości zaproszenia dopiero, gdy strona działa (docs/join-links.md, krok właściciela). */
    LINK_LIVE: false,
    /**
     * Decyzja właściciela z 8.10.2026 (audyt 2, PW-7 A): publiczny link TestFlight (https://testflight.apple.com/join/…)
     * w wiadomości z zaproszeniem — skąd wziąć aplikację. `null`, dopóki właściciel go nie utworzy w App Store Connect
     * (docs/testflight-beta.md, krok 3); do tego czasu wiadomość jest bez tego wiersza.
     */
    TESTFLIGHT_LINK: null as string | null,
    DEFAULT_TTL_HOURS: 168,
    MAX_TTL_HOURS: 720,
    DEFAULT_MAX_USES: 10,
    MAX_USES_LIMIT: 50,
  },

  /**
   * Polityka prywatności (audyt 3, N-75 i N-76; decyzja właściciela Q4 A): strona na tej samej witrynie co zaproszenia
   * (site/privacy/, GitHub Pages), generowana z docs/privacy-policy.md; link w Ustawieniach → Konto i dane i na ekranie
   * logowania. Apple, App Review 5.1.1(i): „All apps must include a link to their privacy policy in the App Store Connect
   * metadata field and within the app in an easily accessible manner.”
   * (https://developer.apple.com/app-store/review/guidelines/). Administrator danych (RODO art. 13 ust. 1 lit. a —
   * „swoją tożsamość i dane kontaktowe”): właściciel aplikacji. `CONTACT_EMAIL` — osobny adres tylko dla Organizera,
   * `null`, dopóki właściciel go nie założy (do tego czasu polityka wskazuje „Wyślij uwagę”); polityka musi podawać
   * dokładnie te dane (test kontraktowy privacy-policy.contract.test.ts).
   */
  privacy: {
    POLICY_URL: 'https://lkarwowski494.github.io/privacy/',
    CONTROLLER: 'Łukasz Karwowski',
    CONTACT_EMAIL: null as string | null,
  },

  /**
   * Jak długo serwer (codzienne sprzątanie, private.run_daily_maintenance) i telefon trzymają dane, które same nie
   * znikają (audyt 2, M-62, M-68). Serwer egzekwuje te same liczby (private.*_days(); test kontraktowy). Wybory
   * projektowe, bez źródła zewnętrznego:
   *  - ACTIVITY_DAYS — historia zmian na serwerze i w telefonie (decyzja właściciela z 8.10.2026, D184, PW-47 A): ekran
   *    zadania pokazuje ostatnie zmiany, a powiadomienia o przypisaniu patrzą najwyżej PUSH_MAX_AGE_H wstecz;
   *  - HANDOFF_DAYS — rozstrzygnięte przekazania (przyjęte, odrzucone, anulowane) od decyzji; oczekujące zostają;
   *  - INVITE_DAYS — zaproszenia po wygaśnięciu, unieważnieniu albo wyczerpaniu (nikt ich już nie użyje);
   *  - ACCESS_EVENT_DAYS — dziennik zmian dostępu (private.access_events; nieczytany, sygnał idzie przez Realtime);
   *  - SYNC_CLIENT_DAYS — licznik nieużywanej instalacji (private.sync_clients) razem z jej zapamiętanymi odrzuceniami;
   *    instalacja, która wróci później, zaczyna licznik od nowa, a jej niepotwierdzone zmiany serwer przyjmuje jak zmiany
   *    po powrocie z trybu offline;
   *  - JOIN_ATTEMPT_DAYS — nieudane próby dołączenia (limity liczą godzinę i czas życia kodu, 24 h);
   *  - MAINTENANCE_RUN_DAYS — dziennik przebiegów sprzątania (private.maintenance_runs, M-194);
   *  - PUSH_LOG_DAYS — dziennik wysłanych powiadomień (private.push_log_retention_days; musi być dłuższy niż
   *    PUSH_MAX_AGE_H, test kontraktowy); CRON_HISTORY_DAYS — historia zadań pg_cron (private.cron_history_days)
   *    — audyt 2, M-154, D-23; wybory projektowe, bez źródła.
   *  - TRIP_DAYS — zrobione zakupy w Kalendarzu (PWD-11 A, public.shopping_trips), jak historia zmian.
   */
  retention: { ACTIVITY_DAYS: 90, HANDOFF_DAYS: 90, INVITE_DAYS: 30, ACCESS_EVENT_DAYS: 30, SYNC_CLIENT_DAYS: 180, JOIN_ATTEMPT_DAYS: 1, MAINTENANCE_RUN_DAYS: 90, PUSH_LOG_DAYS: 7, CRON_HISTORY_DAYS: 7, TRIP_DAYS: 90 },

  /**
   * Twarde limity na konto (decyzja właściciela z 8.10.2026, D183, PW-44 A; audyt 2, M-70): jedno konto nie zapełni bazy
   * planu Free (500 MB — projekt przechodzi wtedy w tryb tylko do odczytu dla wszystkich) ani nie wyczerpie limitów
   * Realtime i Edge Functions. Serwer egzekwuje te liczby (private.max_*(); test kontraktowy). Wybory projektowe, bez
   * źródła zewnętrznego — każda z dużym zapasem nad zwykłym użyciem:
   *  - SHARED_GROUPS — grupy wspólne, w których jestem (także te w koszu): rodzina, dalsza rodzina, znajomi, klasy dzieci
   *    to zwykle kilka; ponad limit tworzenie i dołączanie kończy się komunikatem;
   *  - ACTIVE_INVITES — aktywne zaproszenia grupy: aplikacja wystawia najwyżej jeden kod na rolę (PW-41 A), reszta to
   *    dawne linki; limit zatrzymuje tylko nadużycie;
   *  - PUSH_TOKENS — urządzenia z powiadomieniami na konto (telefon, iPad, ponowne instalacje); nadmiarowy najdawniej
   *    odświeżony token wypada (nikt nie dostaje błędu);
   *  - SYNC_CLIENTS — instalacje aplikacji na konto; nadmiarowa najdawniej używana wypada (jak wyżej);
   *  - SYNC_PUSH_PER_MINUTE — wywołania sync_push na konto na minutę: telefon wysyła najwyżej raz na sekundę
   *    (sync.PUSH_DEBOUNCE_MS), więc dwa urządzenia używane naraz mieszczą się w limicie; ponad limit telefon ponawia
   *    z opóźnieniem (sync.BACKOFF_*), nic nie ginie;
   *  - NOTIFY_PER_HOUR — prośby o powiadomienie (funkcja notify-handoff) na konto na godzinę; ponad limit powiadomienie
   *    nie idzie, a zmiana i tak jest w aplikacji.
   *  - GROUP_ROWS, GROUP_BYTES — limit grupy (audyt 3, N-2; decyzja Q12 część 3 A, 9.10.2026): najwięcej żywych
   *    (nieusuniętych) wierszy wszystkich spraw grupy (zadania, listy, wydarzenia, uczestnicy, zakupy, członkowie…) i ich
   *    łączny rozmiar w bajtach (JSON wiersza, jak przy pobieraniu). Rodzina z codziennymi zadaniami ma ich setki do kilku
   *    tysięcy na rok (zrobione znikają po roku); wiersz to zwykle ok. 0,7 KB. Ponad limit zapis jest odrzucany
   *    z wyjaśnieniem w „Odrzuconych zmianach” (limit:group_rows, limit:group_size); usuwanie zawsze przechodzi;
   *  - WRITE_BYTES_PER_DAY — bajty zapisanych żywych wierszy na konto na dobę, wspólnie przez sync_push i bezpośredni
   *    zapis do tabel (audyt 3, N-2): zwykły dzień to kilkadziesiąt KB; ponad limit telefon ponawia z opóźnieniem, nic nie
   *    ginie. Bez tego jedno konto zapełniłoby 500 MB w kilka minut.
   */
  quotas: { SHARED_GROUPS: 50, ACTIVE_INVITES: 20, PUSH_TOKENS: 10, SYNC_CLIENTS: 20, SYNC_PUSH_PER_MINUTE: 120, NOTIFY_PER_HOUR: 120, GROUP_ROWS: 20_000, GROUP_BYTES: 25 * 1024 * 1024, WRITE_BYTES_PER_DAY: 20 * 1024 * 1024 },

  /** Lokalizacja i strefa czasowa aplikacji (D30, R2). */
  LOCALE: 'pl-PL',
  TIME_ZONE: 'Europe/Warsaw',

  /**
   * Najniższa wersja iOS (D35, `ios.deploymentTarget` w app.json; test kontraktowy). Tyle wymaga Expo SDK 57: tabela
   * obsługiwanych wersji systemów, wiersz „57.0.0 | 7+ | 36 | 36 | 16.4+ | 26.4+” (kolumna iOS version,
   * https://docs.expo.dev/versions/v57.0.0/), i tyle mają podspeci Expo (`:ios => '16.4'`, node_modules/expo/Expo.podspec).
   * Funkcje z iOS 17+ (zgoda tylko na zapis do kalendarza) mają na iOS 16 zachowanie zastępcze — src/app/device-calendar.ts.
   */
  IOS_MIN: '16.4',
  /** Identyfikatory Apple (D36) — jawne, nie są sekretami. */
  BUNDLE_ID: 'io.github.lkarwowski494.organizer',
  APP_GROUP: 'group.io.github.lkarwowski494.organizer',
  /**
   * Projekt Supabase (D1, D41: „organizer”, Frankfurt). Adres jest jawny (trafia do aplikacji); klucz
   * publikowalny podaje build w zmiennej EXPO_PUBLIC_SUPABASE_KEY (w ios-release.yml ze zmiennej środowiska
   * `SUPABASE_PUBLISHABLE_KEY`, ADR 0006) — też jawny z założenia (RLS chroni dane),
   * ale trzymany poza repozytorium, żeby skanery sekretów nie miały fałszywych alarmów.
   */
  SUPABASE_URL: 'https://rkokujgrziaaxabtxnlo.supabase.co',
  /** D40: schemat linków głębokich (zaproszenia; dawniej też magic link — w becie wyłączony, D177) = bundle ID, żeby nie kolidował z innymi aplikacjami. */
  URL_SCHEME: 'io.github.lkarwowski494.organizer',

  /**
   * Progi ostrzeżeń dla darmowych limitów (ok. 70% limitu).
   * Źródła limitów: supabase.com/pricing, docs.github.com (billing, limits) — sprawdzone 5–6.10.2026.
   */
  limits: {
    supabaseDbBytesWarn: 350 * 1024 * 1024, // limit 500 MB
    supabaseEgressBytesPerMonthWarn: 3.5 * 1024 ** 3, // limit 5 GB
    realtimeMessagesPerMonthWarn: 1_400_000, // limit 2 mln
    realtimeConcurrentConnectionsWarn: 140, // limit 200
    edgeFunctionInvocationsPerMonthWarn: 350_000, // limit 500 tys.
    supabaseIdleDaysWarn: 5, // pauza po 7 dniach bezczynności
    actionsCacheBytesWarn: 8 * 1024 ** 3, // limit 10 GB
    // Artefakty Actions: limit GitHub Free 500 MB (czy dotyczy repo publicznego — do potwierdzenia, audyt 3 N-106).
    actionsArtifactsBytesWarn: 350 * 1024 * 1024,
    // Od tego dnia (UTC) brak sekretu SUPABASE_MONITOR_TOKEN oblewa nocny pomiar (audyt 3, N-83): bez sekretu nic nie
    // jest mierzone ani podtrzymywane. Wybór projektowy: tydzień od wdrożenia skryptu (9.10.2026) na dodanie sekretu.
    monitorSecretRequiredFrom: '2026-10-16',
    testflightBuildAgeDaysWarn: 80, // build wygasa po 90 dniach
  },

  /**
   * Budżety czasu widoków w CI (audyt 3, N-6, N-16; test src/domain/__tests__/perf-budget.test.ts): rodzina po
   * `FAMILY_YEARS` latach używania (support/family-data.ts), czas procesora w Node, mediana 5 przebiegów. Przed
   * optymalizacją (9.10.2026, ten sam test na wspólnej maszynie): plan ok. 3,5 s, Moje sprawy (miesiąc) ok. 220 ms,
   * Kalendarz (miesiąc + 6 tygodni wydarzeń) ok. 250 ms; po niej ok. 90 / 55 / 60 ms. Budżet ok. 2,5× wyniku po, żeby
   * obciążony automat CI nie dawał fałszywych alarmów, a powrót kosztu rosnącego z historią oblewał test. Na iPhonie
   * (Hermes, bez JIT) czasy będą dłuższe — do sprawdzenia na urządzeniu.
   */
  perf: {
    FAMILY_YEARS: 3,
    PLAN_REMINDERS_MS: 250,
    MY_DAYS_MONTH_MS: 150,
    CALENDAR_MONTH_MS: 150,
  },
} as const;

export type AppConfig = typeof config;
