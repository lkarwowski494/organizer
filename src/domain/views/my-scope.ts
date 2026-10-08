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
 * zawsze `all` (wszystko w niej jest moje). Ustawienie jest wygodą konta na tym telefonie (src/app/my-scope.tsx).
 */

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
