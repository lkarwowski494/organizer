/**
 * Scenariusze klienta synchronizacji krok po kroku (uzupełnienie symulacji losowej).
 */
import {
  initialState,
  materialize,
  mutate,
  onFetchScope,
  onPullResponse,
  onPushResponse,
  pendingCount,
  pullRequest,
  pushRequest,
  rowKey,
  type ClientState,
} from '../sync-engine/client';
import { FakeServer } from './support/fake-server';

let n = 0;
const newId = () => `op-${++n}`;

function setup() {
  const server = new FakeServer();
  server.addGroup('g1', ['ala', 'bartek']);
  return { server, a: initialState('ca'), b: initialState('cb') };
}

function syncAll(server: FakeServer, user: string, s: ClientState): ClientState {
  let st = onPushResponse(s, server.push(user, pushRequest(s)));
  for (let i = 0; i < 20; i++) {
    const req = pullRequest(st);
    const out = onPullResponse(st, server.pull(user, req.cursors, 100), req.ackedAtStart);
    st = out.state;
    for (const sc of out.fetchScopes) st = onFetchScope(st, server.fetchScope(user, sc));
    if (!out.needMore) break;
  }
  return st;
}

describe('klient synchronizacji — scenariusze', () => {
  it('cofnięcie dostępu do ukrytej listy usuwa jej wiersze z telefonu', () => {
    const { server } = setup();
    let { a, b } = setup();
    a = mutate(a, { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g1', set: { kind: 'tasks', name: 'Prezenty', visibility: 'restricted' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 't1', group_id: 'g1', set: { list_id: 'l1', title: 'rower' } }, newId);
    a = mutate(a, { kind: 'cmd', cmd: 'grant_scope', args: { list_id: 'l1', user: 'bartek' } }, newId);
    a = syncAll(server, 'ala', a);
    b = syncAll(server, 'bartek', b);
    expect(Object.keys(materialize(b).tasks ?? {})).toEqual(['t1']);
    a = mutate(a, { kind: 'cmd', cmd: 'revoke_scope', args: { list_id: 'l1', user: 'bartek' } }, newId);
    a = syncAll(server, 'ala', a);
    expect(a.pending).toHaveLength(0);
    b = syncAll(server, 'bartek', b);
    expect(materialize(b).tasks ?? {}).toEqual({});
    expect(materialize(b).lists ?? {}).toEqual({});
    expect(b.scopes).toEqual([]);
  });

  it('wyścig: pobranie rozpoczęte przed potwierdzeniem wysyłki nie cofa zmiany na ekranie', () => {
    const { server } = setup();
    let { a } = setup();
    a = syncAll(server, 'ala', mutate(a, { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g1', set: { kind: 'tasks', name: 'Dom' } }, newId));
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 't1', group_id: 'g1', set: { list_id: 'l1', title: 'mleko' } }, newId);
    const pull = pullRequest(a); // pobranie wychodzi pierwsze…
    const pullRes = server.pull('ala', pull.cursors, 100);
    a = onPushResponse(a, server.push('ala', pushRequest(a))); // …a potwierdzenie wysyłki przychodzi przed jego odpowiedzią
    a = onPullResponse(a, pullRes, pull.ackedAtStart).state;
    expect(materialize(a).tasks?.t1?.title).toBe('mleko'); // nadal widać, choć tej odpowiedzi brakuje zadania
    expect(pendingCount(a)).toBe(0); // i nie czeka na ponowną wysyłkę
    a = syncAll(server, 'ala', a);
    expect(a.pending).toHaveLength(0);
    expect(a.base.tasks?.t1?.title).toBe('mleko');
  });

  it('resync: grupa pobierana od zera, stare lokalne wiersze znikają', () => {
    let a = initialState('ca');
    a = onPullResponse(a, { groups: [{ group_id: 'g1', cursor: 5, has_more: false, resync: false, rows: [
      { e: 'tasks', v: 4, row: { id: 'old', group_id: 'g1', list_id: 'l1' } },
      { e: 'tasks', v: 5, row: { id: 'kept', group_id: 'g1', list_id: 'l1' } },
    ] }], scopes: [] }, 0).state;
    a = onPullResponse(a, { groups: [{ group_id: 'g1', cursor: 9, has_more: false, resync: true, rows: [
      { e: 'tasks', v: 9, row: { id: 'kept', group_id: 'g1', list_id: 'l1' } },
    ] }], scopes: [] }, 0).state;
    expect(Object.keys(a.base.tasks ?? {})).toEqual(['kept']);
    expect(a.cursors).toEqual({ g1: 9 });
  });

  it('odrzucenie zapisane raz, nawet gdy serwer potwierdzi je ponownie', () => {
    let a = mutate(initialState('ca'), { kind: 'patch', entity: 'tasks', id: 'nope', set: { title: 'x' } }, newId);
    const res = { last_seq: 1, results: [{ seq: 1, status: 'rejected' as const, code: 'not_found' }] };
    a = onPushResponse(onPushResponse(a, res), res);
    expect(a.rejected.map((r) => r.code)).toEqual(['not_found']);
    a = onPushResponse(a, { last_seq: 1, results: [{ seq: 1, status: 'rejected' }, { seq: 99, status: 'rejected', code: 'x' }] });
    expect(a.rejected).toHaveLength(1); // seq 99 nie jest z tej kolejki
    a = onPushResponse(mutate(a, { kind: 'patch', entity: 'tasks', id: 'n2', set: {} }, newId), { last_seq: 2, results: [{ seq: 2, status: 'rejected' }] });
    expect(a.rejected[1]!.code).toBe('unknown');
  });

  it('paczka ograniczona do PUSH_BATCH_MAX i bez potwierdzonych operacji', () => {
    let a = initialState('ca');
    for (let i = 0; i < 150; i++) a = mutate(a, { kind: 'patch', entity: 'tasks', id: 't', set: { note: String(i) } }, newId);
    expect(pushRequest(a).ops).toHaveLength(100);
    a = onPushResponse(a, { last_seq: 120, results: [] });
    expect(pushRequest(a).ops.map((o) => o.seq)).toEqual(Array.from({ length: 30 }, (_, i) => 121 + i));
    expect(pendingCount(a)).toBe(30);
    expect(pushRequest(a)).toMatchObject({ client_id: 'ca', schema_version: 1 });
  });

  it('lokalne zastosowanie operacji zgodne z serwerem', () => {
    let a = initialState('ca');
    const op = (o: Parameters<typeof mutate>[1]) => (a = mutate(a, o, newId));
    op({ kind: 'patch', entity: 'tasks', id: 'none', set: { title: 'x' } }); // brak wiersza: bez skutku
    op({ kind: 'delete', entity: 'tasks', id: 'none' });
    op({ kind: 'restore', entity: 'tasks', id: 'none' });
    op({ kind: 'create', entity: 'tasks', id: 't', group_id: 'g', set: { title: 'a' } });
    op({ kind: 'create', entity: 'tasks', id: 't', group_id: 'g', set: { title: 'DUP' } }); // powtórne utworzenie: bez skutku
    expect(materialize(a).tasks?.t?.title).toBe('a');
    op({ kind: 'restore', entity: 'tasks', id: 't' }); // nieusunięte: bez skutku
    op({ kind: 'patch', entity: 'tasks', id: 't', set: { title: 'b' } });
    op({ kind: 'delete', entity: 'tasks', id: 't' });
    op({ kind: 'patch', entity: 'tasks', id: 't', set: { title: 'po usunięciu' } }); // usunięcie wygrywa
    op({ kind: 'delete', entity: 'tasks', id: 't' }); // już usunięte
    op({ kind: 'cmd', cmd: 'grant_scope', args: {} }); // komenda: skutek tylko na serwerze
    expect(Object.keys(materialize(a))).toEqual(['tasks']);
    expect(materialize(a).tasks).toEqual({ t: { title: 'b', id: 't', group_id: 'g', deleted_at: 'pending' } });
    op({ kind: 'restore', entity: 'tasks', id: 't' });
    expect(materialize(a).tasks?.t?.deleted_at).toBeNull();
  });

  it('klucze wierszy i zakresy wszystkich encji', () => {
    expect(rowKey('group_members', { member_id: 'm' })).toBe('m');
    expect(rowKey('object_members', { scope_id: 'l', member_id: 'm' })).toBe('l:m');
    expect(rowKey('groups', { id: 'g' })).toBe('g');
    let a = initialState('ca');
    a = onPullResponse(a, { groups: [{ group_id: 'g', cursor: 3, has_more: true, resync: false, rows: [
      { e: 'groups', v: 1, row: { id: 'g' } },
      { e: 'group_members', v: 1, row: { member_id: 'm', group_id: 'g' } },
      { e: 'object_members', v: 2, row: { scope_id: 'l', member_id: 'm', group_id: 'g' } },
      { e: 'activity', v: 2, row: { id: 'a1', group_id: 'g', scope_id: 'l' } },
      { e: 'activity', v: 3, row: { id: 'a2', group_id: 'g', scope_id: null } },
    ] }], scopes: ['l'] }, 0).state;
    const out = onPullResponse(a, { groups: [{ group_id: 'g', cursor: 3, has_more: false, resync: false, rows: [] }], scopes: [] }, 0);
    expect(out.needMore).toBe(false);
    // Utrata zakresu „l”: znika jego lista dozwolonych i aktywność; grupa, członkowie i aktywność grupowa zostają.
    expect(Object.keys(out.state.base.object_members ?? {})).toEqual([]);
    expect(Object.keys(out.state.base.activity ?? {})).toEqual(['a2']);
    expect(Object.keys(out.state.base.group_members ?? {})).toEqual(['m']);
    expect(onFetchScope(initialState('x'), [{ e: 'lists', v: 1, row: { id: 'l', group_id: 'g' } }]).base.lists).toEqual({ l: { id: 'l', group_id: 'g' } });
  });

  it('stan początkowy jest pusty', () => {
    expect(initialState('c1')).toEqual({ clientId: 'c1', nextSeq: 1, ackedSeq: 0, base: {}, pending: [], cursors: {}, scopes: [], rejected: [] });
  });

  it('udane i powtórzone operacje nie trafiają do odrzuconych', () => {
    let a = mutate(initialState('ca'), { kind: 'patch', entity: 'tasks', id: 't', set: { title: 'x' } }, newId);
    a = mutate(a, { kind: 'patch', entity: 'tasks', id: 't', set: { title: 'y' } }, newId);
    a = onPushResponse(a, { last_seq: 2, results: [{ seq: 1, status: 'ok' }, { seq: 2, status: 'duplicate' }] });
    expect(a.rejected).toEqual([]);
  });

  it('kilka grup: „pobierz więcej”, gdy którakolwiek ma has_more; znane zakresy nie są pobierane ponownie', () => {
    const g = (group_id: string, has_more: boolean) => ({ group_id, cursor: 1, has_more, resync: false, rows: [] });
    let out = onPullResponse(initialState('c'), { groups: [g('g1', false), g('g2', true)], scopes: ['s1'] }, 0);
    expect(out.needMore).toBe(true);
    expect(out.fetchScopes).toEqual(['s1']);
    out = onPullResponse(out.state, { groups: [g('g1', false), g('g2', false)], scopes: ['s1', 's2'] }, 0);
    expect(out.needMore).toBe(false);
    expect(out.fetchScopes).toEqual(['s2']);
  });

  it('utrata grupy usuwa także wiersz samej grupy', () => {
    let a = onPullResponse(initialState('c'), { groups: [{ group_id: 'g1', cursor: 1, has_more: false, resync: false,
      rows: [{ e: 'groups', v: 1, row: { id: 'g1', version: 1 } }] }], scopes: [] }, 0).state;
    expect(Object.keys(a.base.groups ?? {})).toEqual(['g1']);
    // Kolejne pobranie bez zmian: grupa nadal widoczna, jej wiersz zostaje.
    a = onPullResponse(a, { groups: [{ group_id: 'g1', cursor: 1, has_more: false, resync: false, rows: [] }], scopes: [] }, 0).state;
    expect(Object.keys(a.base.groups ?? {})).toEqual(['g1']);
    a = onPullResponse(a, { groups: [], scopes: [] }, 0).state;
    expect(a.base.groups).toEqual({});
    expect(a.cursors).toEqual({});
  });
});
