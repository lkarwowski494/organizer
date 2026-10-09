/**
 * Model reguł serwera (src/domain/server-rules.ts, atrapy serwera w testach ekranów i E2E — audyt 2, M-50) = prawdziwy
 * SQL. Na tych samych danych (grupa z ownerem, adminem, memberem i dzieckiem z kontem, obca grupa, grupa w koszu, listy:
 * zwykła, ograniczona z udostępnieniem, prywatna, usunięta, zakupy; zadania, wydarzenie z wyjątkiem, uczestnikiem,
 * odpowiedzią i serią zadań, przekazanie) losowe operacje każdej roli idą przez sync_push (każda w podtransakcji
 * wycofywanej po pomiarze) i przez model; kod odrzucenia (albo „ok”) musi być ten sam. Do tego kolumny modelu =
 * private.sync_entities. Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany (z CI_DB=1 —
 * błąd, db-gate.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as fc from 'fast-check';
import { Client } from 'pg';

import { applyOnServer, SYNC_ENTITIES, serverVerdict } from '../../src/domain/server-rules';
import { scopeRowId } from '../../src/domain/views/my-scope';
import { type Entity, type NewOp, type Row, rowKey } from '../../src/domain/sync-engine/client';
import { dbDescribe } from './db-gate';

const d = dbDescribe;
const DB = process.env.PGDATABASE ?? 'organizer_test';

const matrix = readFileSync(join(__dirname, '../../supabase/tests/role_matrix_all.test.sql'), 'utf8');
// Własne konta (testy tests/db biegną równolegle i tworzą konta o tych samych numerach co pgTAP).
const SEED = matrix
  .slice(matrix.indexOf('-- DANE: początek'), matrix.indexOf('-- DANE: koniec'))
  .replaceAll('00000000-0000-7000-8000-0000000000b', '00000000-0000-7000-8000-0000000003b')
  .replaceAll('@x.test', '@rules.test');

const id = (n: string) => `88888888-0000-7000-8000-0000000000${n}`;
const G = '88888888-0000-7000-8000-000000000001';
const G2 = '88888888-0000-7000-8000-000000000002';
const G3 = '88888888-0000-7000-8000-000000000003';
const USERS = { owner: '00000000-0000-7000-8000-0000000003b0', admin: '00000000-0000-7000-8000-0000000003b1', member: '00000000-0000-7000-8000-0000000003b2', child: '00000000-0000-7000-8000-0000000003b3', stranger: '00000000-0000-7000-8000-0000000003b4' };
const MEMBERS = { owner: id('90'), admin: id('91'), member: id('92'), child: id('93'), profile: id('95'), stranger: id('94'), trash: id('96') };

/** Dodatkowe dane ponad macierz ról: lista prywatna admina, lista usunięta z zadaniem, zakupy z osobą, grupa w koszu. */
const EXTRA = `
select set_config('request.jwt.claim.sub', '', true);
insert into public.lists (id, group_id, kind, name, owner_member_id, visibility) values
  ('${id('e4')}', '${G}', 'tasks', 'Prywatna', '${MEMBERS.admin}', 'private');
insert into public.lists (id, group_id, kind, name, owner_member_id, responsible_member_id) values
  ('${id('e5')}', '${G}', 'shopping', 'Zakupy', '${MEMBERS.owner}', '${MEMBERS.member}');
insert into public.lists (id, group_id, kind, name, owner_member_id) values ('${id('e3')}', '${G}', 'tasks', 'Stara', '${MEMBERS.owner}');
insert into public.tasks (id, group_id, list_id, title) values
  ('${id('d7')}', '${G}', '${id('e3')}', 'W starej'),
  ('${id('d8')}', '${G}', '${id('e4')}', 'Prywatne'),
  ('${id('d9')}', '${G}', '${id('e5')}', 'Mleko'),
  ('${id('da')}', '${G}', '${id('e1')}', 'Usunięte');
update public.tasks set deleted_at = now() where id = '${id('da')}';
update public.lists set deleted_at = now() where id = '${id('e3')}';
update public.tasks set deleted_at = now() where id = '${id('d7')}';
insert into public.groups (id, name, kind) values ('${G3}', 'Kosz', 'shared');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values ('${MEMBERS.trash}', '${G3}', '${USERS.owner}', 'Owner', 'owner');
insert into public.lists (id, group_id, kind, name, owner_member_id) values ('${id('e6')}', '${G3}', 'tasks', 'W koszu', '${MEMBERS.trash}');
insert into public.tasks (id, group_id, list_id, title) values ('${id('db')}', '${G3}', '${id('e6')}', 'W koszu');
update public.groups set deleted_at = now() where id = '${G3}';
`;

const ENTITIES = [...Object.keys(SYNC_ENTITIES), 'object_members'] as Entity[];

d('model reguł serwera = sync_push', () => {
  const db = new Client({ database: DB });
  const tables: { [e: string]: { [k: string]: Row } } = {};
  const clients: { [user: string]: string } = {};

  beforeAll(async () => {
    await db.connect();
    await db.query('begin');
    await db.query(SEED);
    await db.query(EXTRA);
    await db.query("select set_config('request.jwt.claim.sub', '', true)");
    await db.query('reset role');
    for (const e of ENTITIES) {
      const rows = (await db.query<{ r: Row }>(`select to_jsonb(t) as r from public.${e} t`)).rows.map((x) => x.r);
      tables[e] = Object.fromEntries(rows.map((r) => [rowKey(e, r), r]));
    }
    Object.values(USERS).forEach((u, i) => (clients[u] = `88888888-0000-7000-8000-0000000001f${i}`));
  });
  afterAll(async () => {
    await db.query('rollback');
    await db.end();
  });

  /** Kod z sync_push jako osoba `user` i (gdy przyjęta) wiersze zmienione przez operację; wszystko wycofane po pomiarze. */
  async function sql(user: string, op: NewOp): Promise<{ code: string; changed: { [key: string]: Row } }> {
    await db.query('savepoint cell');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      await db.query('set local role authenticated');
      const full = { ...op, seq: 1, op_id: '88888888-0000-7000-8000-0000000002ff' };
      const r = (await db.query<{ r: { results: { status: string; code?: string }[] } }>('select public.sync_push($1, 2, $2::jsonb) as r', [clients[user], JSON.stringify([full])])).rows[0]!.r;
      const code = r.results[0]!.code ?? r.results[0]!.status;
      await db.query('reset role');
      const changed: { [key: string]: Row } = {};
      if (code === 'ok') {
        for (const e of ENTITIES) {
          for (const { r: row } of (await db.query<{ r: Row }>(`select to_jsonb(t) as r from public.${e} t`)).rows) {
            const before = tables[e]?.[rowKey(e, row)];
            if (!before || before.version !== row.version) changed[`${e}:${rowKey(e, row)}`] = row;
          }
        }
      }
      return { code, changed };
    } finally {
      await db.query('rollback to savepoint cell');
    }
  }

  /** Porównywane kolumny skutków (znaczniki czasu jako „jest / nie ma”). */
  const COMPARED = ['deleted_at', 'assignee_member_id', 'responsible_member_id', 'responsible_cleared', 'owner_member_id', 'from_member', 'to_member', 'status', 'closed', 'sort_key', 'visibility', 'staples', 'deadline_mode', 'rollover', 'audience', 'cancelled', 'all_day', 'role', 'title', 'name'];
  const norm = (row: Row | undefined) =>
    row && Object.fromEntries(COMPARED.filter((c) => c in row).map((c) => [c, c === 'deleted_at' ? row[c] != null : row[c] ?? null]));

  it('kolumny modelu = private.sync_entities', async () => {
    const rows = (await db.query<{ entity: string; pk: string; insert_cols: string[]; patch_cols: string[]; soft_delete: boolean }>('select * from private.sync_entities')).rows;
    expect(Object.fromEntries(rows.map((r) => [r.entity, { pk: r.pk, insert: r.insert_cols, patch: r.patch_cols, softDelete: r.soft_delete }]))).toEqual(SYNC_ENTITIES);
  });

  it('losowe operacje wszystkich ról: ten sam wynik w modelu i w SQL', async () => {
    const ids = (e: string) => Object.keys(tables[e] ?? {});
    const pick = <T,>(xs: readonly T[]) => fc.constantFrom(...xs);
    const memberIds = Object.values(MEMBERS);
    const values: { [col: string]: fc.Arbitrary<unknown> } = {
      title: pick(['Nowe', 'Inne']),
      name: pick(['Nowa', 'Inna']),
      note: pick([null, 'notatka']),
      sort_key: pick(['a1', 'b0']),
      display_name: pick(['Ktoś', 'Inny']),
      color: pick([null, '#00aa00']), // członek: kolor #rrggbb; grupa — niżej
      role: pick(['child', 'member', 'admin', 'owner']),
      week_a: pick([null, '2026-10-05']),
      visibility: pick(['group', 'restricted', 'private']),
      kind: pick(['tasks', 'shopping']),
      list_id: pick([...ids('lists'), id('ff')]),
      parent_id: pick([null, id('d1'), id('da')]),
      assignee_member_id: pick([null, ...memberIds]),
      responsible_member_id: pick([null, ...memberIds]),
      member_id: pick(memberIds),
      to_member: pick(memberIds),
      completed_at: pick([null, '2026-10-08T10:00:00Z']),
      deadline_mode: pick(['none', 'inherit']),
      due_date: pick([null, '2026-10-09']),
      event_id: pick([id('c1'), id('ff')]),
      occurrence_date: pick(['2026-10-21', '2026-10-28']),
      scope: pick(['all', 'mine']),
      planned_date: pick([null, '2026-10-09']),
      done_at: pick(['2026-10-08T10:00:00Z']),
      answer: pick(['yes', 'no']),
      status: pick(['accepted', 'declined', 'cancelled']),
      closed: fc.boolean(),
      entity: pick(['tasks', 'lists', 'events']),
      entity_id: pick([id('d1'), id('d3'), id('d4'), id('d5'), id('d9'), id('e5'), id('c1')]),
      cancelled: fc.boolean(),
      audience: pick(['group', 'members']),
      start_date: pick(['2026-10-09']),
      start_time: pick(['10:00']),
      end_time: pick(['19:00']),
    };
    const required: { [e: string]: readonly string[] } = {
      groups: ['name'],
      group_members: ['display_name', 'role'],
      lists: ['kind', 'name'],
      tasks: ['list_id', 'title'],
      events: ['title', 'start_date', 'start_time', 'end_time', 'audience'],
      event_participants: ['event_id', 'member_id'],
      event_overrides: ['event_id', 'occurrence_date', 'cancelled'],
      event_rsvps: ['event_id', 'occurrence_date', 'member_id', 'answer'],
      event_task_series: ['event_id', 'list_id', 'title'],
      handoffs: ['entity', 'entity_id', 'to_member'],
      my_day_scopes: ['member_id', 'scope'],
      shopping_trips: ['list_id', 'done_at'],
    };
    // Wartości poprawne dla ograniczeń CHECK (te model pomija — pilnują ich formularze i testy SQL): kolor grupy z palety,
    // zadanie bez pary wydarzenie–dzień, wyjątek bez godziny końca bez początku, termin i osoba tylko przy zakupach.
    const special: { [k: string]: fc.Arbitrary<unknown> } = { 'groups.color': pick([null, 'blue']), 'events.start_time': pick(['10:00']), 'events.end_time': pick(['19:00']) };
    const excluded = new Set(['tasks.event_id', 'tasks.occurrence_date', 'event_overrides.end_time', 'event_overrides.start_time', 'lists.due_date', 'lists.due_time', 'lists.responsible_member_id']);
    const setFor = (e: string) => (cols: readonly string[]) =>
      fc.record(Object.fromEntries(cols.filter((c) => values[c] && !excluded.has(`${e}.${c}`)).map((c) => [c, special[`${e}.${c}`] ?? values[c]!])) as { [k: string]: fc.Arbitrary<unknown> });
    const patchable = (e: string) => SYNC_ENTITIES[e]!.patch.filter((c) => values[c] && !excluded.has(`${e}.${c}`));
    const entity = pick(Object.keys(SYNC_ENTITIES));
    const create = entity.chain((e) =>
      fc
        .record({ kind: fc.constant('create' as const), entity: fc.constant(e as Entity), id: fc.constant(id('fe')), group_id: pick([G, G, G, G2, G3]), set: setFor(e)(required[e]!) })
        // Zakres Moich spraw: id z member_id (UUIDv5) albo inny — invalid_id.
        .chain((o) => (e === 'my_day_scopes' ? fc.constantFrom(o, { ...o, id: scopeRowId(String(o.set.member_id)) }) : fc.constant(o))),
    );
    const patch = entity.chain((e) =>
      fc.record({
        kind: fc.constant('patch' as const),
        entity: fc.constant(e as Entity),
        id: pick(ids(e).length ? ids(e) : [id('ff')]),
        // Bez kolumn do zmiany (uczestnicy): pole spoza listy — invalid_field.
        set: (patchable(e).length ? fc.subarray(patchable(e), { minLength: 1, maxLength: Math.min(2, patchable(e).length) }) : fc.constant(['member_id'])).chain(setFor(e)),
      }),
    );
    const del = entity.chain((e) => fc.record({ kind: pick(['delete', 'restore'] as const), entity: fc.constant(e as Entity), id: pick(ids(e).length ? ids(e) : [id('ff')]) }));
    const op = fc.oneof(create, patch, patch, del) as fc.Arbitrary<NewOp>;
    const who = pick(Object.values(USERS));

    const mismatches: string[] = [];
    const seen = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(who, op, async (user, o) => {
        const { code: want, changed } = await sql(user, o);
        const got = serverVerdict(tables, user, o) ?? 'ok';
        seen.set(want, (seen.get(want) ?? 0) + 1);
        const who = Object.entries(USERS).find(([, u]) => u === user)![0];
        if (want !== got) return void mismatches.push(`${who} ${JSON.stringify(o)}: SQL ${want}, model ${got}`);
        if (want !== 'ok') return;
        // Skutek przyjętej operacji (applyOnServer): te same wiersze zmienione, te same wartości porównywanych kolumn.
        const model: { [e: string]: { [k: string]: Row } } = Object.fromEntries(Object.entries(tables).map(([e, rows]) => [e, { ...rows }]));
        applyOnServer(model, user, o, '2026-10-08T12:00:00Z');
        const touched = new Set(Object.keys(changed));
        for (const [e, rows] of Object.entries(model)) for (const [k, row] of Object.entries(rows)) if (row !== tables[e]?.[k]) touched.add(`${e}:${k}`);
        for (const key of touched) {
          const [e, k] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
          const a = norm(model[e]?.[k]);
          const b = norm(changed[key] ?? tables[e]?.[k]);
          const cols = Object.keys(b ?? {}).filter((c) => a && c in a);
          const pick = (x: { [c: string]: unknown } | undefined) => x && Object.fromEntries(cols.map((c) => [c, x[c]]));
          if (JSON.stringify(pick(a)) !== JSON.stringify(pick(b))) mismatches.push(`${who} ${JSON.stringify(o)}: ${key} SQL ${JSON.stringify(pick(b))}, model ${JSON.stringify(pick(a))}`);
        }
      }),
      // 2500: od P13b dwie encje więcej rozrzedzają losowanie (przy 1500 nie trafiało w deleted:list).
      { numRuns: 2500, seed: 20261008 },
    );
    expect(mismatches.slice(0, 15)).toEqual([]);
    // Generator naprawdę trafia w reguły: przyjęte i różne odrzucenia.
    for (const code of ['ok', 'forbidden', 'forbidden:child', 'not_found', 'deleted', 'deleted:group', 'deleted:list', 'forbidden:role', 'invalid_member', 'forbidden:not_self']) {
      expect([code, (seen.get(code) ?? 0) > 0]).toEqual([code, true]);
    }
  }, 120_000);
});
