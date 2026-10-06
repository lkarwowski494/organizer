/**
 * Symulacja wielu telefonów z zawodną siecią (architektura: „symulator synchronizacji”).
 * fast-check losuje przeplot: lokalne zmiany, wysyłki (dostarczone / zgubione żądanie / zgubiona
 * odpowiedź / odpowiedź z opóźnieniem), pobrania (także spóźnione), udostępnianie i cofanie list,
 * usuwanie członków. Potem sieć „zdrowieje” i sprawdzamy własności:
 *  - zbieżność: każdy telefon widzi dokładnie to, co serwer mu pokazuje (po RLS),
 *  - nic nie ginie: każda operacja jest zastosowana albo jawnie odrzucona,
 *  - idempotencja: żadna operacja nie została zastosowana dwa razy,
 *  - utrata dostępu: brak lokalnych wierszy z grup/list bez dostępu.
 */
import * as fc from 'fast-check';

import {
  type ClientState,
  initialState,
  materialize,
  mutate,
  type NewOp,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  type PullResponse,
  pullRequest,
  type PushResponse,
  pushRequest,
} from '../sync-engine/client';
import { FakeServer } from './support/fake-server';

const USERS = ['ala', 'bartek', 'celina'] as const;
const GROUP = 'g1';
const LISTS = ['l1', 'l2', 'l3'];
const TASKS = ['t1', 't2', 't3', 't4'];

type Phone = {
  user: string;
  state: ClientState;
  inflightPush?: { res?: PushResponse };
  inflightPull?: { res: PullResponse; ackedAtStart: number };
};

type Cmd =
  | { t: 'mutate'; who: number; op: NewOp }
  | { t: 'push'; who: number; fate: 'ok' | 'lostRequest' | 'lostResponse' | 'delayed' }
  | { t: 'deliverPush'; who: number }
  | { t: 'pull'; who: number; lim: number; fate: 'ok' | 'lost' | 'delayed' }
  | { t: 'deliverPull'; who: number }
  | { t: 'removeMember'; who: number }
  // Polecenia złożone: od razu wysłane (sieć działa), żeby scenariusze udostępniania nie były rzadkością.
  | { t: 'share'; who: number; other: number; list: string; grant: boolean };

const who = fc.integer({ min: 0, max: USERS.length - 1 });
const listId = fc.constantFrom(...LISTS);
const taskId = fc.constantFrom(...TASKS);

const opArb: fc.Arbitrary<NewOp> = fc.oneof(
  fc.record({
    kind: fc.constant('create' as const), entity: fc.constant('lists' as const), id: listId, group_id: fc.constant(GROUP),
    set: fc.record({ kind: fc.constant('tasks'), name: fc.constantFrom('Dom', 'Prezenty'), visibility: fc.constantFrom('group', 'restricted') }),
  }),
  fc.record({
    kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: taskId, group_id: fc.constant(GROUP),
    set: fc.record({ list_id: listId, title: fc.constantFrom('a', 'b') }),
  }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: taskId, set: fc.record({ title: fc.constantFrom('x', 'y', 'z') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: taskId, set: fc.record({ note: fc.constantFrom('n1', 'n2') }) }),
  fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: listId, set: fc.record({ name: fc.constantFrom('A', 'B') }) }),
  fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constantFrom('lists' as const, 'tasks' as const), id: fc.constantFrom(...LISTS, ...TASKS) }),
  fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constantFrom('grant_scope', 'revoke_scope'), args: fc.record({ list_id: listId, user: fc.constantFrom(...USERS) }) }),
) as fc.Arbitrary<NewOp>;

// Udostępnianie ukrytych list wymaga właściciela listy, więc osobno częstsze komendy od każdej osoby.
const scopeOpArb: fc.Arbitrary<NewOp> = fc.record({
  kind: fc.constant('cmd' as const), cmd: fc.constantFrom('grant_scope', 'revoke_scope'),
  args: fc.record({ list_id: listId, user: fc.constantFrom(...USERS) }),
}) as fc.Arbitrary<NewOp>;
const restrictedListArb: fc.Arbitrary<NewOp> = fc.record({
  kind: fc.constant('create' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS, 's1', 's2'), group_id: fc.constant(GROUP),
  set: fc.record({ kind: fc.constant('tasks'), name: fc.constant('Prezenty'), visibility: fc.constant('restricted') }),
}) as fc.Arbitrary<NewOp>;

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant('mutate' as const), who, op: opArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('mutate' as const), who, op: scopeOpArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('mutate' as const), who, op: restrictedListArb }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('push' as const), who, fate: fc.constantFrom('ok' as const, 'lostRequest' as const, 'lostResponse' as const, 'delayed' as const) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('deliverPush' as const), who }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('pull' as const), who, lim: fc.integer({ min: 1, max: 6 }), fate: fc.constantFrom('ok' as const, 'lost' as const, 'delayed' as const) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('deliverPull' as const), who }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('removeMember' as const), who: fc.integer({ min: 1, max: USERS.length - 1 }) }) },
  {
    weight: 4,
    arbitrary: fc
      .record({ who, shift: fc.integer({ min: 1, max: USERS.length - 1 }), list: fc.constantFrom('s1', 's2'), grant: fc.boolean() })
      // Odbiorca zawsze inny niż właściciel; osobne listy, żeby nie kolidowały ze zwykłymi.
      .map(({ who: w, shift, list, grant }) => ({ t: 'share' as const, who: w, other: (w + shift) % USERS.length, list, grant })),
  },
);

function run(cmds: Cmd[]) {
  const server = new FakeServer();
  server.addGroup(GROUP, [...USERS]);
  let n = 0;
  const newId = () => `op-${++n}`;
  const phones: Phone[] = USERS.map((user, i) => ({ user, state: initialState(`client-${i}`) }));
  const allOps = new Set<string>();

  const applyPull = (p: Phone, res: PullResponse, ackedAtStart: number, snapshot?: ReturnType<FakeServer['visibleRows']>) => {
    const out = onPullResponse(p.state, res, ackedAtStart);
    p.state = out.state;
    for (const s of out.fetchScopes) p.state = onFetchScope(p.state, server.fetchScope(p.user, s));
    // Niezmiennik po każdym pełnym pobraniu na świeżo: stan potwierdzony = to, co serwer pokazywał w tej chwili
    // (łapie m.in. pozostawione wiersze list, do których cofnięto dostęp, i dziury w kursorach).
    if (snapshot && !out.needMore) {
      expect(p.state.base.lists ?? {}).toEqual(byId(snapshot.lists));
      expect(p.state.base.tasks ?? {}).toEqual(byId(snapshot.tasks));
    }
    return out.needMore;
  };

  for (const c of cmds) {
    const p = phones[c.who]!;
    switch (c.t) {
      case 'mutate':
        p.state = mutate(p.state, c.op, newId);
        allOps.add(p.state.pending[p.state.pending.length - 1]!.op_id);
        break;
      case 'push': {
        if (p.inflightPush) break; // jedna wysyłka naraz na telefon
        const req = pushRequest(p.state);
        if (c.fate === 'lostRequest') break;
        const res = server.push(p.user, req);
        if (c.fate === 'ok') p.state = onPushResponse(p.state, res);
        if (c.fate === 'delayed') p.inflightPush = { res };
        break; // lostResponse: serwer zapisał, telefon nic nie wie — ponowi te same operacje
      }
      case 'deliverPush':
        if (p.inflightPush?.res) p.state = onPushResponse(p.state, p.inflightPush.res);
        p.inflightPush = undefined;
        break;
      case 'pull': {
        if (p.inflightPull) break; // jedno pobranie naraz na telefon
        const req = pullRequest(p.state);
        const res = server.pull(p.user, req.cursors, c.lim);
        if (c.fate === 'ok') applyPull(p, res, req.ackedAtStart, server.visibleRows(p.user));
        if (c.fate === 'delayed') p.inflightPull = { res, ackedAtStart: req.ackedAtStart };
        break;
      }
      case 'deliverPull':
        if (p.inflightPull) applyPull(p, p.inflightPull.res, p.inflightPull.ackedAtStart);
        p.inflightPull = undefined;
        break;
      case 'removeMember':
        server.removeMember(GROUP, p.user);
        break;
      case 'share': {
        // Właściciel tworzy ukrytą listę (jeśli jej nie ma) i udostępnia / cofa dostęp; od razu wysyła.
        const ops: NewOp[] = [
          { kind: 'create', entity: 'lists', id: c.list, group_id: GROUP, set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } },
          { kind: 'create', entity: 'tasks', id: `${c.list}-gift`, group_id: GROUP, set: { list_id: c.list, title: 'prezent' } },
          { kind: 'cmd', cmd: c.grant ? 'grant_scope' : 'revoke_scope', args: { list_id: c.list, user: USERS[c.other]! } },
        ];
        for (const op of ops) {
          p.state = mutate(p.state, op, newId);
          allOps.add(p.state.pending[p.state.pending.length - 1]!.op_id);
        }
        if (!p.inflightPush) p.state = onPushResponse(p.state, server.push(p.user, pushRequest(p.state)));
        break;
      }
    }
  }

  // Sieć zdrowieje: spóźnione odpowiedzi docierają, potem rundy push/pull aż do ciszy.
  for (const p of phones) {
    if (p.inflightPush?.res) p.state = onPushResponse(p.state, p.inflightPush.res);
    if (p.inflightPull) applyPull(p, p.inflightPull.res, p.inflightPull.ackedAtStart);
  }
  for (let round = 0; round < 3; round++) {
    for (const p of phones) {
      for (let i = 0; i < 50 && pushRequest(p.state).ops.length > 0; i++) {
        p.state = onPushResponse(p.state, server.push(p.user, pushRequest(p.state)));
      }
    }
    for (const p of phones) {
      for (let i = 0; i < 200; i++) {
        const req = pullRequest(p.state);
        const res = server.pull(p.user, req.cursors, 3);
        if (!applyPull(p, res, req.ackedAtStart, server.visibleRows(p.user))) break;
      }
    }
  }
  return { server, phones, allOps };
}

const byId = (rows: readonly { [k: string]: unknown }[]) => Object.fromEntries(rows.map((r) => [String(r.id), r]));

describe('symulacja synchronizacji (wiele telefonów, zawodna sieć)', () => {
  it('zbieżność, nic nie ginie, bez podwójnego zastosowania, czyszczenie po utracie dostępu', () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 20, maxLength: 80 }), (cmds) => {
        const { server, phones, allOps } = run(cmds);
        for (const p of phones) {
          const view = materialize(p.state);
          const visible = server.visibleRows(p.user);
          // Zbieżność: po ciszy w kolejce nic nie czeka, a widok = to, co serwer pokazuje.
          expect(p.state.pending).toHaveLength(0);
          expect(view.lists ?? {}).toEqual(byId(visible.lists));
          expect(view.tasks ?? {}).toEqual(byId(visible.tasks));
          // Utrata dostępu: telefon osoby usuniętej z grupy nie ma już żadnych jej wierszy.
          if (!server.groups.get(GROUP)!.members.has(p.user)) {
            expect(Object.keys(view.lists ?? {})).toHaveLength(0);
            expect(Object.keys(view.tasks ?? {})).toHaveLength(0);
          }
        }
        for (const id of allOps) {
          // Nic nie ginie: każda operacja zastosowana albo odrzucona — i nigdy dwa razy.
          const applied = server.applied.get(id) ?? 0;
          expect(applied <= 1).toBe(true);
          expect(applied === 1 || server.rejectedOps.has(id)).toBe(true);
        }
      }),
      { numRuns: 800 },
    );
  });
});
