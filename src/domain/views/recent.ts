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

function touched(op: NewOp): { entity: string; id: string; keys: string[] } | null {
  if (op.kind === 'cmd') return op.cmd === 'staple_add' || op.cmd === 'staple_remove' ? { entity: 'lists', id: String(op.args.list_id), keys: ['staples'] } : null;
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
