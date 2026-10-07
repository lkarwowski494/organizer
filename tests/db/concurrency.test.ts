/**
 * Współbieżność na prawdziwym Postgresie (architektura: „kursor, który nie gubi zmian przy współbieżnych
 * transakcjach”, D32). Kilka połączeń naraz wysyła sync_push do tej samej grupy, a osobne połączenie w tym
 * czasie w pętli robi sync_pull po kursorze. Po zakończeniu zapisów i ostatnim pobraniu pobierający musi mieć
 * dokładnie stan serwera: żadnej zmiany zgubionej przez transakcję zatwierdzoną „później z niższą wersją”.
 * Dane zostają w bazie testowej (scripts/db/test-db.sh tworzy ją od nowa przy każdym uruchomieniu).
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
    // Ustawienia na całą sesję: każde wywołanie RPC to osobna, krótka transakcja (jak w PostgREST).
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
    await c.query('set role authenticated');
  }
  return c;
}

type Row = { e: string; v: number; row: { id?: string; title?: string; version?: number } };

d('współbieżne zapisy i pobieranie po kursorze', () => {
  it('pobierający nie gubi żadnej zmiany', async () => {
    const WRITERS = 6;
    const PUSHES = 25;
    const admin = await connect();
    const users = Array.from({ length: WRITERS + 1 }, () => randomUUID());
    const group = randomUUID();
    const list = randomUUID();
    await admin.query(`insert into auth.users (id, email) select u, u || '@x.test' from unnest($1::uuid[]) u`, [users]);
    const owner = await connect(users[0]);
    await owner.query(`select public.create_group($1, 'Współbieżność', $2, 'Owner')`, [group, randomUUID()]);
    await admin.query(
      `insert into public.group_members (member_id, group_id, user_id, display_name)
       select gen_random_uuid(), $1, u, 'W' from unnest($2::uuid[]) u`,
      [group, users.slice(1)],
    );
    await owner.query(
      `select public.sync_push($1, 1, $2::jsonb)`,
      [randomUUID(), JSON.stringify([{ seq: 1, kind: 'create', entity: 'lists', id: list, group_id: group, set: { kind: 'tasks', name: 'L' } }])],
    );

    const writers = await Promise.all(users.slice(1).map((u) => connect(u)));
    const puller = await connect(users[0]);
    const seen = new Map<string, Row['row']>();
    let cursor = 0;
    let writing = true;

    const pull = async () => {
      for (;;) {
        const res = (await puller.query(`select public.sync_pull($1::jsonb, 7) r`, [JSON.stringify({ [group]: cursor })])).rows[0].r;
        const g = res.groups.find((x: { group_id: string }) => x.group_id === group);
        for (const r of g.rows as Row[]) if (r.e === 'tasks') seen.set(r.row.id!, r.row);
        cursor = g.cursor;
        if (!g.has_more) return;
      }
    };

    const pulling = (async () => {
      while (writing) await pull();
    })();

    const tasks: string[] = [];
    await Promise.all(
      writers.map(async (w, i) => {
        const client = randomUUID();
        for (let k = 1; k <= PUSHES; k++) {
          const id = randomUUID();
          tasks.push(id);
          const ops = [
            { seq: 2 * k - 1, kind: 'create', entity: 'tasks', id, group_id: group, set: { list_id: list, title: `w${i}-${k}` } },
            { seq: 2 * k, kind: 'patch', entity: 'tasks', id, set: { note: 'edytowane' } },
          ];
          await w.query(`select public.sync_push($1, 1, $2::jsonb)`, [client, JSON.stringify(ops)]);
        }
      }),
    );
    writing = false;
    await pulling;
    await pull(); // ostatnie pobranie po zakończeniu wszystkich zapisów

    const server = (await admin.query(`select id::text, version from public.tasks where group_id = $1`, [group])).rows;
    expect(server).toHaveLength(WRITERS * PUSHES);
    expect(seen.size).toBe(server.length);
    for (const s of server) expect(Number(seen.get(s.id)?.version)).toBe(Number(s.version));
    // Wersje w grupie są unikalne i ciągłe: każdy zapis dostał kolejny numer.
    const versions = (await admin.query(`select version from public.tasks where group_id = $1 union all select version from public.lists where group_id = $1 union all select version from public.group_members where group_id = $1`, [group])).rows.map((r) => Number(r.version));
    expect(new Set(versions).size).toBe(versions.length);

    await Promise.all([admin, owner, puller, ...writers].map((c) => c.end()));
  }, 120_000);
});

d('równoczesne przeniesienia zadań', () => {
  it('„A pod B” i „B pod A” naraz: dokładnie jedno przechodzi, nigdy cykl', async () => {
    const admin = await connect();
    const [ua, ub] = [randomUUID(), randomUUID()];
    const group = randomUUID();
    const list = randomUUID();
    await admin.query(`insert into auth.users (id, email) values ($1, 'a'), ($2, 'b')`, [ua, ub]);
    const a = await connect(ua);
    await a.query(`select public.create_group($1, 'Przenoszenie', $2, 'A')`, [group, randomUUID()]);
    await admin.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values (gen_random_uuid(), $1, $2, 'B')`, [group, ub]);
    const b = await connect(ub);
    const push = (c: Client, client: string, ops: object[]) =>
      c.query(`select public.sync_push($1, 1, $2::jsonb) r`, [client, JSON.stringify(ops)]).then((r) => r.rows[0].r);
    const ca = randomUUID();
    const cb = randomUUID();
    await push(a, ca, [{ seq: 1, kind: 'create', entity: 'lists', id: list, group_id: group, set: { kind: 'tasks', name: 'L' } }]);

    let seqA = 1;
    let seqB = 0;
    let cycles = 0;
    let bothOk = 0;
    for (let round = 0; round < 40; round++) {
      const [x, y] = [randomUUID(), randomUUID()];
      await push(a, ca, [
        { seq: ++seqA, kind: 'create', entity: 'tasks', id: x, group_id: group, set: { list_id: list, title: 'X' } },
        { seq: ++seqA, kind: 'create', entity: 'tasks', id: y, group_id: group, set: { list_id: list, title: 'Y' } },
      ]);
      // Obie komendy startują jednocześnie z dwóch połączeń.
      const [ra, rb] = await Promise.all([
        push(a, ca, [{ seq: ++seqA, kind: 'cmd', cmd: 'move_task', args: { id: x, parent_id: y } }]),
        push(b, cb, [{ seq: ++seqB, kind: 'cmd', cmd: 'move_task', args: { id: y, parent_id: x } }]),
      ]);
      const statuses = [ra.results[0].status, rb.results[0].status];
      if (statuses.every((s) => s === 'ok')) bothOk++;
      const rows = (await admin.query(`select id::text, parent_id::text from public.tasks where id = any($1::uuid[])`, [[x, y]])).rows;
      const parent = Object.fromEntries(rows.map((r) => [r.id, r.parent_id]));
      if (parent[x] === y && parent[y] === x) cycles++;
      expect(statuses.filter((s) => s === 'ok')).toHaveLength(1);
    }
    expect(cycles).toBe(0);
    expect(bothOk).toBe(0);
    await Promise.all([admin, a, b].map((c) => c.end()));
  }, 120_000);
});
