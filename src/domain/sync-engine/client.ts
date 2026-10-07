/**
 * Silnik synchronizacji po stronie telefonu (Etap 1) — czysta logika, bez sieci i bez bazy.
 *
 * Model (Replicache, https://doc.replicache.dev/concepts/how-it-works): telefon trzyma stan potwierdzony
 * przez serwer (`base`) i kolejkę własnych operacji (`pending`). Ekran widzi `materialize()` = base +
 * pending nałożone po kolei, więc każda zmiana jest widoczna od razu, także offline (R1).
 * Operacja potwierdzona przez sync_push zostaje w kolejce do pierwszego pobrania (sync_pull), które
 * zaczęło się PO potwierdzeniu — wtedy stan serwera już ją zawiera i nic nie „mignie” wstecz.
 * Odrzucone operacje trafiają do `rejected` (ekran „ta zmiana została odrzucona”), a ich efekt znika
 * przy tym samym pobraniu, bo serwer ma ostatnie słowo.
 *
 * Protokół serwera: supabase/migrations/20261006120200_sync.sql.
 */
import { config } from '../../config';

export type Entity = 'groups' | 'group_members' | 'lists' | 'object_members' | 'tasks' | 'activity' | 'events' | 'event_participants' | 'event_overrides' | 'event_task_series';
export type Row = { readonly [k: string]: unknown };

export type Op =
  | { seq: number; op_id: string; kind: 'create'; entity: Entity; id: string; group_id: string; set: Row }
  | { seq: number; op_id: string; kind: 'patch'; entity: Entity; id: string; set: Row }
  | { seq: number; op_id: string; kind: 'delete' | 'restore'; entity: Entity; id: string }
  | { seq: number; op_id: string; kind: 'cmd'; cmd: string; args: Row };

/** Operacja bez numerów — numery nadaje `mutate()`. */
export type NewOp = Op extends infer O ? (O extends Op ? Omit<O, 'seq' | 'op_id'> : never) : never;

export type PushResponse = {
  last_seq: number;
  results: { seq: number; status: 'ok' | 'rejected' | 'duplicate'; code?: string }[];
};

export type PulledRow = { e: Entity; v: number; row: Row };
export type PullResponse = {
  groups: { group_id: string; cursor: number; has_more: boolean; resync: boolean; rows: PulledRow[] }[];
  scopes: string[];
};

export type ClientState = {
  readonly clientId: string;
  readonly nextSeq: number;
  /** Najwyższy numer operacji potwierdzony przez serwer (ok, odrzucona albo duplikat). */
  readonly ackedSeq: number;
  readonly base: { readonly [e: string]: { readonly [id: string]: Row } };
  readonly pending: readonly Op[];
  readonly cursors: { readonly [groupId: string]: number };
  readonly scopes: readonly string[];
  readonly rejected: readonly { op: Op; code: string }[];
};

/** Klucz główny encji (zgodny z private.sync_entities po stronie serwera). */
export function rowKey(e: Entity, row: Row): string {
  if (e === 'group_members') return String(row.member_id);
  if (e === 'object_members') return `${String(row.scope_id)}:${String(row.member_id)}`;
  return String(row.id);
}

/** Zakres widoczności wiersza (lista), jeśli wiersz należy do listy — do czyszczenia po utracie dostępu. */
function rowScope(e: Entity, row: Row): string | undefined {
  const scope = e === 'lists' ? row.id : e === 'tasks' || e === 'event_task_series' ? row.list_id : row.scope_id;
  // Grupy i członkowie nie mają zakresu; aktywność grupowa ma scope_id = null.
  return scope == null ? undefined : String(scope);
}

const groupOf = (e: Entity, row: Row) => String(e === 'groups' ? row.id : row.group_id);

export function initialState(clientId: string): ClientState {
  return { clientId, nextSeq: 1, ackedSeq: 0, base: {}, pending: [], cursors: {}, scopes: [], rejected: [] };
}

/** Nowa lokalna operacja: numer kolejny w obrębie instalacji, identyfikator z wstrzykniętego generatora. */
export function mutate(state: ClientState, op: NewOp, newId: () => string): ClientState {
  const full = { ...op, seq: state.nextSeq, op_id: newId() } as Op;
  return { ...state, nextSeq: state.nextSeq + 1, pending: [...state.pending, full] };
}

/** Lokalny skutek operacji — ten sam kierunek co serwer (pola serwerowe, np. depth, ustala dopiero serwer). */
export function applyOp(tables: { [e: string]: { [id: string]: Row } }, op: Op): void {
  if (op.kind === 'cmd') return; // komendy (grupy, zakresy) mają skutek dopiero po stronie serwera
  const table = (tables[op.entity] ??= {});
  const current = table[op.id];
  switch (op.kind) {
    case 'create':
      if (!current) table[op.id] = { ...op.set, id: op.id, group_id: op.group_id, deleted_at: null };
      return;
    case 'patch':
      // Usunięcie wygrywa z edycją — tak samo jak na serwerze.
      if (current && current.deleted_at == null) table[op.id] = { ...current, ...op.set };
      return;
    case 'delete':
    case 'restore':
      // Idempotentne: usunięty zostaje usunięty (z pierwotnym znacznikiem), przywrócony — przywrócony.
      if (current) table[op.id] = { ...current, deleted_at: op.kind === 'delete' ? (current.deleted_at ?? 'pending') : null };
      return;
  }
}

function cloneTables(base: ClientState['base']): { [e: string]: { [id: string]: Row } } {
  const out: { [e: string]: { [id: string]: Row } } = {};
  for (const [e, rows] of Object.entries(base)) out[e] = { ...rows };
  return out;
}

/** To, co widzi ekran: stan serwera + oczekujące operacje po kolei. */
export function materialize(state: ClientState): { [e: string]: { [id: string]: Row } } {
  const tables = cloneTables(state.base);
  for (const op of state.pending) applyOp(tables, op);
  return tables;
}

export function pushRequest(state: ClientState) {
  const ops = state.pending.filter((op) => op.seq > state.ackedSeq).slice(0, config.sync.PUSH_BATCH_MAX);
  return { client_id: state.clientId, schema_version: config.sync.SCHEMA_VERSION, ops };
}

export function onPushResponse(state: ClientState, res: PushResponse): ClientState {
  const rejectedNow = res.results
    .filter((r) => r.status === 'rejected')
    .flatMap((r) => {
      const op = state.pending.find((p) => p.seq === r.seq);
      return op && !state.rejected.some((x) => x.op.seq === op.seq) ? [{ op, code: r.code ?? 'unknown' }] : [];
    });
  return { ...state, ackedSeq: Math.max(state.ackedSeq, res.last_seq), rejected: [...state.rejected, ...rejectedNow] };
}

/** Zapytanie o zmiany. `ackedAtStart` trzeba przekazać do `onPullResponse` tej samej odpowiedzi. */
export function pullRequest(state: ClientState) {
  return { cursors: { ...state.cursors }, ackedAtStart: state.ackedSeq };
}

export type PullOutcome = {
  state: ClientState;
  /** Któraś grupa ma więcej wierszy (has_more) — trzeba pobrać ponownie. */
  needMore: boolean;
  /** Nowe ukryte listy, do których dostaliśmy dostęp — pobrać przez sync_fetch_scope. */
  fetchScopes: string[];
};

export function onPullResponse(state: ClientState, res: PullResponse, ackedAtStart: number): PullOutcome {
  const base = cloneTables(state.base);
  const visibleGroups = new Set(res.groups.map((g) => g.group_id));
  const lostScopes = new Set(state.scopes.filter((s) => !res.scopes.includes(s)));

  // Utrata dostępu: usuwamy lokalnie wszystko z grup i list, których serwer już nam nie pokazuje.
  // Resync: grupa pobierana od zera, więc najpierw czyścimy jej wiersze.
  const resyncGroups = new Set(res.groups.filter((g) => g.resync).map((g) => g.group_id));
  for (const [e, rows] of Object.entries(base)) {
    for (const [id, row] of Object.entries(rows)) {
      const g = groupOf(e as Entity, row);
      const scope = rowScope(e as Entity, row);
      if (!visibleGroups.has(g) || resyncGroups.has(g) || lostScopes.has(scope!)) {
        delete rows[id];
      }
    }
  }

  const cursors: { [g: string]: number } = {};
  for (const g of res.groups) {
    for (const r of g.rows) (base[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
    cursors[g.group_id] = g.cursor;
  }

  const pending = state.pending.filter((op) => op.seq > ackedAtStart);
  return {
    state: { ...state, base, cursors, scopes: [...res.scopes], pending },
    needMore: res.groups.some((g) => g.has_more),
    fetchScopes: res.scopes.filter((s) => !state.scopes.includes(s)),
  };
}

/** Wynik sync_fetch_scope: pełna zawartość listy, do której właśnie dostaliśmy dostęp. */
export function onFetchScope(state: ClientState, rows: PulledRow[]): ClientState {
  const base = cloneTables(state.base);
  for (const r of rows) (base[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
  return { ...state, base };
}

/** Wskaźnik stanu (architektura: 5 stanów; tu dane wejściowe dla UI). */
export function pendingCount(state: ClientState): number {
  return state.pending.filter((op) => op.seq > state.ackedSeq).length;
}
