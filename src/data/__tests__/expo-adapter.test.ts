import { expoAdapter, type ExpoSqliteLike } from '../db/expo-adapter';
import { migrate } from '../db/migrations';
import { memoryDb } from './sqlite';

/** Atrapa expo-sqlite na better-sqlite3: ta sama semantyka, inne nazwy metod. */
function fakeExpo(): ExpoSqliteLike & { calls: string[] } {
  const raw = memoryDb().raw;
  const calls: string[] = [];
  return {
    calls,
    execSync: (s) => (calls.push('exec'), raw.exec(s)),
    runSync: (s, p) => (calls.push('run'), raw.prepare(s).run(...p)),
    getAllSync: <T>(s: string, p: unknown[]) => (calls.push('all'), raw.prepare(s).all(...p) as T[]),
    withTransactionSync: (task) => (calls.push('tx'), raw.transaction(task)()),
  };
}

describe('DbAdapter na expo-sqlite', () => {
  it('migracje, zapis, odczyt, transakcja z wycofaniem', () => {
    const f = fakeExpo();
    const db = expoAdapter(f);
    migrate(db);
    db.run('insert into sync_state (key, value) values (?, ?)', ['a', '1']);
    expect(db.all<{ value: string }>('select value from sync_state where key = ?', ['a'])).toEqual([{ value: '1' }]);
    expect(() =>
      db.transaction(() => {
        db.run('insert into sync_state (key, value) values (?, ?)', ['b', '2']);
        throw new Error('przerwij');
      }),
    ).toThrow('przerwij');
    expect(db.all('select * from sync_state where key = ?', ['b'])).toEqual([]);
    db.run("insert into sync_state (key, value) values ('c', '3')");
    expect(db.all<{ n: number }>('select count(*) n from sync_state')).toEqual([{ n: 2 }]);
    expect(f.calls).toEqual(expect.arrayContaining(['exec', 'run', 'all', 'tx']));
  });
});
