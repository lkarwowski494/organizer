/**
 * „To i następne” na telefonie i na serwerze (audyt 2, M-3): ten sam algorytm podziału serii jest w dwóch językach —
 * src/domain/event-split.ts (lokalny skutek polecenia, TypeScript) i private.split_event (SQL, migracja
 * 20261008320000_event_split). Losowa seria z wyjątkami (także w koszu), obecnością dorosłych i dziecka, przekazaniami,
 * zadaniami (także zrobionymi), stałym zadaniem i uczestnikami; czasem już podzielona wcześniej (łańcuch); losowy podział
 * zbudowany tak jak w aplikacji (editEvent → podgląd skutków → seriesEditOps), także ze „starego” widoku (seria, która
 * kończy się przed tym dniem). Stan telefonu tuż po poleceniu (przed wysłaniem) = stan serwera po poleceniu.
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import * as fc from 'fast-check';
import { Client } from 'pg';

import { splitId } from '../../src/domain/event-split';
import { parseRule } from '../../src/domain/rrule';
import { type ClientState, initialState, materialize, mutate, type NewOp, onPullResponse, onPushResponse, type PullResponse, type PushResponse, pullRequest, pushRequest, type Row } from '../../src/domain/sync-engine/client';
import { seriesEditEffects, seriesEditOps } from '../../src/domain/views/event-tasks';
import { cancelEvent, editEvent, eventDetail, fieldsOf } from '../../src/domain/views/events';
import { dbDescribe } from './db-gate';

const d = dbDescribe;

const U = { a: '00000000-0000-7000-8000-0000000008a1', b: '00000000-0000-7000-8000-0000000008b1', r: '00000000-0000-7000-8000-0000000008c1' } as const;
type User = 'a' | 'b';
const id = (prefix: string, n: number) => `88888888-0000-7000-8${prefix}-${String(n).padStart(12, '0')}`;
const G = id('000', 1);
const M = { a: id('001', 1), b: id('001', 2), kuba: id('001', 3), r: id('001', 4) };
const LIST = id('002', 1);
const E = id('003', 1);
const DEF = id('004', 1);
const MONDAYS = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'];

type Scenario = {
  overrides: { date: string; kind: 'cancel' | 'title' | 'time' | 'resp' | 'trash' }[];
  rsvps: { date: string; who: 'a' | 'b' | 'kuba' }[];
  handoff: string | null;
  tasks: { date: string; done: boolean; copy: boolean }[];
  pre: string | null;
  stale: boolean;
  date: string;
  days: string;
  time: string;
  responsible: 'a' | 'b' | 'kuba' | 'r' | null;
  participants: ('b' | 'kuba' | 'r')[];
  lost: 'nearest' | 'unlink';
};
const scenario: fc.Arbitrary<Scenario> = fc.record({
  overrides: fc.uniqueArray(fc.record({ date: fc.constantFrom(...MONDAYS), kind: fc.constantFrom('cancel' as const, 'title' as const, 'time' as const, 'resp' as const, 'trash' as const) }), { selector: (o) => o.date, maxLength: 5 }),
  rsvps: fc.uniqueArray(fc.record({ date: fc.constantFrom(...MONDAYS), who: fc.constantFrom('a' as const, 'b' as const, 'kuba' as const) }), { selector: (r) => `${r.date}|${r.who}`, maxLength: 6 }),
  handoff: fc.option(fc.constantFrom(...MONDAYS, 'series'), { nil: null }),
  tasks: fc.array(fc.record({ date: fc.constantFrom(...MONDAYS), done: fc.boolean(), copy: fc.boolean() }), { maxLength: 5 }),
  pre: fc.option(fc.constantFrom(...MONDAYS), { nil: null }),
  stale: fc.boolean(),
  date: fc.constantFrom(...MONDAYS),
  days: fc.constantFrom('MO', 'MO,WE', 'TU'),
  time: fc.constantFrom('17:00', '18:30'),
  responsible: fc.constantFrom('a' as const, 'b' as const, 'kuba' as const, 'r' as const, null),
  participants: fc.uniqueArray(fc.constantFrom('b' as const, 'kuba' as const, 'r' as const), { maxLength: 3 }),
  lost: fc.constantFrom('nearest' as const, 'unlink' as const),
});

const hhmm = (v: unknown) => (v == null ? null : String(v).slice(0, 5));
const gone = (r: Row) => r.deleted_at != null;
/** Pola, które podział zmienia albo powinien zachować — bez kolumn serwerowych (wersja, autor, czasy). */
const PROJECT: { [e: string]: (r: Row) => Row } = {
  events: (r) => ({ title: r.title, start_date: r.start_date, start_time: hhmm(r.start_time), end_time: hhmm(r.end_time), rrule: r.rrule, audience: r.audience, responsible_member_id: r.responsible_member_id ?? null, location: r.location ?? null, kind: r.kind ?? 'event', note: r.note ?? null, split_from: r.split_from ?? null, gone: gone(r) }),
  event_overrides: (r) => ({ event_id: r.event_id, occurrence_date: r.occurrence_date, cancelled: r.cancelled === true, title: r.title ?? null, start_time: hhmm(r.start_time), responsible_member_id: r.responsible_member_id ?? null, gone: gone(r) }),
  event_rsvps: (r) => ({ event_id: r.event_id, occurrence_date: r.occurrence_date, member_id: r.member_id, answer: r.answer, gone: gone(r) }),
  handoffs: (r) => ({ entity: r.entity, entity_id: r.entity_id, occurrence_date: r.occurrence_date ?? null, status: r.status }),
  tasks: (r) => ({ event_id: r.event_id ?? null, occurrence_date: r.occurrence_date ?? null, deadline_mode: r.deadline_mode, done: r.completed_at != null, gone: gone(r) }),
  event_task_series: (r) => ({ event_id: r.event_id, gone: gone(r) }),
  event_participants: (r) => ({ event_id: r.event_id, member_id: r.member_id, gone: gone(r) }),
};
const project = (t: { [e: string]: { [k: string]: Row } }) =>
  Object.fromEntries(Object.entries(PROJECT).map(([e, f]) => [e, Object.fromEntries(Object.entries(t[e] ?? {}).filter(([, r]) => r.group_id === G).sort(([x], [y]) => x.localeCompare(y)).map(([k, r]) => [k, f(r)]))]));

d('„to i następne”: telefon (TypeScript) = serwer (SQL)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const as = async (user: keyof typeof U | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  const seqs: Record<string, number> = {};
  const push = async (user: User, ops: NewOp[]): Promise<PushResponse> => {
    const client = id('009', user === 'a' ? 1 : 2);
    const numbered = ops.map((o) => ({ ...o, seq: (seqs[client] = (seqs[client] ?? 0) + 1), op_id: id('00a', (seqs.op = (seqs.op ?? 0) + 1)) }));
    await as(user);
    return (await db.query(`select public.sync_push($1, 1, $2::jsonb) r`, [client, JSON.stringify(numbered)])).rows[0].r;
  };
  const ok = async (user: User, ops: NewOp[]) => {
    const res = await push(user, ops);
    expect(res.results.filter((r) => r.status === 'rejected')).toEqual([]);
  };
  /** Jedno pobranie (protokół v2: kursory, wersja schematu i encje telefonu). */
  const pullOnce = async (st: ClientState, user: User) => {
    const req = pullRequest(st);
    await as(user);
    const res: PullResponse = (await db.query(`select public.sync_pull($1::jsonb, $2, $3, $4::jsonb) r`, [JSON.stringify(req.cursors), 1000, req.schema_version, JSON.stringify(req.entities)])).rows[0].r;
    return onPullResponse(st, res, req);
  };
  /** Grupa G: A (właściciel), B, Kuba (profil dziecka), R. */
  async function family() {
    await as(null);
    await db.query(`insert into auth.users (id, email) values ($1, 'a@x.test'), ($2, 'b@x.test'), ($3, 'r@x.test')`, [U.a, U.b, U.r]);
    await as('a');
    await db.query(`select public.create_group($1, 'Rodzina', $2, 'A')`, [G, M.a]);
    await as(null);
    await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name, role) values ($1, $4, $5, 'B', 'member'), ($2, $4, null, 'Kuba', 'child'), ($3, $4, $6, 'R', 'member')`, [M.b, M.kuba, M.r, G, U.b, U.r]);
  }
  /** Telefon (domyślnie B): pełne pobranie od zera. */
  async function phone(user: User = 'b'): Promise<ClientState> {
    const client = id('009', user === 'a' ? 1 : 2);
    let s = initialState(client);
    s = { ...s, ackedSeq: seqs[client] ?? 0, nextSeq: (seqs[client] ?? 0) + 1 };
    for (let i = 0; i < 50; i++) {
      const out = await pullOnce(s, user);
      s = out.state;
      if (!out.needMore) break;
    }
    return s;
  }

  it('ten sam wynik dla losowych serii i podziałów', async () => {
    const seen = { split: 0, chain: 0, moved: 0, decisions: 0 };
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        await db.query('begin');
        for (const k of Object.keys(seqs)) delete seqs[k];
        try {
          await family();
          let n = 0;
          const fresh = (p: string) => id(p, ++n);
          const seed: NewOp[] = [
            { kind: 'create', entity: 'lists', id: LIST, group_id: G, set: { kind: 'tasks', name: 'Dom', visibility: 'group', sort_key: 'a0' } },
            { kind: 'create', entity: 'events', id: E, group_id: G, set: { title: 'Chór', note: 'Nuty', start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group', responsible_member_id: M.a } },
            { kind: 'create', entity: 'event_task_series', id: DEF, group_id: G, set: { event_id: E, list_id: LIST, title: 'Nuty' } },
          ];
          for (const o of sc.overrides) {
            const oid = fresh('00b');
            const set = o.kind === 'cancel' ? { cancelled: true } : o.kind === 'title' ? { title: 'Próba' } : o.kind === 'time' ? { start_time: '16:00', end_time: '17:00' } : { responsible_member_id: M.b };
            seed.push({ kind: 'create', entity: 'event_overrides', id: oid, group_id: G, set: { event_id: E, occurrence_date: o.date, ...(o.kind === 'trash' ? { title: 'Stare' } : set) } });
            if (o.kind === 'trash') seed.push({ kind: 'delete', entity: 'event_overrides', id: oid });
          }
          for (const r of sc.rsvps.filter((x) => x.who !== 'b')) seed.push({ kind: 'create', entity: 'event_rsvps', id: fresh('00c'), group_id: G, set: { event_id: E, occurrence_date: r.date, member_id: M[r.who], answer: 'no' } });
          for (const k of sc.tasks) seed.push({ kind: 'create', entity: 'tasks', id: fresh('00d'), group_id: G, set: { list_id: LIST, title: 'Zadanie', sort_key: 'a0', deadline_mode: 'event', event_id: E, occurrence_date: k.date, ...(k.copy ? { series_id: DEF } : {}), ...(k.done ? { completed_at: '2026-10-08T10:00:00Z' } : {}) } });
          // Przekazanie od A — tylko termin, za który A odpowiada.
          const handoffDate = sc.handoff === 'series' ? null : sc.handoff;
          if (sc.handoff !== null && !sc.overrides.some((o) => o.date === handoffDate && o.kind === 'resp')) {
            seed.push({ kind: 'create', entity: 'handoffs', id: fresh('00e'), group_id: G, set: { entity: 'events', entity_id: E, occurrence_date: handoffDate, to_member: M.b } });
          }
          await ok('a', seed);
          const own = sc.rsvps.filter((x) => x.who === 'b').map((r): NewOp => ({ kind: 'create', entity: 'event_rsvps', id: fresh('00c'), group_id: G, set: { event_id: E, occurrence_date: r.date, member_id: M.b, answer: 'yes' } }));
          if (own.length) await ok('b', own);
          // Wcześniejszy podział (drugi telefon): łańcuch.
          if (sc.pre !== null) {
            const s0 = await phone();
            const t0 = materialize(s0);
            const d0 = eventDetail(t0, U.b, E)!;
            const ops0 = editEvent(d0, sc.pre, 'following', { ...fieldsOf(d0, sc.pre, 'following'), startTime: '19:00', endTime: null });
            await ok('a', ops0);
            seen.chain += 1;
          }
          // R wychodzi z grupy (B miał ją jeszcze w formularzu).
          await as(null);
          await db.query(`update public.group_members set deleted_at = now() where member_id = $1`, [M.r]);

          const s = await phone();
          const t = materialize(s);
          // Telefon zmienia termin z serii, która go ma, albo (widok „stary”) z pierwszej serii.
          const owner = Object.values(t.events ?? {}).find((e) => e.deleted_at == null && String(e.start_date) <= sc.date && (e.rrule as string).split(';').every((p) => !p.startsWith('UNTIL=') || p.slice(6) >= sc.date.replaceAll('-', '')));
          const target = sc.stale || !owner ? E : String(owner.id);
          const det = eventDetail(t, U.b, target)!;
          if (sc.date <= det.event.start_date) return; // od pierwszego wystąpienia to zmiana całej serii, nie podział
          const f = {
            ...fieldsOf(det, sc.date, 'following'),
            startTime: sc.time,
            endTime: null,
            rule: parseRule(`FREQ=WEEKLY;BYDAY=${sc.days}`),
            responsibleId: sc.responsible === null ? null : M[sc.responsible],
            audience: sc.participants.length ? ('members' as const) : ('group' as const),
            participantIds: sc.participants.map((p) => M[p]),
          };
          const draft = editEvent(det, sc.date, 'following', f);
          const ops = seriesEditOps(det, draft, seriesEditEffects(t, det, sc.date, 'following', draft), sc.lost);
          expect(ops).toHaveLength(1);
          const cmd = ops[0]!;
          seen.decisions += cmd.kind === 'cmd' ? (cmd.args.tasks as unknown[]).length : 0;
          let after = s;
          for (const op of ops) after = mutate(after, op, () => id('00f', ++n));
          const local = project(materialize(after));
          const res = await push('b', pushRequest(after).ops as never);
          expect(res.results.map((r) => r.status)).toEqual(['ok']);
          const back = onPushResponse(after, res);
          const server = project(materialize(await (async () => {
            let st = back;
            for (let i = 0; i < 50; i++) {
              const out = await pullOnce(st, 'b');
              st = out.state;
              if (!out.needMore) break;
            }
            expect(st.pending).toHaveLength(0);
            return st;
          })()));
          expect(local).toEqual(server);
          seen.split += 1;
          const sid = splitId(target, sc.date);
          if (local.events?.[sid]) seen.moved += Object.values(local.event_overrides ?? {}).filter((o) => o.event_id === sid).length;
        } finally {
          await db.query('rollback');
        }
      }),
      { numRuns: 60 },
    );
    // Przebiegi mają sens tylko wtedy, gdy naprawdę dzielą, budują łańcuchy, przenoszą wyjątki i podejmują decyzje.
    expect(seen.split).toBeGreaterThan(20);
    expect(seen.chain).toBeGreaterThan(5);
    expect(seen.moved).toBeGreaterThan(0);
    expect(seen.decisions).toBeGreaterThan(0);
  }, 240_000);

  it('M-11 (S-8): dwa telefony zmieniają ten sam termin i dopisują tę samą osobę — bez odrzuceń, zmiany scalone', async () => {
    await db.query('begin');
    for (const k of Object.keys(seqs)) delete seqs[k];
    try {
      await family();
      await ok('a', [{ kind: 'create', entity: 'events', id: E, group_id: G, set: { title: 'Basen', start_date: '2026-10-05', start_time: '17:00', end_time: '18:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', audience: 'group' } }]);
      // Oba telefony mają ten sam stan, potem każdy offline zmienia termin 19.10 i uczestników.
      const [ta, tb] = [materialize(await phone('a')), materialize(await phone('b'))];
      const [da, dbb] = [eventDetail(ta, U.a, E)!, eventDetail(tb, U.b, E)!];
      const kuba = (d: typeof da) => editEvent(d, '2026-10-12', 'all', { ...fieldsOf(d, '2026-10-12', 'all'), audience: 'members', participantIds: [M.kuba] });
      await ok('a', [...cancelEvent(da, '2026-10-19', 'this'), ...kuba(da)]);
      await ok('b', [...editEvent(dbb, '2026-10-19', 'this', { ...fieldsOf(dbb, '2026-10-19', 'this'), startTime: '16:00', endTime: '17:00' }), ...kuba(dbb)]);
      await as(null);
      const o = await db.query(`select cancelled, start_time::text from public.event_overrides where event_id = $1`, [E]);
      expect(o.rows).toEqual([{ cancelled: true, start_time: '16:00:00' }]);
      const p = await db.query(`select member_id from public.event_participants where event_id = $1 and deleted_at is null`, [E]);
      expect(p.rows).toEqual([{ member_id: M.kuba }]);
    } finally {
      await db.query('rollback');
    }
  });
});
