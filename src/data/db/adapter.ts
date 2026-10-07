/**
 * Minimalny interfejs bazy SQLite (architektura: „DbAdapter run/all/get/transaction”). W aplikacji
 * implementuje go expo-sqlite (wersje synchroniczne: execSync, runSync, getAllSync, withTransactionSync —
 * https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), w testach better-sqlite3. Kod nad nim nie zna
 * żadnej z tych bibliotek.
 *
 * Używamy tylko SQL wspólnego dla obu silników: bez kolumn generowanych i bez funkcji JSON, bo wersja
 * SQLite dołączona do expo-sqlite nie jest podana w dokumentacji (otwarte pytanie, spike S4).
 */
export type SqlValue = string | number | null;

export interface DbAdapter {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** Wszystko albo nic: wyjątek w `fn` cofa każdą zmianę z tej transakcji. */
  transaction(fn: () => void): void;
}
