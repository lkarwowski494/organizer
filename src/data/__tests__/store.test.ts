import * as fc from 'fast-check';

import {
  type ClientState,
  ENTITIES,
  initialState,
  mutate,
  type NewOp,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  pullRequest,
  pushRequest,
} from '../../domain/sync-engine/client';
import { FakeServer } from '../../domain/__tests__/support/fake-server';
import { ENTITY_TABLES, migrate, MIGRATIONS, SCHEMA_VERSION } from '../db/migrations';
import { loadLocal, readState, saveLocal, wipeSynced, writeState } from '../store';
import { memoryDb } from './sqlite';

const normalize = (s: ClientState): ClientState => ({
  ...s,
  base: Object.fromEntries(Object.entries(s.base).filter(([, rows]) => Object.keys(rows).length > 0)),
});

describe('lokalna baza: migracje', () => {
  it('nowa baza dostaje bieżący schemat; ponowna migracja nic nie robi', () => {
    const db = memoryDb();
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    const tables = db.all<{ name: string }>("select name from sqlite_master where type = 'table' order by name").map((r) => r.name);
    expect(tables).toEqual(['activity', 'event_overrides', 'event_participants', 'event_rsvps', 'event_task_series', 'events', 'group_members', 'groups', 'handoffs', 'lists', 'object_members', 'pending_ops', 'rejected_ops', 'sync_state', 'tasks']);
  });

  it('aktualizacja z wersji 1 dodaje tabele wydarzeń, stałych zadań serii i obecności i nie rusza istniejących danych', () => {
    const db = memoryDb();
    db.transaction(() => {
      db.exec(MIGRATIONS[0]!.sql);
      db.exec('pragma user_version = 1');
    });
    db.run("insert into tasks (key, group_id, scope_id, version, data) values ('t1', 'g1', 'l1', 3, '{}')");
    db.run("insert into pending_ops (seq, op_id, op) values (1, 'o1', '{}')");
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(db.all('select key from tasks')).toEqual([{ key: 't1' }]);
    expect(db.all('select seq from pending_ops')).toEqual([{ seq: 1 }]);
    expect(db.all("select name from sqlite_master where type = 'table' and name like 'event%' order by name").length).toBe(5);
  });

  it('wersja 5 (obecność, D124): kursory od zera, reszta stanu zostaje', () => {
    const db = memoryDb();
    db.transaction(() => {
      for (const m of MIGRATIONS.slice(0, 4)) db.exec(m.sql);
      db.exec('pragma user_version = 4');
    });
    db.run("insert into sync_state (key, value) values ('cursors', '{\"g1\":9}'), ('clientId', 'c1'), ('local:x', '1')");
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(db.all<{ key: string }>('select key from sync_state order by key').map((r) => r.key)).toEqual(['clientId', 'local:x']);
  });

  it('tabele lustrzane = encje, które silnik wysyła serwerowi (audyt 2, M-58)', () => {
    expect([...ENTITY_TABLES].sort()).toEqual([...ENTITIES].sort());
  });

  it('M-176: po aktualizacji z buildu 21 (v4, kursory zerowane przez v5) pierwsze pobranie usuwa wiersze, których serwer już nie ma', () => {
    const db = memoryDb();
    db.transaction(() => {
      for (const m of MIGRATIONS.slice(0, 4)) db.exec(m.sql);
      db.exec('pragma user_version = 4');
    });
    // Build 21: zadanie usunięte na serwerze i wyczyszczone z kosza zostało w telefonie; kursor, bez epoki i listy encji.
    db.run("insert into tasks (key, group_id, scope_id, version, data) values ('stary', 'g1', 'l1', 1, '{\"id\":\"stary\",\"group_id\":\"g1\",\"list_id\":\"l1\",\"version\":1}')");
    db.run("insert into sync_state (key, value) values ('cursors', '{\"g1\":9}'), ('client_id', 'c-21'), ('next_seq', '4'), ('acked_seq', '3')");
    migrate(db);
    let s = readState(db, 'nowy');
    expect(s).toMatchObject({ clientId: 'c-21', cursors: {}, purged: {}, entities: [] });
    const server = new FakeServer();
    server.addGroup('g1', ['ala']);
    const req = pullRequest(s);
    const next = onPullResponse(s, server.pull('ala', req, 100), req).state;
    writeState(db, s, next, 1);
    s = readState(db, 'nowy');
    expect(s.base.tasks).toBeUndefined();
    expect(db.all('select key from tasks')).toEqual([]);
    expect(s.entities).toEqual([...ENTITIES]);
    expect(s.purged).toEqual({ g1: 0 });
  });

  it('baza z nowszej wersji aplikacji nie jest ruszana', () => {
    const db = memoryDb();
    db.exec(`pragma user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow('local_schema_newer');
  });
});

describe('lokalna baza: zapis stanu synchronizacji', () => {
  it('pusty stan po starcie', () => {
    const db = memoryDb();
    migrate(db);
    expect(readState(db, 'c1')).toEqual(initialState('c1'));
  });

  it('po każdym przejściu stan z bazy = stan w pamięci (losowe scenariusze z serwerem i zawodną siecią)', () => {
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant('create' as const), entity: fc.constant('lists' as const), id: fc.constantFrom('l1', 'l2'), group_id: fc.constant('g1'),
        set: fc.record({ kind: fc.constant('tasks'), name: fc.constantFrom('A', 'B'), visibility: fc.constantFrom('group', 'restricted') }) }),
      fc.record({ kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom('t1', 't2', 't3'), group_id: fc.constant('g1'),
        set: fc.record({ list_id: fc.constantFrom('l1', 'l2'), title: fc.constantFrom('x', 'y') }) }),
      fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom('t1', 't2', 't3', 'nope'), set: fc.record({ title: fc.constantFrom('p', 'q') }) }),
      fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constantFrom('lists' as const, 'tasks' as const), id: fc.constantFrom('l1', 't1', 't2') }),
    ) as fc.Arbitrary<NewOp>;
    const stepArb = fc.oneof(
      fc.record({ t: fc.constant('mutate' as const), op: opArb }),
      fc.record({ t: fc.constant('push' as const), lose: fc.boolean() }),
      fc.record({ t: fc.constant('pull' as const), lim: fc.integer({ min: 1, max: 5 }) }),
      fc.record({ t: fc.constant('restart' as const) }),
    );
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 5, maxLength: 40 }), (steps) => {
        const server = new FakeServer();
        server.addGroup('g1', ['ala']);
        const db = memoryDb();
        migrate(db);
        let n = 0;
        let s = readState(db, 'c1');
        const commit = (next: ClientState) => {
          writeState(db, s, next, 1000);
          s = next;
          expect(normalize(readState(db, 'c1'))).toEqual(normalize(s));
        };
        for (const st of steps) {
          if (st.t === 'mutate') commit(mutate(s, st.op, () => `op-${++n}`));
          else if (st.t === 'push') {
            const res = server.push('ala', pushRequest(s));
            if (!st.lose) commit(onPushResponse(s, res));
          } else if (st.t === 'pull') {
            const req = pullRequest(s);
            const out = onPullResponse(s, server.pull('ala', req, st.lim), req);
            commit(out.state);
            for (const sc of out.fetchScopes) commit(onFetchScope(s, server.fetchScope('ala', sc)));
          } else {
            // Ponowne uruchomienie aplikacji: stan wyłącznie z bazy.
            s = readState(db, 'c1');
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('błąd w trakcie zapisu nie zostawia połowy zmian', () => {
    const db = memoryDb();
    migrate(db);
    const s0 = readState(db, 'c1');
    let s1 = mutate(s0, { kind: 'create', entity: 'tasks', id: 't1', group_id: 'g1', set: { title: 'a' } }, () => 'op-1');
    s1 = { ...s1, base: { tasks: { zly_klucz: { id: 't1', group_id: 'g1' } } } };
    expect(() => writeState(db, s0, s1, 1)).toThrow('niezgodny');
    expect(readState(db, 'c1')).toEqual(s0); // ani wiersza, ani operacji w kolejce
  });

  it('utrata dostępu usuwa wiersze także z bazy; kolumny pomocnicze wypełnione', () => {
    const db = memoryDb();
    migrate(db);
    const s0 = readState(db, 'c1');
    const s1 = onPullResponse(s0, { groups: [{ group_id: 'g1', cursor: 3, has_more: false, resync: false, rows: [
      { e: 'groups', v: 3, row: { id: 'g1', version: 3 } },
      { e: 'lists', v: 1, row: { id: 'l1', group_id: 'g1', version: 1 } },
      { e: 'tasks', v: 2, row: { id: 't1', group_id: 'g1', list_id: 'l1', version: 2 } },
      { e: 'event_task_series', v: 2, row: { id: 's1', group_id: 'g1', list_id: 'l1', event_id: 'e1', version: 2 } },
    ] }], scopes: [] }, pullRequest(s0)).state;
    writeState(db, s0, s1, 1);
    expect(db.all('select key, group_id, scope_id, version from tasks')).toEqual([{ key: 't1', group_id: 'g1', scope_id: 'l1', version: 2 }]);
    // Stałe zadanie serii ma zakres listy (lista ukryta: znika z telefonu razem z nią).
    expect(db.all('select key, scope_id from event_task_series')).toEqual([{ key: 's1', scope_id: 'l1' }]);
    expect(db.all('select key, group_id, scope_id from groups')).toEqual([{ key: 'g1', group_id: 'g1', scope_id: null }]);
    const s2 = onPullResponse(s1, { groups: [], scopes: [] }, pullRequest(s1)).state;
    writeState(db, s1, s2, 2);
    expect(db.all('select count(*) n from tasks')).toEqual([{ n: 0 }]);
    expect(normalize(readState(db, 'c1'))).toEqual(normalize(s2));
  });

  it('zapisuje tylko różnicę: niezmienione wiersze, operacje i odrzucenia nie są zapisywane ponownie', () => {
    const db = memoryDb();
    migrate(db);
    const writes: string[] = [];
    const spy = { ...db, run: (sql: string, p?: readonly (string | number | null)[]) => { writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); db.run(sql, p); } };
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ e: 'tasks' as const, v: i + 1, row: { id: `t${i}`, group_id: 'g1', list_id: 'l1', version: i + 1 } }));
    const s0 = readState(db, 'c1');
    const s1 = onPullResponse(s0, { groups: [{ group_id: 'g1', cursor: 50, has_more: false, resync: false, rows: rows(50) }], scopes: [] }, pullRequest(s0)).state;
    writeState(spy, s0, s1, 1);
    expect(writes.filter((w) => w.startsWith('insert into tasks'))).toHaveLength(50);
    writes.length = 0;
    // Kolejna lokalna zmiana: 50 zadań się nie zmieniło — żadnego zapisu tasks, jedna operacja w kolejce.
    const s2 = mutate(s1, { kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'x' } }, () => 'op-1');
    writeState(spy, s1, s2, 2);
    expect(writes.filter((w) => w.includes('tasks'))).toHaveLength(0);
    expect(writes.filter((w) => w.startsWith('insert into pending_ops'))).toHaveLength(1);
    writes.length = 0;
    const s3 = onPushResponse(s2, { last_seq: 1, results: [{ seq: 1, status: 'rejected', code: 'forbidden' }] });
    writeState(spy, s2, s3, 3);
    writeState(spy, s3, s3, 4);
    expect(writes.filter((w) => w.startsWith('insert or ignore'))).toHaveLength(1);
  });

  it('identyfikator instalacji i zakresy przeżywają restart; zakres listy i wpisów aktywności w kolumnie scope_id', () => {
    const db = memoryDb();
    migrate(db);
    const s0 = initialState('instalacja-1');
    const s1 = onPullResponse(s0, { groups: [{ group_id: 'g1', cursor: 4, has_more: false, resync: false, rows: [
      { e: 'lists', v: 1, row: { id: 'l9', group_id: 'g1', version: 1 } },
      { e: 'activity', v: 2, row: { id: 'a1', group_id: 'g1', scope_id: 'l9', version: 2 } },
      { e: 'object_members', v: 3, row: { scope_id: 'l9', member_id: 'm1', group_id: 'g1', version: 3 } },
      { e: 'group_members', v: 4, row: { member_id: 'm1', group_id: 'g1', version: 4 } },
    ] }], scopes: ['l9'] }, pullRequest(s0)).state;
    writeState(db, s0, s1, 1);
    expect(readState(db, 'inna').clientId).toBe('instalacja-1');
    expect(readState(db, 'inna').scopes).toEqual(['l9']);
    expect(db.all('select key, scope_id from lists union all select key, scope_id from activity union all select key, scope_id from object_members union all select key, scope_id from group_members')).toEqual([
      { key: 'l9', scope_id: 'l9' }, { key: 'a1', scope_id: 'l9' }, { key: 'l9:m1', scope_id: 'l9' }, { key: 'm1', scope_id: null },
    ]);
  });

  it('odrzucenia z czasem i bez powtórzeń', () => {
    const db = memoryDb();
    migrate(db);
    const s0 = readState(db, 'c1');
    const s1 = onPushResponse(mutate(s0, { kind: 'patch', entity: 'tasks', id: 'x', set: {} }, () => 'op-1'), { last_seq: 1, results: [{ seq: 1, status: 'rejected', code: 'not_found' }] });
    writeState(db, s0, s1, 42);
    writeState(db, s1, s1, 43);
    expect(db.all('select seq, code, rejected_at from rejected_ops')).toEqual([{ seq: 1, code: 'not_found', rejected_at: 42 }]);
  });
});

describe('dane lokalne telefonu (D95)', () => {
  it('zapis, odczyt, nadpisanie, usunięcie; nie mieszają się ze stanem synchronizacji', () => {
    const db = memoryDb();
    migrate(db);
    expect(loadLocal(db, 'calendarMirror')).toBeNull();
    saveLocal(db, 'calendarMirror', '{"a":1}');
    saveLocal(db, 'calendarMirror', '{"a":2}');
    expect(loadLocal(db, 'calendarMirror')).toBe('{"a":2}');
    expect(readState(db, 'c').cursors).toEqual({});
    saveLocal(db, 'calendarMirror', null);
    expect(loadLocal(db, 'calendarMirror')).toBeNull();
  });
});

describe('wyczyść dane na telefonie (D121)', () => {
  it('kopia serwera, kolejka, odrzucone i kursory znikają; dane telefonu (local:*) zostają', () => {
    const db = memoryDb();
    migrate(db);
    const s0 = initialState('c1');
    const s1 = mutate(s0, { kind: 'create', entity: 'tasks', id: 't1', group_id: 'g1', set: { list_id: 'l1', title: 'x' } }, () => 'op1');
    writeState(db, s0, { ...s1, cursors: { g1: 5 }, base: { tasks: { t1: { id: 't1', group_id: 'g1', list_id: 'l1', title: 'x', version: 1 } } }, rejected: [{ op: s1.pending[0]!, code: 'forbidden' }] }, 1);
    saveLocal(db, 'calendarMirror', '{"a":1}');
    expect(readState(db, 'c2').pending).toHaveLength(1);
    wipeSynced(db);
    expect(readState(db, 'c2')).toEqual(initialState('c2'));
    expect(loadLocal(db, 'calendarMirror')).toBe('{"a":1}');
  });
});
