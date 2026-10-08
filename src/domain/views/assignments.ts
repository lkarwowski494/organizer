/**
 * Przypisania, o które mam poprosić serwer o powiadomienie (D81, ADR 0017): wpisy aktywności, w których to ja
 * przypisałem komuś innemu zadanie (assignee_member_id), zakupy albo wydarzenie (responsible_member_id). Wpis aktywności powstaje
 * na serwerze, więc jego obecność na telefonie znaczy, że zmiana dotarła. Serwer sprawdza wszystko jeszcze raz
 * (konto odbiorcy, wyciszenie grupy) i powiadamia najwyżej raz.
 */
import { groupsView } from './index';
import type { Tables } from './model';

// D88: także osoba odpowiedzialna za wydarzenie (cała seria albo jeden termin).
const COLUMN: Record<string, string> = { tasks: 'assignee_member_id', lists: 'responsible_member_id', events: 'responsible_member_id', event_overrides: 'responsible_member_id' };

export function assignmentsToNotify(t: Tables, userId: string, nowMs: number, maxAgeH: number): string[] {
  const me = new Map(groupsView(t, userId).map((g) => [g.id, g.me.member_id]));
  const out: string[] = [];
  for (const [id, a] of Object.entries(t.activity ?? {})) {
    const col = COLUMN[String(a.entity)];
    const mine = me.get(String(a.group_id));
    if (!col || !mine || a.actor_member_id !== mine) continue;
    const change = (a.changes as Record<string, [unknown, unknown]> | undefined)?.[col];
    const target = change?.[1];
    if (typeof target !== 'string' || target === mine) continue;
    if (typeof a.created_at !== 'string' || nowMs - Date.parse(a.created_at) > maxAgeH * 3_600_000) continue;
    out.push(id);
  }
  return out.sort();
}
