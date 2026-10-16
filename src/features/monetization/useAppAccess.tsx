/**
 * Apps4Brew Monetization Hook & Context:
 * Zarządza stanem dostępu do aplikacji w modelu „Cheaper than Espresso” ($0.99/msc, $4.99/rok, $14.99 Lifetime).
 * - 100% dostępu w okresie próbnym (Trial).
 * - Zawsze zachowany tryb Read-Only dla dotychczasowej historii i spraw.
 * - Blokada tworzenia nowych rekordów po wygaśnięciu trialu z wyświetleniem Paywalla.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import {
  type AccessState,
  applySubscription,
  canCreateItem,
  defaultAccessState,
  incrementCreation,
  isTrialActive,
  parseAccessState,
  trialDaysRemaining,
} from '../../domain/access';

export const ACCESS_STORAGE_KEY = 'organizer.access_state';

export type AppAccessContextValue = {
  state: AccessState;
  canCreate: boolean;
  isTrial: boolean;
  trialDaysLeft: number;
  showPaywall: boolean;
  setShowPaywall: (show: boolean) => void;
  recordCreation: () => Promise<void>;
  subscribe: (plan: 'monthly' | 'yearly' | 'lifetime') => Promise<void>;
  restorePurchases: () => Promise<boolean>;
  checkCanCreateOrShowPaywall: () => boolean;
};

export const AppAccessContext = createContext<AppAccessContextValue | null>(null);

export function AppAccessProvider({
  children,
  initialState,
  nowIso = () => new Date().toISOString(),
}: {
  children: ReactNode;
  initialState?: AccessState;
  nowIso?: () => string;
}) {
  const [access, setAccess] = useState<AccessState>(() => initialState ?? defaultAccessState(nowIso()));
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    if (initialState) return;
    void SecureStore.getItemAsync(ACCESS_STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = parseAccessState(raw, nowIso());
          setAccess(parsed);
        }
      })
      .catch(() => {});
  }, [initialState, nowIso]);

  const save = useCallback(async (next: AccessState) => {
    setAccess(next);
    try {
      await SecureStore.setItemAsync(ACCESS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // offline fallback
    }
  }, []);

  const currentNow = nowIso();
  const canCreate = useMemo(() => canCreateItem(access, currentNow), [access, currentNow]);
  const isTrial = useMemo(() => isTrialActive(access, currentNow), [access, currentNow]);
  const trialDaysLeft = useMemo(() => trialDaysRemaining(access, currentNow), [access, currentNow]);

  const recordCreation = useCallback(async () => {
    const next = incrementCreation(access);
    await save(next);
  }, [access, save]);

  const subscribe = useCallback(
    async (plan: 'monthly' | 'yearly' | 'lifetime') => {
      const next = applySubscription(access, plan, nowIso());
      await save(next);
      setShowPaywall(false);
    },
    [access, nowIso, save],
  );

  const restorePurchases = useCallback(async () => {
    try {
      const raw = await SecureStore.getItemAsync(ACCESS_STORAGE_KEY);
      if (raw) {
        const parsed = parseAccessState(raw, nowIso());
        setAccess(parsed);
        return parsed.plan !== 'free_trial';
      }
    } catch {
      // ignore
    }
    return false;
  }, [nowIso]);

  const checkCanCreateOrShowPaywall = useCallback(() => {
    if (canCreate) return true;
    setShowPaywall(true);
    return false;
  }, [canCreate]);

  const value = useMemo(
    () => ({
      state: access,
      canCreate,
      isTrial,
      trialDaysLeft,
      showPaywall,
      setShowPaywall,
      recordCreation,
      subscribe,
      restorePurchases,
      checkCanCreateOrShowPaywall,
    }),
    [access, canCreate, isTrial, trialDaysLeft, showPaywall, recordCreation, subscribe, restorePurchases, checkCanCreateOrShowPaywall],
  );

  return <AppAccessContext.Provider value={value}>{children}</AppAccessContext.Provider>;
}

export function useAppAccess(): AppAccessContextValue {
  const ctx = useContext(AppAccessContext);
  if (!ctx) {
    const fallback = defaultAccessState(new Date().toISOString());
    return {
      state: fallback,
      canCreate: true,
      isTrial: true,
      trialDaysLeft: 7,
      showPaywall: false,
      setShowPaywall: () => {},
      recordCreation: async () => {},
      subscribe: async () => {},
      restorePurchases: async () => false,
      checkCanCreateOrShowPaywall: () => true,
    };
  }
  return ctx;
}
