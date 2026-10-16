/**
 * Apps4Brew Monetization & Access Model („Cheaper than Espresso”):
 * - Model cenowy: $0.99 USD / miesiąc (~4,49 zł), $4.99 USD / rok (~22,99 zł, 7 dni trialu), $14.99 USD Lifetime (~69,99 zł na zawsze).
 * - ZERO podziału na funkcje Free i Pro: w okresie próbnym użytkownik ma dostęp do 100% możliwości aplikacji.
 * - Historia Read-Only po trialu: użytkownik ZAWSZE widzi całą swoją historię, zadania, harmonogramy i notatki.
 * - Blokada tworzenia: po wygaśnięciu trialu blokowane jest wyłącznie dodawanie NOWYCH rekordów (z Paywallem).
 */

export type AccessPlan = 'free_trial' | 'monthly' | 'yearly' | 'lifetime';

export type AccessState = {
  plan: AccessPlan;
  trialStartedAt: string;
  expiresAt: string | null;
  createdCount: number;
};

export const TRIAL_DAYS = 7;
export const TRIAL_MAX_CREATIONS = 15;

export const PLAN_PRICING: Record<AccessPlan, { usd: string; pln: string }> = {
  free_trial: { usd: '$0.00', pln: '0 zł' },
  monthly: { usd: '$0.99', pln: '4,49 zł' },
  yearly: { usd: '$4.99', pln: '22,99 zł' },
  lifetime: { usd: '$14.99', pln: '69,99 zł' },
};

export function defaultAccessState(nowIso: string): AccessState {
  return {
    plan: 'free_trial',
    trialStartedAt: nowIso,
    expiresAt: null,
    createdCount: 0,
  };
}

export function isTrialActive(state: AccessState, nowIso: string): boolean {
  if (state.plan !== 'free_trial') return false;
  const started = new Date(state.trialStartedAt).getTime();
  const now = new Date(nowIso).getTime();
  const daysPassed = (now - started) / (1000 * 60 * 60 * 24);
  return daysPassed < TRIAL_DAYS && state.createdCount < TRIAL_MAX_CREATIONS;
}

export function canCreateItem(state: AccessState, nowIso: string): boolean {
  if (state.plan === 'lifetime') return true;
  if (state.plan === 'monthly' || state.plan === 'yearly') {
    if (!state.expiresAt) return true;
    return new Date(nowIso).getTime() <= new Date(state.expiresAt).getTime();
  }
  return isTrialActive(state, nowIso);
}

export function trialDaysRemaining(state: AccessState, nowIso: string): number {
  if (state.plan !== 'free_trial') return 0;
  const started = new Date(state.trialStartedAt).getTime();
  const now = new Date(nowIso).getTime();
  const daysLeft = Math.ceil(TRIAL_DAYS - (now - started) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysLeft);
}

export function incrementCreation(state: AccessState): AccessState {
  return {
    ...state,
    createdCount: state.createdCount + 1,
  };
}

export function applySubscription(
  state: AccessState,
  plan: 'monthly' | 'yearly' | 'lifetime',
  nowIso: string,
): AccessState {
  if (plan === 'lifetime') {
    return {
      ...state,
      plan: 'lifetime',
      expiresAt: null,
    };
  }

  const baseDate = new Date(nowIso);
  if (plan === 'monthly') {
    baseDate.setMonth(baseDate.getMonth() + 1);
  } else {
    baseDate.setFullYear(baseDate.getFullYear() + 1);
  }

  return {
    ...state,
    plan,
    expiresAt: baseDate.toISOString(),
  };
}

export function parseAccessState(raw: string | null | undefined, nowIso: string): AccessState {
  if (!raw) return defaultAccessState(nowIso);
  try {
    const parsed = JSON.parse(raw) as Partial<AccessState>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.plan === 'free_trial' || parsed.plan === 'monthly' || parsed.plan === 'yearly' || parsed.plan === 'lifetime') &&
      typeof parsed.trialStartedAt === 'string' &&
      typeof parsed.createdCount === 'number'
    ) {
      return {
        plan: parsed.plan,
        trialStartedAt: parsed.trialStartedAt,
        expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
        createdCount: parsed.createdCount,
      };
    }
  } catch {
    // fallback do domyślnego stanu
  }
  return defaultAccessState(nowIso);
}
