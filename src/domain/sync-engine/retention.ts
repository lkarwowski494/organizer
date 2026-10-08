/**
 * Retencja na telefonie (audyt 2, M-62, M-68): te same terminy co codzienne sprzątanie serwera
 * (supabase/migrations/20261008480000_retention.sql, private.purge_group), żeby kopia na telefonie nie trzymała dłużej
 * niż serwer. Serwer usuwa takie wiersze bez nagrobka; telefon z kursorem sprzed nich dostaje resync (purged_version),
 * a telefon, który je już ma, usuwa je sam tutaj:
 *  - historia zmian (activity) starsza niż config.retention.ACTIVITY_DAYS (decyzja właściciela z 8.10.2026, D184);
 *  - rozstrzygnięte przekazania (status inny niż „pending”) z decyzją starszą niż config.retention.HANDOFF_DAYS.
 * Wiersz bez czytelnej daty zostaje (nie zgadujemy).
 */
import { config } from '../../config';
import type { ClientState, Row } from './client';

const DAY_MS = 86_400_000;

const older = (value: unknown, limitMs: number) => typeof value === 'string' && Date.parse(value) < limitMs;

function expired(entity: 'activity' | 'handoffs', row: Row, nowMs: number): boolean {
  return entity === 'activity'
    ? older(row.created_at, nowMs - config.retention.ACTIVITY_DAYS * DAY_MS)
    : row.status !== 'pending' && older(row.decided_at, nowMs - config.retention.HANDOFF_DAYS * DAY_MS);
}

/** Stan bez wierszy po terminie; ten sam obiekt, gdy nic nie wygasło (bez zbędnego zapisu). */
export function pruneExpired(state: ClientState, nowMs: number): ClientState {
  let base: { [e: string]: { [id: string]: Row } } | null = null;
  for (const e of ['activity', 'handoffs'] as const) {
    const rows = state.base[e];
    if (!rows) continue;
    const gone = Object.entries(rows).filter(([, row]) => expired(e, row, nowMs));
    if (gone.length === 0) continue;
    base ??= { ...state.base };
    const kept = { ...rows };
    for (const [id] of gone) delete kept[id];
    base[e] = kept;
  }
  return base ? { ...state, base } : state;
}
