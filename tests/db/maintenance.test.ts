/**
 * Codzienne sprzątanie na prawdziwym połączeniu (audyt 2, M-66; migracja 20261008390000_retention): pg_cron woła
 * `call private.run_daily_maintenance()`, a procedura zatwierdza każdą grupę osobno. Zapis telefonu do grupy już
 * posprzątanej nie czeka na koniec całego zadania (dotąd czekał — blokady grup trzymała jedna transakcja).
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const enabled = !!process.env.PGHOST;
const d = enabled ? describe : describe.skip;
const DB = process.env.PGDATABASE ?? 'organizer_test';

async function connect(user?: string) {
  const c = new Client({ database: DB });
  await c.connect();
  if (user) {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
    await c.query('set role authenticated');
  }
  return c;
}

d('procedura sprzątania (M-66)', () => {
  it('zapis do posprzątanej grupy nie czeka na koniec całego przebiegu', async () => {
    const admin = await connect();
    const user = randomUUID();
    // Kolejność grup w przebiegu: po id — pierwsza i ostatnia.
    const first = `00000000-0000-7000-8000-${randomUUID().slice(-12)}`;
    const last = `ffffffff-ffff-7fff-8fff-${randomUUID().slice(-12)}`;
    await admin.query(`insert into auth.users (id, email) values ($1::uuid, $1::text || '@x.test')`, [user]);
    const phone = await connect(user);
    const client = randomUUID();
    const lists: Record<string, string> = {};
    let seq = 0;
    for (const g of [first, last]) {
      await phone.query(`select public.create_group($1, 'G', $2, 'A')`, [g, randomUUID()]);
      lists[g] = randomUUID();
      const t = randomUUID();
      await phone.query(`select public.sync_push($1, 2, $2::jsonb)`, [
        client,
        JSON.stringify([
          { seq: ++seq, kind: 'create', entity: 'lists', id: lists[g], group_id: g, set: { kind: 'tasks', name: 'L' } },
          { seq: ++seq, kind: 'create', entity: 'tasks', id: t, group_id: g, set: { list_id: lists[g], title: 'Stare' } },
          { seq: ++seq, kind: 'delete', entity: 'tasks', id: t },
        ]),
      ]);
      await admin.query(`update public.tasks set deleted_at = now() - interval '31 days' where id = $1`, [t]);
    }
    // Sprzątanie ostatniej grupy trwa 2 s.
    await admin.query(`create function public.zz_slow() returns trigger language plpgsql as $$ begin if old.group_id = '${last}' then perform pg_sleep(2); end if; return old; end $$`);
    await admin.query(`create trigger zz_slow before delete on public.tasks for each row execute function public.zz_slow()`);
    const runner = await connect();
    try {
      const started = Date.now();
      const run = runner.query('call private.run_daily_maintenance()');
      await new Promise((r) => setTimeout(r, 700));
      const t0 = Date.now();
      const res = (
        await phone.query(`select public.sync_push($1, 2, $2::jsonb) r`, [
          client,
          JSON.stringify([{ seq: ++seq, kind: 'create', entity: 'tasks', id: randomUUID(), group_id: first, set: { list_id: lists[first], title: 'Nowe' } }]),
        ])
      ).rows[0].r;
      const waited = Date.now() - t0;
      await run;
      const total = Date.now() - started;
      expect(res.results[0].status).toBe('ok');
      // Zapis przeszedł, zanim skończył się przebieg (ten trwał co najmniej 2 s).
      expect(total).toBeGreaterThanOrEqual(2000);
      expect(waited).toBeLessThan(1000);
      const left = (await admin.query(`select count(*)::int n from public.tasks where group_id = any($1::uuid[]) and title = 'Stare'`, [[first, last]])).rows[0].n;
      expect(left).toBe(0);
      const runRow = (await admin.query(`select finished_at is not null done, result from private.maintenance_runs order by id desc limit 1`)).rows[0];
      expect(runRow.done).toBe(true);
      expect(runRow.result.tombstones).toBeGreaterThanOrEqual(2);
    } finally {
      await admin.query('drop trigger zz_slow on public.tasks');
      await admin.query('drop function public.zz_slow()');
      await Promise.all([admin, phone, runner].map((c) => c.end()));
    }
  }, 60_000);
});
