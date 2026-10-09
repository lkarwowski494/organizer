/**
 * Odporność silnika synchronizacji na telefonie (audyt 2, paczka P2): telefon odtworzony z kopii iCloud (M-8), nieudane
 * pobranie udostępnionej listy (M-53), kaskada lokalnego usunięcia (M-60), grupa pobierana w całości bez znikania
 * z ekranów i potwierdzone zmiany bez „mignięcia” przy pobieraniu porcjami.
 */
import {
  adoptDevice,
  type ClientState,
  initialState,
  materialize,
  mutate,
  type NewOp,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  pullRequest,
  type PullResponse,
  pushRequest,
  rejectedCreateIds,
  rejectedDeleteIds,
} from '../sync-engine/client';
import { FakeServer } from './support/fake-server';

let n = 0;
const newId = () => `op-${++n}`;

function pullAll(server: FakeServer, user: string, s: ClientState, lim = 100): ClientState {
  for (let i = 0; ; i++) {
    if (i >= 30) throw new Error('pobieranie się nie kończy');
    const req = pullRequest(s);
    const out = onPullResponse(s, server.pull(user, req, lim), req);
    s = out.state;
    for (const sc of out.fetchScopes) s = onFetchScope(s, server.fetchScope(user, sc), sc);
    if (!out.needMore) return s;
  }
}
const push = (server: FakeServer, user: string, s: ClientState) => {
  const req = pushRequest(s);
  return onPushResponse(s, server.push(user, req), req);
};
const sync = (server: FakeServer, user: string, s: ClientState, lim = 100) => pullAll(server, user, push(server, user, s), lim);
const ops = (s: ClientState, list: NewOp[]) => list.reduce((st, o) => mutate(st, o, newId), s);
const task = (id: string, title: string, extra: object = {}): NewOp => ({ kind: 'create', entity: 'tasks', id, group_id: 'g1', set: { list_id: 'l1', title, ...extra } });
const LIST: NewOp = { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g1', set: { kind: 'tasks', name: 'Dom' } };

describe('M-8: telefon odtworzony z kopii iCloud', () => {
  it('zmiany po odtworzeniu docierają na serwer (dawniej „duplicate” i znikały)', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala']);
    let a = sync(server, 'ala', ops(initialState('stary'), [LIST]));
    // Kopia iCloud w tej chwili; potem stary telefon wysyła jeszcze dwie zmiany.
    const backup = a;
    a = sync(server, 'ala', ops(a, [task('t1', 'po kopii'), task('t2', 'też')]));
    expect(server.clients.get('stary')!.lastSeq).toBe(3);
    // Nowy iPhone z kopii: pęk kluczy pusty → nowy identyfikator.
    let r = adoptDevice(backup, null, () => 'nowy');
    expect(r.clientId).toBe('nowy');
    r = sync(server, 'ala', ops(r, [task('t3', 'NOWE po odtworzeniu')]));
    expect(r.rejected).toEqual([]);
    expect(server.tasks.get('t3')).toMatchObject({ title: 'NOWE po odtworzeniu' });
    expect(materialize(r).tasks?.t3).toMatchObject({ title: 'NOWE po odtworzeniu' });
    // Bez nowego identyfikatora ta sama zmiana zginęłaby po cichu (stan sprzed poprawki).
    const old = ops(backup, [task('t4', 'zginie')]);
    expect(server.push('ala', pushRequest(old)).results).toEqual([{ seq: 2, status: 'duplicate' }]);
  });

  it('operacje z kopii idą pod starym identyfikatorem: wysłane przez stary telefon nie wykonują się drugi raz', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala']);
    let a = sync(server, 'ala', ops(initialState('stary'), [LIST, task('t1', 'a')]));
    // Zmiana zrobiona tuż przed kopią, wysłana przez stary telefon już po kopii; druga — tylko w kopii (stary padł offline? nie: wysłał obie).
    a = ops(a, [{ kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'b' } }]);
    const backup = a;
    a = sync(server, 'ala', a);
    const applied = server.applied.get(backup.pending.at(-1)!.op_id);
    expect(applied).toBe(1);
    // Ktoś inny zmienia tytuł później; odtworzony telefon nie może go nadpisać starą zmianą z kopii.
    server.tasks.set('t1', { ...server.tasks.get('t1')!, title: 'c', version: 99 });
    let r = adoptDevice(backup, null, () => 'nowy');
    expect(r.legacy).toEqual([{ clientId: 'stary', upTo: backup.nextSeq - 1 }]);
    const req = pushRequest(r);
    expect(req.client_id).toBe('stary');
    r = onPushResponse(r, server.push('ala', req), req);
    expect(server.applied.get(backup.pending.at(-1)!.op_id)).toBe(1);
    expect(server.tasks.get('t1')!.title).toBe('c');
    expect(r.legacy).toEqual([]);
    expect(pushRequest(r)).toMatchObject({ client_id: 'nowy', ops: [] });
  });

  it('stary telefon poszedł dalej: potwierdzenie najwyżej do końca zakresu z kopii — nowe zmiany nie są uznane za przyjęte', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala']);
    let a = sync(server, 'ala', ops(initialState('stary'), [LIST]));
    a = ops(a, [task('t1', 'z kopii')]);
    const backup = a; // nextSeq 3, operacja 2 niewysłana
    a = sync(server, 'ala', ops(a, [task('t2', 'x'), task('t3', 'y'), task('t4', 'z')])); // stary: last_seq 5
    let r = adoptDevice(backup, null, () => 'nowy');
    r = ops(r, [task('t5', 'nowe')]); // numer 3 — pod nowym identyfikatorem
    const req = pushRequest(r);
    expect(req).toMatchObject({ client_id: 'stary', ops: [{ seq: 2 }] });
    const res = server.push('ala', req);
    expect(res).toMatchObject({ last_seq: 5, results: [{ seq: 2, status: 'duplicate' }] });
    r = onPushResponse(r, res, req);
    expect(r.ackedSeq).toBe(2);
    r = sync(server, 'ala', r);
    expect(server.tasks.get('t5')).toMatchObject({ title: 'nowe' });
    expect(r.pending).toEqual([]);
  });

  it('adoptDevice: ten sam identyfikator — bez zmian; bez niewysłanych — bez zakresu; kolejne odtworzenie dokłada zakres', () => {
    const s = ops(initialState('c1'), [LIST]);
    expect(adoptDevice(s, 'c1', newId)).toBe(s);
    expect(adoptDevice({ ...s, ackedSeq: 1 }, null, () => 'c2')).toMatchObject({ clientId: 'c2', legacy: [] });
    const r1 = adoptDevice(s, null, () => 'c2');
    expect(r1.legacy).toEqual([{ clientId: 'c1', upTo: 1 }]);
    // Drugie odtworzenie bez nowych zmian: zakres już jest.
    expect(adoptDevice(r1, null, () => 'c3')).toMatchObject({ clientId: 'c3', legacy: [{ clientId: 'c1', upTo: 1 }] });
    const r2 = adoptDevice(ops(r1, [task('t', 'x')]), 'inny', () => 'c3');
    expect(r2.legacy).toEqual([{ clientId: 'c1', upTo: 1 }, { clientId: 'c2', upTo: 2 }]);
    // Odpowiedź bez zapytania: instalacja następnej operacji (tu c1, zakres do 1).
    expect(onPushResponse(r2, { last_seq: 7, results: [] })).toMatchObject({ ackedSeq: 1, legacy: [{ clientId: 'c2', upTo: 2 }] });
    // Spóźniona odpowiedź instalacji, której już nie ma (ani bieżąca, ani w zakresie): nic nie potwierdza.
    expect(onPushResponse(r2, { last_seq: 7, results: [] }, { client_id: 'zgubiona' }).ackedSeq).toBe(0);
    // Bieżąca instalacja: zwykłe potwierdzenie.
    expect(onPushResponse({ ...r2, legacy: [] }, { last_seq: 2, results: [] }, { client_id: 'c3' }).ackedSeq).toBe(2);
  });
});

describe('M-53: nieudane pobranie udostępnionej listy', () => {
  it('lista czeka na pobranie (także po restarcie) i przychodzi przy następnym sync_pull', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala', 'bartek']);
    let a = sync(server, 'ala', ops(initialState('ca'), [{ kind: 'create', entity: 'lists', id: 's1', group_id: 'g1', set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } }, task('gift', 'rower', { list_id: 's1' })]));
    let b = pullAll(server, 'bartek', initialState('cb'));
    a = sync(server, 'ala', ops(a, [{ kind: 'cmd', cmd: 'grant_scope', args: { list_id: 's1', user: 'bartek' } }]));
    let req = pullRequest(b);
    let out = onPullResponse(b, server.pull('bartek', req, 100), req);
    expect(out.fetchScopes).toEqual(['s1']);
    // sync_fetch_scope się nie udaje (sieć): lista nie jest oznaczona jako pobrana.
    b = out.state;
    expect(b.scopesToFetch).toEqual(['s1']);
    req = pullRequest(b);
    out = onPullResponse(b, server.pull('bartek', req, 100), req);
    expect(out.fetchScopes).toEqual(['s1']);
    b = onFetchScope(out.state, server.fetchScope('bartek', 's1'), 's1');
    expect(b.scopesToFetch).toEqual([]);
    expect(materialize(b).tasks?.gift).toMatchObject({ title: 'rower' });
    req = pullRequest(b);
    expect(onPullResponse(b, server.pull('bartek', req, 100), req).fetchScopes).toEqual([]);
    // Dostęp cofnięty, zanim pobranie się udało: lista znika z „do pobrania”.
    const pendingFetch = { ...b, scopesToFetch: ['s1'] };
    a = sync(server, 'ala', ops(a, [{ kind: 'cmd', cmd: 'revoke_scope', args: { list_id: 's1', user: 'bartek' } }]));
    req = pullRequest(pendingFetch);
    expect(onPullResponse(pendingFetch, server.pull('bartek', req, 100), req).state.scopesToFetch).toEqual([]);
    expect(a.rejected).toEqual([]);
  });
});

describe('M-60: lokalne usunięcie kaskaduje jak na serwerze', () => {
  const base: ClientState['base'] = {
    lists: { l1: { id: 'l1', group_id: 'g1', deleted_at: null } },
    tasks: {
      remont: { id: 'remont', group_id: 'g1', list_id: 'l1', parent_id: null, deleted_at: null },
      farba: { id: 'farba', group_id: 'g1', list_id: 'l1', parent_id: 'remont', deleted_at: null },
      pędzel: { id: 'pędzel', group_id: 'g1', list_id: 'l1', parent_id: 'farba', deleted_at: null },
      wcześniej: { id: 'wcześniej', group_id: 'g1', list_id: 'l1', parent_id: 'remont', deleted_at: '2026-10-01T10:00:00Z' },
      inne: { id: 'inne', group_id: 'g1', list_id: 'l2', parent_id: null, deleted_at: null },
    },
  };
  const del = (entity: 'tasks' | 'lists', id: string): NewOp => ({ kind: 'delete', entity, id });
  const res = (entity: 'tasks' | 'lists', id: string): NewOp => ({ kind: 'restore', entity, id });
  const deleted = (s: ClientState) => Object.fromEntries(Object.entries(materialize(s).tasks!).map(([id, t]) => [id, t.deleted_at]));

  it('usunięcie zadania usuwa podzadania (rekurencyjnie), przywrócenie przywraca tylko usunięte razem z nim', () => {
    let s = ops({ ...initialState('c'), base }, [del('tasks', 'remont')]);
    const mark = `pending:${s.pending[0]!.seq}`;
    expect(deleted(s)).toEqual({ remont: mark, farba: mark, pędzel: mark, wcześniej: '2026-10-01T10:00:00Z', inne: null });
    // Drugie usunięcie: bez zmian (pierwotny znacznik).
    expect(deleted(ops(s, [del('tasks', 'remont')]))).toEqual(deleted(s));
    s = ops(s, [res('tasks', 'remont')]);
    expect(deleted(s)).toEqual({ remont: null, farba: null, pędzel: null, wcześniej: '2026-10-01T10:00:00Z', inne: null });
    // Przywrócenie żywego: bez skutku.
    expect(deleted(ops(s, [res('tasks', 'remont')]))).toEqual(deleted(s));
  });

  it('podzadanie usunięte osobno nie wraca z rodzicem; lista usuwa i przywraca swoje zadania', () => {
    let s = ops({ ...initialState('c'), base }, [del('tasks', 'farba'), del('tasks', 'remont'), res('tasks', 'remont')]);
    expect(deleted(s)).toMatchObject({ remont: null, farba: `pending:${s.pending[0]!.seq}`, pędzel: `pending:${s.pending[0]!.seq}` });
    s = ops({ ...initialState('c'), base }, [del('lists', 'l1')]);
    const mark = `pending:${s.pending[0]!.seq}`;
    expect(deleted(s)).toEqual({ remont: mark, farba: mark, pędzel: mark, wcześniej: '2026-10-01T10:00:00Z', inne: null });
    s = ops(s, [res('lists', 'l1')]);
    expect(deleted(s)).toMatchObject({ remont: null, farba: null, pędzel: null, wcześniej: '2026-10-01T10:00:00Z' });
    // Inne encje nie mają kaskady; brak tabeli zadań — nic do zrobienia.
    expect(materialize(ops({ ...initialState('c'), base: { groups: { g1: { id: 'g1', deleted_at: null } } } }, [{ kind: 'delete', entity: 'groups', id: 'g1' }])).tasks).toBeUndefined();
    expect(materialize(ops({ ...initialState('c'), base }, [{ kind: 'delete', entity: 'events', id: 'brak' }])).tasks).toEqual(base.tasks);
  });

  it('przywrócenie wiersza usuniętego na serwerze przywraca podzadania z tym samym znacznikiem (jak tasks_cascade)', () => {
    const at = '2026-10-05T08:00:00Z';
    const b2: ClientState['base'] = { tasks: { ...base.tasks, remont: { ...base.tasks!.remont!, deleted_at: at }, farba: { ...base.tasks!.farba!, deleted_at: at }, pędzel: { ...base.tasks!.pędzel!, deleted_at: at } } };
    expect(deleted(ops({ ...initialState('c'), base: b2 }, [res('tasks', 'remont')]))).toMatchObject({ remont: null, farba: null, pędzel: null, wcześniej: '2026-10-01T10:00:00Z' });
  });

  it('na serwerze w pamięci: po wysłaniu i pobraniu stan telefonu = stan serwera (lista → zadania)', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala']);
    let a = sync(server, 'ala', ops(initialState('ca'), [LIST, task('t1', 'a'), task('t2', 'b')]));
    a = ops(a, [del('lists', 'l1')]);
    expect(Object.values(materialize(a).tasks!).every((t) => t.deleted_at !== null)).toBe(true);
    a = sync(server, 'ala', a);
    expect(Object.values(materialize(a).tasks!).every((t) => t.deleted_at !== null)).toBe(true);
    a = sync(server, 'ala', ops(a, [res('lists', 'l1')]));
    expect(Object.values(materialize(a).tasks!).every((t) => t.deleted_at === null)).toBe(true);
  });
});

describe('grupa pobierana w całości i potwierdzone zmiany przy pobieraniu porcjami', () => {
  const group = (over: Partial<PullResponse['groups'][number]> = {}): PullResponse['groups'][number] => ({ group_id: 'g1', cursor: 1, has_more: false, resync: false, rows: [], ...over });
  const row = (id: string, v: number, extra: object = {}) => ({ e: 'tasks' as const, v, row: { id, group_id: 'g1', list_id: 'l1', version: v, ...extra } });

  it('potwierdzona zmiana nie znika na chwilę, gdy pierwsza porcja jeszcze nie ma jej wiersza', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala', 'bartek']);
    let a = sync(server, 'ala', ops(initialState('ca'), [LIST, task('t1', 'a'), task('t2', 'b'), task('t3', 'c')]));
    // Bartek zmienia t1 i t2 (niższe wersje), potem Ala wysyła zmianę t3 — jej wiersz przyjdzie dopiero w trzeciej porcji.
    push(server, 'bartek', ops(initialState('cb'), [{ kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'a2' } }, { kind: 'patch', entity: 'tasks', id: 't2', set: { title: 'b2' } }]));
    a = push(server, 'ala', ops(a, [{ kind: 'patch', entity: 'tasks', id: 't3', set: { title: 'nowy' } }]));
    const seen: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const req = pullRequest(a);
      const out = onPullResponse(a, server.pull('ala', req, 1), req);
      a = out.state;
      seen.push(materialize(a).tasks?.t3?.title);
      if (!out.needMore) break;
    }
    expect(seen).toEqual(['nowy', 'nowy', 'nowy']);
    expect(a.pending).toEqual([]);
  });

  it('pobranie od zera porcjami: ekran widzi stare wiersze do ostatniej porcji, potem podmiana naraz (także usunięcie zbędnych)', () => {
    let s: ClientState = { ...initialState('c'), entities: ['x'], base: { tasks: { stary: row('stary', 2).row, t1: row('t1', 3).row }, groups: { g1: { id: 'g1', version: 3 } } } };
    let req = pullRequest(s);
    expect(req.cursors).toEqual({});
    s = onPullResponse(s, { groups: [group({ cursor: 2, has_more: true, rows: [row('t1', 2, { title: 'nowy' })] })], scopes: [] }, req).state;
    expect(Object.keys(s.base.tasks!)).toEqual(['stary', 't1']);
    expect(s.base.groups?.g1).toBeDefined(); // lustro kalendarza widzi grupę (M-5)
    expect(s.cursors).toEqual({ g1: 2 });
    req = pullRequest({ ...s, entities: [...pullRequest(s).entities] });
    s = onPullResponse({ ...s, entities: [...req.entities] }, { groups: [group({ cursor: 5, rows: [row('t2', 4), { e: 'groups', v: 5, row: { id: 'g1', version: 5 } }] })], scopes: [] }, req).state;
    expect(Object.keys(s.base.tasks!).sort()).toEqual(['t1', 't2']);
    expect(s.base.tasks!.t1).toMatchObject({ title: 'nowy' });
    expect(s.base.groups?.g1).toMatchObject({ version: 5 });
    expect(s.staged).toEqual({});
  });

  it('w trakcie: utrata dostępu, zawężona lista, „gone”, ponowny resync i pobranie listy trafiają też do porcji w toku', () => {
    const start: ClientState = { ...initialState('c'), base: { tasks: { t0: row('t0', 1).row } } };
    let s = onPullResponse(start, { groups: [group({ cursor: 2, has_more: true, rows: [row('t1', 1), row('t2', 2, { list_id: 'l2' }), row('t3', 2)] }), group({ group_id: 'g2', cursor: 1, has_more: true, rows: [{ e: 'tasks', v: 1, row: { id: 'm1', group_id: 'g2', list_id: 'm', version: 1 } }] })], scopes: [] }, pullRequest(start)).state;
    expect(Object.keys(s.staged).sort()).toEqual(['g1', 'g2']);
    expect(s.base.tasks).toEqual({ t0: row('t0', 1).row });
    // g2 znika (utrata dostępu), lista l2 zawężona, t3 przeniesione poza wzrok; ukryta lista s1 pobrana osobno.
    let req = pullRequest(s);
    let out = onPullResponse(s, { groups: [group({ cursor: 3, has_more: true, lists: ['l1'], gone: ['t3', 'brak'], rows: [row('t4', 3)] })], scopes: ['s1'] }, req);
    s = out.state;
    expect(Object.keys(s.staged)).toEqual(['g1']);
    expect(Object.keys(s.staged.g1!.tasks!).sort()).toEqual(['t1', 't4']);
    s = onFetchScope(s, [{ e: 'lists', v: 1, row: { id: 's1', group_id: 'g1', version: 1 } }, { e: 'lists', v: 1, row: { id: 'x', group_id: 'g9', version: 1 } }], 's1');
    expect(s.staged.g1!.lists).toEqual({ s1: { id: 's1', group_id: 'g1', version: 1 } });
    expect(s.base.lists?.s1).toBeDefined();
    // Drugie pobranie listy w tej samej grupie dopisuje do tej samej porcji.
    s = onFetchScope(s, [{ e: 'tasks', v: 1, row: { id: 'gift', group_id: 'g1', list_id: 's1', version: 1 } }], 's1');
    expect(s.staged.g1!.tasks?.gift).toBeDefined();
    // Resync w trakcie: porcja zaczyna się od nowa.
    req = pullRequest(s);
    out = onPullResponse(s, { groups: [group({ cursor: 1, resync: true, has_more: true, rows: [row('t1', 1)] })], scopes: ['s1'] }, req);
    expect(Object.keys(out.state.staged.g1!.tasks!)).toEqual(['t1']);
    req = pullRequest(out.state);
    s = onPullResponse(out.state, { groups: [group({ cursor: 4, rows: [row('t5', 4)] })], scopes: ['s1'] }, req).state;
    expect(Object.keys(s.base.tasks!).sort()).toEqual(['t1', 't5']);
    expect(s.staged).toEqual({});
  });

  it('kolejka nie traci operacji w trakcie porcji, a schodzi po ostatniej', () => {
    let s = ops(initialState('c'), [task('t1', 'x')]);
    s = { ...s, ackedSeq: 1 };
    let req = pullRequest(s);
    s = onPullResponse(s, { groups: [group({ cursor: 1, has_more: true })], scopes: [] }, req).state;
    expect(s.pending).toHaveLength(1);
    req = pullRequest(s);
    s = onPullResponse(s, { groups: [group({ cursor: 2 })], scopes: [] }, req).state;
    expect(s.pending).toEqual([]);
  });
});

it('rejectedCreateIds: tylko odrzucone utworzenia', () => {
  const s = ops(initialState('c'), [task('a', 'x'), { kind: 'patch', entity: 'tasks', id: 'b', set: { title: 'y' } }]);
  const r = onPushResponse(s, { last_seq: 2, results: [{ seq: 1, status: 'rejected', code: 'forbidden' }, { seq: 2, status: 'rejected', code: 'not_found' }] });
  expect([...rejectedCreateIds(r)]).toEqual(['a']);
});

it('audyt 3 (N-123) rejectedDeleteIds: tylko odrzucone usunięcia', () => {
  const s = ops(initialState('c'), [task('a', 'x'), { kind: 'delete', entity: 'tasks', id: 'b' }]);
  const r = onPushResponse(s, { last_seq: 2, results: [{ seq: 1, status: 'rejected', code: 'forbidden' }, { seq: 2, status: 'rejected', code: 'forbidden:child' }] });
  expect([...rejectedDeleteIds(r)]).toEqual(['b']);
});
