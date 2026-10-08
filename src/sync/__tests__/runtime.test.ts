import { config } from '../../config';
import { migrate } from '../../data/db/migrations';
import { readState, writeState } from '../../data/store';
import { memoryDb } from '../../data/__tests__/sqlite';
import { FakeServer } from '../../domain/__tests__/support/fake-server';
import { initialState } from '../../domain/sync-engine/client';
import { SyncRuntime } from '../runtime';
import { TransportError, errorKind, type SyncTransport } from '../transport';

const G = 'g1';

/** Zegar i timery pod kontrolą testu; obietnice opróżniane po każdym kroku. */
function harness(transport: SyncTransport, extra: Partial<ConstructorParameters<typeof SyncRuntime>[0]> = {}) {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  let n = 0;
  const rt = new SyncRuntime({
    initial: initialState('c-1'),
    transport,
    now: () => now,
    newId: () => `op-${++n}`,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    ...extra,
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
      await flush();
    }
    now = end;
    timers = timers.filter((t) => !t.cancelled);
  };
  return { rt, flush, advance, activeTimers: () => timers.filter((t) => !t.cancelled).length };
}

function serverTransport(server: FakeServer, user: string): SyncTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    push: async (req) => (calls.push('push'), server.push(user, req)),
    pull: async (r, l) => (calls.push('pull'), server.pull(user, r, l)),
    fetchScope: async (id) => (calls.push(`scope:${id}`), server.fetchScope(user, id)),
  };
}

describe('pętla synchronizacji w działaniu', () => {
  it('start pobiera; zmiana idzie po debounce, potem pobranie zdejmuje ją z kolejki', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const { rt, flush, advance } = harness(tr);
    const seen: string[] = [];
    const unsub = rt.subscribe(() => seen.push(rt.getSnapshot().indicator.state));
    rt.start();
    await flush();
    expect(tr.calls).toEqual(['pull']);
    expect(rt.getSnapshot().indicator.state).toBe('synced');

    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    expect(rt.getSnapshot().indicator).toEqual({ state: 'pending', pending: 1 });
    expect(rt.getSnapshot().state.pending).toHaveLength(1);
    await advance(config.sync.PUSH_DEBOUNCE_MS - 1);
    expect(tr.calls).toEqual(['pull']);
    await advance(1);
    expect(tr.calls).toEqual(['pull', 'push', 'pull']);
    expect(rt.getSnapshot().state.pending).toHaveLength(0);
    expect(rt.getSnapshot().state.base.lists!.l1).toMatchObject({ name: 'Dom' });
    expect(seen).toContain('syncing');
    unsub();
    const before = seen.length;
    rt.event({ t: 'background' });
    expect(seen).toHaveLength(before);
  });

  it('kilka operacji naraz: jeden zapis stanu (jedna transakcja), kolejność zachowana', () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const persist = jest.fn();
    const { rt } = harness(serverTransport(server, 'ala'), { persist });
    rt.dispatch([
      { kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } },
      { kind: 'patch', entity: 'lists', id: 'l1', set: { name: 'Dom 2' } },
    ]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rt.getSnapshot().state.pending.map((o) => o.kind)).toEqual(['create', 'patch']);
    expect(rt.getSnapshot().indicator).toMatchObject({ pending: 2 });
  });

  it('brak sieci (wyjątek fetch): błąd, ponowienie z opóźnieniem, zmiana nie ginie', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let down = true;
    const tr: SyncTransport = {
      push: (r) => (down ? Promise.reject(new TypeError('Network request failed')) : real.push(r)),
      pull: (c, l) => (down ? Promise.reject(new TypeError('Network request failed')) : real.pull(c, l)),
      fetchScope: real.fetchScope,
    };
    const { rt, flush, advance } = harness(tr);
    rt.start();
    await flush();
    expect(rt.getSnapshot().indicator).toMatchObject({ state: 'error', error: 'network' });
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    await advance(config.sync.BACKOFF_MAX_MS);
    expect(rt.getSnapshot().state.pending).toHaveLength(1);
    down = false;
    await advance(config.sync.BACKOFF_MAX_MS);
    expect(rt.getSnapshot().state.pending).toHaveLength(0);
    expect(server.lists.get('l1')).toBeDefined();
  });

  it('wygasła sesja: nic nie wysyła do odświeżenia, potem dokańcza', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let expired = true;
    const tr: SyncTransport = {
      push: (r) => (expired ? Promise.reject(new TransportError('auth', 'JWT expired')) : real.push(r)),
      pull: (c, l) => (expired ? Promise.reject(new TransportError('auth', 'JWT expired')) : real.pull(c, l)),
      fetchScope: real.fetchScope,
    };
    const { rt, flush, advance } = harness(tr);
    rt.start();
    await flush();
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    await advance(config.sync.PENDING_TIMER_MS * 3);
    expect(rt.getSnapshot().indicator).toEqual({ state: 'auth_expired', pending: 1 });
    expired = false;
    rt.event({ t: 'auth_refreshed' });
    await flush();
    await advance(config.sync.PUSH_DEBOUNCE_MS);
    expect(rt.getSnapshot().state.pending).toHaveLength(0);
  });

  it('upgrade_required (audyt 2, M-57): „Zaktualizuj aplikację”, bez ponowień w kółko; powrót do aplikacji próbuje raz', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let old = true;
    const calls: string[] = [];
    const fatal = () => Promise.reject(new TransportError('fatal', 'upgrade_required'));
    const tr: SyncTransport = {
      push: (r) => (calls.push('push'), old ? fatal() : real.push(r)),
      pull: (q, l) => (calls.push('pull'), old ? fatal() : real.pull(q, l)),
      fetchScope: real.fetchScope,
    };
    const { rt, flush, advance, activeTimers } = harness(tr);
    rt.start();
    await flush();
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    await advance(config.sync.BACKOFF_MAX_MS * 5);
    expect(calls).toEqual(['pull']);
    expect(activeTimers()).toBe(0);
    expect(rt.getSnapshot().indicator).toEqual({ state: 'upgrade_required', pending: 1 });
    old = false;
    rt.event({ t: 'foreground' });
    await flush();
    await advance(config.sync.PUSH_DEBOUNCE_MS);
    expect(rt.getSnapshot().state.pending).toHaveLength(0);
    expect(server.lists.get('l1')).toBeDefined();
  });

  it('offline z kolejką: timer kolejki zostaje ustawiony; stop() go kasuje, start() wznawia', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const { rt, flush, advance, activeTimers } = harness(tr);
    rt.start();
    await flush();
    rt.event({ t: 'network', online: false });
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    expect(activeTimers()).toBe(1);
    rt.stop();
    expect(activeTimers()).toBe(0);
    rt.event({ t: 'network', online: true });
    await advance(10_000);
    expect(tr.calls).toEqual(['pull']);
    rt.start();
    await flush();
    expect(tr.calls).toEqual(['pull', 'push', 'pull']);
    rt.stop();
    rt.stop();
  });

  it('nowa ukryta lista: pobranie całej zawartości przez fetchScope', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala', 'bartek']);
    const ala = serverTransport(server, 'ala');
    const a = harness(ala);
    a.rt.start();
    await a.flush();
    a.rt.dispatch({ kind: 'create', entity: 'lists', id: 'ukryta', group_id: G, set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } });
    await a.advance(config.sync.PUSH_DEBOUNCE_MS);
    expect(ala.calls).toContain('scope:ukryta');
    expect(a.rt.getSnapshot().state.scopes).toEqual(['ukryta']);
  });

  it('każde przejście trafia do bazy telefonu; po restarcie stan jest ten sam', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const db = memoryDb();
    migrate(db);
    const { rt, flush, advance } = harness(serverTransport(server, 'ala'), { persist: (p, nx, now) => writeState(db, p, nx, now) });
    rt.start();
    await flush();
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    expect(readState(db, 'c-1').pending).toHaveLength(1);
    await advance(config.sync.PUSH_DEBOUNCE_MS);
    expect(readState(db, 'c-1')).toEqual(rt.getSnapshot().state);
  });

  it('kolejka z poprzedniego uruchomienia: od razu do wysłania', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const first = harness(tr);
    first.rt.event({ t: 'network', online: false });
    first.rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    const saved = first.rt.getSnapshot().state;
    const second = harness(tr, { initial: saved });
    expect(second.rt.getSnapshot().indicator).toEqual({ state: 'pending', pending: 1 });
    second.rt.start();
    await second.flush();
    expect(second.rt.getSnapshot().state.pending).toHaveLength(0);
  });

  it('rodzaj błędu: TransportError zachowuje rodzaj, reszta to sieć', () => {
    expect(errorKind(new TransportError('server', 'x'))).toBe('server');
    expect(errorKind(new Error('x'))).toBe('network');
    expect(new TransportError('auth', 'm')).toMatchObject({ name: 'TransportError', message: 'm', kind: 'auth' });
  });
});
