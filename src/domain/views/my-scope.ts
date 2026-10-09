/**
 * Zakres Moich spraw w grupie (decyzja właściciela 8.10.2026, PW-2 A / audyt 2 M-35, D149): przy każdej grupie wspólnej
 * ustawienie „W Moich sprawach”:
 *  - `all` — Wszystko (domyślne): reguła D89 bez zmian (nieprzypisane z terminem, wydarzenia całej grupy…);
 *  - `mineAndEvents` — Przypisane do mnie i wydarzenia: zadania i zakupy tylko moje (moja osoba albo moja lista „Tylko
 *    ja”), wydarzenia jak dotąd;
 *  - `mine` — Tylko przypisane do mnie: zadania jak wyżej, z wydarzeń tylko te, za które odpowiadam albo w których
 *    jestem imiennie uczestnikiem.
 * Ten sam zakres stosują Moje sprawy, przypomnienia, poranne podsumowanie, lustro w kalendarzu iPhone'a i dojazd —
 * wszystkie liczą „co mnie dotyczy” tymi samymi funkcjami (concerns.ts, Occurrence.concernsMe). Grupa osobista ma
 * zawsze `all` (wszystko w niej jest moje).
 * Zapis na koncie (decyzja koordynatora 9.10.2026 — wariant lepszy): wiersz `my_day_scopes` przy moim członkostwie, który
 * widzi tylko moje konto (RLS, migracja 20261008570000_my_scopes_trips), więc drugi telefon dostaje go przy pobieraniu.
 * Id wiersza = UUIDv5 z mojego member_id (`scopeRowId`) — dwa telefony piszą ten sam wiersz.
 */
import { uuidv5 } from '../ids';
import type { NewOp } from '../sync-engine/client';
import { rows, type Tables } from './model';

export type MyScope = 'all' | 'mineAndEvents' | 'mine';

export const MY_SCOPES: readonly MyScope[] = ['all', 'mineAndEvents', 'mine'];

/** Zakres grupy; nieznana grupa albo brak ustawienia — `all`. */
export type ScopeOf = (groupId: string) => MyScope;

export const scopeAll: ScopeOf = () => 'all';

/** Zapis ustawień (JSON: grupa → zakres) — nieznane wartości i uszkodzony zapis pomijamy (zostaje `all`). */
export function parseScopes(raw: string | null): Record<string, MyScope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, MyScope] => MY_SCOPES.includes(e[1] as MyScope) && e[1] !== 'all'));
}

export const scopeLookup = (scopes: Readonly<Record<string, MyScope>>): ScopeOf => (groupId) => scopes[groupId] ?? 'all';

/** Wystąpienie w zakresie grupy (wydarzenia: `mine` — tylko moja odpowiedzialność albo imienny udział). */
export function occurrenceInScope(o: { concernsMe: boolean; assignedToMe: boolean; groupId: string }, scopeOf: ScopeOf): boolean {
  return o.concernsMe && (scopeOf(o.groupId) !== 'mine' || o.assignedToMe);
}

/** Przestrzeń nazw: UUIDv5(NAMESPACE_URL, „https://github.com/lkarwowski494/organizer/my-day-scope”). */
export const SCOPE_NAMESPACE = '2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9';
export const scopeRowId = (memberId: string) => uuidv5(SCOPE_NAMESPACE, memberId);

type ScopeRow = { id: string; group_id: string; member_id: string; scope: string; deleted_at: string | null };
const asScopeRow = (r: Record<string, unknown>): ScopeRow => ({ id: String(r.id), group_id: String(r.group_id), member_id: String(r.member_id), scope: String(r.scope), deleted_at: r.deleted_at == null ? null : String(r.deleted_at) });

/** Moje zakresy z danych konta: grupa → zakres (tylko wiersze moich członkostw; „Wszystko” i nieznane pomijane). */
export function scopesOf(t: Tables, myMembers: ReadonlyMap<string, { member_id: string }>): Record<string, MyScope> {
  const out: Record<string, MyScope> = {};
  for (const r of rows(t, 'my_day_scopes', asScopeRow)) {
    const mine = myMembers.get(r.group_id)?.member_id === r.member_id;
    if (mine && r.deleted_at === null && (r.scope === 'mine' || r.scope === 'mineAndEvents')) out[r.group_id] = r.scope;
  }
  return out;
}

/** Zmiana zakresu w grupie: utworzenie wiersza albo zmiana pola (także z powrotem na „Wszystko”). */
export function setScopeOps(t: Tables, groupId: string, memberId: string, scope: MyScope): NewOp[] {
  const id = scopeRowId(memberId);
  const row = t.my_day_scopes?.[id];
  if (!row) return [{ kind: 'create', entity: 'my_day_scopes', id, group_id: groupId, set: { member_id: memberId, scope } }];
  return [...(row.deleted_at != null ? [{ kind: 'restore', entity: 'my_day_scopes', id } as const] : []), { kind: 'patch', entity: 'my_day_scopes', id, set: { scope } }];
}
