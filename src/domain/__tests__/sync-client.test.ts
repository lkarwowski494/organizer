/**
 * Scenariusze klienta synchronizacji krok po kroku (uzupełnienie symulacji losowej).
 */
import {
  clearRejected,
  ENTITIES,
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
  stapleCmdResult,
  type ClientState,
  type PullResponse,
} from '../sync-engine/client';
import { FakeServer } from './support/fake-server';

let n = 0;
const newId = () => `op-${++n}`;

function setup() {
  const server = new FakeServer();
  server.addGroup('g1', ['ala', 'bartek']);
  return { server, a: initialState('ca'), b: initialState('cb') };
}

/** Wysyłka i pobieranie aż do końca; pobieranie, które się nie kończy, to błąd (audyt 2, M-49). */
function syncAll(server: FakeServer, user: string, s: ClientState, lim = 100): ClientState {
  let st = onPushResponse(s, server.push(user, pushRequest(s)));
  for (let i = 0; ; i++) {
    if (i >= 20) throw new Error('pobieranie się nie kończy');
    const req = pullRequest(st);
    const out = onPullResponse(st, server.pull(user, req, lim), req);
    st = out.state;
    for (const sc of out.fetchScopes) st = onFetchScope(st, server.fetchScope(user, sc), sc);
    if (!out.needMore) return st;
  }
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

  it('utrata dostępu do ukrytej listy usuwa też jej stałe zadania serii (zakres = lista)', () => {
    let st = onPullResponse(initialState('c'), { groups: [{ group_id: 'g1', cursor: 2, has_more: false, resync: false, rows: [
      { e: 'event_task_series', v: 1, row: { id: 's1', group_id: 'g1', list_id: 'l1', event_id: 'e1' } },
      { e: 'event_task_series', v: 2, row: { id: 's2', group_id: 'g1', list_id: 'l2', event_id: 'e1' } },
    ] }], scopes: ['l1'] }, pullRequest(initialState('c'))).state;
    st = onPullResponse(st, { groups: [{ group_id: 'g1', cursor: 2, has_more: false, resync: false, rows: [] }], scopes: [] }, pullRequest(st)).state;
    expect(Object.keys(st.base.event_task_series ?? {})).toEqual(['s2']);
  });

  it('wyścig: pobranie rozpoczęte przed potwierdzeniem wysyłki nie cofa zmiany na ekranie', () => {
    const { server } = setup();
    let { a } = setup();
    a = syncAll(server, 'ala', mutate(a, { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g1', set: { kind: 'tasks', name: 'Dom' } }, newId));
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 't1', group_id: 'g1', set: { list_id: 'l1', title: 'mleko' } }, newId);
    const pull = pullRequest(a); // pobranie wychodzi pierwsze…
    const pullRes = server.pull('ala', pull, 100);
    a = onPushResponse(a, server.push('ala', pushRequest(a))); // …a potwierdzenie wysyłki przychodzi przed jego odpowiedzią
    a = onPullResponse(a, pullRes, pull).state;
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
    ] }], scopes: [] }, pullRequest(a)).state;
    a = onPullResponse(a, { groups: [{ group_id: 'g1', cursor: 9, has_more: false, resync: true, rows: [
      { e: 'tasks', v: 9, row: { id: 'kept', group_id: 'g1', list_id: 'l1' } },
    ] }], scopes: [] }, pullRequest(a)).state;
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
    // „Wyczyść listę” (D190): lista pusta; pusta zostaje tym samym stanem.
    const cleared = clearRejected(a);
    expect(cleared.rejected).toEqual([]);
    expect(clearRejected(cleared)).toBe(cleared);
  });

  it('paczka ograniczona do PUSH_BATCH_MAX i bez potwierdzonych operacji', () => {
    let a = initialState('ca');
    for (let i = 0; i < 150; i++) a = mutate(a, { kind: 'patch', entity: 'tasks', id: 't', set: { note: String(i) } }, newId);
    expect(pushRequest(a).ops).toHaveLength(100);
    a = onPushResponse(a, { last_seq: 120, results: [] });
    expect(pushRequest(a).ops.map((o) => o.seq)).toEqual(Array.from({ length: 30 }, (_, i) => 121 + i));
    expect(pendingCount(a)).toBe(30);
    expect(pushRequest(a)).toMatchObject({ client_id: 'ca', schema_version: 2 });
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
    // Znacznik lokalnego usunięcia z numerem operacji (kaskada odróżnia dwa usunięcia, M-60).
    expect(materialize(a).tasks).toEqual({ t: { title: 'b', id: 't', group_id: 'g', deleted_at: `pending:${a.pending.find((o) => o.kind === 'delete' && o.id === 't')!.seq}` } });
    op({ kind: 'restore', entity: 'tasks', id: 't' });
    expect(materialize(a).tasks?.t?.deleted_at).toBeNull();
  });

  it('audyt 2 (M-111): stałe zakupy jako polecenia — skutek od razu na telefonie, jak na serwerze', () => {
    let a: ClientState = { ...initialState('ca'), base: { lists: { l: { id: 'l', group_id: 'g', staples: ['Mleko', 7], deleted_at: null }, z: { id: 'z', group_id: 'g', deleted_at: 'x' } } } };
    const op = (o: Parameters<typeof mutate>[1]) => (a = mutate(a, o, newId));
    op({ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'l', name: 'Chleb' } });
    op({ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'l', name: 'Mleko' } }); // już jest — bez dubla
    expect(materialize(a).lists?.l?.staples).toEqual(['Mleko', 'Chleb']);
    op({ kind: 'cmd', cmd: 'staple_remove', args: { list_id: 'l', names: ['Mleko', 'brak'] } });
    expect(materialize(a).lists?.l?.staples).toEqual(['Chleb']);
    // Lista usunięta albo nieznana: bez skutku; inne polecenia: skutek tylko na serwerze.
    op({ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'z', name: 'Chleb' } });
    op({ kind: 'cmd', cmd: 'staple_add', args: { list_id: 'brak', name: 'Chleb' } });
    op({ kind: 'cmd', cmd: 'move_task', args: { id: 't', parent_id: null, list_id: 'l' } });
    expect(materialize(a).lists).toEqual({ l: { id: 'l', group_id: 'g', staples: ['Chleb'], deleted_at: null }, z: { id: 'z', group_id: 'g', deleted_at: 'x' } });
    expect(stapleCmdResult({}, { cmd: 'staple_add', args: { name: 'Woda' } })).toEqual(['Woda']);
    expect(stapleCmdResult({ staples: ['Woda'] }, { cmd: 'grant_scope', args: {} })).toBeNull();
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
    ] }], scopes: ['l'] }, pullRequest(a)).state;
    const out = onPullResponse(a, { groups: [{ group_id: 'g', cursor: 3, has_more: false, resync: false, rows: [] }], scopes: [] }, pullRequest(a));
    expect(out.needMore).toBe(false);
    // Utrata zakresu „l”: znika jego lista dozwolonych i aktywność; grupa, członkowie i aktywność grupowa zostają.
    expect(Object.keys(out.state.base.object_members ?? {})).toEqual([]);
    expect(Object.keys(out.state.base.activity ?? {})).toEqual(['a2']);
    expect(Object.keys(out.state.base.group_members ?? {})).toEqual(['m']);
    expect(onFetchScope(initialState('x'), [{ e: 'lists', v: 1, row: { id: 'l', group_id: 'g' } }], 'l').base.lists).toEqual({ l: { id: 'l', group_id: 'g' } });
  });

  it('stan początkowy jest pusty', () => {
    expect(initialState('c1')).toEqual({ clientId: 'c1', nextSeq: 1, ackedSeq: 0, base: {}, pending: [], cursors: {}, purged: {}, entities: [], scopes: [], scopesToFetch: [], rejected: [], staged: {}, legacy: [] });
  });

  it('udane i powtórzone operacje nie trafiają do odrzuconych', () => {
    let a = mutate(initialState('ca'), { kind: 'patch', entity: 'tasks', id: 't', set: { title: 'x' } }, newId);
    a = mutate(a, { kind: 'patch', entity: 'tasks', id: 't', set: { title: 'y' } }, newId);
    a = onPushResponse(a, { last_seq: 2, results: [{ seq: 1, status: 'ok' }, { seq: 2, status: 'duplicate' }] });
    expect(a.rejected).toEqual([]);
  });

  it('kilka grup: „pobierz więcej”, gdy którakolwiek ma has_more; znane zakresy nie są pobierane ponownie', () => {
    const g = (group_id: string, has_more: boolean) => ({ group_id, cursor: 1, has_more, resync: false, rows: [] });
    let out = onPullResponse(initialState('c'), { groups: [g('g1', false), g('g2', true)], scopes: ['s1'] }, pullRequest(initialState('c')));
    expect(out.needMore).toBe(true);
    expect(out.fetchScopes).toEqual(['s1']);
    const fetched = onFetchScope(out.state, [], 's1');
    out = onPullResponse(fetched, { groups: [g('g1', false), g('g2', false)], scopes: ['s1', 's2'] }, pullRequest(fetched));
    expect(out.needMore).toBe(false);
    expect(out.fetchScopes).toEqual(['s2']);
  });

  it('utrata grupy usuwa także wiersz samej grupy', () => {
    let a = onPullResponse(initialState('c'), { groups: [{ group_id: 'g1', cursor: 1, has_more: false, resync: false,
      rows: [{ e: 'groups', v: 1, row: { id: 'g1', version: 1 } }] }], scopes: [] }, pullRequest(initialState('c'))).state;
    expect(Object.keys(a.base.groups ?? {})).toEqual(['g1']);
    // Kolejne pobranie bez zmian: grupa nadal widoczna, jej wiersz zostaje.
    a = onPullResponse(a, { groups: [{ group_id: 'g1', cursor: 1, has_more: false, resync: false, rows: [] }], scopes: [] }, pullRequest(a)).state;
    expect(Object.keys(a.base.groups ?? {})).toEqual(['g1']);
    a = onPullResponse(a, { groups: [], scopes: [] }, pullRequest(a)).state;
    expect(a.base.groups).toEqual({});
    expect(a.cursors).toEqual({});
  });
});

describe('protokół 2 (audyt 2): epoka kursora, pobranie od zera, listy widoczne, przeniesienia', () => {
  const group = (over: Partial<PullResponse['groups'][number]> = {}): PullResponse['groups'][number] => ({ group_id: 'g1', cursor: 1, has_more: false, resync: false, rows: [], ...over });
  const task = (id: string, v: number, list = 'l1') => ({ e: 'tasks' as const, v, row: { id, group_id: 'g1', list_id: list, version: v } });

  it('M-1: po czyszczeniu kosza duża grupa pobiera się porcjami do końca (resync tylko raz)', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala', 'bartek']);
    let a = mutate(initialState('ca'), { kind: 'create', entity: 'lists', id: 'l1', group_id: 'g1', set: { kind: 'tasks', name: 'Dom' } }, newId);
    for (let i = 0; i < 12; i++) a = mutate(a, { kind: 'create', entity: 'tasks', id: `t${i}`, group_id: 'g1', set: { list_id: 'l1', title: `${i}` } }, newId);
    a = mutate(a, { kind: 'delete', entity: 'tasks', id: 't0' }, newId);
    a = syncAll(server, 'ala', a);
    // Bartek pobiera porcjami po 2 — w połowie serwer czyści kosz (t0); potem dalej tylko porcje, bez pętli.
    let b = initialState('cb');
    let req = pullRequest(b);
    b = onPullResponse(b, server.pull('bartek', req, 2), req).state;
    expect(server.purge(server.now() + 1)).toBe(1);
    const resyncs: boolean[] = [];
    for (let i = 0; ; i++) {
      if (i >= 15) throw new Error('pobieranie się nie kończy');
      req = pullRequest(b);
      const res = server.pull('bartek', req, 2);
      resyncs.push(res.groups[0]!.resync);
      const out = onPullResponse(b, res, req);
      b = out.state;
      if (!out.needMore) break;
    }
    // Pierwsza porcja po czyszczeniu: resync (epoka się zmieniła); dalej żadnej.
    expect(resyncs[0]).toBe(true);
    expect(resyncs.slice(1).every((r) => !r)).toBe(true);
    expect(Object.keys(b.base.tasks ?? {}).sort()).toEqual(server.visibleRows('bartek').tasks.map((t) => String(t.id)).sort());
    expect(b.base.tasks?.t0).toBeUndefined();
    expect(b.purged.g1).toBe(server.groups.get('g1')!.purged);
  });

  it('M-1: zapytanie niesie kursor z epoką (brak epoki = 0), wersję protokołu i encje', () => {
    const s = { ...initialState('c'), cursors: { g1: 7, g2: 3 }, purged: { g1: 5 }, entities: [...ENTITIES] };
    expect(pullRequest(s)).toEqual({ cursors: { g1: { v: 7, p: 5 }, g2: { v: 3, p: 0 } }, ackedAtStart: 0, schema_version: 2, entities: ENTITIES });
  });

  it('M-1: odpowiedź zapamiętuje epokę; bez pola zostaje poprzednia; grupa, której już nie widzę, traci ją', () => {
    let s: ClientState = { ...initialState('c'), entities: [...ENTITIES] };
    s = onPullResponse(s, { groups: [group({ purged: 4 }), group({ group_id: 'g2', purged: 9 })], scopes: [] }, pullRequest(s)).state;
    expect(s.purged).toEqual({ g1: 4, g2: 9 });
    s = onPullResponse(s, { groups: [group({ cursor: 2 })], scopes: [] }, pullRequest(s)).state;
    expect(s.purged).toEqual({ g1: 4 });
    s = onPullResponse(s, { groups: [group({ group_id: 'g3' })], scopes: [] }, pullRequest(s)).state;
    expect(s.purged).toEqual({});
  });

  it('M-49: resync porcjami — druga porcja zachowuje wiersze pierwszej', () => {
    let s: ClientState = { ...initialState('c'), entities: [...ENTITIES] };
    s = onPullResponse(s, { groups: [group({ cursor: 5, rows: [task('stary', 2), task('t1', 5)] })], scopes: [] }, pullRequest(s)).state;
    s = onPullResponse(s, { groups: [group({ cursor: 3, has_more: true, resync: true, purged: 4, rows: [task('t1', 3)] })], scopes: [] }, pullRequest(s)).state;
    // Do ostatniej porcji ekran widzi dotychczasowe wiersze (P2); porcja czeka obok.
    expect(Object.keys(s.base.tasks ?? {})).toEqual(['stary', 't1']);
    expect(s.base.tasks?.t1?.version).toBe(5);
    expect(Object.keys(s.staged.g1?.tasks ?? {})).toEqual(['t1']);
    const req = pullRequest(s);
    expect(req.cursors).toEqual({ g1: { v: 3, p: 4 } });
    s = onPullResponse(s, { groups: [group({ cursor: 6, purged: 4, rows: [task('t2', 6)] })], scopes: [] }, req).state;
    expect(Object.keys(s.base.tasks ?? {}).sort()).toEqual(['t1', 't2']);
    expect(s.staged).toEqual({});
  });

  it('M-176: pobranie od zera (kursor wyzerowany, np. migracja v5) czyści wiersze grupy, których serwer już nie ma', () => {
    // Wiersze sprzed wyzerowania kursorów, grupa bez kursora: odpowiedź od zera zastępuje całą grupę.
    const s: ClientState = { ...initialState('c'), entities: [...ENTITIES], base: { tasks: { stary: task('stary', 2).row, t1: task('t1', 3).row }, lists: { l1: { id: 'l1', group_id: 'g1' } } } };
    const out = onPullResponse(s, { groups: [group({ cursor: 3, rows: [task('t1', 3)] })], scopes: [] }, pullRequest(s));
    expect(Object.keys(out.state.base.tasks ?? {})).toEqual(['t1']);
    expect(out.state.base.lists).toEqual({});
  });

  it('M-176 na serwerze w pamięci: kursory wyzerowane, zanim telefon dowiedział się o przeniesieniu — pobranie od zera nie zostawia zadania', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala', 'bartek']);
    let a = mutate(initialState('ca'), { kind: 'create', entity: 'lists', id: 'dom', group_id: 'g1', set: { kind: 'tasks', name: 'Dom', visibility: 'group' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'lists', id: 'moje', group_id: 'g1', set: { kind: 'tasks', name: 'Tylko ja', visibility: 'private' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 'test', group_id: 'g1', set: { list_id: 'dom', title: 'Kupić test' } }, newId);
    a = syncAll(server, 'ala', a);
    let b = syncAll(server, 'bartek', initialState('cb'));
    expect(Object.keys(b.base.tasks ?? {})).toEqual(['test']);
    a = syncAll(server, 'ala', mutate(a, { kind: 'cmd', cmd: 'move_task', args: { id: 'test', list_id: 'moje' } }, newId));
    expect(a.base.tasks?.test).toMatchObject({ list_id: 'moje' });
    // Lokalna migracja zeruje kursory (jak v5): pobranie od zera nie niesie „gone” — zadanie znika, bo grupa jest czyszczona.
    b = syncAll(server, 'bartek', { ...b, cursors: {} });
    expect(b.base.tasks ?? {}).toEqual({});
  });

  it('M-58: aplikacja zna nową encję — kursory jej nie obejmują, więc pobiera wszystko od zera (i czyści)', () => {
    const old: ClientState = { ...initialState('c'), cursors: { g1: 9 }, purged: { g1: 2 }, entities: ENTITIES.filter((e) => e !== 'event_rsvps'), base: { tasks: { stary: task('stary', 2).row } } };
    const req = pullRequest(old);
    expect(req.cursors).toEqual({});
    const out = onPullResponse(old, { groups: [group({ cursor: 9, rows: [task('t1', 9)] })], scopes: [] }, req);
    expect(Object.keys(out.state.base.tasks ?? {})).toEqual(['t1']);
    expect(out.state.entities).toEqual([...ENTITIES]);
    expect(pullRequest(out.state).cursors).toEqual({ g1: { v: 9, p: 2 } });
  });

  it('M-54: lista spoza zbioru widocznych (zawężona) znika z zadaniami, stałymi zadaniami, aktywnością i wpisami dostępu', () => {
    let s: ClientState = { ...initialState('c'), entities: [...ENTITIES] };
    s = onPullResponse(s, { groups: [group({ cursor: 6, lists: ['l1', 'l2'], rows: [
      { e: 'lists', v: 1, row: { id: 'l1', group_id: 'g1' } },
      { e: 'lists', v: 2, row: { id: 'l2', group_id: 'g1' } },
      task('t1', 3), task('t2', 4, 'l2'),
      { e: 'event_task_series', v: 5, row: { id: 's2', group_id: 'g1', list_id: 'l2' } },
      { e: 'activity', v: 6, row: { id: 'a2', group_id: 'g1', scope_id: 'l2' } },
      { e: 'object_members', v: 6, row: { scope_id: 'l2', member_id: 'm', group_id: 'g1' } },
      { e: 'activity', v: 6, row: { id: 'a0', group_id: 'g1', scope_id: null } },
    ] })], scopes: [] }, pullRequest(s)).state;
    s = onPullResponse(s, { groups: [group({ cursor: 7, lists: ['l1'] })], scopes: [] }, pullRequest(s)).state;
    expect(Object.keys(s.base.lists ?? {})).toEqual(['l1']);
    expect(Object.keys(s.base.tasks ?? {})).toEqual(['t1']);
    expect(s.base.event_task_series).toEqual({});
    expect(Object.keys(s.base.activity ?? {})).toEqual(['a0']);
    expect(s.base.object_members).toEqual({});
    // Bez pola „lists” (stary serwer) nic nie znika.
    s = onPullResponse(s, { groups: [group({ cursor: 7 })], scopes: [] }, pullRequest(s)).state;
    expect(Object.keys(s.base.lists ?? {})).toEqual(['l1']);
  });

  it('M-54: zadanie przeniesione do listy, której nie widzę, znika; wraca, gdy w tej samej odpowiedzi jest jego nowy wiersz', () => {
    let s: ClientState = { ...initialState('c'), entities: [...ENTITIES] };
    s = onPullResponse(s, { groups: [group({ cursor: 3, rows: [task('t1', 2), task('t2', 3)] })], scopes: [] }, pullRequest(s)).state;
    s = onPullResponse(s, { groups: [group({ cursor: 5, gone: ['t1', 'nieznane'] })], scopes: [] }, pullRequest(s)).state;
    expect(Object.keys(s.base.tasks ?? {})).toEqual(['t2']);
    s = onPullResponse(s, { groups: [group({ cursor: 7, gone: ['t2'], rows: [task('t2', 7, 'l3')] })], scopes: [] }, pullRequest(s)).state;
    expect(s.base.tasks?.t2).toMatchObject({ list_id: 'l3' });
    // Odpowiedź bez tabeli zadań u telefonu: nic do usunięcia.
    expect(onPullResponse(initialState('x'), { groups: [group({ gone: ['t9'] })], scopes: [] }, pullRequest(initialState('x'))).state.base).toEqual({});
  });

  it('M-54 na serwerze w pamięci: zawężenie listy i przeniesienie do ukrytej listy docierają do osób bez dostępu', () => {
    const server = new FakeServer();
    server.addGroup('g1', ['ala', 'bartek']);
    let a = mutate(initialState('ca'), { kind: 'create', entity: 'lists', id: 'prezenty', group_id: 'g1', set: { kind: 'tasks', name: 'Prezenty', visibility: 'group' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'lists', id: 'dom', group_id: 'g1', set: { kind: 'tasks', name: 'Dom', visibility: 'group' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 'rower', group_id: 'g1', set: { list_id: 'prezenty', title: 'Rower dla Bartka' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'tasks', id: 'test', group_id: 'g1', set: { list_id: 'dom', title: 'Kupić test' } }, newId);
    a = mutate(a, { kind: 'create', entity: 'lists', id: 'moje', group_id: 'g1', set: { kind: 'tasks', name: 'Tylko ja', visibility: 'private' } }, newId);
    a = syncAll(server, 'ala', a);
    let b = syncAll(server, 'bartek', initialState('cb'));
    expect(Object.keys(b.base.tasks ?? {}).sort()).toEqual(['rower', 'test']);
    a = mutate(a, { kind: 'patch', entity: 'lists', id: 'prezenty', set: { visibility: 'private' } }, newId);
    a = mutate(a, { kind: 'cmd', cmd: 'move_task', args: { id: 'test', list_id: 'moje' } }, newId);
    a = syncAll(server, 'ala', a);
    expect(a.rejected).toEqual([]);
    b = syncAll(server, 'bartek', b, 1);
    expect(b.base.tasks ?? {}).toEqual({});
    expect(Object.keys(b.base.lists ?? {})).toEqual(['dom']);
    expect(Object.keys(a.base.tasks ?? {}).sort()).toEqual(['rower', 'test']);
  });
});
