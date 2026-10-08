/**
 * Jedyne źródło liczb i reguł aplikacji (zasada „jedno źródło prawdy”).
 * Każda zmiana wartości tutaj wymaga wpisu w rejestrze decyzji (docs/adr).
 * Limity po stronie serwera (SQL) muszą być z nimi zgodne — pilnuje tego test kontraktowy
 * (dodawany w Etapie 1 razem z migracjami Supabase).
 */
export const config = {
  /** D4: maksymalna głębokość zagnieżdżenia podzadań (0 = zadanie główne, 2 = pod-podzadanie). */
  MAX_TASK_DEPTH: 2,

  /** Jak długo widać pasek „Cofnij” po usunięciu (ms). Wybór projektowy, bez źródła zewnętrznego. */
  UNDO_MS: 6000,

  /**
   * Zgłaszanie błędów i opinii (D80). Serwer egzekwuje te same liczby (private.client_errors_per_day,
   * feedback_per_day, feedback_retention_days; test kontraktowy). Wybory projektowe, bez źródła.
   */
  feedback: { ERRORS_PER_DAY: 50, PER_DAY: 20, RETENTION_DAYS: 90, MAX_LENGTH: 2000 },

  /**
   * Zakupy (D85, D86): ile podpowiedzi przy wpisywaniu, ile stałych pozycji na liście i ich długość
   * (SQL: private.staples_max(), private.staple_max_length(); test kontraktowy). Wybory projektowe, bez źródła.
   */
  shopping: { SUGGESTIONS: 5, STAPLES_MAX: 50, STAPLE_MAX_LENGTH: 200 },

  /**
   * Imię (D100): najdłuższe imię w profilu i w grupach — z ograniczeń kolumn display_name w SQL (profiles,
   * group_members; test kontraktowy). Wartość z pierwszej migracji, wybór projektowy bez źródła.
   */
  profile: { NAME_MAX_LENGTH: 100 },

  /**
   * Kalendarz iPhone'a w obie strony (D95, D96): okno odczytu moich wydarzeń i okno lustra grup (dni wstecz /
   * naprzód), limit wystąpień w lustrze, opóźnienie po zmianie danych; dubel z wpisem aplikacji (D107): różnica godzin
   * i najkrótsze wspólne słowo nazwy. Wybory projektowe, bez źródła.
   */
  calendar: { READ_DAYS_BACK: 31, READ_DAYS_AHEAD: 62, MIRROR_DAYS_BACK: 7, MIRROR_DAYS_AHEAD: 90, MIRROR_MAX: 500, MIRROR_DEBOUNCE_MS: 3000, DUPLICATE_WINDOW_MIN: 30, DUPLICATE_MIN_WORD: 4 },

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
   * i zbiorcze o 8:00 dla spraw bez godziny; osoba zmienia to w Ustawieniach. Wybory projektowe, bez źródła.
   */
  reminders: {
    LEAD_MIN: 30,
    LEAD_OPTIONS: [0, 10, 30, 60] as const,
    MORNING: '08:00',
    MORNING_OPTIONS: ['off', '07:00', '08:00', '09:00'] as const,
    /** Ile dni naprzód planuje telefon (plan odświeża się przy każdej zmianie danych i uruchomieniu). */
    DAYS_AHEAD: 3,
    /**
     * Najwyżej tyle zaplanowanych powiadomień naraz. Wybór projektowy z zapasem: iOS ogranicza liczbę oczekujących
     * powiadomień lokalnych, ale dokładnej liczby nie znaleźliśmy w przeczytanej dokumentacji Apple — otwarte pytanie.
     */
    MAX_SCHEDULED: 40,
  },

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
    /** Wersja protokołu; klient ze starszą dostaje upgrade_required. */
    SCHEMA_VERSION: 1,
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
  },

  /**
   * Zaproszenia linkiem (D48, decyzja właściciela z 7.10.2026): ważność 7 dni (maks. 30),
   * domyślnie 10 użyć (maks. 50). Serwer egzekwuje je funkcjami private.invite_* (test kontraktowy).
   */
  invites: {
    /**
     * Dołączanie jak w Zoom (D92–D94, decyzja właściciela z 8.10.2026): ID grupy 9 cyfr, kod 6 cyfr ważny 24 h,
     * limity nieudanych prób na godzinę (osoba / ID grupy). SQL: private.join_* (test kontraktowy).
     */
    JOIN_ID_DIGITS: 9,
    CODE_DIGITS: 6,
    CODE_TTL_HOURS: 24,
    JOIN_FAILS_PER_USER: 5,
    JOIN_FAILS_PER_GROUP: 20,
    /** Strona z linkiem zaproszenia (GitHub Pages, D94); ścieżka /j/ obsługiwana też przez Universal Links. */
    JOIN_LINK: 'https://lkarwowski494.github.io/j/',
    DEFAULT_TTL_HOURS: 168,
    MAX_TTL_HOURS: 720,
    DEFAULT_MAX_USES: 10,
    MAX_USES_LIMIT: 50,
  },

  /** Lokalizacja i strefa czasowa aplikacji (D30, R2). */
  LOCALE: 'pl-PL',
  TIME_ZONE: 'Europe/Warsaw',

  /** Identyfikatory Apple (D36) — jawne, nie są sekretami. */
  BUNDLE_ID: 'io.github.lkarwowski494.organizer',
  APP_GROUP: 'group.io.github.lkarwowski494.organizer',
  /**
   * Projekt Supabase (D1, D41: „organizer”, Frankfurt). Adres jest jawny (trafia do aplikacji); klucz
   * publikowalny podaje build w zmiennej EXPO_PUBLIC_SUPABASE_KEY — też jawny z założenia (RLS chroni dane),
   * ale trzymany poza repozytorium, żeby skanery sekretów nie miały fałszywych alarmów.
   */
  SUPABASE_URL: 'https://rkokujgrziaaxabtxnlo.supabase.co',
  /** D40: schemat linków głębokich (magic link, zaproszenia) = bundle ID, żeby nie kolidował z innymi aplikacjami. */
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
    testflightBuildAgeDaysWarn: 80, // build wygasa po 90 dniach
  },
} as const;

export type AppConfig = typeof config;
