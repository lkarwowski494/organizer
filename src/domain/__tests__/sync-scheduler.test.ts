import * as fc from 'fast-check';

import { config } from '../../config';
import {
  backoffMs,
  decide,
  indicator,
  initialScheduler,
  onEvent,
  pendingTimer,
  type SchedulerEvent,
  type SchedulerState,
} from '../sync-engine/scheduler';

const T0 = 1_000_000;
const run = (events: [SchedulerEvent, number][], s: SchedulerState = initialScheduler(T0)) =>
  events.reduce((acc, [e, at]) => onEvent(acc, e, at), s);

describe('pętla synchronizacji — scenariusze', () => {
  it('start: od razu pobranie', () => {
    expect(decide(initialScheduler(T0), T0)).toEqual({ do: 'pull' });
  });

  it('lokalna zmiana: wysyłka dopiero po 1 s (debounce), potem pobranie', () => {
    let s = run([[{ t: 'started', what: 'pull' }, T0], [{ t: 'pull_ok', needMore: false, pending: 0 }, T0]]);
    s = onEvent(s, { t: 'local_change', pending: 1 }, T0 + 10);
    expect(decide(s, T0 + 500)).toEqual({ do: 'wait', until: T0 + 10 + config.sync.PUSH_DEBOUNCE_MS });
    expect(decide(s, T0 + 1010)).toEqual({ do: 'push' });
    s = onEvent(onEvent(s, { t: 'started', what: 'push' }, T0 + 1010), { t: 'push_ok', pending: 1 }, T0 + 1100);
    // Po wysyłce pobranie zdejmie potwierdzone operacje (pending z ClientState zmaleje dopiero wtedy).
    expect(decide({ ...s, pending: 0 }, T0 + 1100)).toEqual({ do: 'pull' });
  });

  it('kolejne zmiany przesuwają debounce, ale nie w nieskończoność wstecz', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0]]);
    s = onEvent(s, { t: 'local_change', pending: 1 }, T0);
    s = onEvent(s, { t: 'local_change', pending: 2 }, T0 + 800);
    expect(decide(s, T0 + 1500)).toEqual({ do: 'wait', until: T0 + 1800 });
  });

  it('w trakcie wywołania nic nowego nie startuje', () => {
    const s = onEvent(initialScheduler(T0), { t: 'started', what: 'pull' }, T0);
    expect(decide({ ...s, pending: 5 }, T0 + 99_999)).toEqual({ do: 'idle' });
    expect(indicator({ ...s, pending: 5 })).toEqual({ state: 'syncing', pending: 5 });
  });

  it('offline: nic nie wysyła, wskaźnik „offline” z liczbą zmian; po powrocie sieci — od razu', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0], [{ t: 'network', online: false }, T0], [{ t: 'local_change', pending: 3 }, T0]]);
    expect(decide(s, T0 + 10_000)).toEqual({ do: 'idle' });
    expect(indicator(s)).toEqual({ state: 'offline', pending: 3 });
    s = onEvent(s, { t: 'network', online: true }, T0 + 20_000);
    expect(decide(s, T0 + 20_000)).toEqual({ do: 'push' });
  });

  it('błąd przejściowy: ponowienie z rosnącym opóźnieniem 1 s → 60 s, potem sukces zeruje licznik', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0], [{ t: 'local_change', pending: 1 }, T0]]);
    const delays: number[] = [];
    let now = T0 + 1000;
    for (let i = 0; i < 9; i++) {
      expect(decide(s, now)).toEqual({ do: 'push' });
      s = onEvent(onEvent(s, { t: 'started', what: 'push' }, now), { t: 'failed', what: 'push', error: 'network' }, now);
      const d = decide(s, now);
      expect(d.do).toBe('wait');
      delays.push((d as { until: number }).until - now);
      now = (d as { until: number }).until;
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(indicator(s)).toEqual({ state: 'error', pending: 1, error: 'network' });
    s = onEvent(onEvent(s, { t: 'started', what: 'push' }, now), { t: 'push_ok', pending: 1 }, now);
    expect(s.failures).toBe(0);
    expect(indicator({ ...s, pending: 0 })).toEqual({ state: 'synced', since: now });
  });

  it('nieudane pobranie: ponowienie pobrania z opóźnieniem', () => {
    const s = run([[{ t: 'started', what: 'pull' }, T0], [{ t: 'failed', what: 'pull', error: 'server' }, T0]]);
    expect(decide(s, T0)).toEqual({ do: 'wait', until: T0 + 1000 });
    expect(decide(s, T0 + 1000)).toEqual({ do: 'pull' });
  });

  it('wygasła sesja: nic nie wysyła, kolejka zostaje, po odświeżeniu tokenu — od razu', () => {
    let s = run([[{ t: 'local_change', pending: 2 }, T0], [{ t: 'started', what: 'push' }, T0 + 2000], [{ t: 'failed', what: 'push', error: 'auth' }, T0 + 2000]]);
    expect(decide(s, T0 + 100_000)).toEqual({ do: 'idle' });
    expect(indicator(s)).toEqual({ state: 'auth_expired', pending: 2 });
    expect(s.pending).toBe(2);
    s = onEvent(s, { t: 'auth_refreshed' }, T0 + 200_000);
    expect(decide(s, T0 + 200_000)).toEqual({ do: 'push' });
  });

  it('błąd trwały (audyt 2, M-57): bez ponowień i bez timera; upgrade_required → „Zaktualizuj aplikację”; powrót do aplikacji próbuje raz', () => {
    let s = run([[{ t: 'local_change', pending: 2 }, T0], [{ t: 'started', what: 'push' }, T0 + 1000], [{ t: 'failed', what: 'push', error: 'fatal', code: 'upgrade_required' }, T0 + 1000]]);
    expect(decide(s, T0 + 3_600_000)).toEqual({ do: 'idle' });
    expect(pendingTimer(s, T0 + 1000)).toBeNull();
    expect(indicator(s)).toEqual({ state: 'upgrade_required', pending: 2 });
    // Sieć i odświeżona sesja tego nie zdejmują; pierwszy plan — jedna nowa próba.
    s = onEvent(onEvent(s, { t: 'network', online: true }, T0 + 2000), { t: 'auth_refreshed' }, T0 + 2000);
    expect(decide(s, T0 + 2000)).toEqual({ do: 'idle' });
    s = onEvent(s, { t: 'foreground' }, T0 + 5000);
    expect(decide(s, T0 + 5000)).toEqual({ do: 'push' });
    // Inny błąd trwały (np. client_mismatch): wskaźnik błędu z kodem, też bez ponowień.
    s = onEvent(onEvent(s, { t: 'started', what: 'pull' }, T0 + 6000), { t: 'failed', what: 'pull', error: 'fatal', code: 'client_mismatch' }, T0 + 6000);
    expect(decide(s, T0 + 999_999)).toEqual({ do: 'idle' });
    expect(indicator(s)).toEqual({ state: 'error', pending: 2, error: 'client_mismatch' });
  });

  it('poke: pobiera tylko przy nowszej wersji; w tle nie pobiera, ale wysyła', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0]]);
    expect(decide(onEvent(s, { t: 'poke', fresh: false }, T0), T0)).toEqual({ do: 'idle' });
    expect(decide(onEvent(s, { t: 'poke', fresh: true }, T0), T0)).toEqual({ do: 'pull' });
    s = onEvent(onEvent(s, { t: 'background' }, T0), { t: 'poke', fresh: true }, T0);
    expect(decide(s, T0)).toEqual({ do: 'idle' });
    s = onEvent(s, { t: 'local_change', pending: 1 }, T0);
    expect(decide(s, T0 + 1000)).toEqual({ do: 'push' });
    s = onEvent(s, { t: 'foreground' }, T0 + 5000);
    expect(decide({ ...s, pending: 0 }, T0 + 5000)).toEqual({ do: 'pull' });
  });

  it('pobieranie porcjami: has_more → kolejne pobranie od razu', () => {
    const s = run([[{ t: 'started', what: 'pull' }, T0], [{ t: 'pull_ok', needMore: true, pending: 0 }, T0 + 50]]);
    expect(decide(s, T0 + 50)).toEqual({ do: 'pull' });
  });

  it('timer przy niepustej kolejce tylko na pierwszym planie', () => {
    const s = run([[{ t: 'local_change', pending: 1 }, T0]]);
    expect(pendingTimer(s, T0)).toBe(T0 + config.sync.PENDING_TIMER_MS);
    expect(pendingTimer({ ...s, foreground: false }, T0)).toBeNull();
    expect(pendingTimer({ ...s, pending: 0 }, T0)).toBeNull();
  });

  it('wskaźnik: N zmian czeka', () => {
    const s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0], [{ t: 'local_change', pending: 4 }, T0]]);
    expect(indicator(s)).toEqual({ state: 'pending', pending: 4 });
  });

  it('powrót sieci i odświeżenie sesji wymuszają pobranie także bez zaległych zmian', () => {
    const idle = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0]]);
    expect(decide(onEvent(onEvent(idle, { t: 'network', online: false }, T0), { t: 'network', online: true }, T0 + 5), T0 + 5)).toEqual({ do: 'pull' });
    const auth = onEvent(onEvent(idle, { t: 'failed', what: 'pull', error: 'auth' }, T0), { t: 'auth_refreshed' }, T0 + 7);
    expect(decide(auth, T0 + 7)).toEqual({ do: 'pull' });
    expect(onEvent(idle, { t: 'failed', what: 'push', error: 'auth' }, T0).lastError).toBe('auth');
  });

  it('czekanie do najbliższego z terminów; udane pobranie nie skraca debounce wysyłki', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0], [{ t: 'local_change', pending: 1 }, T0]]);
    s = { ...s, needPull: true, pullNotBefore: T0 + 300 };
    expect(decide(s, T0)).toEqual({ do: 'wait', until: T0 + 300 });
    s = onEvent(onEvent(s, { t: 'started', what: 'pull' }, T0 + 300), { t: 'pull_ok', needMore: false, pending: 1 }, T0 + 400);
    expect(decide(s, T0 + 400)).toEqual({ do: 'wait', until: T0 + 1000 });
  });

  it('backoff: wartości graniczne', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(100)).toBe(60_000);
  });
});

const evArb: fc.Arbitrary<SchedulerEvent> = fc.oneof(
  fc.record({ t: fc.constant('local_change' as const), pending: fc.integer({ min: 0, max: 5 }) }),
  fc.constant({ t: 'foreground' as const }),
  fc.constant({ t: 'background' as const }),
  fc.record({ t: fc.constant('network' as const), online: fc.boolean() }),
  fc.record({ t: fc.constant('poke' as const), fresh: fc.boolean() }),
  fc.record({ t: fc.constant('failed' as const), what: fc.constantFrom('push' as const, 'pull' as const), error: fc.constantFrom('network' as const, 'auth' as const, 'server' as const) }),
  fc.record({ t: fc.constant('failed' as const), what: fc.constantFrom('push' as const, 'pull' as const), error: fc.constant('fatal' as const), code: fc.constantFrom('upgrade_required', 'client_mismatch') }),
  fc.constant({ t: 'auth_refreshed' as const }),
  fc.constant({ t: 'refresh' as const }),
  fc.constant({ t: 'clock' as const }),
);

describe('pętla synchronizacji — własności', () => {

  it('decyzja zawsze spójna ze stanem; czekanie zawsze w przyszłość; kolejka nigdy nie znika sama', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(evArb, fc.integer({ min: 0, max: 120_000 })), { maxLength: 60 }), (steps) => {
        let s = initialScheduler(T0);
        let now = T0;
        for (const [e, dt] of steps) {
          now += dt;
          const before = s.pending;
          s = onEvent(s, e, now);
          if (e.t !== 'local_change') expect(s.pending).toBe(before);
          const d = decide(s, now);
          if (d.do === 'push' || d.do === 'pull') {
            expect(s.online && !s.authExpired && !s.fatal && s.inflight === null).toBe(true);
            if (d.do === 'push') expect(s.pending).toBeGreaterThan(0);
            // Symulacja wywołania i natychmiastowego sukcesu.
            s = onEvent(onEvent(s, { t: 'started', what: d.do }, now), d.do === 'push' ? { t: 'push_ok', pending: s.pending } : { t: 'pull_ok', needMore: false, pending: s.pending }, now);
          }
          if (d.do === 'wait') expect(d.until).toBeGreaterThan(now);
          expect(backoffMs(s.failures)).toBeLessThanOrEqual(config.sync.BACKOFF_MAX_MS);
        }
      }),
    );
  });

  it('online, na pierwszym planie, bez błędów sesji: niepusta kolejka zostaje wysłana najpóźniej po 60 s', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 1, max: 9 }), (failures, pending) => {
        let s: SchedulerState = { ...initialScheduler(T0), needPull: false, failures };
        s = onEvent(s, { t: 'local_change', pending }, T0);
        if (failures > 0) s = { ...s, pushNotBefore: T0 + backoffMs(failures) };
        let now = T0;
        let d = decide(s, now);
        while (d.do === 'wait') {
          now = d.until;
          d = decide(s, now);
        }
        expect(d).toEqual({ do: 'push' });
        expect(now - T0).toBeLessThanOrEqual(config.sync.BACKOFF_MAX_MS);
      }),
    );
  });
});

describe('odporność pętli (audyt 2, P2)', () => {
  it('M-10: błąd sieci przy wysyłce wstrzymuje też pobranie — jedno nieudane żądanie na cykl, nie dwa', () => {
    let s = run([[{ t: 'local_change', pending: 1 }, T0]]); // start: needPull
    s = run([[{ t: 'started', what: 'push' }, T0 + 1000], [{ t: 'failed', what: 'push', error: 'network' }, T0 + 1000]], s);
    expect(decide(s, T0 + 1000)).toEqual({ do: 'wait', until: T0 + 2000 });
    expect(s.needPull).toBe(true);
    // Błąd serwera (nie sieci) przy wysyłce nie blokuje pobrania.
    const srv = run([[{ t: 'started', what: 'push' }, T0 + 1000], [{ t: 'failed', what: 'push', error: 'server' }, T0 + 1000]], run([[{ t: 'local_change', pending: 1 }, T0]]));
    expect(decide(srv, T0 + 1000)).toEqual({ do: 'pull' });
    // Błąd sieci przy pobraniu też przesuwa wysyłkę; pobranie zostaje do zrobienia.
    const pull = run([[{ t: 'pull_ok', needMore: false, pending: 1 }, T0], [{ t: 'started', what: 'pull' }, T0], [{ t: 'failed', what: 'pull', error: 'network' }, T0]]);
    expect(pull).toMatchObject({ pushNotBefore: T0 + 1000, pullNotBefore: T0 + 1000, needPull: true });
    const idle = run([[{ t: 'pull_ok', needMore: false, pending: 1 }, T0], [{ t: 'started', what: 'push' }, T0], [{ t: 'failed', what: 'push', error: 'network' }, T0]]);
    expect(idle.needPull).toBe(false);
  });

  it('M-9: powrót na pierwszy plan próbuje raz mimo wygasłej sesji (token mógł zostać odświeżony w tle)', () => {
    let s = run([[{ t: 'local_change', pending: 1 }, T0], [{ t: 'started', what: 'push' }, T0 + 1000], [{ t: 'failed', what: 'push', error: 'auth' }, T0 + 1000]]);
    expect(decide(s, T0 + 5000)).toEqual({ do: 'idle' });
    s = onEvent(onEvent(s, { t: 'background' }, T0 + 6000), { t: 'foreground' }, T0 + 7000);
    expect(s.authExpired).toBe(false);
    expect(decide(s, T0 + 7000)).toEqual({ do: 'push' });
  });

  it('M-178: odświeżenie po operacji serwerowej pobiera od razu, mimo trwającego ponowienia po błędzie', () => {
    let s = run([[{ t: 'started', what: 'pull' }, T0], [{ t: 'failed', what: 'pull', error: 'network' }, T0], [{ t: 'started', what: 'pull' }, T0 + 1000], [{ t: 'failed', what: 'pull', error: 'network' }, T0 + 1000]]);
    expect(decide(s, T0 + 1500)).toEqual({ do: 'wait', until: T0 + 3000 });
    // Poke tylko zaznacza potrzebę pobrania — dalej czeka (stan sprzed poprawki dla refresh).
    expect(decide(onEvent(s, { t: 'poke', fresh: true }, T0 + 1500), T0 + 1500)).toEqual({ do: 'wait', until: T0 + 3000 });
    s = onEvent(s, { t: 'refresh' }, T0 + 1500);
    expect(s.failures).toBe(0);
    expect(decide(s, T0 + 1500)).toEqual({ do: 'pull' });
  });

  it('M-179: cofnięcie zegara nie wydłuża czekania; zegar do przodu niczego nie przesuwa', () => {
    let s = run([[{ t: 'pull_ok', needMore: false, pending: 0 }, T0], [{ t: 'local_change', pending: 1 }, T0]]);
    expect(decide(s, T0)).toEqual({ do: 'wait', until: T0 + 1000 });
    // Zegar cofnięty o godzinę: zostaje ta sama sekunda czekania.
    const back = T0 - 3_600_000;
    s = onEvent(s, { t: 'clock' }, back);
    expect(decide(s, back)).toEqual({ do: 'wait', until: back + 1000 });
    expect(s.seenAt).toBe(back);
    const fwd = onEvent(s, { t: 'clock' }, back + 500);
    expect(fwd).toEqual({ ...s, seenAt: back + 500 });
  });

  it('własność: po cofnięciu zegara czekanie nigdy nie jest dłuższe niż przed skokiem', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(evArb, fc.integer({ min: 0, max: 120_000 })), { maxLength: 30 }), fc.integer({ min: 1, max: 86_400_000 }), (steps, jump) => {
        let s = initialScheduler(T0);
        let now = T0;
        for (const [e, dt] of steps) s = onEvent(s, e, (now += dt));
        const before = decide(s, now);
        const after = decide(onEvent(s, { t: 'clock' }, now - jump), now - jump);
        if (before.do === 'wait' && after.do === 'wait') expect(after.until - (now - jump)).toBeLessThanOrEqual(before.until - now);
        else expect(after.do).toBe(before.do);
      }),
    );
  });
});
