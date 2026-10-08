/**
 * Zakres Moich spraw w grupach (decyzja właściciela 8.10.2026, PW-2 A / audyt 2 M-35, D149): „Wszystko / Przypisane do
 * mnie i wydarzenia / Tylko przypisane do mnie” przy każdej grupie wspólnej (src/domain/views/my-scope.ts). Jedno
 * miejsce zapisu i odczytu — z niego korzystają Moje sprawy, przypomnienia z porannym podsumowaniem, lustro w kalendarzu
 * iPhone'a i dojazd.
 * Zapis w lokalnej bazie konta (klucz local:*, jak „Grupa domyślna” — D175, decyzja koordynatora dla P6/P9), a nie na
 * serwerze: to wygoda czytającego, nie dane grupy. Wiersz członka (group_members) widzi cała grupa, więc zapis tam
 * pokazywałby innym, że ktoś „wyciszył” ich sprawy; lokalnie działa też od razu bez sieci i nie zmienia protokołu
 * (build 21). Koszt: drugi telefon tego samego konta ustawia się osobno.
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import { type MyScope, parseScopes, type ScopeOf, scopeAll, scopeLookup } from '../domain/views/my-scope';
import type { LocalStore } from './calendar-mirror';
import { useServices } from './context';

export const MY_SCOPE_KEY = 'myDaysScope';

/** Zakres z lokalnej bazy konta bez Reacta — planowanie w tle (przypomnienia, dojazd; D159). */
export const storedScopes = (local: LocalStore): ScopeOf => scopeLookup(parseScopes(local.load(MY_SCOPE_KEY)));

type Api = { scopeOf: ScopeOf; set(groupId: string, scope: MyScope): void };

const Ctx = createContext<Api>({ scopeOf: scopeAll, set: () => {} });
export const useMyScope = () => useContext(Ctx);

export function MyScopeProvider({ children }: { children: ReactNode }) {
  const { local } = useServices();
  const [scopes, setScopes] = useState(() => parseScopes(local?.load(MY_SCOPE_KEY) ?? null));
  const api = useMemo<Api>(
    () => ({
      scopeOf: scopeLookup(scopes),
      set: (groupId, scope) => {
        const next = { ...scopes };
        if (scope === 'all') delete next[groupId];
        else next[groupId] = scope;
        setScopes(next);
        local?.save(MY_SCOPE_KEY, JSON.stringify(next));
      },
    }),
    [local, scopes],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
