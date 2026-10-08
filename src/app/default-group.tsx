/**
 * Grupa domyślna nowego wpisu (decyzje właściciela 8.10.2026: PW-3 / audyt 2 M-24 — chip przy polu dodawania w Moich
 * sprawach; PW-37 / M-118 — później formularze wydarzenia, rutyny i listy): ustawienie „Grupa domyślna” („Ostatnio
 * użyta” albo konkretna grupa) i ostatnio użyta grupa. Start liczy `startGroup` (domain/views/default-group.ts);
 * `remember` to jedyne miejsce, które zapisuje ostatnio użytą grupę.
 * Tylko na tym telefonie, w lokalnej bazie konta (klucze local:*, jak stan lustra kalendarza — więc osobno dla każdego
 * konta, D175): to wygoda jednego telefonu,
 * a nie dane grupy, więc bez synchronizacji (drugi telefon może mieć inną grupę domyślną).
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import { LAST_USED } from '../domain/views/default-group';
import { useServices } from './context';

export const DEFAULT_GROUP_KEY = 'defaultGroup';
export const LAST_USED_GROUP_KEY = 'lastUsedGroup';

type Api = {
  /** Bez lokalnej bazy nic nie zapamiętujemy: start od osobistej, ustawienia nie ma. */
  available: boolean;
  /** `LAST_USED` albo id grupy. */
  setting: string;
  last: string | null;
  setSetting(value: string): void;
  /** Grupa została użyta (wybrana chipem, „#Grupa”…) — zostaje ostatnio użytą. */
  remember(groupId: string): void;
};

const Ctx = createContext<Api>({ available: false, setting: LAST_USED, last: null, setSetting: () => {}, remember: () => {} });
export const useDefaultGroup = () => useContext(Ctx);

export function DefaultGroupProvider({ children }: { children: ReactNode }) {
  const { local } = useServices();
  const [setting, setSettingState] = useState(() => local?.load(DEFAULT_GROUP_KEY) ?? LAST_USED);
  const [last, setLast] = useState(() => local?.load(LAST_USED_GROUP_KEY) ?? null);
  const api = useMemo<Api>(
    () => ({
      available: !!local,
      setting,
      last,
      setSetting: (value) => {
        setSettingState(value);
        local?.save(DEFAULT_GROUP_KEY, value);
      },
      remember: (groupId) => {
        setLast(groupId);
        local?.save(LAST_USED_GROUP_KEY, groupId);
      },
    }),
    [local, setting, last],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
