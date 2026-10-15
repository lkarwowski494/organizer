/**
 * Aktualizacja zrzutu widżetu iOS (D17, BRD B4).
 * Przelicza widok „Moje sprawy” na dziś i zapisuje zrzut JSON przez WidgetBridge.
 */
import { formatIsoDate } from '../domain/civil-date';
import { localNow } from '../domain/local-time';
import { materialize, type ClientState } from '../domain/sync-engine/client';
import { buildWidgetPayload } from '../domain/views/widget';
import type { WidgetBridge } from './widget-bridge';
import { storedScopes } from './my-scope';

export function updateWidgetSnapshot(
  widget: WidgetBridge | undefined,
  state: ClientState,
  userId: string,
  nowMs: number,
): void {
  if (!widget) return;
  const tables = materialize(state);
  const now = localNow(nowMs);
  const today = { y: now.y, m: now.m, d: now.d };
  const payload = buildWidgetPayload({
    tables,
    userId,
    today,
    nowIso: new Date(nowMs).toISOString(),
    localIso: (utcIso) => formatIsoDate(localNow(Date.parse(utcIso))),
    scopeOf: storedScopes(tables, userId),
  });
  widget.updateSnapshot(JSON.stringify(payload));
}
