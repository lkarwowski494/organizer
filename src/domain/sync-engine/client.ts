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
 * Protokół serwera: supabase/migrations/20261006120200_sync.sql, wersja 2 (kursor z epoką, listy widoczne, zadania
 * przeniesione poza wzrok, filtr encji): 20261008310000_sync_protocol_v2.sql.
 */
import { config } from '../../config';
import { applySplit } from '../event-split';

/**
 * Encje, które ta wersja aplikacji zna i zapisuje (= tabele lustrzane w src/data/db/migrations.ts — pilnuje test).
 * Telefon wysyła je w sync_pull, a serwer pomija resztę (audyt 2, M-58): kursor nie przechodzi nad wierszami, których
 * telefon nie umie zapisać. Nowa encja w kolejnej wersji = pobranie wszystkiego od zera (`entities` w stanie).
 */
export const ENTITIES = ['groups', 'group_members', 'lists', 'object_members', 'tasks', 'activity', 'events', 'event_participants', 'event_overrides', 'event_task_series', 'handoffs', 'event_rsvps'] as const;
export type Entity = (typeof ENTITIES)[number];
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
  groups: {
    group_id: string;
    cursor: number;
    has_more: boolean;
    resync: boolean;
    rows: PulledRow[];
    /** Protokół 2: epoka grupy (purged_version) — wraca do serwera w kursorze (audyt 2, M-1). */
    purged?: number;
    /** Protokół 2: wszystkie listy grupy, które widzę; lokalne spoza zbioru znikają z zawartością (M-54). */
    lists?: string[];
    /** Protokół 2: zadania przeniesione do listy, której nie widzę (M-54). */
    gone?: string[];
  }[];
  scopes: string[];
};

/** Kursor grupy w protokole 2: wersja i epoka czyszczenia kosza, przy której ją pobrano. */
export type Cursor = { v: number; p: number };
/** Zapytanie sync_pull (transport dokłada limit porcji). */
export type PullRequest = { cursors: { [groupId: string]: Cursor }; schema_version: number; entities: readonly string[] };

export type ClientState = {
  readonly clientId: string;
  readonly nextSeq: number;
  /** Najwyższy numer operacji potwierdzony przez serwer (ok, odrzucona albo duplikat). */
  readonly ackedSeq: number;
  readonly base: { readonly [e: string]: { readonly [id: string]: Row } };
  readonly pending: readonly Op[];
  readonly cursors: { readonly [groupId: string]: number };
  /**
   * Epoka kursora (purged_version grupy z ostatniej odpowiedzi). Serwer każe pobrać grupę od nowa (resync) tylko wtedy,
   * gdy od tej epoki coś wyczyszczono, więc kolejne porcje jednego pobrania nie cofają się do zera (audyt 2, M-1).
   */
  readonly purged: { readonly [groupId: string]: number };
  /** Encje, które obejmują kursory (M-58). Gdy aplikacja zna więcej (nowa wersja), pobiera wszystko od zera. */
  readonly entities: readonly string[];
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
  return { clientId, nextSeq: 1, ackedSeq: 0, base: {}, pending: [], cursors: {}, purged: {}, entities: [], scopes: [], rejected: [] };
}

/** Nowa lokalna operacja: numer kolejny w obrębie instalacji, identyfikator z wstrzykniętego generatora. */
export function mutate(state: ClientState, op: NewOp, newId: () => string): ClientState {
  const full = { ...op, seq: state.nextSeq, op_id: newId() } as Op;
  return { ...state, nextSeq: state.nextSeq + 1, pending: [...state.pending, full] };
}

/** Lokalny skutek operacji — ten sam kierunek co serwer (pola serwerowe, np. depth, ustala dopiero serwer). */
export function applyOp(tables: { [e: string]: { [id: string]: Row } }, op: Op): void {
  if (op.kind === 'cmd') return applyCmd(tables, op);
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

/**
 * Stałe zakupy po poleceniu (audyt 2, M-111): staple_add dopisuje nazwę na koniec, jeśli jej nie ma; staple_remove usuwa
 * wskazane nazwy — ten sam skutek co private.staple_cmd na serwerze (20261008370000_staple_commands.sql). Inne polecenia
 * (grupy, zakresy, przenosiny) mają skutek dopiero po stronie serwera — `null`.
 */
export function stapleCmdResult(list: Row, cmd: { cmd: string; args: Row }): string[] | null {
  const cur = Array.isArray(list.staples) ? list.staples.filter((s): s is string => typeof s === 'string') : [];
  if (cmd.cmd === 'staple_add') return cur.includes(String(cmd.args.name)) ? cur : [...cur, String(cmd.args.name)];
  if (cmd.cmd === 'staple_remove') return cur.filter((s) => !(cmd.args.names as readonly unknown[]).includes(s));
  return null;
}

/**
 * Polecenia serwera, które telefon wykonuje też u siebie tym samym algorytmem (widoczne od razu, także offline — R1):
 * „to i następne” (audyt 2, M-3: split_event, migracja 20261008320000_event_split) i stałe zakupy.
 */
function applyCmd(tables: { [e: string]: { [id: string]: Row } }, op: Extract<Op, { kind: 'cmd' }>): void {
  if (op.cmd === 'split_event') return applySplit(tables, op.args);
  const id = String(op.args.list_id);
  const list = tables.lists?.[id];
  // Usunięcie wygrywa ze zmianą (jak patch); listy, której nie mam, nie zakładam.
  if (!list || list.deleted_at != null) return;
  const staples = stapleCmdResult(list, op);
  if (staples) tables.lists![id] = { ...list, staples };
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

/**
 * Zapytanie o zmiany. Całe zapytanie (`ackedAtStart`, wysłane kursory) trzeba przekazać do `onPullResponse` tej samej
 * odpowiedzi. Gdy kursory nie obejmują wszystkich znanych encji (aktualizacja aplikacji z nową tabelą, M-58), pobieramy
 * wszystko od zera.
 */
export function pullRequest(state: ClientState): PullRequest & { ackedAtStart: number } {
  const covered = ENTITIES.every((e) => state.entities.includes(e));
  const cursors: { [g: string]: Cursor } = {};
  if (covered) for (const [g, v] of Object.entries(state.cursors)) cursors[g] = { v, p: state.purged[g] ?? 0 };
  return { cursors, ackedAtStart: state.ackedSeq, schema_version: config.sync.SCHEMA_VERSION, entities: ENTITIES };
}

export type PullOutcome = {
  state: ClientState;
  /** Któraś grupa ma więcej wierszy (has_more) — trzeba pobrać ponownie. */
  needMore: boolean;
  /** Nowe ukryte listy, do których dostaliśmy dostęp — pobrać przez sync_fetch_scope. */
  fetchScopes: string[];
};

export function onPullResponse(state: ClientState, res: PullResponse, req: PullRequest & { ackedAtStart: number }): PullOutcome {
  const base = cloneTables(state.base);
  const visibleGroups = new Set(res.groups.map((g) => g.group_id));
  const lostScopes = new Set(state.scopes.filter((s) => !res.scopes.includes(s)));
  // Grupa przychodzi w całości przy resync i przy pobraniu od zera (bez kursora w zapytaniu) — najpierw czyścimy jej
  // wiersze. Bez tego po wyzerowaniu kursorów zostawały wiersze, których na serwerze już nie ma (audyt 2, M-176).
  const fromScratch = new Set(res.groups.filter((g) => g.resync || !(g.group_id in req.cursors)).map((g) => g.group_id));
  // Listy grupy, które widzę (protokół 2): lista spoza zbioru (zawężona widoczność, M-54) znika razem z zawartością.
  const listsOf = new Map(res.groups.flatMap((g) => (g.lists ? [[g.group_id, new Set(g.lists)] as const] : [])));

  // Utrata dostępu: usuwamy lokalnie wszystko z grup i list, których serwer już nam nie pokazuje.
  for (const [e, rows] of Object.entries(base)) {
    for (const [id, row] of Object.entries(rows)) {
      const g = groupOf(e as Entity, row);
      const scope = rowScope(e as Entity, row);
      const hidden = scope !== undefined && (lostScopes.has(scope) || listsOf.get(g)?.has(scope) === false);
      if (!visibleGroups.has(g) || fromScratch.has(g) || hidden) delete rows[id];
    }
  }

  const cursors: { [g: string]: number } = {};
  const purged: { [g: string]: number } = {};
  for (const g of res.groups) {
    // Zadania przeniesione do listy, której nie widzę: przed wierszami tej odpowiedzi (wiersz z nowszą wersją wraca).
    for (const id of g.gone ?? []) delete base.tasks?.[id];
    for (const r of g.rows) (base[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
    cursors[g.group_id] = g.cursor;
    const p = g.purged ?? state.purged[g.group_id];
    if (p !== undefined) purged[g.group_id] = p;
  }

  const pending = state.pending.filter((op) => op.seq > req.ackedAtStart);
  return {
    state: { ...state, base, cursors, purged, entities: [...req.entities], scopes: [...res.scopes], pending },
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
