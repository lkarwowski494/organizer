/**
 * Zakres Moich spraw z prawdziwym silnikiem telefonu (src/domain/sync-engine/client.ts) na prawdziwym serwerze
 * (sync_push / sync_pull):
 *  - audyt 3, N-91: telefon, który nie zna jeszcze wiersza zakresu (drugi telefon, nowa instalacja, offline), zmienia
 *    zakres skutecznie — dotąd serwer brał utworzenie istniejącego id za powtórzenie i wybór cicho przepadał;
 *  - audyt 3, N-40 i N-87: usunięcie osoby i „Cofnij” nie kasuje jej zakresu — wszystkie jej telefony pokazują ten sam,
 *    a zmiana jest przyjmowana (dotąd: serwer bez wiersza, telefon ze starym, każda zmiana odrzucana not_found).
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
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
import { scopeRowId, setScopeOps } from '../../src/domain/views/my-scope';
import { dbDescribe } from './db-gate';

// Własne konta i grupa (testy tests/db biegną równolegle).
const U = { ala: '00000000-0000-7000-8000-0000000005a1', jan: '00000000-0000-7000-8000-0000000005b1' } as const;
const M = { ala: '55550000-0000-7000-8000-0000000000a1', jan: '55550000-0000-7000-8000-0000000000b1' } as const;
type User = keyof typeof U;
const G = '55550000-0000-7000-8000-000000000001';
const id = (prefix: string, n: number) => `55550000-0000-7000-8${prefix}-${String(n).padStart(12, '0')}`;

dbDescribe('zakres Moich spraw na kilku telefonach (prawdziwy serwer)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  beforeEach(() => db.query('begin'));
  afterEach(() => db.query('rollback'));

  const as = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  const push = async (user: User, req: ReturnType<typeof pushRequest>): Promise<PushResponse> => {
    await as(user);
    return (await db.query(`select public.sync_push($1, $2, $3::jsonb) r`, [req.client_id, req.schema_version, JSON.stringify(req.ops)])).rows[0].r;
  };
  const pull = async (user: User, req: ReturnType<typeof pullRequest>): Promise<PullResponse> => {
    await as(user);
    return (await db.query(`select public.sync_pull($1::jsonb, $2, $3, $4::jsonb) r`, [JSON.stringify(req.cursors), 1000, req.schema_version, JSON.stringify(req.entities)])).rows[0].r;
  };
  const fetchScope = async (user: User, scope: string): Promise<PulledRow[]> => {
    await as(user);
    return (await db.query(`select public.sync_fetch_scope($1) r`, [scope])).rows[0].r.rows;
  };
  async function pullAll(user: User, s: ClientState): Promise<ClientState> {
    for (let i = 0; i < 50; i++) {
      const req = pullRequest(s);
      const out = onPullResponse(s, await pull(user, req), req);
      s = out.state;
      for (const sc of out.fetchScopes) s = onFetchScope(s, await fetchScope(user, sc), sc);
      if (!out.needMore) return s;
    }
    throw new Error('pobieranie się nie kończy');
  }
  let n = 0;
  const newId = () => id('003', ++n);
  async function sync(user: User, s: ClientState): Promise<ClientState> {
    for (let i = 0; pushRequest(s).ops.length > 0; i++) {
      if (i > 5) throw new Error('wysyłka się nie kończy');
      const req = pushRequest(s);
      s = onPushResponse(s, await push(user, req), req);
    }
    return pullAll(user, s);
  }
  const queue = (s: ClientState, ops: NewOp[]) => ops.reduce((st, op) => mutate(st, op, newId), s);
  const doOps = async (user: User, s: ClientState, ops: NewOp[]) => sync(user, queue(s, ops));
  /** Zmiana zakresu tak jak na ekranie: z tego, co telefon ma u siebie. */
  const choose = (s: ClientState, scope: 'all' | 'mine' | 'mineAndEvents') => setScopeOps(materialize(s), G, M.jan, scope);
  const scopeOn = (s: ClientState) => materialize(s).my_day_scopes?.[scopeRowId(M.jan)]?.scope;

  beforeEach(async () => {
    await as(null);
    for (const u of ['ala', 'jan'] as const) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [U[u], `${u}@scope.test`]);
    await as('ala');
    await db.query(`select public.create_group($1, 'Rodzina', $2, 'Ala')`, [G, M.ala]);
    await as(null);
    await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values ($1, $2, $3, 'Jan')`, [M.jan, G, U.jan]);
  });

  it('N-91: drugi telefon bez wiersza zakresu zmienia zakres — wygrywa ostatni wybór, bez odrzuceń', async () => {
    let phone1 = await pullAll('jan', initialState(id('004', 1)));
    let phone2 = await pullAll('jan', initialState(id('004', 2)));
    // Oba offline: telefon 1 wybiera „Tylko przypisane do mnie”, potem telefon 2 „Przypisane do mnie i wydarzenia”.
    phone1 = queue(phone1, choose(phone1, 'mine'));
    phone2 = queue(phone2, choose(phone2, 'mineAndEvents'));
    phone1 = await sync('jan', phone1);
    phone2 = await sync('jan', phone2);
    phone1 = await pullAll('jan', phone1);
    expect([scopeOn(phone1), scopeOn(phone2)]).toEqual(['mineAndEvents', 'mineAndEvents']);
    expect([phone1.rejected, phone2.rejected]).toEqual([[], []]);
    // Nowa instalacja przed pierwszym pobraniem: wybór też zostaje.
    let fresh = initialState(id('004', 3));
    fresh = await sync('jan', queue(fresh, choose(fresh, 'all')));
    expect([scopeOn(fresh), scopeOn(await pullAll('jan', phone1)), fresh.rejected]).toEqual(['all', 'all', []]);
  });

  it('N-40, N-87: usunięcie i „Cofnij” zostawia zakres — oba telefony go widzą, a zmiana jest przyjmowana', async () => {
    let jan = await doOps('jan', await pullAll('jan', initialState(id('004', 1))), choose(initialState(id('004', 9)), 'mine'));
    let ala = await pullAll('ala', initialState(id('004', 2)));
    // Ala usuwa Jana i od razu cofa (D165: pasek „Cofnij”) — telefon Jana w tym czasie nie pobierał.
    ala = await doOps('ala', ala, [{ kind: 'delete', entity: 'group_members', id: M.jan }]);
    ala = await doOps('ala', ala, [{ kind: 'restore', entity: 'group_members', id: M.jan }]);
    jan = await pullAll('jan', jan);
    const fresh = await pullAll('jan', initialState(id('004', 3)));
    expect([scopeOn(jan), scopeOn(fresh)]).toEqual(['mine', 'mine']);
    jan = await doOps('jan', jan, choose(jan, 'all'));
    expect([jan.rejected, scopeOn(jan), scopeOn(await pullAll('jan', fresh))]).toEqual([[], 'all', 'all']);
  });

  it('N-87: usunięcie osoby wkłada zakres do kosza ze znacznikiem usunięcia, „Cofnij” go przywraca', async () => {
    let jan = await doOps('jan', await pullAll('jan', initialState(id('004', 1))), choose(initialState(id('004', 9)), 'mineAndEvents'));
    const sid = scopeRowId(M.jan);
    let ala = await pullAll('ala', initialState(id('004', 2)));
    ala = await doOps('ala', ala, [{ kind: 'delete', entity: 'group_members', id: M.jan }]);
    // Serwer: nagrobek z chwilą usunięcia (telefon po powrocie dostaje nowszą wersję wiersza).
    await as(null);
    const row = (await db.query(`select s.deleted_at = m.deleted_at same from public.my_day_scopes s join public.group_members m using (member_id) where s.id = $1`, [sid])).rows[0];
    expect(row).toEqual({ same: true });
    ala = await doOps('ala', ala, [{ kind: 'restore', entity: 'group_members', id: M.jan }]);
    jan = await pullAll('jan', jan);
    expect([scopeOn(jan), materialize(jan).my_day_scopes?.[sid]?.deleted_at]).toEqual(['mineAndEvents', null]);
  });
});
