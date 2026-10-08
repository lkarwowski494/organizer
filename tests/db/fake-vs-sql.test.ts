/**
 * Test różnicowy: te same losowe paczki operacji idą do FakeServer (model używany w symulacji klientów)
 * i do prawdziwych funkcji sync_push / sync_pull w Postgresie. Statusy operacji i to, co każda osoba
 * widzi, muszą być identyczne — inaczej symulacja testowałaby klienta na fałszywym modelu serwera.
 * Wymaga bazy z migracjami (scripts/db/test-db.sh zostawia organizer_test); bez PGHOST test jest pomijany.
 */
import * as fc from 'fast-check';
import { Client } from 'pg';

import { config } from '../../src/config';
import type { NewOp, Op } from '../../src/domain/sync-engine/client';
import { FakeServer } from '../../src/domain/__tests__/support/fake-server';

const enabled = !!process.env.PGHOST;
const d = enabled ? describe : describe.skip;

const U = { ala: '00000000-0000-7000-8000-0000000000a1', bartek: '00000000-0000-7000-8000-0000000000b1' } as const;
const MEMBER = { ala: '99999999-0000-7000-8000-0000000000a1', bartek: '99999999-0000-7000-8000-0000000000b1' } as const;
const G = '99999999-0000-7000-8000-000000000001';
const id = (prefix: string, n: number) => `99999999-0000-7000-8${prefix}-${String(n).padStart(12, '0')}`;
const LISTS = [1, 2].map((n) => id('001', n));
const TASKS = [1, 2, 3].map((n) => id('002', n));
type User = keyof typeof U;

const opArb: fc.Arbitrary<NewOp> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS), group_id: fc.constant(G),
    set: fc.record({ kind: fc.constant('tasks'), name: fc.constantFrom('Dom', 'Prezenty'), visibility: fc.constantFrom('group', 'restricted') }) }),
  fc.record({ kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS), group_id: fc.constant(G),
    set: fc.record({ list_id: fc.constantFrom(...LISTS), title: fc.constantFrom('a', 'b') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS), set: fc.record({ title: fc.constantFrom('x', 'y') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS), set: fc.record({ name: fc.constantFrom('A', 'B') }) }),
  fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constantFrom('lists' as const, 'tasks' as const), id: fc.constantFrom(...LISTS, ...TASKS) }),
  fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constantFrom('grant_scope', 'revoke_scope'), args: fc.record({ list_id: fc.constantFrom(...LISTS), user: fc.constantFrom<User>('ala', 'bartek') }) }),
  // Audyt 2: widoczność (także „Tylko ja”), przeniesienie zadania, odhaczenie (jedyna zmiana dziecka).
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS), set: fc.record({ visibility: fc.constantFrom('group', 'restricted', 'private') }) }),
  fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constant('move_task'), args: fc.record({ id: fc.constantFrom(...TASKS), list_id: fc.constantFrom(...LISTS) }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS), set: fc.record({ completed_at: fc.constantFrom('2026-10-08T10:00:00.000Z', null) }) }),
) as fc.Arbitrary<NewOp>;

// Krok: paczka operacji jednej osoby; `retry` — ta sama paczka jeszcze raz (zgubiona odpowiedź, M-56); `role` — przed
// paczką właściciel zmienia rolę Bartka (dziecko tylko odhacza).
const stepArb = fc.record({
  who: fc.constantFrom<User>('ala', 'bartek'),
  ops: fc.array(opArb, { minLength: 1, maxLength: 4 }),
  retry: fc.boolean(),
  role: fc.constantFrom(null, 'member' as const, 'child' as const),
});

/** Komenda zakresu: model trzyma użytkownika, SQL — identyfikator członka grupy (move_task bez zmian). */
const toSql = (op: Op): Op =>
  op.kind === 'cmd' && op.cmd !== 'move_task' ? { ...op, args: { list_id: op.args.list_id, member_id: MEMBER[op.args.user as User] } } : op;

function view(rows: { lists: Record<string, unknown>[]; tasks: Record<string, unknown>[] }) {
  const pick = (r: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries([...keys.map((k) => [k, r[k] ?? null]), ['deleted', r.deleted_at != null]]);
  return {
    lists: Object.fromEntries(rows.lists.map((r) => [r.id, pick(r, ['name', 'visibility'])])),
    tasks: Object.fromEntries(rows.tasks.map((r) => [r.id, pick(r, ['title', 'list_id'])])),
  };
}

d('FakeServer = prawdziwy SQL (sync_push / sync_pull)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const as = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };

  async function sqlVisible(user: User) {
    await as(user);
    const res = (await db.query(`select public.sync_pull('{}'::jsonb, 1000, $1) r`, [config.sync.SCHEMA_VERSION])).rows[0].r;
    const rows = res.groups.filter((g: { group_id: string }) => g.group_id === G).flatMap((g: { rows: { e: string; row: Record<string, unknown> }[] }) => g.rows);
    // Ukryte listy dostępne przez zakres: ich wiersze mogą mieć starsze wersje, więc dobieramy je fetch_scope.
    for (const s of res.scopes as string[]) {
      rows.push(...(await db.query(`select public.sync_fetch_scope($1) r`, [s])).rows[0].r.rows);
    }
    const by = (e: string) => [...new Map(rows.filter((x: { e: string }) => x.e === e).map((x: { row: { id: string } }) => [x.row.id, x.row])).values()] as Record<string, unknown>[];
    return view({ lists: by('lists'), tasks: by('tasks') });
  }

  it('te same statusy i ten sam widok dla każdej osoby', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 12 }), async (steps) => {
        await db.query('begin');
        try {
          await as(null);
          await db.query(`insert into auth.users (id, email) values ($1, 'a@x.test'), ($2, 'b@x.test')`, [U.ala, U.bartek]);
          await as('ala');
          await db.query(`select public.create_group($1, 'Rodzina', $2, 'Ala')`, [G, MEMBER.ala]);
          await as(null);
          await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values ($1, $2, $3, 'Bartek')`, [MEMBER.bartek, G, U.bartek]);

          const fake = new FakeServer();
          fake.addGroup(G, ['ala', 'bartek']);
          const seq: Record<User, number> = { ala: 0, bartek: 0 };
          let n = 0;
          for (const step of steps) {
            if (step.role) {
              fake.setRole(G, 'bartek', step.role);
              await as(null);
              await db.query(`update public.group_members set role = $1 where member_id = $2`, [step.role, MEMBER.bartek]);
            }
            const ops = step.ops.map((o) => ({ ...o, seq: ++seq[step.who], op_id: id('003', ++n) }) as Op);
            for (let k = 0; k < (step.retry ? 2 : 1); k++) {
              const f = fake.push(step.who, { client_id: `c-${step.who}`, ops });
              await as(step.who);
              const s = (await db.query(`select public.sync_push($1, $2, $3::jsonb) r`, [id('004', step.who === 'ala' ? 1 : 2), config.sync.SCHEMA_VERSION, JSON.stringify(ops.map(toSql))])).rows[0].r;
              expect(s.results.map((r: { status: string }) => r.status)).toEqual(f.results.map((r) => r.status));
            }
          }
          for (const user of ['ala', 'bartek'] as const) {
            expect(await sqlVisible(user)).toEqual(view(fake.visibleRows(user) as never));
            // Protokół 2: zbiór list, które osoba widzi (M-54), i ukryte zakresy — te same w modelu i w SQL.
            await as(user);
            const res = (await db.query(`select public.sync_pull('{}'::jsonb, 1000, $1) r`, [config.sync.SCHEMA_VERSION])).rows[0].r;
            const f = fake.pull(user, { cursors: {} }, 1000);
            expect(res.groups.find((g: { group_id: string }) => g.group_id === G).lists).toEqual(f.groups.find((g) => g.group_id === G)!.lists);
            expect(res.scopes).toEqual(f.scopes);
          }
        } finally {
          await db.query('rollback');
        }
      }),
      { numRuns: 500 },
    );
  }, 120_000);
});
