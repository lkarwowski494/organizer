/**
 * Trwały zapis stanu silnika synchronizacji (ClientState) w SQLite telefonu.
 *
 * Logika zostaje w jednym miejscu — src/domain/sync-engine/client.ts. Ten moduł tylko zapisuje różnicę
 * między stanem przed i po przejściu (`writeState`) w JEDNEJ transakcji i odtwarza stan po starcie
 * aplikacji (`readState`). Zasada R1: zmiana i jej wpis w kolejce zapisują się razem albo wcale.
 */
import { type ClientState, type Entity, type Op, type Row, rowKey, rowScope } from '../domain/sync-engine/client';
import { badField } from '../domain/sync-engine/row-check';
import type { DbAdapter } from './db/adapter';
import { ENTITY_TABLES, migrate } from './db/migrations';

const scopeOf = (e: Entity, row: Row): string | null => rowScope(e, row) ?? null;
const groupOf = (e: Entity, row: Row) => String(e === 'groups' ? row.id : row.group_id);

export function readState(db: DbAdapter, clientId: string): ClientState {
  const kv = Object.fromEntries(db.all<{ key: string; value: string }>('select key, value from sync_state').map((r) => [r.key, r.value]));
  const base: Record<string, Record<string, Row>> = {};
  for (const t of ENTITY_TABLES) {
    // N-1: wiersz z datą spoza zakresu zapisany przez starszą wersję aplikacji — pomijany (widoki by padły).
    const rows = db.all<{ key: string; data: string }>(`select key, data from ${t}`).flatMap((r) => {
      const row = JSON.parse(r.data) as Row;
      return badField(t, row) ? [] : [[r.key, row] as const];
    });
    if (rows.length) base[t] = Object.fromEntries(rows);
  }
  return {
    clientId: kv.client_id ?? clientId,
    nextSeq: Number(kv.next_seq ?? 1),
    ackedSeq: Number(kv.acked_seq ?? 0),
    base,
    pending: db.all<{ op: string }>('select op from pending_ops order by seq').map((r) => JSON.parse(r.op) as Op),
    cursors: kv.cursors ? (JSON.parse(kv.cursors) as Record<string, number>) : {},
    // Baza sprzed protokołu 2 (build 21) nie ma epok ani listy encji: epoka 0, encje nieznane → pobranie od zera.
    purged: kv.purged ? (JSON.parse(kv.purged) as Record<string, number>) : {},
    entities: kv.entities ? (JSON.parse(kv.entities) as string[]) : [],
    scopes: kv.scopes ? (JSON.parse(kv.scopes) as string[]) : [],
    scopesToFetch: kv.scopes_to_fetch ? (JSON.parse(kv.scopes_to_fetch) as string[]) : [],
    rejected: db.all<{ op: string; code: string }>('select op, code from rejected_ops order by seq').map((r) => ({ op: JSON.parse(r.op) as Op, code: r.code })),
    staged: readStaged(db),
    legacy: kv.legacy ? (JSON.parse(kv.legacy) as ClientState['legacy']) : [],
  };
}

function readStaged(db: DbAdapter): ClientState['staged'] {
  const out: Record<string, Record<string, Record<string, Row>>> = {};
  for (const r of db.all<{ group_id: string; entity: string; key: string; data: string }>('select group_id, entity, key, data from staged_rows')) {
    ((out[r.group_id] ??= {})[r.entity] ??= {})[r.key] = JSON.parse(r.data) as Row;
  }
  return out;
}

const NO_ROWS: { readonly [id: string]: Row } = {};

/**
 * Wiersze, które zmieniły się między `before` a `after`. Porównanie referencji (audyt 2, M-61): logika stanu
 * (client.ts) kopiuje tabele płytko i podmienia tylko zmienione wiersze, więc ta sama tabela = nic do zapisu, a ten sam
 * wiersz = bez serializacji. Dawniej JSON.stringify każdego wiersza przy każdym dotknięciu (~90 ms przy 20 tys. wierszy).
 */
function diffRows(before: { readonly [id: string]: Row }, after: { readonly [id: string]: Row }, removed: (key: string) => void, changed: (key: string, row: Row) => void): void {
  if (before === after) return;
  for (const key of Object.keys(before)) if (!(key in after)) removed(key);
  for (const [key, row] of Object.entries(after)) if (before[key] !== row) changed(key, row);
}

/** Zapisuje różnicę prev → next. `now` — znacznik czasu odrzucenia (do ekranu „zmiana odrzucona”). */
export function writeState(db: DbAdapter, prev: ClientState, next: ClientState, now: number): void {
  db.transaction(() => {
    for (const t of ENTITY_TABLES) {
      diffRows(
        prev.base[t] ?? NO_ROWS,
        next.base[t] ?? NO_ROWS,
        (key) => db.run(`delete from ${t} where key = ?`, [key]),
        (key, row) => {
          if (key !== rowKey(t, row)) throw new Error(`store: klucz ${key} niezgodny z wierszem ${t}`);
          db.run(
            `insert into ${t} (key, group_id, scope_id, version, data) values (?, ?, ?, ?, ?)
             on conflict (key) do update set group_id = excluded.group_id, scope_id = excluded.scope_id,
               version = excluded.version, data = excluded.data`,
            [key, groupOf(t, row), scopeOf(t, row), Number(row.version), JSON.stringify(row)],
          );
        },
      );
    }
    if (prev.staged !== next.staged) {
      for (const g of Object.keys(prev.staged)) if (!(g in next.staged)) db.run('delete from staged_rows where group_id = ?', [g]);
      for (const [g, tables] of Object.entries(next.staged)) {
        const old = prev.staged[g] ?? {};
        for (const e of new Set([...Object.keys(old), ...Object.keys(tables)])) {
          diffRows(
            old[e] ?? NO_ROWS,
            tables[e] ?? NO_ROWS,
            (key) => db.run('delete from staged_rows where group_id = ? and entity = ? and key = ?', [g, e, key]),
            (key, row) =>
              db.run('insert into staged_rows (group_id, entity, key, data) values (?, ?, ?, ?) on conflict (group_id, entity, key) do update set data = excluded.data', [g, e, key, JSON.stringify(row)]),
          );
        }
      }
    }
    const nextSeqs = new Set(next.pending.map((o) => o.seq));
    for (const op of prev.pending) if (!nextSeqs.has(op.seq)) db.run('delete from pending_ops where seq = ?', [op.seq]);
    const prevSeqs = new Set(prev.pending.map((o) => o.seq));
    for (const op of next.pending) {
      if (!prevSeqs.has(op.seq)) db.run('insert into pending_ops (seq, op_id, op) values (?, ?, ?)', [op.seq, op.op_id, JSON.stringify(op)]);
    }
    // „Wyczyść listę” (D190): odrzucone, których już nie ma w stanie, znikają też z bazy.
    const kept = new Set(next.rejected.map((r) => r.op.seq));
    for (const r of prev.rejected) if (!kept.has(r.op.seq)) db.run('delete from rejected_ops where seq = ?', [r.op.seq]);
    for (const r of next.rejected.slice(prev.rejected.length)) {
      db.run('insert or ignore into rejected_ops (seq, code, op, rejected_at) values (?, ?, ?, ?)', [r.op.seq, r.code, JSON.stringify(r.op), now]);
    }
    // Liczniki operacji tylko rosną (audyt 3, N-11): zapis ze starszego stanu (drugi pisarz tej samej bazy) nie cofa ich,
    // bo numer już wysłany serwer uznałby przy następnej zmianie za „duplicate”, a ona zniknęłaby bez śladu.
    for (const [k, v] of [
      ['next_seq', next.nextSeq],
      ['acked_seq', next.ackedSeq],
    ] as const) {
      db.run('insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = cast(max(cast(sync_state.value as integer), cast(excluded.value as integer)) as text)', [k, String(v)]);
    }
    const kv: [string, string][] = [
      ['client_id', next.clientId],
      ['cursors', JSON.stringify(next.cursors)],
      ['purged', JSON.stringify(next.purged)],
      ['entities', JSON.stringify(next.entities)],
      ['scopes', JSON.stringify(next.scopes)],
      ['legacy', JSON.stringify(next.legacy)],
      ['scopes_to_fetch', JSON.stringify(next.scopesToFetch)],
    ];
    for (const [k, v] of kv) db.run('insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [k, v]);
  });
}

/** Własne dane telefonu poza synchronizacją (np. stan lustra kalendarza, D95) w tabeli sync_state pod kluczem `local:<k>`. */
export function loadLocal(db: DbAdapter, key: string): string | null {
  return db.all<{ value: string }>('select value from sync_state where key = ?', [`local:${key}`])[0]?.value ?? null;
}

export function saveLocal(db: DbAdapter, key: string, value: string | null): void {
  if (value === null) db.run('delete from sync_state where key = ?', [`local:${key}`]);
  else db.run('insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [`local:${key}`, value]);
}

/**
 * „Wyczyść dane na telefonie” (D121): kopia danych z serwera, kolejka i odrzucone zmiany do usunięcia — po ponownym
 * starcie silnik pobiera wszystko od zera. Zostają własne dane telefonu (`local:*`, np. stan lustra kalendarza).
 */
export function wipeSynced(db: DbAdapter): void {
  db.transaction(() => {
    for (const t of ENTITY_TABLES) db.run(`delete from ${t}`);
    db.run('delete from staged_rows');
    db.run('delete from pending_ops');
    db.run('delete from rejected_ops');
    db.run("delete from sync_state where key not like 'local:%'");
  });
}

/**
 * Baza z nowszej wersji aplikacji (M-177), gdy osoba wybrała „Wyczyść i pobierz od nowa”: wszystkie tabele znikają,
 * a schemat buduje się od zera tą wersją (migrate). Zostają własne dane telefonu (`local:*`, np. stan lustra kalendarza
 * — bez niego lustro założyłoby wydarzenia w iPhonie drugi raz); dane z serwera pobiorą się od nowa.
 */
export function rebuildNewer(db: DbAdapter): void {
  const tables = db.all<{ name: string }>("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").map((r) => r.name);
  const local = tables.includes('sync_state') ? db.all<{ key: string; value: string }>("select key, value from sync_state where key like 'local:%'") : [];
  db.transaction(() => {
    for (const t of tables) db.exec(`drop table "${t.replace(/"/g, '""')}"`);
    db.exec('pragma user_version = 0');
  });
  migrate(db);
  for (const r of local) db.run('insert into sync_state (key, value) values (?, ?)', [r.key, r.value]);
}
