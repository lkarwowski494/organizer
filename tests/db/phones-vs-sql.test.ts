/**
 * Dwa telefony z prawdziwym silnikiem synchronizacji (src/domain/sync-engine/client.ts) na prawdziwym serwerze
 * (sync_push / sync_pull w Postgresie), przy zawodnej sieci: zgubione żądanie, zgubiona odpowiedź, ta sama paczka
 * wysłana dwa razy, zgubione pobranie, małe porcje pobierania. Operacje obejmują nowsze rzeczy, których symulacja
 * na modelu (sync-sim) nie zna: wydarzenia z wyjątkami i uczestnikami, zakupy z dniem i osobą, powtarzanie zadań,
 * przypisania. Obie osoby edytują te same pola (konflikty). W trakcie: nocne czyszczenie kosza (resync porcjami —
 * audyt 2, M-1) i zmiana roli Bartka na dziecko i z powrotem (operacje w kolejce odrzucane). Po „wyzdrowieniu” sieci:
 *  - kolejka każdego telefonu jest pusta,
 *  - stan telefonu zbudowany z kolejnych porcji = pełny, świeży odczyt serwera (nic nie zgubione po drodze; wolno
 *    zostać tylko nagrobkom wierszy, które serwer już wyczyścił),
 *  - oba telefony widzą to samo,
 *  - powtórzona paczka nigdy nie daje nowego odrzucenia, a odrzucenie wraca z tym samym kodem (M-56),
 *  - pętle „do ciszy” mają górną granicę obrotów (M-49).
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany.
 */
import * as fc from 'fast-check';
import { Client } from 'pg';

import {
  type ClientState,
  initialState,
  materialize,
  mutate,
  type NewOp,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  type PulledRow,
  type PullResponse,
  type PushResponse,
  pullRequest,
  pushRequest,
} from '../../src/domain/sync-engine/client';

const enabled = !!process.env.PGHOST;
const d = enabled ? describe : describe.skip;

const U = { ala: '00000000-0000-7000-8000-0000000000a1', bartek: '00000000-0000-7000-8000-0000000000b1' } as const;
const M = { ala: '99999999-0000-7000-8000-0000000000a1', bartek: '99999999-0000-7000-8000-0000000000b1' } as const;
type User = keyof typeof U;
const USERS: User[] = ['ala', 'bartek'];
const G = '99999999-0000-7000-8000-000000000001';
const id = (prefix: string, n: number) => `99999999-0000-7000-8${prefix}-${String(n).padStart(12, '0')}`;
const LIST = id('001', 1);
const SHOP = id('001', 2);
const TASKS = [1, 2, 3].map((n) => id('002', n));
const ITEMS = [1, 2].map((n) => id('005', n));
const EVENTS = [1, 2].map((n) => id('006', n));
const OVERRIDE = id('007', 1);
const PARTICIPANT = id('008', 1);

const member = fc.constantFrom(M.ala, M.bartek, null);
const opArb: fc.Arbitrary<NewOp> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS), group_id: fc.constant(G),
    set: fc.record({ list_id: fc.constant(LIST), title: fc.constantFrom('Śmieci', 'Kwiaty') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS), set: fc.oneof(
    fc.record({ title: fc.constantFrom('x', 'y') }),
    fc.record({ assignee_member_id: member }),
    fc.record({ deadline_mode: fc.constant('own'), due_date: fc.constantFrom('2026-10-12', '2026-10-14'), repeat: fc.constantFrom('FREQ=WEEKLY;BYDAY=MO', 'AFTER=DAILY;INTERVAL=3', null) }),
    // Bez terminu z powtarzaniem: serwer odrzuca (tasks_repeat_needs_due) — telefon musi to wycofać.
    fc.record({ deadline_mode: fc.constant('none'), due_date: fc.constant(null) }),
    fc.record({ completed_at: fc.constantFrom('2026-10-08T10:00:00Z', null) }),
  ) }),
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...ITEMS), group_id: fc.constant(G),
    set: fc.record({ list_id: fc.constant(SHOP), title: fc.constantFrom('2 kg jabłek', 'Mleko') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: fc.constant(SHOP), set: fc.oneof(
    fc.record({ due_date: fc.constantFrom('2026-10-10', null) }),
    fc.record({ responsible_member_id: member }),
  ) }),
  // Stałe zakupy jako polecenia (audyt 2, M-111): obie osoby dopisują i usuwają naraz.
  fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constant('staple_add'), args: fc.record({ list_id: fc.constant(SHOP), name: fc.constantFrom('Mleko', 'Chleb', 'Jajka') }) }),
  fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constant('staple_remove'), args: fc.record({ list_id: fc.constant(SHOP), names: fc.subarray(['Mleko', 'Chleb', 'Jajka']) }) }),
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('events' as const), id: fc.constantFrom(...EVENTS), group_id: fc.constant(G),
    set: fc.record({ title: fc.constantFrom('Basen', 'Angielski'), start_date: fc.constant('2026-10-12'), start_time: fc.constant('17:00'), rrule: fc.constantFrom('FREQ=WEEKLY;BYDAY=MO', null) }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('events' as const), id: fc.constantFrom(...EVENTS), set: fc.oneof(
    fc.record({ title: fc.constantFrom('A', 'B') }),
    fc.record({ start_time: fc.constantFrom('16:00', '18:00') }),
    fc.record({ responsible_member_id: member }),
  ) }),
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('event_overrides' as const), id: fc.constant(OVERRIDE), group_id: fc.constant(G),
    set: fc.record({ event_id: fc.constant(EVENTS[0]!), occurrence_date: fc.constant('2026-10-19'), cancelled: fc.boolean() }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('event_overrides' as const), id: fc.constant(OVERRIDE), set: fc.record({ cancelled: fc.boolean() }) }),
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('event_participants' as const), id: fc.constant(PARTICIPANT), group_id: fc.constant(G),
    set: fc.record({ event_id: fc.constant(EVENTS[0]!), member_id: fc.constantFrom(M.ala, M.bartek) }) }),
  fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS, ...ITEMS) }),
  fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constant('events' as const), id: fc.constantFrom(...EVENTS) }),
) as fc.Arbitrary<NewOp>;

type Cmd =
  | { t: 'mutate'; who: User; op: NewOp }
  | { t: 'push'; who: User; fate: 'ok' | 'lostRequest' | 'lostResponse' | 'twice' }
  | { t: 'pull'; who: User; lim: number; fate: 'ok' | 'lost' }
  // Nocne czyszczenie: wszystko z kosza „sprzed 40 dni”, potem private.purge_tombstones() (M-1, M-4).
  | { t: 'purge' }
  | { t: 'role'; role: 'member' | 'child' };
const who = fc.constantFrom<User>('ala', 'bartek');
const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('mutate' as const), who, op: opArb }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('push' as const), who, fate: fc.constantFrom('ok' as const, 'lostRequest' as const, 'lostResponse' as const, 'twice' as const) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('pull' as const), who, lim: fc.integer({ min: 1, max: 5 }), fate: fc.constantFrom('ok' as const, 'lost' as const) }) },
  { weight: 1, arbitrary: fc.constant({ t: 'purge' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('role' as const), role: fc.constantFrom('member' as const, 'child' as const) }) },
);

/** Wiersze w porządku niezależnym od kolejności pobrania. */
const sorted = (t: { [e: string]: { [k: string]: unknown } }) =>
  Object.fromEntries(Object.entries(t).filter(([, rows]) => Object.keys(rows).length > 0).sort(([a], [b]) => a.localeCompare(b))) as { [e: string]: { [k: string]: { [c: string]: unknown } } };

const seen = { ok: 0, rejected: 0, entities: new Set<string>(), shopItems: 0, staples: 0, purged: 0, resync: 0, child: 0, recalled: 0 };

d('telefony na prawdziwym serwerze przy zawodnej sieci', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const as = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  const push = async (user: User, req: ReturnType<typeof pushRequest>): Promise<PushResponse> => {
    await as(user);
    return (await db.query(`select public.sync_push($1, $2, $3::jsonb) r`, [req.client_id, req.schema_version, JSON.stringify(req.ops)])).rows[0].r;
  };
  // Protokół 2 jak w aplikacji (src/sync/supabase.ts): kursory z epoką, wersja protokołu, encje znane telefonowi.
  const pull = async (user: User, req: ReturnType<typeof pullRequest>, lim: number): Promise<PullResponse> => {
    await as(user);
    return (await db.query(`select public.sync_pull($1::jsonb, $2, $3, $4::jsonb) r`, [JSON.stringify(req.cursors), lim, req.schema_version, JSON.stringify(req.entities)])).rows[0].r;
  };
  const fetchScope = async (user: User, scope: string): Promise<PulledRow[]> => {
    await as(user);
    return (await db.query(`select public.sync_fetch_scope($1) r`, [scope])).rows[0].r.rows;
  };

  async function applyPull(user: User, s: ClientState, lim: number): Promise<{ state: ClientState; more: boolean }> {
    const req = pullRequest(s);
    const res = await pull(user, req, lim);
    if (res.groups.some((g) => g.resync)) seen.resync += 1;
    const out = onPullResponse(s, res, req);
    let state = out.state;
    for (const sc of out.fetchScopes) state = onFetchScope(state, await fetchScope(user, sc));
    return { state, more: out.needMore };
  }

  /** Pobieranie aż do końca z górną granicą obrotów — inaczej nieskończone pobieranie (M-1) przeszłoby po cichu. */
  async function pullAll(user: User, s: ClientState, lim: number, bound: number): Promise<ClientState> {
    for (let i = 0; ; i++) {
      if (i >= bound) throw new Error(`pobieranie się nie kończy (${user}, ${bound} porcji)`);
      const r = await applyPull(user, s, lim);
      s = r.state;
      if (!r.more) return s;
    }
  }

  /** Pełny, świeży odczyt: nowy telefon bez kursorów, duże porcje. */
  async function fresh(user: User) {
    return sorted((await pullAll(user, initialState('fresh'), 1000, 5)).base);
  }

  /** Nagrobki, które serwer już wyczyścił, mogą zostać na telefonie, który widział usunięcie — poza nimi stan = serwer. */
  const withoutPurged = (view: ReturnType<typeof sorted>, server: ReturnType<typeof sorted>) =>
    sorted(Object.fromEntries(Object.entries(view).map(([e, rows]) => [e, Object.fromEntries(Object.entries(rows).filter(([k, r]) => k in (server[e] ?? {}) || r.deleted_at == null))])));

  it('zbieżność z serwerem, pusta kolejka, oba telefony widzą to samo, powtórki bez nowych odrzuceń', async () => {
    // Statystyka przebiegów: test ma sens tylko wtedy, gdy losowe operacje naprawdę przechodzą (nie same odrzucenia).
    Object.assign(seen, { ok: 0, rejected: 0, entities: new Set<string>(), shopItems: 0, staples: 0, purged: 0, resync: 0, child: 0, recalled: 0 });
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 10, maxLength: 50 }), async (cmds) => {
        await db.query('begin');
        try {
          await as(null);
          await db.query(`insert into auth.users (id, email) values ($1, 'a@x.test'), ($2, 'b@x.test')`, [U.ala, U.bartek]);
          await as('ala');
          await db.query(`select public.create_group($1, 'Rodzina', $2, 'Ala')`, [G, M.ala]);
          await as(null);
          await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values ($1, $2, $3, 'Bartek')`, [M.bartek, G, U.bartek]);
          const setup = await push('ala', { client_id: id('004', 9), schema_version: 1, ops: [
            { seq: 1, op_id: id('003', 9001), kind: 'create', entity: 'lists', id: LIST, group_id: G, set: { kind: 'tasks', name: 'Dom' } },
            { seq: 2, op_id: id('003', 9002), kind: 'create', entity: 'lists', id: SHOP, group_id: G, set: { kind: 'shopping', name: 'Zakupy' } },
          ] } as never);
          expect(setup.results.map((r) => r.status)).toEqual(['ok', 'ok']);

          let n = 0;
          const newId = () => id('003', ++n);
          const phones: Record<User, ClientState> = { ala: initialState(id('004', 1)), bartek: initialState(id('004', 2)) };
          const sent: Record<User, number> = { ala: 0, bartek: 0 };
          for (const c of cmds) {
            const s = phones['who' in c ? c.who : 'ala'];
            if (c.t === 'mutate') {
              phones[c.who] = mutate(s, c.op, newId);
            } else if (c.t === 'push') {
              const req = pushRequest(s);
              if (req.ops.length === 0 || c.fate === 'lostRequest') continue;
              const first = await push(c.who, req);
              // Statystyka tylko pierwszych wyników (powtórka odrzucenia to znowu „rejected” — M-56).
              for (const r of first.results) {
                if (r.seq <= sent[c.who]) continue;
                seen[r.status === 'rejected' ? 'rejected' : 'ok'] += 1;
                if (r.code === 'forbidden:child') seen.child += 1;
              }
              sent[c.who] = Math.max(sent[c.who], first.last_seq);
              if (c.fate === 'lostResponse') continue; // serwer zapisał, telefon ponowi te same operacje
              let res = first;
              if (c.fate === 'twice') {
                res = await push(c.who, req);
                for (const r of first.results) {
                  const again = res.results.find((x) => x.seq === r.seq);
                  // Powtórzona paczka: to, co za pierwszym razem przeszło, nie zmienia się w odrzucenie…
                  if (r.status === 'ok') expect(again?.status).not.toBe('rejected');
                  // …a odrzucenie wraca z tym samym kodem zamiast „duplicate” (M-56).
                  if (r.status === 'rejected') {
                    expect(again).toEqual(r);
                    seen.recalled += 1;
                  }
                }
              }
              phones[c.who] = onPushResponse(s, res);
            } else if (c.t === 'pull') {
              if (c.fate === 'ok') phones[c.who] = (await applyPull(c.who, s, c.lim)).state;
            } else if (c.t === 'purge') {
              await as(null);
              await db.query(`update public.tasks set deleted_at = now() - interval '40 days' where group_id = $1 and deleted_at is not null`, [G]);
              await db.query(`update public.events set deleted_at = now() - interval '40 days' where group_id = $1 and deleted_at is not null`, [G]);
              seen.purged += (await db.query('select private.purge_tombstones() n')).rows[0].n;
            } else {
              // Zmiana roli Bartka przez serwer (jak owner w aplikacji): operacje dziecka w kolejce są odrzucane.
              await as(null);
              await db.query(`update public.group_members set role = $1 where member_id = $2`, [c.role, M.bartek]);
            }
          }

          // Sieć zdrowieje: wysyłki do skutku, potem pobieranie małymi porcjami (sprawdza kursory i epoki) aż do końca —
          // z górną granicą obrotów (porcje po 3 wiersze + resync + zapas).
          for (let round = 0; round < 2; round++) {
            for (const u of USERS) {
              for (let i = 0; pushRequest(phones[u]).ops.length > 0; i++) {
                if (i >= 20) throw new Error(`wysyłka się nie kończy (${u})`);
                phones[u] = onPushResponse(phones[u], await push(u, pushRequest(phones[u])));
              }
            }
            for (const u of USERS) {
              const rows = Object.values(await fresh(u)).reduce((n, t) => n + Object.keys(t).length, 0);
              phones[u] = await pullAll(u, phones[u], 3, Math.ceil(rows / 3) + 3);
            }
          }

          // Wspólna grupa (bez grup osobistych, które każdy ma swoją).
          const shared = (t: { [e: string]: { [k: string]: { [c: string]: unknown } } }) =>
            sorted(Object.fromEntries(Object.entries(t).map(([e, rows]) => [e, Object.fromEntries(Object.entries(rows).filter(([, r]) => (e === 'groups' ? r.id : r.group_id) === G))])));
          const views: Record<string, unknown> = {};
          for (const u of USERS) {
            expect(phones[u].pending).toHaveLength(0);
            const server = await fresh(u);
            const view = withoutPurged(sorted(materialize(phones[u])), server);
            expect(view).toEqual(server);
            views[u] = shared(view as never);
            for (const [e, rows] of Object.entries(views[u] as object)) if (Object.keys(rows).length > 0) seen.entities.add(e);
            seen.shopItems += ITEMS.filter((i) => (views[u] as { tasks?: object }).tasks && i in (views[u] as { tasks: object }).tasks).length;
            seen.staples += ((views[u] as { lists: { [k: string]: { staples?: unknown[] } } }).lists[SHOP]?.staples ?? []).length;
          }
          // Obie osoby są dorosłymi w tej samej grupie bez ukrytych list — widzą dokładnie to samo.
          expect(views.ala).toEqual(views.bartek);
        } finally {
          await db.query('rollback');
        }
      }),
      { numRuns: 150 },
    );
    // Liczone tylko pierwsze wyniki (powtórki nie zawyżają sukcesów). Dużo odrzuceń jest zamierzonych: dziecko,
    // zmiany po czyszczeniu kosza, wyjątki do nieistniejących serii — ale spora część operacji przechodzi.
    expect(seen.ok).toBeGreaterThan(seen.rejected / 4);
    // Sytuacje z audytu 2 naprawdę się zdarzają: czyszczenie z resync, odrzucenia dziecka, odrzucenie po powtórce.
    expect(seen.purged).toBeGreaterThan(0);
    expect(seen.resync).toBeGreaterThan(0);
    expect(seen.child).toBeGreaterThan(0);
    expect(seen.recalled).toBeGreaterThan(0);
    // Regresja D87: pozycje zakupów naprawdę zapisują się na serwerze (wcześniej odrzucane po cichu).
    expect(seen.shopItems).toBeGreaterThan(0);
    // Polecenia stałych zakupów naprawdę zmieniają tablicę na serwerze (M-111).
    expect(seen.staples).toBeGreaterThan(0);
    expect([...seen.entities].sort()).toEqual(expect.arrayContaining(['event_overrides', 'event_participants', 'events', 'lists', 'tasks']));
  }, 240_000);
});
