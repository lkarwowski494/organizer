import {
  applySubscription,
  canCreateItem,
  defaultAccessState,
  incrementCreation,
  isTrialActive,
  parseAccessState,
  PLAN_PRICING,
  TRIAL_DAYS,
  TRIAL_MAX_CREATIONS,
  trialDaysRemaining,
} from '../app-access';

describe('app-access domain model', () => {
  const t0 = '2026-10-16T10:00:00.000Z';

  it('tworzy domyślny stan okresu próbnego', () => {
    const s = defaultAccessState(t0);
    expect(s.plan).toBe('free_trial');
    expect(s.trialStartedAt).toBe(t0);
    expect(s.expiresAt).toBeNull();
    expect(s.createdCount).toBe(0);
    expect(isTrialActive(s, t0)).toBe(true);
    expect(canCreateItem(s, t0)).toBe(true);
    expect(trialDaysRemaining(s, t0)).toBe(TRIAL_DAYS);
  });

  it('wygasza trial po przekroczeniu 7 dni', () => {
    const s = defaultAccessState(t0);
    const day8 = '2026-10-24T10:00:01.000Z'; // > 7 dni
    expect(isTrialActive(s, day8)).toBe(false);
    expect(canCreateItem(s, day8)).toBe(false);
    expect(trialDaysRemaining(s, day8)).toBe(0);
  });

  it('wygasza trial po osiągnięciu maksymalnej liczby utworzeń', () => {
    let s = defaultAccessState(t0);
    for (let i = 0; i < TRIAL_MAX_CREATIONS; i++) {
      expect(canCreateItem(s, t0)).toBe(true);
      s = incrementCreation(s);
    }
    expect(s.createdCount).toBe(TRIAL_MAX_CREATIONS);
    expect(isTrialActive(s, t0)).toBe(false);
    expect(canCreateItem(s, t0)).toBe(false);
  });

  it('obsługuje plan Lifetime (dostęp zawsze odblokowany)', () => {
    const s = defaultAccessState(t0);
    const sub = applySubscription(s, 'lifetime', t0);
    expect(sub.plan).toBe('lifetime');
    expect(sub.expiresAt).toBeNull();
    expect(canCreateItem(sub, '2030-01-01T00:00:00.000Z')).toBe(true);
    expect(trialDaysRemaining(sub, t0)).toBe(0);
    expect(isTrialActive(sub, t0)).toBe(false);
  });

  it('obsługuje plan miesięczny i roczny z ważnością expiresAt', () => {
    const s = defaultAccessState(t0);
    const monthly = applySubscription(s, 'monthly', t0);
    expect(monthly.plan).toBe('monthly');
    expect(canCreateItem(monthly, '2026-11-01T00:00:00.000Z')).toBe(true);
    expect(canCreateItem(monthly, '2026-12-01T00:00:00.000Z')).toBe(false);

    const yearly = applySubscription(s, 'yearly', t0);
    expect(yearly.plan).toBe('yearly');
    expect(canCreateItem(yearly, '2027-05-01T00:00:00.000Z')).toBe(true);
    expect(canCreateItem(yearly, '2028-01-01T00:00:00.000Z')).toBe(false);

    // Gdyby expiresAt było null
    expect(canCreateItem({ ...monthly, expiresAt: null }, t0)).toBe(true);
  });

  it('parsuje poprawny i uszkodzony stan JSON', () => {
    const validJson = JSON.stringify({
      plan: 'yearly',
      trialStartedAt: t0,
      expiresAt: '2027-10-16T10:00:00.000Z',
      createdCount: 4,
    });
    const parsed = parseAccessState(validJson, t0);
    expect(parsed.plan).toBe('yearly');
    expect(parsed.createdCount).toBe(4);

    expect(parseAccessState(null, t0).plan).toBe('free_trial');
    expect(parseAccessState('', t0).plan).toBe('free_trial');
    expect(parseAccessState('{ bad json', t0).plan).toBe('free_trial');
    expect(parseAccessState('{"plan":"unknown"}', t0).plan).toBe('free_trial');
    expect(parseAccessState('123', t0).plan).toBe('free_trial');
  });

  it('zawiera cennik dla wszystkich planów', () => {
    expect(PLAN_PRICING.monthly.usd).toBe('$0.99');
    expect(PLAN_PRICING.yearly.usd).toBe('$4.99');
    expect(PLAN_PRICING.lifetime.usd).toBe('$14.99');
  });
});
