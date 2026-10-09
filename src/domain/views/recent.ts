/**
 * „Ostatnie zmiany” (decyzja właściciela z 8.10.2026, audyt 2: PW-10 C+A, M-38; D194): „Cofnij” bez limitu czasu ze
 * sprawdzeniem, czy rzecz nie zmieniła się od mojej zmiany. Odcisk to stan pól, które zmiana ustawiła (i czy wiersz
 * istnieje), zaraz po niej; cofnięcie, gdy odcisk już się nie zgadza, nadpisałoby cudzą (albo moją późniejszą) zmianę,
 * więc go nie robimy.
 */
import type { NewOp, Row } from '../sync-engine/client';
import type { Tables } from './model';

export type Fingerprint = readonly { entity: string; id: string; alive: boolean; fields: Readonly<Record<string, unknown>> }[];

const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Ta sama wartość po drodze przez serwer: godzina wraca z sekundami („17:30:00”), znacznik czasu w innym zapisie strefy,
 * brak pola = null, a tablice (stałe zakupy) porównujemy po treści.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if ((a ?? null) === (b ?? null)) return true;
  if (typeof a === 'string' && typeof b === 'string') {
    if (TIME.test(a) && TIME.test(b)) return a.slice(0, 5) === b.slice(0, 5);
    if (STAMP.test(a) && STAMP.test(b)) return Date.parse(a) === Date.parse(b);
    return false;
  }
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Audyt 3 (N-35): część serii po „to i następne” (split_event — także zmiana lekcji w zapisie planu) — nazwa i godziny
 * nowej części (telefon tworzy ją od razu, applySplit; serwer — te same pola). Reguły nie porównujemy: serwer może
 * przejść do następczyni serii i zapisać inną datę końca.
 */
const SPLIT_KEYS = ['title', 'start_date', 'start_time', 'end_time'];

function touched(op: NewOp): { entity: string; id: string; keys: string[] } | null {
  if (op.kind === 'cmd') {
    if (op.cmd === 'split_event') return { entity: 'events', id: String(op.args.id), keys: SPLIT_KEYS };
    return op.cmd === 'staple_add' || op.cmd === 'staple_remove' ? { entity: 'lists', id: String(op.args.list_id), keys: ['staples'] } : null;
  }
  return { entity: op.entity, id: op.id, keys: op.kind === 'create' || op.kind === 'patch' ? Object.keys(op.set) : [] };
}

const alive = (r: Row | undefined) => r !== undefined && r.deleted_at == null;

/** Odcisk po zmianie `ops` (tabele `t` już ze zmianą). */
export function fingerprint(t: Tables, ops: readonly NewOp[]): Fingerprint {
  const acc = new Map<string, { entity: string; id: string; keys: Set<string> }>();
  for (const op of ops) {
    const x = touched(op);
    if (!x) continue;
    const k = `${x.entity}|${x.id}`;
    const cur = acc.get(k) ?? { entity: x.entity, id: x.id, keys: new Set<string>() };
    x.keys.forEach((key) => cur.keys.add(key));
    acc.set(k, cur);
  }
  return [...acc.values()].map(({ entity, id, keys }) => {
    const r = t[entity]?.[id];
    return { entity, id, alive: alive(r), fields: Object.fromEntries([...keys].map((key) => [key, r?.[key] ?? null])) };
  });
}

/** Czy od odcisku coś się zmieniło (wiersz usunięty albo przywrócony, inne wartości pól). */
export function isStale(t: Tables, fp: Fingerprint): boolean {
  return fp.some((f) => {
    const r = t[f.entity]?.[f.id];
    return alive(r) !== f.alive || Object.entries(f.fields).some(([k, v]) => !sameValue(r?.[k], v));
  });
}

/**
 * Zapis „Ostatnich zmian” w bazie konta (decyzja koordynatora z 8.10.2026, D194 b): lista przeżywa ponowne
 * uruchomienie. Cofnięcie zapisujemy jako operacje — stałe albo liczone w chwili cofnięcia według przepisu (rutyna:
 * kopie kroków dołożone w międzyczasie, routineUndoOps). Cofnięcia, których nie da się zapisać (wywołanie serwera —
 * grupa; plan lekcji liczony z całego planu), zostają po ponownym uruchomieniu tylko w historii, z powodem (`lost`).
 */
export type RecentUndo = { ops: readonly NewOp[]; recipe?: 'routine' };
export type RecentLost = 'server' | 'plan';
export type RecentRecord = {
  id: number;
  message: string;
  at: number;
  /** „pending” — cofnięcie przez serwer czeka na odpowiedź (audyt 3, N-34); po ponownym uruchomieniu — „lost”. */
  state: 'open' | 'pending' | 'undone' | 'stale' | 'lost';
  undo: RecentUndo | null;
  /** Dlaczego po ponownym uruchomieniu nie da się cofnąć (cofnięcie nie było zapisywalne). */
  lost: RecentLost | null;
  fp: Fingerprint | null;
};

const STATES = ['open', 'undone', 'stale', 'lost'] as const;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function asUndo(x: unknown): RecentUndo | null {
  if (!isObj(x) || !Array.isArray(x.ops) || !x.ops.every(isObj)) return null;
  return x.recipe === 'routine' ? { ops: x.ops as unknown as NewOp[], recipe: 'routine' } : { ops: x.ops as unknown as NewOp[] };
}

/**
 * Odczyt po uruchomieniu. Wpis otwarty bez zapisanego cofnięcia staje się „lost”; uszkodzone wpisy pomijamy (zapis
 * z innej wersji aplikacji, ręczna zmiana bazy) — lista to wygoda, nie dane.
 */
export function parseRecent(json: string | null): RecentRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): RecentRecord[] => {
    if (!isObj(r) || typeof r.id !== 'number' || typeof r.message !== 'string' || typeof r.at !== 'number') return [];
    const state = STATES.find((s) => s === r.state) ?? 'open';
    const undo = asUndo(r.undo);
    const lost = r.lost === 'plan' ? 'plan' : r.lost === 'server' ? 'server' : null;
    const fp = Array.isArray(r.fp) ? (r.fp as Fingerprint) : null;
    return [{ id: r.id, message: r.message, at: r.at, state: state === 'open' && undo === null ? 'lost' : state, undo, lost: lost ?? (undo === null ? 'server' : null), fp }];
  });
}
