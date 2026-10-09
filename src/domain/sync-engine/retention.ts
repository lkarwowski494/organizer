/**
 * Retencja na telefonie (audyt 2, M-62, M-68; audyt 3, N-89, N-93): te same reguły co codzienne sprzątanie serwera
 * (private.purge_group, ostatnia definicja: supabase/migrations/20261008570000_my_scopes_trips.sql), żeby kopia na
 * telefonie nie trzymała dłużej niż serwer i żeby stary telefon miał to samo co świeża instalacja. Serwer usuwa takie
 * wiersze bez nagrobka; telefon z kursorem sprzed nich dostaje resync (purged_version), a telefon, który je już ma,
 * usuwa je sam tutaj:
 *  - historia zmian (activity) starsza niż config.retention.ACTIVITY_DAYS (decyzja właściciela z 8.10.2026, D184);
 *  - rozstrzygnięte przekazania (status inny niż „pending”) z decyzją starszą niż config.retention.HANDOFF_DAYS;
 *  - zrobione zakupy starsze niż config.retention.TRIP_DAYS i cofnięte zakupy po terminie w koszu;
 *  - rzeczy w koszu dłużej niż config.sync.TOMBSTONE_DAYS (nagrobki): wydarzenia z wyjątkami, odpowiedziami
 *    i uczestnikami, stałe zadania serii, zadania (bez podzadań, które zostają), wpisy dostępu do list, listy bez
 *    zadań — razem z ich historią zmian.
 * Serwer sprząta raz na dobę, więc reguły dodane w audycie 3 mają zapas config.retention.PURGE_LAG_DAYS: telefon nie
 * usuwa niczego wcześniej niż serwer. Wiersz bez czytelnej daty zostaje (nie zgadujemy). Gdy na serwerze zostaje
 * wiersz, który wskazuje usuwany (zadanie przypięte do wydarzenia, kopia stałego zadania serii), serwer najpierw go
 * zmienia (odpina) — telefon czeka, aż ta zmiana przyjdzie, i do tego czasu wskazanego wiersza nie usuwa.
 *
 * Zegar (N-93): „teraz” to zegar telefonu, ale nie później niż najnowszy wpis historii zmian (created_at nadaje
 * serwer) + config.retention.CLOCK_SLACK_DAYS. Zegar przestawiony o miesiące w przód nie kasuje lokalnie historii
 * ani przekazań, których serwer jeszcze nie skasował.
 */
import { config } from '../../config';
import type { ClientState, Entity, Row } from './client';

const DAY_MS = 86_400_000;

/** Encje, z których telefon usuwa wiersze po terminie — te same tabele, z których usuwa private.purge_group (kontrakt w testach). */
export const PURGED_ENTITIES = [
  'activity',
  'handoffs',
  'shopping_trips',
  'events',
  'event_task_series',
  'tasks',
  'object_members',
  'lists',
  'event_overrides',
  'event_rsvps',
  'event_participants',
] as const satisfies readonly Entity[];

type Tables = ClientState['base'];

const ms = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);
const older = (value: unknown, limitMs: number) => value != null && ms(value) < limitMs;

/**
 * Klucze wierszy encji `e`, dla których `test` jest prawdą. Pętla for…in bez kopii tabel: pobranie przy 20 tys. wierszy
 * nie może kosztować więcej niż kilka milisekund (audyt 3, N-6 — pruneExpired idzie przy każdej porcji).
 */
function where(t: Tables, e: string, test: (r: Row, key: string) => boolean): Set<string> {
  const out = new Set<string>();
  const rows = t[e];
  if (rows) for (const k in rows) if (test(rows[k]!, k)) out.add(k);
  return out;
}

/**
 * Chwila wpisu historii (created_at) — policzona raz na wiersz: wiersze są niezmienne i przechodzą między stanami bez
 * kopiowania, a historia to największa tabela przeglądana przy każdej porcji pobrania.
 */
const createdCache = new WeakMap<Row, number>();
function createdMs(r: Row): number {
  let v = createdCache.get(r);
  if (v === undefined) createdCache.set(r, (v = ms(r.created_at)));
  return v;
}

/** „Teraz” do retencji: zegar telefonu, najwyżej najnowsza chwila nadana przez serwer + zapas (N-93). */
export function retentionNow(base: Tables, clockMs: number): number {
  let newest = Number.NEGATIVE_INFINITY;
  const rows = base.activity ?? {};
  for (const k in rows) newest = Math.max(newest, createdMs(rows[k]!) || Number.NEGATIVE_INFINITY);
  return Math.min(clockMs, newest === Number.NEGATIVE_INFINITY ? clockMs : newest + config.retention.CLOCK_SLACK_DAYS * DAY_MS);
}

/** Klucze wierszy do usunięcia, per encja (kolejność i zależności jak w private.purge_group). */
function expiredKeys(t: Tables, nowMs: number): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const drop = (e: string, keys: Set<string>) => {
    if (keys.size === 0) return;
    const set = out.get(e) ?? out.set(e, new Set()).get(e)!;
    for (const k of keys) set.add(k);
  };
  const lag = config.retention.PURGE_LAG_DAYS * DAY_MS;
  const horizon = nowMs - config.sync.TOMBSTONE_DAYS * DAY_MS - lag;
  const trash = (r: Row) => older(r.deleted_at, horizon);
  const tasks = t.tasks ?? {};
  const series = t.event_task_series ?? {};

  // Historia i przekazania (M-62, M-68) — bez zapasu, jak dotąd.
  const actLimit = nowMs - config.retention.ACTIVITY_DAYS * DAY_MS;
  drop('activity', where(t, 'activity', (r) => createdMs(r) < actLimit));
  drop('handoffs', where(t, 'handoffs', (r) => r.status !== 'pending' && older(r.decided_at, nowMs - config.retention.HANDOFF_DAYS * DAY_MS)));
  // Zrobione zakupy po TRIP_DAYS i cofnięte po terminie w koszu (PWD-11 A).
  drop('shopping_trips', where(t, 'shopping_trips', (r) => older(r.done_at, nowMs - config.retention.TRIP_DAYS * DAY_MS - lag) || trash(r)));

  // Zadania: tylko takie, pod którymi nie zostaje żaden wiersz (podzadanie poza koszem albo młodszy nagrobek).
  const trashedTasks = where(t, 'tasks', trash);
  const keep = new Set<string>();
  if (trashedTasks.size > 0) {
    for (const k in tasks) {
      if (trashedTasks.has(k)) continue;
      for (let id = tasks[k]!.parent_id; id != null && trashedTasks.has(String(id)) && !keep.has(String(id)); id = tasks[String(id)]?.parent_id) keep.add(String(id));
    }
  }
  const gone = new Set([...trashedTasks].filter((k) => !keep.has(k)));
  /** Czy zostające zadanie wskazuje (polem `col`) któryś z kluczy — serwer najpierw je zmienia, czekamy na tę zmianę. */
  const pointed = (keys: Set<string>, col: string) => {
    const hit = new Set<string>();
    if (keys.size > 0) for (const k in tasks) if (!gone.has(k) && keys.has(String(tasks[k]![col]))) hit.add(String(tasks[k]![col]));
    return hit;
  };
  // Wydarzenia po terminie w koszu, bez zostających zadań przypiętych (zadanie usuwane razem z wydarzeniem nie czeka).
  const trashedEvents = where(t, 'events', trash);
  const pinned = pointed(trashedEvents, 'event_id');
  const ev = new Set([...trashedEvents].filter((k) => !pinned.has(k)));
  // Stałe zadania serii: po terminie w koszu, przy usuwanym wydarzeniu albo na liście po terminie w koszu; bez kopii
  // (zostających zadań), które serwer najpierw odłącza od definicji.
  const trashedLists = where(t, 'lists', trash);
  const serCand = where(t, 'event_task_series', (r) => trash(r) || ev.has(String(r.event_id)) || trashedLists.has(String(r.list_id)));
  const copies = pointed(serCand, 'series_id');
  const ser = new Set([...serCand].filter((k) => !copies.has(k)));
  // Listy po terminie w koszu, bez zadań i stałych zadań, które zostają; z ich zakupami (kaskada na serwerze).
  const used = new Set<string>();
  if (trashedLists.size > 0) {
    for (const k in tasks) if (!gone.has(k)) used.add(String(tasks[k]!.list_id));
    for (const k in series) if (!ser.has(k)) used.add(String(series[k]!.list_id));
  }
  const lst = new Set([...trashedLists].filter((l) => !used.has(l)));
  if (lst.size > 0) drop('shopping_trips', where(t, 'shopping_trips', (r) => lst.has(String(r.list_id))));
  // Wyjątki terminów, odpowiedzi i uczestnicy: po terminie w koszu albo przy usuwanym wydarzeniu.
  const ofEvent = (e: string) => where(t, e, (r) => trash(r) || ev.has(String(r.event_id)));
  const removed: { [e: string]: Set<string> } = {
    tasks: gone,
    event_task_series: ser,
    events: ev,
    lists: lst,
    object_members: where(t, 'object_members', trash),
    event_overrides: ofEvent('event_overrides'),
    event_rsvps: ofEvent('event_rsvps'),
    event_participants: ofEvent('event_participants'),
  };
  for (const [e, keys] of Object.entries(removed)) drop(e, keys);
  // Historia usuniętych rzeczy znika razem z nimi (jak na serwerze); klucz wpisu dostępu to „lista:osoba”.
  if (Object.values(removed).some((keys) => keys.size > 0)) {
    drop(
      'activity',
      where(t, 'activity', (r) => {
        const key = r.entity === 'object_members' ? `${String(r.scope_id)}:${String(r.entity_id)}` : String(r.entity_id);
        return removed[String(r.entity)]?.has(key) === true || lst.has(String(r.scope_id));
      }),
    );
  }
  return out;
}

/** Stan bez wierszy po terminie; ten sam obiekt, gdy nic nie wygasło (bez zbędnego zapisu). */
export function pruneExpired(state: ClientState, clockMs: number): ClientState {
  const expired = expiredKeys(state.base, retentionNow(state.base, clockMs));
  if (expired.size === 0) return state;
  const base = { ...state.base };
  for (const [e, keys] of expired) {
    const kept = { ...base[e] };
    for (const k of keys) delete kept[k];
    base[e] = kept;
  }
  return { ...state, base };
}
