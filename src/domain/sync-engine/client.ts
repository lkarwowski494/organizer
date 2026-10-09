/**
 * Silnik synchronizacji po stronie telefonu (Etap 1) — czysta logika, bez sieci i bez bazy.
 *
 * Model (Replicache, https://doc.replicache.dev/concepts/how-it-works): telefon trzyma stan potwierdzony
 * przez serwer (`base`) i kolejkę własnych operacji (`pending`). Ekran widzi `materialize()` = base +
 * pending nałożone po kolei, więc każda zmiana jest widoczna od razu, także offline (R1).
 * Operacja potwierdzona przez sync_push zostaje w kolejce do końca pierwszego pobrania (sync_pull, ostatnia porcja),
 * które zaczęło się PO potwierdzeniu — wtedy stan serwera już ją zawiera i nic nie „mignie” wstecz.
 * Odrzucone operacje trafiają do `rejected` (ekran „ta zmiana została odrzucona”), a ich efekt znika
 * przy tym samym pobraniu, bo serwer ma ostatnie słowo.
 *
 * Protokół serwera: supabase/migrations/20261006120200_sync.sql, wersja 2 (kursor z epoką, listy widoczne, zadania
 * przeniesione poza wzrok, filtr encji): 20261008310000_sync_protocol_v2.sql.
 */
import { config } from '../../config';
import { applyEndSeries, applyRestoreSeries, repointLate } from '../event-chain';
import { applySplit } from '../event-split';
import { moveCmdSteps, movedAlive } from '../task-move-cmd';

/**
 * Encje, które ta wersja aplikacji zna i zapisuje (= tabele lustrzane w src/data/db/migrations.ts — pilnuje test).
 * Telefon wysyła je w sync_pull, a serwer pomija resztę (audyt 2, M-58): kursor nie przechodzi nad wierszami, których
 * telefon nie umie zapisać. Nowa encja w kolejnej wersji = pobranie wszystkiego od zera (`entities` w stanie).
 */
export const ENTITIES = ['groups', 'group_members', 'lists', 'object_members', 'tasks', 'activity', 'events', 'event_participants', 'event_overrides', 'event_task_series', 'handoffs', 'event_rsvps', 'my_day_scopes', 'shopping_trips'] as const;
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
  /**
   * Ukryte listy, do których dostaliśmy dostęp, a ich zawartości (sync_fetch_scope) jeszcze nie pobraliśmy. Zostają tu do
   * udanego pobrania — nieudane (sieć, zamknięta aplikacja) ponawia następne sync_pull (audyt 2, M-53). Dawniej lista
   * trafiała do `scopes` przed pobraniem i po błędzie nie docierała nigdy.
   */
  readonly scopesToFetch: readonly string[];
  readonly rejected: readonly { op: Op; code: string }[];
  /**
   * Grupy pobierane w całości (resync albo pobranie od zera): porcje czekają tu, a ekran widzi dotychczasowe wiersze
   * grupy, dopóki nie przyjdzie ostatnia porcja — wtedy podmiana naraz (audyt 2, P2). Bez tego duża grupa znikała ze
   * wszystkich ekranów na czas pobierania porcjami. Zapisane w bazie, więc przerwane pobranie wznawia się od kursora.
   */
  readonly staged: { readonly [groupId: string]: { readonly [e: string]: { readonly [id: string]: Row } } };
  /**
   * Numery operacji nadane pod wcześniejszymi identyfikatorami tej instalacji (rosnąco po `upTo`): telefon odtworzony
   * z kopii iCloud dostaje nowy identyfikator (M-8), ale operacje z kopii wysyła jeszcze pod starym — serwer rozpozna
   * te, które stary telefon zdążył wysłać („duplicate”), i nie zastosuje ich drugi raz.
   */
  readonly legacy: readonly { readonly clientId: string; readonly upTo: number }[];
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
  return { clientId, nextSeq: 1, ackedSeq: 0, base: {}, pending: [], cursors: {}, purged: {}, entities: [], scopes: [], scopesToFetch: [], rejected: [], staged: {}, legacy: [] };
}

/**
 * Identyfikator instalacji zapamiętany na tym urządzeniu (pęk kluczy „tylko to urządzenie”, który nie przechodzi do kopii
 * iCloud ani do „Szybkiego startu”). Inny niż w bazie = baza przyszła z kopii albo z innego telefonu (audyt 2, M-8):
 * dotychczasowe numery operacji serwer już widział od tamtej instalacji, więc nowe zmiany ginęłyby jako „duplicate”.
 * Telefon dostaje nowy identyfikator; niewysłane operacje z kopii idą pod starym (zakres w `legacy`).
 * Pierwsze uruchomienie wersji z tym mechanizmem (pusty pęk kluczy) też nadaje nowy — bez szkody.
 */
export function adoptDevice(state: ClientState, deviceClientId: string | null, newId: () => string): ClientState {
  if (deviceClientId === state.clientId) return state;
  const covered = state.legacy.length ? state.legacy[state.legacy.length - 1]!.upTo : state.ackedSeq;
  const unsent = state.pending.some((op) => op.seq > covered);
  const legacy = unsent ? [...state.legacy, { clientId: state.clientId, upTo: state.nextSeq - 1 }] : state.legacy;
  return { ...state, clientId: newId(), legacy };
}

/** Identyfikatory obiektów, których utworzenie serwer odrzucił — generatory (kopie powtórzeń i serii) ich nie ponawiają. */
export function rejectedCreateIds(state: Pick<ClientState, 'rejected'>): Set<string> {
  return new Set(state.rejected.flatMap((r) => (r.op.kind === 'create' ? [r.op.id] : [])));
}

/** Nowa lokalna operacja: numer kolejny w obrębie instalacji, identyfikator z wstrzykniętego generatora. */
export function mutate(state: ClientState, op: NewOp, newId: () => string): ClientState {
  const full = { ...op, seq: state.nextSeq, op_id: newId() } as Op;
  return { ...state, nextSeq: state.nextSeq + 1, pending: [...state.pending, full] };
}

/**
 * Kaskada usunięcia i przywrócenia jak na serwerze (tasks_cascade, lists_cascade w 20261006120100_lists_tasks.sql):
 * usunięcie listy usuwa jej zadania główne, usunięcie zadania — podzadania (rekurencyjnie, ten sam znacznik czasu);
 * przywrócenie przywraca tylko te, które mają znacznik rodzica (usunięte razem z nim). Audyt 2, M-60: bez tego offline
 * podzadania usuniętego zadania wyskakiwały w Moich sprawach, Kalendarzu i przypomnieniach.
 */
function cascade(tables: { [e: string]: { [id: string]: Row } }, entity: Entity, id: string, from: unknown, to: unknown): void {
  const tasks = tables.tasks;
  if (!tasks || (entity !== 'tasks' && entity !== 'lists')) return;
  for (const [tid, t] of Object.entries(tasks)) {
    const child = entity === 'lists' ? t.list_id === id && t.parent_id == null : t.parent_id === id;
    if (!child || (t.deleted_at ?? null) !== from) continue;
    tasks[tid] = { ...t, deleted_at: to };
    cascade(tables, 'tasks', tid, from, to);
  }
}

/** Lokalny skutek operacji — ten sam kierunek co serwer (pola serwerowe, np. depth, ustala dopiero serwer). */
export function applyOp(tables: { [e: string]: { [id: string]: Row } }, op: Op): void {
  if (op.kind === 'cmd') return applyCmd(tables, op);
  const table = (tables[op.entity] ??= {});
  const current = table[op.id];
  switch (op.kind) {
    case 'create':
      if (!current) table[op.id] = { ...op.set, id: op.id, group_id: op.group_id, deleted_at: null };
      // Audyt 3 (N-23): termin z części serii, która go już nie ma po „to i następne” — do następczyni (jak serwer).
      if (!current) repointLate(tables, op.entity, op.id);
      return;
    case 'patch':
      // Usunięcie wygrywa z edycją — tak samo jak na serwerze.
      if (current && current.deleted_at == null) table[op.id] = { ...current, ...op.set };
      if (op.entity === 'tasks' && ('event_id' in op.set || 'occurrence_date' in op.set)) repointLate(tables, op.entity, op.id);
      return;
    case 'delete':
      // Idempotentne: usunięty zostaje usunięty (z pierwotnym znacznikiem). Znacznik z numerem operacji odróżnia dwa
      // lokalne usunięcia, tak jak różne chwile na serwerze (przywrócenie listy nie wskrzesza zadania usuniętego osobno).
      if (!current || current.deleted_at != null) return;
      table[op.id] = { ...current, deleted_at: `pending:${op.seq}` };
      cascade(tables, op.entity, op.id, null, `pending:${op.seq}`);
      return;
    case 'restore':
      if (!current || current.deleted_at == null) return;
      // Audyt 3 (N-131): przeniesione do innej grupy nie wraca, dopóki żyje kopia; przywrócone traci znacznik (serwer:
      // tasks_a_guard_moved, kod „moved”).
      if (op.entity === 'tasks' && movedAlive(tables, current)) return;
      table[op.id] = { ...current, deleted_at: null, ...(current.moved_to != null ? { moved_to: null } : {}) };
      cascade(tables, op.entity, op.id, current.deleted_at, null);
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
 * „to i następne” (audyt 2, M-3: split_event, migracja 20261008320000_event_split), koniec serii i jego cofnięcie
 * (audyt 3: end_series, restore_series, migracja 20261010050000_series_chain), przeniesienie zadania do innej grupy i jego
 * cofnięcie (audyt 3: move_task_to_group, unmove_task, migracja 20261010060000_move_task_to_group) i stałe zakupy.
 */
function applyCmd(tables: { [e: string]: { [id: string]: Row } }, op: Extract<Op, { kind: 'cmd' }>): void {
  if (op.cmd === 'split_event') return applySplit(tables, op.args);
  // Audyt 3 (N-3, N-117): koniec całej serii (łańcucha) i jego cofnięcie (src/domain/event-chain.ts).
  if (op.cmd === 'end_series') return applyEndSeries(tables, op.args, `pending:${op.seq}`);
  if (op.cmd === 'restore_series') return applyRestoreSeries(tables, op.args);
  // Audyt 3 (N-12): przeniesienie zadania do innej grupy i jego cofnięcie (src/domain/task-move-cmd.ts).
  const move = moveCmdSteps(tables, op);
  if (move) {
    for (const step of move) {
      if ('op' in step) applyOp(tables, { ...step.op, seq: op.seq, op_id: op.op_id } as Op);
      else tables.tasks![step.mark.id] = { ...tables.tasks![step.mark.id]!, moved_to: step.mark.to };
    }
    return;
  }
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

/** Zakres numerów (instalacja), do którego należy najstarsza niewysłana operacja — jedna paczka = jeden identyfikator. */
function sendingRange(state: ClientState): { clientId: string; upTo: number } | null {
  const first = state.pending.find((op) => op.seq > state.ackedSeq);
  return (first && state.legacy.find((r) => first.seq <= r.upTo)) ?? null;
}

export function pushRequest(state: ClientState) {
  const range = sendingRange(state);
  const ops = state.pending.filter((op) => op.seq > state.ackedSeq && (!range || op.seq <= range.upTo)).slice(0, config.sync.PUSH_BATCH_MAX);
  return { client_id: range?.clientId ?? state.clientId, schema_version: config.sync.SCHEMA_VERSION, ops };
}

/**
 * Odpowiedź sync_push. `req` — zapytanie tej odpowiedzi: `last_seq` dotyczy instalacji z `req.client_id`, a dawna
 * instalacja (M-8) mogła dojść dalej niż zakres z kopii — potwierdzamy wtedy najwyżej do końca zakresu, inaczej nowe,
 * niewysłane operacje uznalibyśmy za przyjęte. Bez `req` (testy) — instalacja, do której należy następna operacja.
 */
export function onPushResponse(state: ClientState, res: PushResponse, req?: { client_id: string }): ClientState {
  const rejectedNow = res.results
    .filter((r) => r.status === 'rejected')
    .flatMap((r) => {
      const op = state.pending.find((p) => p.seq === r.seq);
      return op && !state.rejected.some((x) => x.op.seq === op.seq) ? [{ op, code: r.code ?? 'unknown' }] : [];
    });
  const clientId = req?.client_id ?? sendingRange(state)?.clientId ?? state.clientId;
  const range = state.legacy.find((r) => r.clientId === clientId);
  const acked = Math.max(state.ackedSeq, range ? Math.min(res.last_seq, range.upTo) : clientId === state.clientId ? res.last_seq : state.ackedSeq);
  return { ...state, ackedSeq: acked, rejected: [...state.rejected, ...rejectedNow], legacy: state.legacy.filter((r) => r.upTo > acked) };
}

/** „Wyczyść listę” odrzuconych zmian (decyzja właściciela z 8.10.2026, audyt 2: PW-30 A, M-137; D190). */
export function clearRejected(state: ClientState): ClientState {
  return state.rejected.length === 0 ? state : { ...state, rejected: [] };
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

type Tables = { [e: string]: { [id: string]: Row } };

/**
 * Tabele kopiowane dopiero przy pierwszej zmianie (audyt 3, N-15): pobranie, które nic nie przyniosło (każdy powrót do
 * aplikacji), zostawia te same obiekty tabel, więc ekrany, plan przypomnień i lustro nie liczą się od nowa (tablesOf
 * w src/app/context.tsx po `base` i `pending`), a zapis (store.ts diffRows) nie przegląda całej bazy. Tabela źródłowa
 * nigdy nie jest zmieniana w miejscu — należy do poprzedniego stanu.
 */
class CowTables {
  readonly tables: Tables;
  private readonly own = new Set<string>();
  constructor(private readonly src: { readonly [e: string]: { readonly [id: string]: Row } }) {
    this.tables = { ...src } as Tables;
  }
  /** Tabela do zapisu (kopia przy pierwszym dotknięciu). */
  write(e: string): { [id: string]: Row } {
    if (!this.own.has(e)) {
      this.tables[e] = { ...this.tables[e] };
      this.own.add(e);
    }
    return this.tables[e]!;
  }
  set(e: string, id: string, row: Row): void {
    this.write(e)[id] = row;
  }
  delete(e: string, id: string): void {
    if (this.tables[e] && id in this.tables[e]) delete this.write(e)[id];
  }
  /** Wynik: źródło, gdy nic się nie zmieniło. */
  result(): { readonly [e: string]: { readonly [id: string]: Row } } {
    return this.own.size === 0 ? this.src : this.tables;
  }
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameMap = <T>(a: { readonly [k: string]: T }, b: { readonly [k: string]: T }) => {
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((k) => k in a && a[k] === b[k]);
};

export function onPullResponse(state: ClientState, res: PullResponse, req: PullRequest & { ackedAtStart: number }): PullOutcome {
  const base = new CowTables(state.base);
  const staged: { [g: string]: CowTables } = {};
  const visibleGroups = new Set(res.groups.map((g) => g.group_id));
  const lostScopes = new Set(state.scopes.filter((s) => !res.scopes.includes(s)));
  // Grupa przychodzi w całości przy resync i przy pobraniu od zera (bez kursora w zapytaniu). Jej porcje odkładamy obok
  // (`staged`), a po ostatniej podmieniamy wiersze grupy naraz — także te, których na serwerze już nie ma (M-176).
  const fromScratch = new Set(res.groups.filter((g) => g.resync || !(g.group_id in req.cursors)).map((g) => g.group_id));
  // Listy grupy, które widzę (protokół 2): lista spoza zbioru (zawężona widoczność, M-54) znika razem z zawartością.
  const listsOf = new Map(res.groups.flatMap((g) => (g.lists ? [[g.group_id, new Set(g.lists)] as const] : [])));
  const hidden = (e: Entity, row: Row) => {
    const scope = rowScope(e, row);
    return scope !== undefined && (lostScopes.has(scope) || listsOf.get(groupOf(e, row))?.has(scope) === false);
  };
  const forget = (tables: CowTables) => {
    for (const [e, rows] of Object.entries(tables.tables)) {
      for (const [id, row] of Object.entries(rows)) if (!visibleGroups.has(groupOf(e as Entity, row)) || hidden(e as Entity, row)) tables.delete(e, id);
    }
  };

  // Utrata dostępu: usuwamy lokalnie wszystko z grup i list, których serwer już nam nie pokazuje — także z porcji w toku.
  forget(base);
  for (const [g, tables] of Object.entries(state.staged)) {
    if (!visibleGroups.has(g) || fromScratch.has(g)) continue;
    staged[g] = new CowTables(tables);
    forget(staged[g]);
  }

  const cursors: { [g: string]: number } = {};
  const purged: { [g: string]: number } = {};
  for (const g of res.groups) {
    const gid = g.group_id;
    if (fromScratch.has(gid)) staged[gid] = new CowTables({});
    const target = staged[gid] ?? base;
    // Zadania przeniesione do listy, której nie widzę: przed wierszami tej odpowiedzi (wiersz z nowszą wersją wraca);
    // znikają od razu także z widocznych jeszcze starych wierszy.
    for (const id of g.gone ?? []) {
      base.delete('tasks', id);
      target.delete('tasks', id);
    }
    for (const r of g.rows) target.set(r.e, rowKey(r.e, r.row), r.row);
    const done = staged[gid];
    if (done && !g.has_more) {
      // Komplet: stare wiersze grupy znikają, nowe wchodzą — w jednym przejściu stanu.
      for (const [e, rows] of Object.entries(base.tables)) for (const [id, row] of Object.entries(rows)) if (groupOf(e as Entity, row) === gid) base.delete(e, id);
      for (const [e, rows] of Object.entries(done.tables)) Object.assign(base.write(e), rows);
      delete staged[gid];
    }
    cursors[gid] = g.cursor;
    const p = g.purged ?? state.purged[gid];
    if (p !== undefined) purged[gid] = p;
  }

  const needMore = res.groups.some((g) => g.has_more);
  // Potwierdzone operacje schodzą z kolejki dopiero po ostatniej porcji: wcześniejsza porcja może jeszcze nie mieć
  // wiersza z ich skutkiem i zmiana na chwilę by zniknęła (audyt 2, P2).
  const pending = needMore ? state.pending : state.pending.filter((op) => op.seq > req.ackedAtStart);
  // Do pobrania: nowe ukryte listy i te, których pobranie się nie udało (M-53) — o ile nadal je widzę.
  const scopesToFetch = res.scopes.filter((s) => !state.scopes.includes(s) || state.scopesToFetch.includes(s));
  const stagedOut = Object.fromEntries(Object.entries(staged).map(([g, t]) => [g, t.result()]));
  // N-15: niezmienione części zostają tymi samymi obiektami; nic się nie zmieniło — ten sam stan.
  const next: ClientState = {
    ...state,
    base: base.result(),
    staged: sameMap(state.staged, stagedOut) ? state.staged : stagedOut,
    cursors: sameMap(state.cursors, cursors) ? state.cursors : cursors,
    purged: sameMap(state.purged, purged) ? state.purged : purged,
    entities: sameList(state.entities, req.entities) ? state.entities : [...req.entities],
    scopes: sameList(state.scopes, res.scopes) ? state.scopes : [...res.scopes],
    scopesToFetch: sameList(state.scopesToFetch, scopesToFetch) ? state.scopesToFetch : scopesToFetch,
    pending: pending.length === state.pending.length ? state.pending : pending,
  };
  const same = (Object.keys(next) as (keyof ClientState)[]).every((k) => next[k] === state[k]);
  return { state: same ? state : next, needMore, fetchScopes: scopesToFetch };
}

/**
 * Wynik sync_fetch_scope: pełna zawartość listy `listId`, do której właśnie dostaliśmy dostęp. Grupa pobierana właśnie
 * w całości dostaje wiersze także do porcji w toku — inaczej podmiana po ostatniej porcji by je usunęła.
 */
export function onFetchScope(state: ClientState, rows: PulledRow[], listId: string): ClientState {
  const base = cloneTables(state.base);
  const staged: { [g: string]: Tables } = {};
  for (const r of rows) {
    (base[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
    const g = groupOf(r.e, r.row);
    if (!state.staged[g]) continue;
    const tables = (staged[g] ??= cloneTables(state.staged[g]));
    (tables[r.e] ??= {})[rowKey(r.e, r.row)] = r.row;
  }
  return { ...state, base, staged: { ...state.staged, ...staged }, scopesToFetch: state.scopesToFetch.filter((s) => s !== listId) };
}

/** Wskaźnik stanu (architektura: 5 stanów; tu dane wejściowe dla UI). */
export function pendingCount(state: ClientState): number {
  return state.pending.filter((op) => op.seq > state.ackedSeq).length;
}
