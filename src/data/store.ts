/**
 * Trwały zapis stanu silnika synchronizacji (ClientState) w SQLite telefonu.
 *
 * Logika zostaje w jednym miejscu — src/domain/sync-engine/client.ts. Ten moduł tylko zapisuje różnicę
 * między stanem przed i po przejściu (`writeState`) w JEDNEJ transakcji i odtwarza stan po starcie
 * aplikacji (`readState`). Zasada R1: zmiana i jej wpis w kolejce zapisują się razem albo wcale.
 */
import { type ClientState, type Entity, type Op, type Row, rowKey } from '../domain/sync-engine/client';
import type { DbAdapter } from './db/adapter';
import { ENTITY_TABLES } from './db/migrations';

const scopeOf = (e: Entity, row: Row): string | null => {
  const s = e === 'lists' ? row.id : e === 'tasks' || e === 'event_task_series' ? row.list_id : row.scope_id;
  return s == null ? null : String(s);
};
const groupOf = (e: Entity, row: Row) => String(e === 'groups' ? row.id : row.group_id);

export function readState(db: DbAdapter, clientId: string): ClientState {
  const kv = Object.fromEntries(db.all<{ key: string; value: string }>('select key, value from sync_state').map((r) => [r.key, r.value]));
  const base: Record<string, Record<string, Row>> = {};
  for (const t of ENTITY_TABLES) {
    const rows = db.all<{ key: string; data: string }>(`select key, data from ${t}`);
    if (rows.length) base[t] = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.data) as Row]));
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
    rejected: db.all<{ op: string; code: string }>('select op, code from rejected_ops order by seq').map((r) => ({ op: JSON.parse(r.op) as Op, code: r.code })),
  };
}

// Wiersze z serwera to zwykły JSON, więc porównanie po serializacji jest pełne (brak wiersza → undefined ≠ tekst).
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Zapisuje różnicę prev → next. `now` — znacznik czasu odrzucenia (do ekranu „zmiana odrzucona”). */
export function writeState(db: DbAdapter, prev: ClientState, next: ClientState, now: number): void {
  db.transaction(() => {
    for (const t of ENTITY_TABLES) {
      const before = prev.base[t] ?? {};
      const after = next.base[t] ?? {};
      for (const key of Object.keys(before)) {
        if (!(key in after)) db.run(`delete from ${t} where key = ?`, [key]);
      }
      for (const [key, row] of Object.entries(after)) {
        if (same(before[key], row)) continue;
        if (key !== rowKey(t, row)) throw new Error(`store: klucz ${key} niezgodny z wierszem ${t}`);
        db.run(
          `insert into ${t} (key, group_id, scope_id, version, data) values (?, ?, ?, ?, ?)
           on conflict (key) do update set group_id = excluded.group_id, scope_id = excluded.scope_id,
             version = excluded.version, data = excluded.data`,
          [key, groupOf(t, row), scopeOf(t, row), Number(row.version), JSON.stringify(row)],
        );
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
    const kv: [string, string][] = [
      ['client_id', next.clientId],
      ['next_seq', String(next.nextSeq)],
      ['acked_seq', String(next.ackedSeq)],
      ['cursors', JSON.stringify(next.cursors)],
      ['purged', JSON.stringify(next.purged)],
      ['entities', JSON.stringify(next.entities)],
      ['scopes', JSON.stringify(next.scopes)],
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
    db.run('delete from pending_ops');
    db.run('delete from rejected_ops');
    db.run("delete from sync_state where key not like 'local:%'");
  });
}
