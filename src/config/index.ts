/**
 * Jedyne źródło liczb i reguł aplikacji (zasada „jedno źródło prawdy”).
 * Każda zmiana wartości tutaj wymaga wpisu w rejestrze decyzji (docs/adr).
 * Limity po stronie serwera (SQL) muszą być z nimi zgodne — pilnuje tego test kontraktowy
 * (dodawany w Etapie 1 razem z migracjami Supabase).
 */
export const config = {
  /** D4: maksymalna głębokość zagnieżdżenia podzadań (0 = zadanie główne, 2 = pod-podzadanie). */
  MAX_TASK_DEPTH: 2,

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
  },

  /** Lokalizacja i strefa czasowa aplikacji (D30, R2). */
  LOCALE: 'pl-PL',
  TIME_ZONE: 'Europe/Warsaw',

  /** Identyfikatory Apple (D36) — jawne, nie są sekretami. */
  BUNDLE_ID: 'io.github.lkarwowski494.organizer',
  APP_GROUP: 'group.io.github.lkarwowski494.organizer',
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
