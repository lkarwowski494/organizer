import { config } from '../../config';
import { migrate } from '../../data/db/migrations';
import { readState, writeState } from '../../data/store';
import { memoryDb } from '../../data/__tests__/sqlite';
import { FakeServer } from '../../domain/__tests__/support/fake-server';
import { type ClientState, ENTITIES, initialState, type PullResponse } from '../../domain/sync-engine/client';
import { pullStep, SyncRuntime } from '../runtime';
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

  it('audyt 3, N-15: pobranie bez zmian nie zapisuje stanu i nie zmienia tabel ekranów', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const persist = jest.fn();
    const tr = serverTransport(server, 'ala');
    const { rt, flush } = harness(tr, { persist });
    rt.start();
    await flush();
    const writes = persist.mock.calls.length;
    const state = rt.getSnapshot().state;
    rt.event({ t: 'foreground' });
    await flush();
    expect(tr.calls).toEqual(['pull', 'pull']);
    expect(rt.getSnapshot().state).toBe(state);
    expect(persist).toHaveBeenCalledTimes(writes);
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

  /** Bartek tworzy ukrytą listę z zadaniem i udostępnia ją Ali (sync_fetch_scope dociąga zadanie ze starą wersją). */
  const shareFromBartek = (server: FakeServer) =>
    server.push('bartek', { client_id: 'cb', ops: [
      { seq: 1, op_id: 'b1', kind: 'create', entity: 'lists', id: 'ukryta', group_id: G, set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } },
      { seq: 2, op_id: 'b2', kind: 'create', entity: 'tasks', id: 'prezent', group_id: G, set: { list_id: 'ukryta', title: 'Rower' } },
      { seq: 3, op_id: 'b3', kind: 'cmd', cmd: 'grant_scope', args: { list_id: 'ukryta', user: 'ala' } },
    ] });

  it('nowa ukryta lista: pobranie całej zawartości przez fetchScope', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala', 'bartek']);
    const ala = serverTransport(server, 'ala');
    const a = harness(ala);
    a.rt.start();
    await a.flush();
    shareFromBartek(server);
    a.rt.event({ t: 'refresh' });
    await a.flush();
    expect(ala.calls).toContain('scope:ukryta');
    expect(a.rt.getSnapshot().state.scopes).toEqual(['ukryta']);
    expect(Object.keys(a.rt.getSnapshot().state.base.tasks ?? {})).toEqual(['prezent']);
  });

  it('N-94: bez dodatkowego pobrania listy, której wiersze i tak przychodzą — grupa pobierana od zera', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala', 'bartek']);
    shareFromBartek(server);
    // Nowy telefon (pobranie od zera): udostępniona lista przychodzi w całości z grupą.
    const fresh = serverTransport(server, 'ala');
    const b = harness(fresh);
    b.rt.start();
    await b.flush();
    expect(fresh.calls.filter((c) => c.startsWith('scope:'))).toEqual([]);
    expect(Object.keys(b.rt.getSnapshot().state.base.tasks ?? {})).toEqual(['prezent']);
    expect(b.rt.getSnapshot().state.scopes).toEqual(['ukryta']);
    expect(b.rt.getSnapshot().state.scopesToFetch).toEqual([]);
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

  it('„Wyczyść listę” odrzuconych (D190): pusta lista w stanie i w bazie, ekran dostaje powiadomienie', () => {
    const db = memoryDb();
    migrate(db);
    const initial = { ...initialState('c-1'), rejected: [{ op: { seq: 1, op_id: 'o1', kind: 'delete' as const, entity: 'tasks' as const, id: 't' }, code: 'forbidden' }] };
    writeState(db, initialState('c-1'), initial, 1);
    const { rt } = harness({ push: jest.fn(), pull: jest.fn(), fetchScope: jest.fn() }, { initial, persist: (p, nx, now) => writeState(db, p, nx, now) });
    const seen = jest.fn();
    rt.subscribe(seen);
    rt.clearRejected();
    expect(rt.getSnapshot().state.rejected).toEqual([]);
    expect(readState(db, 'c-1').rejected).toEqual([]);
    expect(seen).toHaveBeenCalled();
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

  // Audyt 2 (M-62): historia starsza niż config.retention.ACTIVITY_DAYS znika z telefonu przy pobraniu, także z bazy.
  it('pobranie usuwa z telefonu historię po terminie retencji', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const first = harness(tr);
    first.rt.start();
    await first.flush();
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(1_000_000 - daysAgo * day).toISOString();
    const synced = first.rt.getSnapshot().state;
    const initial = {
      ...synced,
      base: { ...synced.base, activity: { old: { id: 'old', group_id: G, version: 1, created_at: at(config.retention.ACTIVITY_DAYS + 1) }, fresh: { id: 'fresh', group_id: G, version: 1, created_at: at(1) } } },
    };
    const db = memoryDb();
    migrate(db);
    writeState(db, initialState('c-1'), initial, 0);
    const second = harness(tr, { initial, persist: (p, nx, now) => writeState(db, p, nx, now) });
    second.rt.start();
    await second.flush();
    expect(Object.keys(second.rt.getSnapshot().state.base.activity ?? {})).toEqual(['fresh']);
    expect(Object.keys(readState(db, 'c-1').base.activity ?? {})).toEqual(['fresh']);
  });

  it('rodzaj błędu: TransportError zachowuje rodzaj, reszta to sieć', () => {
    expect(errorKind(new TransportError('server', 'x'))).toBe('server');
    expect(errorKind(new Error('x'))).toBe('network');
    expect(new TransportError('auth', 'm')).toMatchObject({ name: 'TransportError', message: 'm', kind: 'auth' });
  });

  it('D159: po wysłaniu — operacje, odpowiedź i stan sprzed niej dla cichych powiadomień; błąd tam nie psuje wysyłki', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const seen: unknown[] = [];
    const { rt, flush, advance } = harness(tr, {
      onPushed: (ops, res, st) => {
        seen.push([ops.map((o) => o.seq), res.results.map((r) => r.status), st.ackedSeq]);
        throw new Error('awaria');
      },
    });
    rt.start();
    await flush();
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    await advance(config.sync.PUSH_DEBOUNCE_MS);
    expect(seen).toEqual([[[1], ['ok'], 0]]);
    expect(tr.calls).toEqual(['pull', 'push', 'pull']);
    expect(rt.getSnapshot().indicator.state).toBe('synced');
  });

  it('D159: refreshNow czeka na pobranie, które zaczęło się po prośbie (wszystkie porcje); błąd i zatrzymanie też kończą', async () => {
    const page = (more: boolean): PullResponse => ({ groups: [{ group_id: G, cursor: 1, has_more: more, resync: false, rows: [] }], scopes: [] });
    const pages: ((v: PullResponse) => void)[] = [];
    let fail = false;
    const tr: SyncTransport = {
      push: async () => ({ last_seq: 0, results: [] }),
      pull: () => (fail ? Promise.reject(new Error('sieć')) : new Promise<PullResponse>((r) => pages.push(r))),
      fetchScope: async () => [],
    };
    const { rt, flush } = harness(tr);
    rt.start();
    await flush();
    expect(pages).toHaveLength(1); // pierwsze pobranie w toku
    let done = false;
    void rt.refreshNow().then(() => (done = true));
    pages[0]!(page(false));
    await flush();
    expect(done).toBe(false); // to pobranie zaczęło się przed prośbą
    expect(pages).toHaveLength(2);
    pages[1]!(page(true));
    await flush();
    expect(done).toBe(false); // jeszcze porcja
    pages[2]!(page(false));
    await flush();
    expect(done).toBe(true);
    fail = true;
    await expect(rt.refreshNow()).resolves.toBeUndefined();
    fail = false;
    const waiting = rt.refreshNow();
    rt.stop();
    await expect(waiting).resolves.toBeUndefined();
    await expect(rt.refreshNow()).resolves.toBeUndefined();
  });

  it('D159: refreshNow w tle pobiera mimo tła i wraca do tła; dwa naraz; powrót na pierwszy plan w trakcie zostaje', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const tr = serverTransport(server, 'ala');
    const { rt, flush } = harness(tr);
    rt.start();
    await flush();
    rt.event({ t: 'background' });
    rt.event({ t: 'poke', fresh: true });
    await flush();
    expect(tr.calls).toEqual(['pull']); // w tle pętla nie pobiera
    // Druga prośba przyszła w trakcie pierwszego pobrania — jeszcze jedno.
    await Promise.all([rt.refreshNow(), rt.refreshNow()]);
    expect(tr.calls).toEqual(['pull', 'pull', 'pull']);
    rt.event({ t: 'poke', fresh: true });
    await flush();
    expect(tr.calls).toHaveLength(3); // znów tło
    const p = rt.refreshNow();
    rt.event({ t: 'foreground' });
    await p;
    await flush();
    const n = tr.calls.length;
    rt.event({ t: 'poke', fresh: true });
    await flush();
    expect(tr.calls.length).toBe(n + 1); // pierwszy plan — pobiera jak zwykle
  });

  it('pullStep: porcja i nowe ukryte listy; zwraca has_more', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    let st = initialState('c-1');
    expect(await pullStep(() => st, (n) => (st = n), serverTransport(server, 'ala'), () => 0)).toBe(false);
    expect(Object.keys(st.cursors)).toEqual([G]);
  });

  it('pullStep po stop() w trakcie dociągania ukrytej listy: wynik listy przepada (M-55)', async () => {
    let alive = true;
    const tr: SyncTransport = {
      push: async () => ({ last_seq: 0, results: [] }),
      pull: async () => ({ groups: [{ group_id: G, cursor: 1, has_more: false, resync: false, rows: [] }], scopes: ['ukryta'] }),
      fetchScope: async () => ((alive = false), []),
    };
    let st = initialState('c-1');
    const sets: unknown[] = [];
    await pullStep(() => st, (n) => (sets.push(n), (st = n)), tr, () => 0, () => alive);
    expect(sets).toHaveLength(1);
  });

  it('N-1: wiersze z datą spoza zakresu (pobranie i ukryta lista) — pominięte i zgłoszone nazwą pola; błąd zgłoszenia nie psuje pobrania', async () => {
    const bad = { e: 'events' as const, v: 1, row: { id: 'e1', group_id: G, start_date: 'infinity', version: 1 } };
    const tr: SyncTransport = {
      push: async () => ({ last_seq: 0, results: [] }),
      pull: async () => ({ groups: [{ group_id: G, cursor: 1, has_more: false, resync: false, rows: [bad] }], scopes: ['ukryta'] }),
      fetchScope: async () => [{ ...bad, row: { ...bad.row, id: 'e2', start_time: '24:00:00', start_date: '2026-10-07' } }, { e: 'lists', v: 1, row: { id: 'ukryta', group_id: G, version: 1 } }],
    };
    let st = initialState('c-1');
    const seen: string[][] = [];
    await pullStep(() => st, (n) => (st = n), tr, () => 0, () => true, (f) => seen.push(f));
    expect(seen).toEqual([['events.start_date'], ['events.start_time']]);
    expect(st.base.events ?? {}).toEqual({});
    expect(Object.keys(st.base.lists ?? {})).toEqual(['ukryta']);
    // Bez zgłaszającego (odświeżenie w tle) — tylko pominięcie; zgłaszający, który rzuca, nie przerywa pętli.
    st = initialState('c-1');
    await pullStep(() => st, (n) => (st = n), tr, () => 0);
    expect(st.scopes).toEqual(['ukryta']);
    const { rt, flush } = harness(tr, {
      onInvalidRows: () => {
        throw new Error('zgłoszenie');
      },
    });
    rt.start();
    await flush();
    expect(rt.getSnapshot().indicator.state).toBe('synced');
  });

  it('N-100: własny sygnał Realtime w trakcie pobrania po wysyłce nie każe pobierać drugi raz; cudza nowsza wersja — tak', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let gate: Promise<void> | null = null;
    let open = () => {};
    let version = 0;
    const tr: SyncTransport = {
      ...real,
      // Serwer z migracją 20261010030000: wersja grupy po zapisie.
      push: async (r) => ({ ...(await real.push(r)), versions: { [G]: (version = 1000) } }),
      pull: async (c, l) => {
        if (gate) await gate;
        return real.pull(c, l);
      },
    };
    const { rt, flush, advance } = harness(tr);
    rt.start();
    await flush();
    expect(rt.isFresh(G, 1000)).toBe(true);
    rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    gate = new Promise((r) => (open = r));
    await advance(config.sync.PUSH_DEBOUNCE_MS);
    const pullsBefore = real.calls.filter((c) => c === 'pull').length;
    // Pobranie po wysyłce czeka na sieć; przychodzi mój sygnał z wersją z sync_push.
    rt.event({ t: 'poke', fresh: rt.isFresh(G, version) });
    gate = null;
    open();
    await flush();
    await advance(60_000);
    expect(real.calls.filter((c) => c === 'pull').length).toBe(pullsBefore + 1);
    // Wersja wyższa niż moja (ktoś inny zapisał po mnie) i kanał użytkownika — nowe.
    expect(rt.isFresh(G, version + 1)).toBe(true);
    expect(rt.isFresh(G, null)).toBe(true);
    expect(rt.isFresh('inna', 1)).toBe(true);
    expect(rt.isFresh(G, version)).toBe(false);
  });

  it('M-55: odpowiedź, która przyszła po stop() („Wyczyść dane”), nie trafia do bazy ani do stanu', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tr: SyncTransport = { ...real, pull: async (c, l) => (await gate, real.pull(c, l)), push: async (r) => (await gate, real.push(r)) };
    const writes: unknown[] = [];
    const { rt, flush } = harness(tr, { persist: (_p, nx) => writes.push(nx) });
    rt.start();
    await flush();
    expect(rt.getSnapshot().indicator.state).toBe('syncing');
    rt.stop();
    release();
    await flush();
    expect(writes).toEqual([]);
    expect(rt.getSnapshot().state.cursors).toEqual({});
    // Wysyłka w locie przy stop(): to samo.
    const b = harness({ ...real, push: async (r) => (await new Promise((res) => setImmediate(res)), real.push(r)) }, { persist: (_p, nx) => writes.push(nx) });
    b.rt.event({ t: 'network', online: false });
    b.rt.dispatch({ kind: 'create', entity: 'lists', id: 'l1', group_id: G, set: { kind: 'tasks', name: 'Dom' } });
    writes.length = 0;
    b.rt.event({ t: 'network', online: true });
    b.rt.stop();
    await b.flush();
    expect(writes).toEqual([]);
    expect(b.rt.getSnapshot().state.ackedSeq).toBe(0);
  });

  it('N-94: trwały błąd pobrania udostępnionej listy nie blokuje porcji dużej grupy — lista po ostatniej porcji', async () => {
    let page = 0;
    const scopeCalls: number[] = [];
    const tr: SyncTransport = {
      push: async () => ({ last_seq: 0, results: [] }),
      pull: async (r) => {
        page++;
        const since = r.cursors[G]?.v ?? 0;
        return { groups: [{ group_id: G, cursor: since + 1, has_more: since + 1 < 3, resync: false, rows: [] }], scopes: ['ukryta'] };
      },
      fetchScope: async () => (scopeCalls.push(page), Promise.reject(new Error('błąd serwera'))),
    };
    let st: ClientState = { ...initialState('c-1'), cursors: { [G]: 0 }, entities: [...ENTITIES] };
    const set = (n: ClientState) => void (st = n);
    expect(await pullStep(() => st, set, tr, () => 0)).toBe(true);
    expect(await pullStep(() => st, set, tr, () => 0)).toBe(true);
    await expect(pullStep(() => st, set, tr, () => 0)).rejects.toThrow('błąd serwera');
    expect(st.cursors[G]).toBe(3);
    expect(scopeCalls).toEqual([3]);
    expect(st.scopesToFetch).toEqual(['ukryta']);
  });

  it('M-53: nieudane pobranie udostępnionej listy ponawia się przy następnym pobraniu', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala', 'bartek']);
    const real = serverTransport(server, 'ala');
    let fail = true;
    const tr: SyncTransport = { ...real, fetchScope: (id) => (fail ? Promise.reject(new TypeError('Network request failed')) : real.fetchScope(id)) };
    const { rt, flush, advance } = harness(tr);
    rt.start();
    await flush();
    shareFromBartek(server);
    rt.event({ t: 'refresh' });
    await flush();
    expect(rt.getSnapshot().state.scopesToFetch).toEqual(['ukryta']);
    expect(rt.getSnapshot().indicator).toMatchObject({ state: 'error', error: 'network' });
    fail = false;
    await advance(config.sync.BACKOFF_MAX_MS);
    expect(rt.getSnapshot().state.scopesToFetch).toEqual([]);
    expect(rt.getSnapshot().state.scopes).toEqual(['ukryta']);
  });

  it('M-178: odświeżenie po operacji serwerowej pobiera od razu, mimo przerwy po błędzie sieci', async () => {
    const server = new FakeServer();
    server.addGroup(G, ['ala']);
    const real = serverTransport(server, 'ala');
    let down = true;
    const tr: SyncTransport = { ...real, pull: (c, l) => (down ? Promise.reject(new TypeError('Network request failed')) : real.pull(c, l)) };
    const { rt, flush, advance } = harness(tr);
    rt.start();
    await flush();
    await advance(1000); // druga nieudana próba → przerwa 2 s
    down = false;
    rt.event({ t: 'refresh' });
    await flush();
    expect(rt.getSnapshot().indicator.state).toBe('synced');
  });
});
