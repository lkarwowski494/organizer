/**
 * Zakres Moich spraw w grupach (decyzja właściciela 8.10.2026, PW-2 A / audyt 2 M-35, D149): „Wszystko / Przypisane do
 * mnie i wydarzenia / Tylko przypisane do mnie” przy każdej grupie wspólnej (src/domain/views/my-scope.ts). Jedno
 * miejsce odczytu i zapisu — z niego korzystają Moje sprawy, przypomnienia z porannym podsumowaniem, lustro w kalendarzu
 * iPhone'a i dojazd.
 * Zapis na koncie (decyzja koordynatora 9.10.2026): wiersz `my_day_scopes`, który widzi tylko moje konto, wysyłany jak
 * każda zmiana (offline też), więc drugi telefon tego konta ma to samo. Wcześniejszy zapis tego telefonu (local:*, przed
 * tą zmianą) przechodzi na konto raz.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { myMemberships, type Tables } from '../domain/views';
import { type MyScope, parseScopes, type ScopeOf, scopeAll, scopeLookup, scopesOf, setScopeOps } from '../domain/views/my-scope';
import { useAppData, useServices } from './context';

/** Dawny zapis na telefonie (przed zapisem na koncie) — przenoszony raz. */
export const MY_SCOPE_KEY = 'myDaysScope';

/** Zakres z danych konta bez Reacta — planowanie w tle (przypomnienia, dojazd; D159). */
export const storedScopes = (t: Tables, userId: string): ScopeOf => scopeLookup(scopesOf(t, myMemberships(t, userId)));

type Api = { scopeOf: ScopeOf; set(groupId: string, scope: MyScope): void };

const Ctx = createContext<Api>({ scopeOf: scopeAll, set: () => {} });
export const useMyScope = () => useContext(Ctx);

export function MyScopeProvider({ children }: { children: ReactNode }) {
  const { local, store, userId } = useServices();
  const { tables } = useAppData();
  const mine = useMemo(() => myMemberships(tables, userId), [tables, userId]);
  // Przeniesienie dawnego zapisu: grupy, w których jestem, dostają wiersz (jeśli konto go jeszcze nie ma); potem zapis
  // telefonu znika. Czekamy na pobrane członkostwa — przed pierwszym pobraniem nie ma do czego przypiąć.
  useEffect(() => {
    const old = parseScopes(local?.load(MY_SCOPE_KEY) ?? null);
    if (!local?.load(MY_SCOPE_KEY) || mine.size === 0) return;
    const have = scopesOf(tables, mine);
    const ops = Object.entries(old).flatMap(([g, scope]) => (mine.has(g) && !have[g] ? setScopeOps(tables, g, mine.get(g)!.member_id, scope) : []));
    if (ops.length) store.dispatch(ops);
    local.save(MY_SCOPE_KEY, null);
  }, [local, store, tables, mine]);
  const api = useMemo<Api>(
    () => ({
      scopeOf: scopeLookup(scopesOf(tables, mine)),
      set: (groupId, scope) => {
        const m = mine.get(groupId);
        if (m) store.dispatch(setScopeOps(tables, groupId, m.member_id, scope));
      },
    }),
    [tables, mine, store],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
