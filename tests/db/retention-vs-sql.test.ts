/**
 * Audyt 3 (N-89): retencja telefonu (src/domain/sync-engine/retention.ts) a codzienne sprzątanie serwera
 * (private.purge_group) na prawdziwym Postgresie. Stary telefon, który widział wszystko przed sprzątaniem, po
 * pobraniu (pullStep: onPullResponse + pruneExpired) ma dokładnie to samo co świeża instalacja — bez nagrobków
 * i starych zakupów, które serwer już usunął bez śladu. Dane obejmują każdą regułę purge_group: zadania z podzadaniem,
 * które zostaje, zadanie przypięte do wydarzenia (serwer je odpina), wydarzenie z wyjątkami, odpowiedziami
 * i uczestnikami, stałe zadanie serii, wpis dostępu do listy, listę bez zadań, zrobione i cofnięte zakupy, historię.
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import { Client } from 'pg';

import { type ClientState, initialState, type NewOp, onPullResponse, type PullResponse, pullRequest } from '../../src/domain/sync-engine/client';
import { pruneExpired } from '../../src/domain/sync-engine/retention';
import { dbDescribe } from './db-gate';

const d = dbDescribe;

const ALA = '00000000-0000-7000-8000-0000000003a1';
const BEN = '00000000-0000-7000-8000-0000000003a2';
const id = (n: number) => `7e000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const G = id(1);
const MA = id(2), MB = id(3);
const L = id(10), LOLD = id(11), SHOP = id(12), LHID = id(13);
const T1 = id(20), T2 = id(21), P = id(22), C = id(23), P2 = id(24), C2 = id(25), TOLD = id(26), PIN = id(27), COPY = id(28);
const E = id(30), EY = id(31), LIVE = id(32);
const O1 = id(40), O2 = id(41), O3 = id(42), R1 = id(43), R2 = id(44), X1 = id(45), S1 = id(46);
const Z1 = id(50), Z2 = id(51), Z3 = id(52);

const sorted = (t: ClientState['base']) =>
  Object.fromEntries(
    Object.entries(t)
      .filter(([, rows]) => Object.keys(rows).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([e, rows]) => [e, Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))]),
  );

d('retencja telefonu = sprzątanie serwera (N-89)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const as = async (user: string | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  let seq = 0;
  const push = async (ops: NewOp[]) => {
    await as(ALA);
    const full = ops.map((op) => ({ ...op, seq: ++seq, op_id: id(1000 + seq) }));
    const res = (await db.query(`select public.sync_push($1, 2, $2::jsonb) r`, [id(999), JSON.stringify(full)])).rows[0].r;
    expect(res.results.map((r: { status: string; code?: string }) => `${r.status}${r.code ? `:${r.code}` : ''}`)).toEqual(ops.map(() => 'ok'));
  };
  const pullAll = async (s: ClientState, prune: boolean): Promise<ClientState> => {
    for (let i = 0; i < 10; i++) {
      await as(ALA);
      const req = pullRequest(s);
      const res: PullResponse = (await db.query(`select public.sync_pull($1::jsonb, 1000, $2, $3::jsonb) r`, [JSON.stringify(req.cursors), req.schema_version, JSON.stringify(req.entities)])).rows[0].r;
      const out = onPullResponse(s, res, req);
      s = prune ? pruneExpired(out.state, Date.now()) : out.state;
      if (!out.needMore) return s;
    }
    throw new Error('pobieranie się nie kończy');
  };

  it('stary telefon po pobraniu = świeża instalacja', async () => {
    await db.query('begin');
    try {
      await as(null);
      await db.query(`insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`, [ALA, BEN]);
      await as(ALA);
      await db.query(`select public.create_group($1, 'Rodzina', $2, 'Ala')`, [G, MA]);
      await as(null);
      await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values ($1, $2, $3, 'Jan')`, [MB, G, BEN]);
      const task = (tid: string, list: string, extra: Record<string, unknown> = {}): NewOp => ({ kind: 'create', entity: 'tasks', id: tid, group_id: G, set: { list_id: list, title: 'Zadanie', ...extra } });
      await push([
        { kind: 'create', entity: 'lists', id: L, group_id: G, set: { kind: 'tasks', name: 'Dom' } },
        { kind: 'create', entity: 'lists', id: LOLD, group_id: G, set: { kind: 'tasks', name: 'Stara' } },
        { kind: 'create', entity: 'lists', id: SHOP, group_id: G, set: { kind: 'shopping', name: 'Zakupy' } },
        { kind: 'create', entity: 'lists', id: LHID, group_id: G, set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } },
        { kind: 'create', entity: 'events', id: E, group_id: G, set: { title: 'Basen', start_date: '2026-08-03', start_time: '17:00' } },
        { kind: 'create', entity: 'events', id: EY, group_id: G, set: { title: 'Chór', start_date: '2026-08-04' } },
        { kind: 'create', entity: 'events', id: LIVE, group_id: G, set: { title: 'Angielski', start_date: '2026-08-05', rrule: 'FREQ=WEEKLY;BYDAY=WE' } },
        task(T1, L), task(T2, L), task(P, L), task(C, L, { parent_id: P }), task(P2, L), task(C2, L, { parent_id: P2 }), task(TOLD, LOLD),
        task(PIN, L, { deadline_mode: 'event', event_id: E, occurrence_date: '2026-08-03' }),
        { kind: 'create', entity: 'event_overrides', id: O1, group_id: G, set: { event_id: E, occurrence_date: '2026-08-03', cancelled: true } },
        { kind: 'create', entity: 'event_overrides', id: O2, group_id: G, set: { event_id: LIVE, occurrence_date: '2026-08-05', cancelled: true } },
        { kind: 'create', entity: 'event_overrides', id: O3, group_id: G, set: { event_id: LIVE, occurrence_date: '2026-08-12', cancelled: true } },
        { kind: 'create', entity: 'event_rsvps', id: R1, group_id: G, set: { event_id: E, occurrence_date: '2026-08-03', member_id: MA, answer: 'no' } },
        { kind: 'create', entity: 'event_rsvps', id: R2, group_id: G, set: { event_id: LIVE, occurrence_date: '2026-08-12', member_id: MA, answer: 'no' } },
        { kind: 'create', entity: 'event_participants', id: X1, group_id: G, set: { event_id: E, member_id: MB } },
        { kind: 'create', entity: 'event_task_series', id: S1, group_id: G, set: { event_id: LIVE, list_id: L, title: 'Strój' } },
        task(COPY, L, { series_id: S1, deadline_mode: 'event', event_id: LIVE, occurrence_date: '2026-08-12' }),
        { kind: 'create', entity: 'shopping_trips', id: Z1, group_id: G, set: { list_id: SHOP, done_at: new Date().toISOString() } },
        { kind: 'create', entity: 'shopping_trips', id: Z2, group_id: G, set: { list_id: SHOP, done_at: new Date().toISOString() } },
        { kind: 'create', entity: 'shopping_trips', id: Z3, group_id: G, set: { list_id: SHOP, done_at: new Date().toISOString() } },
      ]);
      await as(null);
      await db.query(`insert into public.object_members (scope_entity, scope_id, member_id, group_id) values ('lists', $1, $2, $3)`, [LHID, MB, G]);
      // Kosz i daty sprzed terminów (jak po miesiącach używania): nagrobki 40 dni, młodsze 10 dni, zakupy 100 dni.
      const back = async (table: string, col: string, days: number, ids: string[], key = 'id') =>
        db.query(`update public.${table} set ${col} = now() - make_interval(days => $1) where ${key} = any ($2::uuid[])`, [days, ids]);
      await db.query(`select set_config('organizer.trash_ok', 'on', true)`);
      await back('tasks', 'deleted_at', 40, [T1, P, P2, C2, TOLD]);
      await back('tasks', 'deleted_at', 10, [T2]);
      await back('lists', 'deleted_at', 40, [LOLD]);
      await back('events', 'deleted_at', 40, [E]);
      await back('events', 'deleted_at', 10, [EY]);
      await back('event_overrides', 'deleted_at', 40, [O2]);
      await back('event_task_series', 'deleted_at', 40, [S1]);
      await back('object_members', 'deleted_at', 40, [LHID], 'scope_id');
      await back('shopping_trips', 'done_at', 100, [Z1]);
      await back('shopping_trips', 'deleted_at', 40, [Z3]);
      await db.query(`update public.activity set created_at = now() - interval '100 days' where group_id = $1 and entity_id = $2`, [G, T2]);
      await db.query(`select set_config('organizer.trash_ok', '', true)`);

      // Telefon Ali widział wszystko przed sprzątaniem.
      const before = await pullAll(initialState(id(900)), false);
      expect(Object.keys(before.base.tasks ?? {})).toHaveLength(9);
      await as(null);
      const purged = (await db.query('select private.purge_group($1) r', [G])).rows[0].r;
      expect(purged.tombstones).toBeGreaterThanOrEqual(10);
      // Pobranie przyrostowe (kursor za usuniętymi — bez resync) z retencją telefonu = świeża instalacja.
      const old = await pullAll(before, true);
      const fresh = await pullAll(initialState(id(901)), false);
      expect(sorted(old.base)).toEqual(sorted(fresh.base));
      // Bez retencji telefonu zostałyby nagrobki (test coś sprawdza).
      expect(sorted((await pullAll(before, false)).base)).not.toEqual(sorted(fresh.base));
    } finally {
      await db.query('rollback');
    }
  });
});
