/**
 * Zmiana wydarzenia na dwóch telefonach na prawdziwym serwerze (sync_push / sync_pull w Postgresie): Ala otwiera formularz
 * i zmienia samą nazwę, a w tym czasie Bartek na swoim telefonie ustawia osobę odpowiedzialną i dopisuje uczestnika.
 * Zmiany są per pole, więc po synchronizacji zostają obie — formularz Ali wysyła tylko pola, które zmieniła (editEvent
 * z polami z chwili otwarcia). Kontrola: zapis bez tych pól (dawny formularz) wysłałby też osobę z chwili otwarcia.
 * Wymaga bazy z migracjami (scripts/db/test-db.sh); bez PGHOST test jest pomijany (z CI_DB=1 — błąd, db-gate.ts).
 */
import { Client } from 'pg';

import { type ClientState, initialState, materialize, mutate, type NewOp, onPullResponse, onPushResponse, pullRequest, pushRequest } from '../../src/domain/sync-engine/client';
import { createEvent, editEvent, eventDetail, fieldsOf, participantId } from '../../src/domain/views/events';
import { parseRule } from '../../src/domain/rrule';
import { dbDescribe } from './db-gate';

const U = { ala: '00000000-0000-7000-8000-0000000003c1', bartek: '00000000-0000-7000-8000-0000000003c2' } as const;
const M = { ala: '99999999-0000-7000-8000-0000000003c1', bartek: '99999999-0000-7000-8000-0000000003c2', tymek: '99999999-0000-7000-8000-0000000003c3' } as const;
type User = keyof typeof U;
const G = '99999999-0000-7000-8000-0000000003c0';
const DATE = '2026-10-12';

dbDescribe('zmiana wydarzenia na dwóch telefonach (synchronizacja per pole)', () => {
  const db = new Client({ database: process.env.PGDATABASE ?? 'organizer_test' });
  beforeAll(() => db.connect());
  afterAll(() => db.end());

  const as = async (user: User | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? U[user] : '']);
    await db.query(user ? 'set local role authenticated' : 'reset role');
  };
  const sync = async (user: User, s: ClientState): Promise<ClientState> => {
    const req = pushRequest(s);
    await as(user);
    if (req.ops.length) {
      const res = (await db.query(`select public.sync_push($1, $2, $3::jsonb) r`, [req.client_id, req.schema_version, JSON.stringify(req.ops)])).rows[0].r;
      expect(res.results.filter((r: { status: string }) => r.status === 'rejected')).toEqual([]);
      s = onPushResponse(s, res);
    }
    for (let i = 0; i < 5; i++) {
      const p = pullRequest(s);
      const out = onPullResponse(s, (await db.query(`select public.sync_pull($1::jsonb, $2, $3, $4::jsonb) r`, [JSON.stringify(p.cursors), 1000, p.schema_version, JSON.stringify(p.entities)])).rows[0].r, p);
      s = out.state;
      if (!out.needMore) return s;
    }
    throw new Error('pobieranie się nie kończy');
  };
  let n = 0;
  const newId = () => `99999999-0000-7000-8009-${String(++n).padStart(12, '0')}`;
  const apply = (s: ClientState, ops: readonly NewOp[]) => ops.reduce((st, o) => mutate(st, o, newId), s);

  it.each([
    ['Ala pobiera zmianę Bartka przed zapisem', true],
    ['Ala zapisuje bez pobrania zmiany Bartka', false],
  ])('%s: nazwa Ali, osoba i uczestnik Bartka zostają', async (_name, pullFirst) => {
    await db.query('begin');
    try {
      await as(null);
      await db.query(`insert into auth.users (id, email) values ($1, 'a3@x.test'), ($2, 'b3@x.test')`, [U.ala, U.bartek]);
      await as('ala');
      await db.query(`select public.create_group($1, 'Rodzina', $2, 'Ala')`, [G, M.ala]);
      await as(null);
      await db.query(`insert into public.group_members (member_id, group_id, user_id, display_name) values ($1, $2, $3, 'Bartek'), ($4, $2, null, 'Tymek')`, [M.bartek, G, U.bartek, M.tymek]);
      await db.query(`update public.group_members set role = 'child' where member_id = $1`, [M.tymek]);

      let a = initialState('99999999-0000-7000-8004-0000000003c1');
      let b = initialState('99999999-0000-7000-8004-0000000003c2');
      const created = createEvent(G, { title: 'Basen', date: DATE, startTime: '17:00', endTime: '18:00', rule: parseRule('FREQ=WEEKLY;BYDAY=MO'), until: null, audience: 'members', participantIds: [M.tymek], responsibleId: null }, newId);
      a = await sync('ala', apply(a, created.ops));
      b = await sync('bartek', b);

      // Ala otwiera formularz („wszystkie”) — pola z chwili otwarcia.
      const loaded = fieldsOf(eventDetail(materialize(a), U.ala, created.id)!, DATE, 'all');
      // Bartek w tym czasie: osoba odpowiedzialna i drugi uczestnik.
      b = apply(b, [
        { kind: 'patch', entity: 'events', id: created.id, set: { responsible_member_id: M.bartek } },
        { kind: 'create', entity: 'event_participants', id: participantId(created.id, M.ala), group_id: G, set: { event_id: created.id, member_id: M.ala } },
      ]);
      b = await sync('bartek', b);
      if (pullFirst) a = await sync('ala', a);

      const d = eventDetail(materialize(a), U.ala, created.id)!;
      const mine = { ...loaded, title: 'Basen z Tymkiem' };
      // Kontrola: bez pól z chwili otwarcia zapis niesie też osobę i listę uczestników z formularza (nadpisałby Bartka).
      expect(editEvent(d, DATE, 'all', mine)[0]).toMatchObject({ set: { responsible_member_id: null } });
      a = await sync('ala', apply(a, editEvent(d, DATE, 'all', mine, loaded)));
      b = await sync('bartek', b);
      a = await sync('ala', a);

      for (const [who, s] of [['ala', a], ['bartek', b]] as const) {
        const t = materialize(s);
        expect([who, t.events![created.id]]).toMatchObject([who, { title: 'Basen z Tymkiem', responsible_member_id: M.bartek }]);
        expect([who, Object.values(t.event_participants!).filter((p) => p.deleted_at === null).map((p) => p.member_id).sort()]).toEqual([who, [M.ala, M.tymek].sort()]);
      }
      await as(null);
      expect((await db.query(`select title, responsible_member_id from public.events where id = $1`, [created.id])).rows).toEqual([{ title: 'Basen z Tymkiem', responsible_member_id: M.bartek }]);
    } finally {
      await db.query('rollback');
    }
  });
});
