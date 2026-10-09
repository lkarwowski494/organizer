/**
 * Codzienne sprzątanie na prawdziwym połączeniu (audyt 2, M-66; migracja 20261008480000_retention): pg_cron woła
 * `call private.run_daily_maintenance()`, a procedura zatwierdza każdą grupę osobno. Zapis telefonu do grupy już
 * posprzątanej nie czeka na koniec całego zadania (dotąd czekał — blokady grup trzymała jedna transakcja).
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { dbDescribe } from './db-gate';

const d = dbDescribe;
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
    const ga: string = randomUUID();
    const gb: string = randomUUID();
    await admin.query(`insert into auth.users (id, email) values ($1::uuid, $1::text || '@x.test')`, [user]);
    const phone = await connect(user);
    const client = randomUUID();
    const lists: Record<string, string> = {};
    const stale: Record<string, string> = {};
    let seq = 0;
    for (const g of [ga, gb]) {
      await phone.query(`select public.create_group($1, 'G', $2, 'A')`, [g, randomUUID()]);
      lists[g] = randomUUID();
      const t = (stale[g] = randomUUID());
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
    // Przebieg zatrzymujemy blokadami wierszy zamiast pauzy i zegara: dwie transakcje testu trzymają FOR UPDATE stary
    // wpis każdej z grup. Przebieg staje na pierwszej grupie, którą sprząta (kolejność nie jest ustalona); puszczamy ją,
    // przebieg zatwierdza tę grupę i staje na drugiej — i stoi, dopóki test go nie puści. Zapis telefonu do posprzątanej
    // grupy idzie wtedy z lock_timeout: gdyby czekał na blokady przebiegu (jedna transakcja na cały przebieg, M-66),
    // kończy się błędem zamiast przejść. Dotąd: pauza 2 s w wyzwalaczu na public.tasks i warunek „zapis < 1 s” — na
    // obciążonej maszynie 1,6 s bez czekania na przebieg, a tworzenie i usuwanie wyzwalacza na wspólnej tabeli czekało
    // na długie transakcje innych plików tests/db (rules-vs-sql) i wstrzymywało ich zapisy (pomiar 9.10.2026).
    const holders = { [ga]: await connect(), [gb]: await connect() };
    const holderPid: Record<string, number> = {};
    for (const g of [ga, gb]) {
      holderPid[g] = (await holders[g]!.query('select pg_backend_pid() p')).rows[0].p as number;
      await holders[g]!.query('begin');
      await holders[g]!.query('select 1 from public.tasks where id = $1 for update', [stale[g]]);
    }
    const runner = await connect();
    const runnerPid = (await runner.query('select pg_backend_pid() p')).rows[0].p as number;
    /** Grupa, na której blokadzie stoi przebieg (albo null). */
    const heldAt = async () => {
      const blockers = (await admin.query('select pg_blocking_pids($1) b', [runnerPid])).rows[0].b as number[];
      return [ga, gb].find((g) => blockers.includes(holderPid[g]!)) ?? null;
    };
    const waitHeldAt = async (what: string) => {
      for (let i = 0; i < 600; i++) {
        const g = await heldAt();
        if (g) return g;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`przebieg sprzątania nie stanął na ${what}`);
    };
    const open = new Set([ga, gb]);
    const release = async (g: string) => {
      if (open.delete(g)) await holders[g]!.query('rollback');
    };
    try {
      const run = runner.query('call private.run_daily_maintenance()');
      run.catch(() => undefined); // błąd przebiegu zgłasza `await run` niżej, nie jako nieobsłużone odrzucenie
      const cleaned = await waitHeldAt('pierwszej grupie');
      await release(cleaned);
      const other = [ga, gb].find((g) => g !== cleaned)!;
      expect(await waitHeldAt('drugiej grupie')).toBe(other);
      // Pierwsza grupa posprzątana i zatwierdzona (widać to z innej sesji), druga jeszcze nie.
      const left = (await admin.query(`select group_id from public.tasks where group_id = any($1::uuid[]) and title = 'Stare'`, [[ga, gb]])).rows.map((r) => r.group_id as string);
      expect(left).toEqual([other]);
      await phone.query(`set lock_timeout = '20s'`);
      const res = (
        await phone.query(`select public.sync_push($1, 2, $2::jsonb) r`, [
          client,
          JSON.stringify([{ seq: ++seq, kind: 'create', entity: 'tasks', id: randomUUID(), group_id: cleaned, set: { list_id: lists[cleaned], title: 'Nowe' } }]),
        ])
      ).rows[0].r;
      expect(res.results[0].status).toBe('ok');
      // Zapis przeszedł, a przebieg wciąż stoi na drugiej grupie (nie skończył się w międzyczasie).
      expect(await heldAt()).toBe(other);
      await release(other);
      await run;
      const stillStale = (await admin.query(`select count(*)::int n from public.tasks where group_id = any($1::uuid[]) and title = 'Stare'`, [[ga, gb]])).rows[0].n;
      expect(stillStale).toBe(0);
      const runRow = (await admin.query(`select finished_at is not null done, result from private.maintenance_runs order by id desc limit 1`)).rows[0];
      expect(runRow.done).toBe(true);
      expect(runRow.result.tombstones).toBeGreaterThanOrEqual(2);
    } finally {
      for (const g of [...open]) await release(g);
      await Promise.all([admin, phone, runner, ...Object.values(holders)].map((c) => c.end()));
    }
  }, 60_000);
});
