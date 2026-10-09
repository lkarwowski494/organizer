/**
 * Audyt 3, PK-05: łańcuch serii na prawdziwym SQL z telefonami (silnik synchronizacji) — przekazanie całej serii przyjęte
 * po podziale (N-113), spóźnione zapisy telefonu, który jeszcze nie pobrał „to i następne” (N-23): na telefonie (zanim
 * wyśle) i na serwerze ten sam wynik — termin w części, która ma ten dzień. Wymaga bazy z migracjami
 * (scripts/db/test-db.sh); bez PGHOST pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import { Client } from 'pg';

import { splitId } from '../../src/domain/event-split';
import { type ClientState, initialState, materialize, mutate, type NewOp, onPullResponse, onPushResponse, type PullResponse, type PushResponse, pullRequest, pushRequest, type Row } from '../../src/domain/sync-engine/client';
import { createEventTask } from '../../src/domain/views/event-tasks';
import { cancelEvent, editEvent, eventDetail, expandEvents, fieldsOf } from '../../src/domain/views/events';
import { createHandoff } from '../../src/domain/views/handoffs';
import { answerOps, rsvpView } from '../../src/domain/views/rsvp';
import { dbDescribe } from './db-gate';

const U = { a: '00000000-0000-7000-8000-0000000009a1', b: '00000000-0000-7000-8000-0000000009b1' } as const;
type User = 'a' | 'b';
const id = (prefix: string, n: number) => `99999999-0000-7000-8${prefix}-${String(n).padStart(12, '0')}`;
const G = id('000', 1);
const M = { a: id('001', 1), b: id('001', 2) };
const E = id('003', 1);
const LIST = id('002', 1);
const S = splitId(E, '2026-11-02');

dbDescribe('łańcuch serii z telefonami (SQL)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());
  const as = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  const client = (user: User) => id('009', user === 'a' ? 1 : 2);
  const seqs: Record<string, number> = {};
  const push = async (user: User, ops: NewOp[]): Promise<PushResponse> => {
    const numbered = ops.map((o) => ({ ...o, seq: (seqs[client(user)] = (seqs[client(user)] ?? 0) + 1), op_id: id('00a', (seqs.op = (seqs.op ?? 0) + 1)) }));
    await as(user);
    return (await db.query(`select public.sync_push($1, 1, $2::jsonb) r`, [client(user), JSON.stringify(numbered)])).rows[0].r;
  };
  const ok = async (user: User, ops: NewOp[]) => {
    const res = await push(user, ops);
    expect(res.results.filter((r) => r.status === 'rejected')).toEqual([]);
  };
  async function pull(user: User, from: ClientState): Promise<ClientState> {
    let s = from;
    for (let i = 0; i < 50; i++) {
      const req = pullRequest(s);
      await as(user);
      const res: PullResponse = (await db.query(`select public.sync_pull($1::jsonb, $2, $3, $4::jsonb) r`, [JSON.stringify(req.cursors), 1000, req.schema_version, JSON.stringify(req.entities)])).rows[0].r;
      const out = onPullResponse(s, res, req);
      s = out.state;
      if (!out.needMore) break;
    }
    return s;
  }
  const phone = (user: User) => pull(user, { ...initialState(client(user)), ackedSeq: seqs[client(user)] ?? 0, nextSeq: (seqs[client(user)] ?? 0) + 1 });
  async function family() {
    for (const k of Object.keys(seqs)) delete seqs[k];
    await as(null);
    await db.query(`insert into auth.users (id, email) values ($1, 'a9@x.test'), ($2, 'b9@x.test')`, [U.a, U.b]);
    await as('a');
    await db.query(`select public.create_group($1, 'Rodzina', $2, 'A')`, [G, M.a]);
    await as(null);
    await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name, role) values ($1, $2, $3, 'B', 'member')`, [M.b, G, U.b]);
    await ok('a', [
      { kind: 'create', entity: 'lists', id: LIST, group_id: G, set: { kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0' } },
      { kind: 'create', entity: 'events', id: E, group_id: G, set: { title: 'Chór', start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: M.a } },
    ]);
  }
  const tx = (f: () => Promise<void>) => async () => {
    await db.query('begin');
    try {
      await f();
    } finally {
      await db.query('rollback');
    }
  };
  /** B: „od 2.11 o 18:00” (ten i następne). */
  async function splitByB() {
    const tb = materialize(await phone('b'));
    const d = eventDetail(tb, U.b, E)!;
    const f = fieldsOf(d, '2026-11-02', 'following');
    await ok('b', editEvent(d, '2026-11-02', 'following', { ...f, startTime: '18:00', endTime: '19:00' }, f));
  }
  const responsible = async (date: string) => {
    await as(null);
    const r = await db.query(
      `select private.occurrence_responsible(e, $1::date) who from public.events e where e.group_id = $2 and e.deleted_at is null
         and e.start_date <= $1::date and coalesce(private.rrule_until(e.rrule), $1::date) >= $1::date`,
      [date, G],
    );
    return r.rows.map((x) => x.who);
  };

  it('N-113: przekazanie całej serii, potem „to i następne” od 2.11, potem przyjęcie — B odpowiada za 26.10 i 9.11', tx(async () => {
    await family();
    await ok('a', [createHandoff({ id: id('00e', 1), groupId: G, entity: 'events', entityId: E, toMember: M.b })]);
    await splitByB();
    await ok('b', [{ kind: 'patch', entity: 'handoffs', id: id('00e', 1), set: { status: 'accepted' } }]);
    expect(await responsible('2026-10-26')).toEqual([M.b]);
    expect(await responsible('2026-11-09')).toEqual([M.b]);
  }));

  /**
   * Telefon A pobrał serię przed podziałem i offline zapisuje terminy od 2.11; potem pobiera podział (zapisy dalej czekają
   * w kolejce) — widzi je już w nowej części; po wysłaniu serwer ma to samo.
   */
  it('N-23: „nie będę”, „odwołaj tylko ten”, zadanie i przekazanie terminu z telefonu bez podziału trafiają do nowej części', tx(async () => {
    await family();
    let sa = await phone('a');
    const stale = materialize(sa);
    const ops: NewOp[] = [
      ...answerOps(stale, { groupId: G, eventId: E, date: '2026-11-09', memberId: M.a, answer: 'no' }),
      ...cancelEvent(eventDetail(stale, U.a, E)!, '2026-11-16', 'this'),
      createEventTask({ id: id('00d', 1), groupId: G, listId: LIST, eventId: E, occurrenceDate: '2026-11-23', title: 'Strój' }),
      createHandoff({ id: id('00e', 2), groupId: G, entity: 'events', entityId: E, occurrenceDate: '2026-11-30', toMember: M.b }),
    ];
    let n = 0;
    for (const op of ops) sa = mutate(sa, op, () => id('00f', ++n));
    await splitByB();
    sa = await pull('a', sa);
    const local = materialize(sa);
    expect(rsvpView(local, U.a, S, '2026-11-09')!.people.find((p) => p.me)!.answer).toBe('no');
    expect(expandEvents(local, U.a, { y: 2026, m: 11, d: 16 }, { y: 2026, m: 11, d: 16 })).toEqual([]);
    expect([local.tasks![id('00d', 1)]!.event_id, local.handoffs![id('00e', 2)]!.entity_id]).toEqual([S, S]);
    const res = await push('a', pushRequest(sa).ops as never);
    expect(res.results.map((r) => r.status)).toEqual(ops.map(() => 'ok'));
    const server = materialize(await pull('a', onPushResponse(sa, res)));
    const pick = (t: { [e: string]: { [k: string]: Row } }) => ({
      rsvp: Object.values(t.event_rsvps ?? {}).map((r) => [r.event_id, r.occurrence_date, r.answer]),
      overrides: Object.values(t.event_overrides ?? {}).map((o) => [o.event_id, o.occurrence_date, o.cancelled]),
      task: t.tasks![id('00d', 1)]!.event_id,
      handoff: t.handoffs![id('00e', 2)]!.entity_id,
    });
    expect(pick(server)).toEqual(pick(local));
    expect(pick(server).rsvp).toEqual([[S, '2026-11-09', 'no']]);
    expect(pick(server).overrides).toEqual([[S, '2026-11-16', true]]);
  }));
});
