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

  /** Na ile tygodni naprzód telefon dokłada kopie stałych zadań serii (D65). Wybór projektowy, bez źródła. */
  SERIES_TASK_WEEKS: 8,

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
