/**
 * DbAdapter na expo-sqlite (API synchroniczne SDK 57: execSync, runSync, getAllSync, withTransactionSync —
 * https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/). Typ bazy podany strukturalnie, żeby test w Node
 * mógł podać atrapę bez natywnego modułu.
 */
import type { DbAdapter, SqlValue } from './adapter';

export type ExpoSqliteLike = {
  execSync(source: string): void;
  runSync(source: string, params: SqlValue[]): unknown;
  getAllSync<T>(source: string, params: SqlValue[]): T[];
  withTransactionSync(task: () => void): void;
};

export function expoAdapter(db: ExpoSqliteLike): DbAdapter {
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => void db.runSync(sql, [...params]),
    all: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllSync<T>(sql, [...params]),
    transaction: (fn) => db.withTransactionSync(fn),
  };
}
