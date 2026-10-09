/**
 * Współbieżność na prawdziwym Postgresie (architektura: „kursor, który nie gubi zmian przy współbieżnych
 * transakcjach”, D32). Kilka połączeń naraz wysyła sync_push do tej samej grupy, a osobne połączenie w tym
 * czasie w pętli robi sync_pull po kursorze. Po zakończeniu zapisów i ostatnim pobraniu pobierający musi mieć
 * dokładnie stan serwera: żadnej zmiany zgubionej przez transakcję zatwierdzoną „później z niższą wersją”.
 * Dane zostają w bazie testowej (scripts/db/test-db.sh tworzy ją od nowa przy każdym uruchomieniu).
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

import { stapleCmdResult } from '../../src/domain/sync-engine/client';
import { dbDescribe } from './db-gate';

const d = dbDescribe;
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

    // Górna granica obrotów (audyt 2, M-49): pobieranie, które się nie kończy, ma być błędem, a nie wiszącym testem.
    const pull = async () => {
      for (let i = 0; ; i++) {
        if (i >= 10_000) throw new Error('pobieranie się nie kończy');
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

d('równoczesne stałe zakupy (audyt 2, M-111)', () => {
  it('dopisania z wielu telefonów naraz się sumują — nic nie ginie, bez dubli; telefon liczy ten sam skutek', async () => {
    const WRITERS = 5;
    const NAMES = 4;
    const admin = await connect();
    const users = Array.from({ length: WRITERS }, () => randomUUID());
    const group = randomUUID();
    const list = randomUUID();
    await admin.query(`insert into auth.users (id, email) select u, u || '@x.test' from unnest($1::uuid[]) u`, [users]);
    const owner = await connect(users[0]);
    await owner.query(`select public.create_group($1, 'Stałe', $2, 'Owner')`, [group, randomUUID()]);
    await admin.query(`insert into public.group_members (member_id, group_id, user_id, display_name) select gen_random_uuid(), $1, u, 'W' from unnest($2::uuid[]) u`, [group, users.slice(1)]);
    await owner.query(`select public.sync_push($1, 1, $2::jsonb)`, [randomUUID(), JSON.stringify([{ seq: 1, kind: 'create', entity: 'lists', id: list, group_id: group, set: { kind: 'shopping', name: 'Zakupy' } }])]);
    const writers = await Promise.all(users.map((u) => connect(u)));
    // Każdy telefon dopisuje swoje nazwy i jedną wspólną („Mleko”) — wszystkie naraz.
    const results = await Promise.all(
      writers.map(async (w, i) => {
        const ops = [...Array.from({ length: NAMES }, (_, k) => `w${i}-${k}`), 'Mleko'].map((name, k) => ({ seq: k + 1, kind: 'cmd', cmd: 'staple_add', args: { list_id: list, name } }));
        return (await w.query(`select public.sync_push($1, 1, $2::jsonb) r`, [randomUUID(), JSON.stringify(ops)])).rows[0].r;
      }),
    );
    expect(results.flatMap((r) => r.results.map((x: { status: string }) => x.status)).every((x: string) => x === 'ok')).toBe(true);
    const staples: string[] = (await admin.query(`select staples from public.lists where id = $1`, [list])).rows[0].staples;
    const expected = ['Mleko', ...users.flatMap((_, i) => Array.from({ length: NAMES }, (_, k) => `w${i}-${k}`))];
    expect([...staples].sort()).toEqual(expected.sort());
    // Usunięcie na starym stanie też niczego nie przywraca ani nie kasuje cudzego.
    await writers[1]!.query(`select public.sync_push($1, 1, $2::jsonb)`, [randomUUID(), JSON.stringify([{ seq: 1, kind: 'cmd', cmd: 'staple_remove', args: { list_id: list, names: ['Mleko', 'w0-0'] } }])]);
    const after: string[] = (await admin.query(`select staples from public.lists where id = $1`, [list])).rows[0].staples;
    expect(after).toEqual(staples.filter((x) => x !== 'Mleko' && x !== 'w0-0'));
    // Skutek lokalny (telefon przed potwierdzeniem) = skutek serwera dla tej samej kolejności poleceń.
    expect(stapleCmdResult({ staples }, { cmd: 'staple_remove', args: { names: ['Mleko', 'w0-0'] } })).toEqual(after);
    await Promise.all([admin, owner, ...writers].map((c) => c.end()));
  }, 60_000);
});


// Audyt 2 (M-192): paczki dotykające tych samych dwóch grup w odwrotnej kolejności. Dotąd każda blokowała grupy w kolejności
// operacji — A potem B kontra B potem A dawało deadlock_detected; teraz sync_push blokuje grupy paczki na początku, po id.
d('paczki w odwrotnej kolejności grup', () => {
  it('bez zakleszczeń', async () => {
    const admin = await connect();
    const [ua, ub] = [randomUUID(), randomUUID()];
    await admin.query(`insert into auth.users (id, email) values ($1, 'a'), ($2, 'b')`, [ua, ub]);
    const a = await connect(ua);
    const b = await connect(ub);
    const groups = [randomUUID(), randomUUID()];
    const lists = [randomUUID(), randomUUID()];
    const ca = randomUUID();
    const cb = randomUUID();
    for (const [i, g] of groups.entries()) {
      await a.query(`select public.create_group($1, 'G', $2, 'A')`, [g, randomUUID()]);
      await admin.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values (gen_random_uuid(), $1, $2, 'B')`, [g, ub]);
      await a.query(`select public.sync_push($1, 2, $2::jsonb)`, [ca, JSON.stringify([{ seq: i + 1, kind: 'create', entity: 'lists', id: lists[i], group_id: g, set: { kind: 'tasks', name: 'L' } }])]);
    }
    let seqA = 2;
    let seqB = 0;
    const task = (g: number, seq: number) => ({ seq, kind: 'create', entity: 'tasks', id: randomUUID(), group_id: groups[g], set: { list_id: lists[g], title: 'T' } });
    // 30 rund wystarcza, żeby bez sortowania trafić w zakleszczenie (sprawdzone z wyłączonym private.lock_groups);
    // z sortowaniem nie może się zdarzyć ani razu.
    const errors: string[] = [];
    try {
      for (let round = 0; round < 30; round++) {
        const res = await Promise.allSettled([
          a.query(`select public.sync_push($1, 2, $2::jsonb)`, [ca, JSON.stringify([task(0, ++seqA), task(1, ++seqA)])]),
          b.query(`select public.sync_push($1, 2, $2::jsonb)`, [cb, JSON.stringify([task(1, ++seqB), task(0, ++seqB)])]),
        ]);
        for (const r of res) if (r.status === 'rejected') errors.push(String((r.reason as Error).message));
      }
    } finally {
      await Promise.all([admin, a, b].map((c) => c.end()));
    }
    expect(errors).toEqual([]);
  }, 60_000);
});

// Audyt 3 (N-98): limity liczone z istniejących wierszy (grupy wspólne konta, aktywne zaproszenia grupy, opinie na dobę)
// pod równoległymi żądaniami. Pierwsze żądanie trzyma otwartą transakcję tuż przed limitem; drugie musi poczekać na jego
// koniec i zobaczyć jego wiersz — dotąd liczyło bez blokady i oba przechodziły (np. 51 grup przy limicie 50).
d('limity pod równoległymi żądaniami (audyt 3, N-98)', () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** `first` w otwartej transakcji, potem `second` z drugiego połączenia; zwraca, czy `second` czekało, i jego błąd. */
  async function race(c1: Client, c2: Client, first: string, second: string, args1: unknown[], args2: unknown[]) {
    await c1.query('begin');
    await c1.query(first, args1);
    let done = false;
    const p = c2.query(second, args2).then(
      () => ((done = true), null),
      (e: Error) => ((done = true), e.message),
    );
    await settle(300);
    const waited = !done;
    await c1.query('commit');
    return { waited, error: await p };
  }
  const user = async (admin: Client) => {
    const u = randomUUID();
    await admin.query(`insert into auth.users (id, email) values ($1::uuid, $1::text || '@x.test')`, [u]);
    return u;
  };

  it('grupy wspólne konta: druga grupa ponad limit odrzucona', async () => {
    const admin = await connect();
    const u = await user(admin);
    const max = Number((await admin.query('select private.max_shared_groups() n')).rows[0].n);
    await admin.query(
      `with g as (insert into public.groups (id, name, kind) select gen_random_uuid(), 'G', 'shared' from generate_series(1, $2::int - 1) returning id)
       insert into public.group_members (member_id, group_id, user_id, display_name, role) select gen_random_uuid(), g.id, $1, 'Ala', 'owner' from g`,
      [u, max],
    );
    const [c1, c2] = [await connect(u), await connect(u)];
    const q = `select public.create_group($1, 'Nowa', $2, 'Ala')`;
    const r = await race(c1, c2, q, q, [randomUUID(), randomUUID()], [randomUUID(), randomUUID()]);
    expect(r).toEqual({ waited: true, error: 'limit:groups' });
    const n = (await admin.query(`select count(*)::int n from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = $1 and g.kind = 'shared'`, [u])).rows[0].n;
    expect(n).toBe(max);
    await Promise.all([admin, c1, c2].map((c) => c.end()));
  }, 30_000);

  it('aktywne zaproszenia grupy: drugie ponad limit odrzucone', async () => {
    const admin = await connect();
    const u = await user(admin);
    const group = randomUUID();
    const owner = await connect(u);
    await owner.query(`select public.create_group($1, 'Zaproszenia', $2, 'Ala')`, [group, randomUUID()]);
    const max = Number((await admin.query('select private.max_active_invites() n')).rows[0].n);
    for (let i = 0; i < max - 1; i++) await owner.query('select public.create_invite($1)', [group]);
    const c2 = await connect(u);
    const q = 'select public.create_invite($1)';
    const r = await race(owner, c2, q, q, [group], [group]);
    expect(r).toEqual({ waited: true, error: 'limit:invites' });
    await Promise.all([admin, owner, c2].map((c) => c.end()));
  }, 30_000);

  it('opinie na dobę: druga ponad limit odrzucona', async () => {
    const admin = await connect();
    const u = await user(admin);
    const max = Number((await admin.query('select private.feedback_per_day() n')).rows[0].n);
    await admin.query(`insert into public.app_feedback (user_id, message) select $1, 'stara' from generate_series(1, $2::int - 1)`, [u, max]);
    const [c1, c2] = [await connect(u), await connect(u)];
    const q = `select public.send_feedback('Opinia', null, null)`;
    const r = await race(c1, c2, q, q, [], []);
    expect(r).toEqual({ waited: true, error: 'rate_limited' });
    await Promise.all([admin, c1, c2].map((c) => c.end()));
  }, 30_000);

  it('zgłoszenia błędów na dobę: ponad limit drugie się nie zapisuje', async () => {
    const admin = await connect();
    const u = await user(admin);
    const max = Number((await admin.query('select private.client_errors_per_day() n')).rows[0].n);
    await admin.query(`insert into public.client_errors (user_id, kind, message) select $1, 'error', 'stary' from generate_series(1, $2::int - 1)`, [u, max]);
    const [c1, c2] = [await connect(u), await connect(u)];
    const q = `select public.report_client_error('error', 'nowy', null, null, null)`;
    const r = await race(c1, c2, q, q, [], []);
    expect(r).toEqual({ waited: true, error: null });
    expect((await admin.query('select count(*)::int n from public.client_errors where user_id = $1', [u])).rows[0].n).toBe(max);
    await Promise.all([admin, c1, c2].map((c) => c.end()));
  }, 30_000);
});
