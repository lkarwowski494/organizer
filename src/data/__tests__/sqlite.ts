/** DbAdapter na better-sqlite3 — do testów w Node (ten sam interfejs co expo-sqlite w aplikacji). */
import Database from 'better-sqlite3';

import type { DbAdapter, SqlValue } from '../db/adapter';

export function memoryDb(): DbAdapter & { raw: Database.Database } {
  const raw = new Database(':memory:');
  return {
    raw,
    exec: (sql) => void raw.exec(sql),
    run: (sql, params: readonly SqlValue[] = []) => void raw.prepare(sql).run(...params),
    all: <T>(sql: string, params: readonly SqlValue[] = []) => {
      const st = raw.prepare(sql);
      return (st.reader ? st.all(...params) : (st.run(...params), [])) as T[];
    },
    transaction: (fn) => raw.transaction(fn)(),
  };
}
