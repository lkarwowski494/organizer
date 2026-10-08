/**
 * Symulacja wielu telefonów z zawodną siecią (architektura: „symulator synchronizacji”).
 * fast-check losuje przeplot: lokalne zmiany, wysyłki (dostarczone / zgubione żądanie / zgubiona
 * odpowiedź / odpowiedź z opóźnieniem), pobrania (także spóźnione), udostępnianie i cofanie list, zmianę widoczności
 * listy i przeniesienie zadania (M-54), role i ich zmianę (dziecko tylko odhacza), usuwanie i powrót członków,
 * nocne czyszczenie kosza z resync (M-1, M-4) i ponowne uruchomienie telefonu (stan z SQLite). Potem sieć „zdrowieje”
 * i sprawdzamy własności:
 *  - zbieżność: każdy telefon widzi dokładnie to, co serwer mu pokazuje (po RLS); wolno zostać tylko nagrobkom
 *    wierszy, które serwer już wyczyścił (telefon widział usunięcie, więc nic nie pokazuje),
 *  - nic nie ginie: każda operacja jest zastosowana albo jawnie odrzucona — i każde odrzucenie jest w „Odrzuconych
 *    zmianach” telefonu, który ją wysłał, także po zgubionej odpowiedzi (M-56),
 *  - idempotencja: żadna operacja nie została zastosowana dwa razy,
 *  - utrata dostępu: brak lokalnych wierszy z grup/list bez dostępu,
 *  - pętle „do ciszy” się kończą (wysyłka i pobieranie mają górną granicę obrotów — M-49),
 *  - odtworzenie telefonu z kopii (M-8): zmiany zrobione po odtworzeniu docierają na serwer, a operacje z kopii nie są
 *    stosowane drugi raz; nieudane pobranie udostępnionej listy ponawia się (M-53); kopie powtórzeń (identyfikatory
 *    pochodne z generatorów src/domain/views) nie są odrzucane dwa razy na jednym telefonie.
 */
import * as fc from 'fast-check';

import { migrate } from '../../data/db/migrations';
import { readState, writeState } from '../../data/store';
import { memoryDb } from '../../data/__tests__/sqlite';
import { parseIsoDate } from '../format';
import { expiredRepeatOps, missingRepeatOps, nextId } from '../views/task-repeat';
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
  type PullResponse,
  pullRequest,
  type PushResponse,
  pushRequest,
  rejectedCreateIds,
  type Row,
  rowKey,
} from '../sync-engine/client';
import { FakeServer } from './support/fake-server';

const USERS = ['ala', 'bartek', 'celina'] as const;
const GROUP = 'g1';
/** Druga grupa (Bartek — właściciel, Ala; bez Celiny): porcje i czyszczenie w kilku grupach naraz. */
const GROUP2 = 'g2';
const LISTS = ['l1', 'l2', 'l3'];
const TASKS = ['t1', 't2', 't3', 't4'];
/** Porcja pobierania w fazie „do ciszy” (małe porcje sprawdzają kursory i epoki). */
const LIM = 3;

type Phone = {
  user: string;
  state: ClientState;
  /** Kopia iCloud (stan z bazy w chwili kopii) i operacje zrobione od tamtej chwili. */
  backup?: ClientState;
  sinceBackup: Set<string>;
  inflightPush?: { res?: PushResponse };
  inflightPull?: { res: PullResponse; req: ReturnType<typeof pullRequest> };
};

type Cmd =
  | { t: 'mutate'; who: number; op: NewOp }
  | { t: 'push'; who: number; fate: 'ok' | 'lostRequest' | 'lostResponse' | 'delayed' }
  | { t: 'deliverPush'; who: number }
  // failScope: pobranie udostępnionej listy (sync_fetch_scope) się nie udaje (M-53).
  | { t: 'pull'; who: number; lim: number; fate: 'ok' | 'lost' | 'delayed'; failScope: boolean }
  | { t: 'deliverPull'; who: number }
  | { t: 'removeMember'; who: number }
  | { t: 'rejoin'; who: number }
  | { t: 'setRole'; who: number; role: 'admin' | 'member' | 'child' }
  | { t: 'purge'; keep: number }
  // Ponowne uruchomienie; resetCursors — jak lokalna migracja, która zeruje kursory (v5).
  | { t: 'restart'; who: number; resetCursors: boolean }
  // Kopia iCloud i odtworzenie z niej na nowym iPhonie (M-8): stary telefon przepada, pęk kluczy nowego jest pusty.
  | { t: 'backup'; who: number }
  | { t: 'restore'; who: number }
  // Generatory kopii powtórzeń na widoku telefonu, jak na ekranie Moje sprawy (D133, T-12).
  | { t: 'derive'; who: number }
  // Ala (twórczyni list l1, l2) zmienia ich widoczność — także zawężenie (M-54); od razu wysłane.
  | { t: 'narrow'; list: string; to: 'group' | 'restricted' | 'private' }
  // Ala przenosi zadanie do swojej ukrytej listy l3 — inni tracą je z widoku (M-54); od razu wysłane.
  | { t: 'hide'; task: string }
  // Polecenia złożone: od razu wysłane (sieć działa), żeby scenariusze udostępniania nie były rzadkością.
  | { t: 'share'; who: number; other: number; list: string; grant: boolean };

const who = fc.integer({ min: 0, max: USERS.length - 1 });
const notOwner = fc.integer({ min: 1, max: USERS.length - 1 });
const listId = fc.constantFrom(...LISTS);
const taskId = fc.constantFrom(...TASKS);

const opArb: fc.Arbitrary<NewOp> = fc.oneof(
  { weight: 1, arbitrary: fc.record({
    kind: fc.constant('create' as const), entity: fc.constant('lists' as const), id: listId, group_id: fc.constant(GROUP),
    set: fc.record({ kind: fc.constant('tasks'), name: fc.constantFrom('Dom', 'Prezenty'), visibility: fc.constantFrom('group', 'restricted') }),
  }) },
  { weight: 2, arbitrary: fc.record({
    kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: taskId, group_id: fc.constant(GROUP),
    set: fc.record({ list_id: listId, title: fc.constantFrom('a', 'b') }),
  }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: taskId, set: fc.record({ title: fc.constantFrom('x', 'y', 'z') }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: taskId, set: fc.record({ note: fc.constantFrom('n1', 'n2') }) }) },
  // Odhaczenie: jedyna zmiana, którą może zrobić dziecko (D34).
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('tasks' as const), id: taskId, set: fc.record({ completed_at: fc.constantFrom('2026-10-08T10:00:00Z', null) }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: listId, set: fc.record({ name: fc.constantFrom('A', 'B') }) }) },
  // Zmiana widoczności (także zawężenie — M-54); serwer przyjmuje ją tylko od twórcy listy.
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('patch' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS, 's1'), set: fc.record({ visibility: fc.constantFrom('group', 'restricted', 'private') }) }) },
  // Usunięcia i przywrócenia — po czyszczeniu kosza (purge) to nagrobki znikają na dobre.
  { weight: 3, arbitrary: fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom(...TASKS, 's1-gift') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constant('lists' as const), id: fc.constantFrom(...LISTS, 's1') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constantFrom('grant_scope', 'revoke_scope'), args: fc.record({ list_id: listId, user: fc.constantFrom(...USERS) }) }) },
  // Przeniesienie zadania do innej listy (także ukrytej przed częścią osób — M-54; do listy innej grupy: odrzucone).
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('cmd' as const), cmd: fc.constant('move_task'), args: fc.record({ id: fc.constantFrom(...TASKS, 's1-gift', 'mt'), list_id: fc.constantFrom(...LISTS, 's1', 'm1') }) }) },
  // Druga grupa: zadania listy m1.
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('create' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom('mt', 'mt2'), group_id: fc.constant(GROUP2), set: fc.record({ list_id: fc.constant('m1'), title: fc.constantFrom('a', 'b') }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constantFrom('patch' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom('mt', 'mt2'), set: fc.record({ title: fc.constantFrom('x', 'y') }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constantFrom('delete' as const, 'restore' as const), entity: fc.constant('tasks' as const), id: fc.constantFrom('mt', 'mt2') }) },
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
  { weight: 3, arbitrary: fc.record({ t: fc.constant('pull' as const), who, lim: fc.integer({ min: 1, max: 6 }), fate: fc.constantFrom('ok' as const, 'lost' as const, 'delayed' as const), failScope: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('deliverPull' as const), who }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('removeMember' as const), who: notOwner }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('rejoin' as const), who: notOwner }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('setRole' as const), who: notOwner, role: fc.constantFrom('admin' as const, 'member' as const, 'child' as const) }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('purge' as const), keep: fc.integer({ min: 0, max: 3 }) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('restart' as const), who, resetCursors: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('backup' as const), who }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('restore' as const), who }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('derive' as const), who }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('narrow' as const), list: fc.constantFrom('l1', 'l2'), to: fc.constantFrom('group' as const, 'restricted' as const, 'private' as const) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('hide' as const), task: fc.constantFrom('t1', 't2', 't3') }) },
  {
    weight: 4,
    arbitrary: fc
      .record({ who, shift: fc.integer({ min: 1, max: USERS.length - 1 }), list: fc.constantFrom('s1', 's2'), grant: fc.boolean() })
      // Odbiorca zawsze inny niż właściciel; osobne listy, żeby nie kolidowały ze zwykłymi.
      .map(({ who: w, shift, list, grant }) => ({ t: 'share' as const, who: w, other: (w + shift) % USERS.length, list, grant })),
  },
);

/** Ponowne uruchomienie aplikacji: stan wyłącznie z bazy telefonu (src/data/store), jak po zamknięciu i otwarciu. */
function restarted(s: ClientState): ClientState {
  const db = memoryDb();
  migrate(db);
  writeState(db, initialState(s.clientId), s, 1);
  return readState(db, 'inna-instalacja');
}

/**
 * Pętla „do ciszy” z górną granicą obrotów: `step` robi jeden obrót i mówi, czy potrzebny następny. Bez granicy
 * nieskończone pobieranie (M-1) po cichu kończyłoby test na zielono (M-49).
 */
function untilQuiet(bound: number, step: () => boolean, what: string): void {
  for (let i = 0; step(); i++) if (i + 1 >= bound) throw new Error(`${what} się nie kończy (${bound} obrotów)`);
}

const byId = (rows: readonly Row[], key = 'id') => Object.fromEntries(rows.map((r) => [String(r[key]), r]));
/**
 * Wiersze telefonu, które porównujemy z serwerem: wszystko poza nagrobkami wierszy, które serwer już wyczyścił (telefon
 * widział usunięcie — dlatego nie dostał resync — i nic z nich nie pokazuje).
 */
const comparable = (phone: { readonly [id: string]: Row } | undefined, server: Record<string, Row>) =>
  Object.fromEntries(Object.entries(phone ?? {}).filter(([id, r]) => id in server || r.deleted_at == null));

function expectSameAsServer(state: ClientState | { base: ClientState['base'] }, visible: ReturnType<FakeServer['visibleRows']>, tables = state.base) {
  const lists = byId(visible.lists);
  const tasks = byId(visible.tasks);
  expect(comparable(tables.lists, lists)).toEqual(lists);
  expect(comparable(tables.tasks, tasks)).toEqual(tasks);
  expect(tables.group_members ?? {}).toEqual(byId(visible.group_members, 'member_id'));
}

/** Ile razy przebiegi doszły do sytuacji, które sprawdzamy (bez tego własność mogłaby przechodzić „na pusto”). */
const seen = { purged: 0, resync: 0, resyncPaged: 0, wiped: 0, narrowed: 0, gone: 0, recalled: 0, child: 0, moved: 0, restored: 0, scopeRetried: 0, derived: 0 };
/** Dzień symulacji dla generatorów kopii powtórzeń (zadanie r1 ma termin wcześniej — „minione”). */
const TODAY = parseIsoDate('2026-10-08');
/** Odrzucone utworzenia kopii powtórzeń (lista zawężona, osoba usunięta, rola dziecka — zanim telefon się dowiedział). */
let derivedRejected = 0;

function observe(p: Phone, res: PullResponse, req: ReturnType<typeof pullRequest>) {
  const base = p.state.base;
  for (const g of res.groups) {
    if (g.resync) seen.resync++;
    if (g.resync && g.has_more) seen.resyncPaged++;
    const mine = (e: string) => Object.values(base[e] ?? {}).filter((r) => r.group_id === g.group_id);
    if (!g.resync && !(g.group_id in req.cursors) && mine('tasks').length + mine('lists').length > 0) seen.wiped++;
    if (g.lists && mine('lists').some((l) => !g.lists!.includes(String(l.id)))) seen.narrowed++;
    if (g.gone?.some((id) => base.tasks?.[id])) seen.gone++;
  }
}

function run(cmds: Cmd[]) {
  const server = new FakeServer();
  server.addGroup(GROUP, [...USERS], { celina: 'child' });
  server.addGroup(GROUP2, ['bartek', 'ala']);
  let n = 0;
  const newId = () => `op-${++n}`;
  const phones: Phone[] = USERS.map((user, i) => ({ user, state: initialState(`client-${i}`), sinceBackup: new Set() }));
  /** Każda operacja i telefon, który ją wysłał. */
  const allOps = new Map<string, number>();
  /** Operacje telefonu sprzed odtworzenia z kopii: wolno je zgubić razem ze starym telefonem (nie dotarły na serwer). */
  const lostWithPhone = new Set<string>();
  /** …a ich odrzucenie widział stary telefon, nie odtworzony. */
  const beforeRestore = new Set<string>();
  let restores = 0;

  const applyPull = (p: Phone, res: PullResponse, req: ReturnType<typeof pullRequest>, snapshot?: ReturnType<FakeServer['visibleRows']>, failScope = false) => {
    observe(p, res, req);
    const before = p.state;
    const out = onPullResponse(p.state, res, req);
    p.state = out.state;
    // Nieudane pobranie zawartości listy: telefon nic nie zapisuje, lista czeka na następne pobranie (M-53).
    if (!failScope) {
      for (const s of out.fetchScopes) {
        const rows = server.fetchScope(p.user, s);
        // Ponowienie po nieudanym pobraniu przyniosło coś, czego telefon nie miał — bez niego lista by nie dotarła.
        if (before.scopes.includes(s) && before.scopesToFetch.includes(s) && rows.some((r) => !p.state.base[r.e]?.[rowKey(r.e, r.row)])) seen.scopeRetried++;
        p.state = onFetchScope(p.state, rows, s);
      }
    }
    // Niezmiennik po każdym pełnym pobraniu na świeżo: stan potwierdzony = to, co serwer pokazywał w tej chwili
    // (łapie m.in. pozostawione wiersze list, do których cofnięto dostęp, i dziury w kursorach).
    if (snapshot && !out.needMore && !(failScope && out.fetchScopes.length)) expectSameAsServer(p.state, snapshot);
    return out.needMore;
  };
  const record = (p: Phone, i: number) => {
    const id = p.state.pending[p.state.pending.length - 1]!.op_id;
    allOps.set(id, i);
    p.sinceBackup.add(id);
  };
  /** Wysyłka do serwera (sieć doręcza żądanie) ze statystyką odpowiedzi. */
  const send = (p: Phone, req: ReturnType<typeof pushRequest>) => {
    const recalled = server.recalled;
    const res = server.push(p.user, req);
    seen.recalled += server.recalled - recalled;
    for (const r of res.results) {
      const op = req.ops.find((o) => o.seq === r.seq)!;
      if (r.code === 'forbidden:child') seen.child++;
      if (r.status === 'rejected' && op.kind === 'create' && (op.id === nextId('r1') || op.id === nextId('r1s'))) derivedRejected++;
      if (r.status === 'ok' && op.kind === 'cmd' && op.cmd === 'move_task') seen.moved++;
    }
    return res;
  };

  // Grupa z danymi (jak u rodziny po kilku dniach): Ala ma listy l1, l2 (cała grupa) i l3 (ukrytą), zadania t1–t4 —
  // dzięki temu losowe zmiany, usunięcia, przeniesienia i czyszczenie kosza dotyczą istniejących wierszy.
  const seed: NewOp[] = [
    { kind: 'create', entity: 'lists', id: 'l1', group_id: GROUP, set: { kind: 'tasks', name: 'Dom', visibility: 'group' } },
    { kind: 'create', entity: 'lists', id: 'l2', group_id: GROUP, set: { kind: 'tasks', name: 'Zakupy', visibility: 'group' } },
    { kind: 'create', entity: 'lists', id: 'l3', group_id: GROUP, set: { kind: 'tasks', name: 'Tylko Ala', visibility: 'restricted' } },
    ...TASKS.map((id, i): NewOp => ({ kind: 'create', entity: 'tasks', id, group_id: GROUP, set: { list_id: LISTS[Math.min(i, 2)]!, title: id } })),
  ];
  for (const op of seed) {
    phones[0]!.state = mutate(phones[0]!.state, op, newId);
    record(phones[0]!, 0);
  }
  phones[0]!.state = onPushResponse(phones[0]!.state, send(phones[0]!, pushRequest(phones[0]!.state)));
  // Bartek: lista m1 w drugiej grupie, z zadaniem.
  for (const op of [
    { kind: 'create', entity: 'lists', id: 'm1', group_id: GROUP2, set: { kind: 'tasks', name: 'Działka', visibility: 'group' } },
    { kind: 'create', entity: 'tasks', id: 'mt', group_id: GROUP2, set: { list_id: 'm1', title: 'Skosić' } },
  ] as NewOp[]) {
    phones[1]!.state = mutate(phones[1]!.state, op, newId);
    record(phones[1]!, 1);
  }
  phones[1]!.state = onPushResponse(phones[1]!.state, send(phones[1]!, pushRequest(phones[1]!.state)));
  // Zadanie powtarzane z minionym terminem „tylko tego dnia” (D133) i podzadaniem — materiał dla generatorów kopii.
  for (const op of [
    { kind: 'create', entity: 'tasks', id: 'r1', group_id: GROUP, set: { list_id: 'l2', title: 'Podlać', deadline_mode: 'own', due_date: '2026-10-01', due_time: null, repeat: 'FREQ=DAILY', rollover: false } },
    { kind: 'create', entity: 'tasks', id: 'r1s', group_id: GROUP, set: { list_id: 'l2', parent_id: 'r1', title: 'Konewka', deadline_mode: 'inherit' } },
  ] as NewOp[]) {
    phones[0]!.state = mutate(phones[0]!.state, op, newId);
    record(phones[0]!, 0);
  }
  phones[0]!.state = onPushResponse(phones[0]!.state, send(phones[0]!, pushRequest(phones[0]!.state)));
  // Telefony już zsynchronizowane (rodzina po kilku dniach): grupa pobierana od zera pokazuje się dopiero w komplecie,
  // więc bez tego przez większość przebiegu telefony nie miałyby czego zawężać ani przenosić.
  for (const p of phones) {
    untilQuiet(20, () => {
      const req = pullRequest(p.state);
      return applyPull(p, server.pull(p.user, req, LIM), req);
    }, 'pierwsze pobranie');
  }

  for (const c of cmds) {
    const p = 'who' in c ? phones[c.who]! : phones[0]!;
    switch (c.t) {
      case 'mutate':
        p.state = mutate(p.state, c.op, newId);
        record(p, c.who);
        break;
      case 'push': {
        if (p.inflightPush) break; // jedna wysyłka naraz na telefon
        const req = pushRequest(p.state);
        if (c.fate === 'lostRequest') break;
        const res = send(p, req);
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
        const res = server.pull(p.user, req, c.lim);
        if (c.fate === 'ok') applyPull(p, res, req, server.visibleRows(p.user), c.failScope);
        if (c.fate === 'delayed') p.inflightPull = { res, req };
        break;
      }
      case 'deliverPull':
        if (p.inflightPull) applyPull(p, p.inflightPull.res, p.inflightPull.req);
        p.inflightPull = undefined;
        break;
      case 'removeMember':
        server.removeMember(GROUP, p.user);
        break;
      case 'rejoin':
        server.rejoin(GROUP, p.user);
        break;
      case 'setRole':
        server.setRole(GROUP, p.user, c.role);
        break;
      case 'purge':
        // Wiersze usunięte wcześniej niż `keep` ostatnich usunięć (keep = 0: wszystkie).
        if (server.purge(server.now() + 1 - c.keep) > 0) seen.purged++;
        break;
      case 'restart':
        // Zamknięcie aplikacji: żądania w locie przepadają (serwer mógł je wykonać), stan tylko z bazy telefonu.
        p.inflightPush = undefined;
        p.inflightPull = undefined;
        p.state = restarted(p.state);
        if (c.resetCursors) p.state = { ...p.state, cursors: {} };
        break;
      case 'backup':
        p.backup = restarted(p.state);
        p.sinceBackup = new Set();
        break;
      case 'restore': {
        if (!p.backup) break;
        // Stary telefon przepada z tym, czego nie zdążył wysłać; operacje z kopii odtworzony telefon wyśle pod starym
        // identyfikatorem (serwer rozpozna już przetworzone), nowe — pod nowym.
        for (const [id, i] of allOps) if (i === c.who) beforeRestore.add(id);
        for (const id of p.sinceBackup) lostWithPhone.add(id);
        const old = server.clients.get(p.backup.clientId);
        if (old && old.lastSeq >= p.backup.nextSeq) seen.restored++;
        p.inflightPush = undefined;
        p.inflightPull = undefined;
        p.state = adoptDevice(restarted(p.backup), null, () => `client-${c.who}-r${++restores}`);
        break;
      }
      case 'derive': {
        const view = materialize(p.state);
        const canCreate = (g: string) =>
          Object.values(view.group_members ?? {}).some((m) => m.group_id === g && m.user_id === p.user && m.deleted_at == null && m.role !== 'child');
        const skip = rejectedCreateIds(p.state);
        const ops = [...expiredRepeatOps(view, TODAY, canCreate, skip), ...missingRepeatOps(view, TODAY, canCreate, (iso) => iso.slice(0, 10), skip)];
        for (const op of ops) {
          p.state = mutate(p.state, op, newId);
          record(p, c.who);
          seen.derived++;
        }
        break;
      }
      case 'hide':
        p.state = mutate(p.state, { kind: 'cmd', cmd: 'move_task', args: { id: c.task, list_id: 'l3' } }, newId);
        record(p, 0);
        if (!p.inflightPush) p.state = onPushResponse(p.state, send(p, pushRequest(p.state)));
        break;
      case 'narrow':
        p.state = mutate(p.state, { kind: 'patch', entity: 'lists', id: c.list, set: { visibility: c.to } }, newId);
        record(p, 0);
        if (!p.inflightPush) p.state = onPushResponse(p.state, send(p, pushRequest(p.state)));
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
          record(p, c.who);
        }
        if (!p.inflightPush) p.state = onPushResponse(p.state, send(p, pushRequest(p.state)));
        break;
      }
    }
  }

  // Sieć zdrowieje: spóźnione odpowiedzi docierają, potem rundy push/pull aż do ciszy — z górną granicą obrotów
  // (bez niej nieskończone pobieranie po cichu kończyłoby test na zielono; M-49).
  for (const p of phones) {
    if (p.inflightPush?.res) p.state = onPushResponse(p.state, p.inflightPush.res);
    if (p.inflightPull) applyPull(p, p.inflightPull.res, p.inflightPull.req);
  }
  for (let round = 0; round < 3; round++) {
    for (const p of phones) {
      untilQuiet(50, () => pushRequest(p.state).ops.length > 0 && ((p.state = onPushResponse(p.state, send(p, pushRequest(p.state)))), true), `wysyłka (${p.user})`);
    }
    for (const p of phones) {
      const visible = server.visibleRows(p.user);
      const rows = visible.lists.length + visible.tasks.length + visible.group_members.length + visible.groups; // + wiersze grup
      untilQuiet(Math.ceil(rows / LIM) + 3, () => {
        const req = pullRequest(p.state);
        return applyPull(p, server.pull(p.user, req, LIM), req, visible);
      }, `pobieranie (${p.user})`);
    }
  }
  return { server, phones, allOps, lostWithPhone, beforeRestore };
}

describe('symulacja synchronizacji (wiele telefonów, zawodna sieć)', () => {
  it('zbieżność, nic nie ginie, bez podwójnego zastosowania, czyszczenie po utracie dostępu, koniec pętli', () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 20, maxLength: 80 }), (cmds) => {
        const { server, phones, allOps, lostWithPhone, beforeRestore } = run(cmds);
        for (const p of phones) {
          const view = materialize(p.state);
          const visible = server.visibleRows(p.user);
          // Zbieżność: po ciszy w kolejce nic nie czeka, a widok = to, co serwer pokazuje.
          expect(p.state.pending).toHaveLength(0);
          expectSameAsServer(p.state, visible, view);
          // Utrata dostępu: telefon osoby usuniętej z grupy nie ma już żadnych jej wierszy.
          if (!server.groups.get(GROUP)!.members.get(p.user) || server.groups.get(GROUP)!.members.get(p.user)!.deleted) {
            const ofGroup = (t: { readonly [id: string]: Row } | undefined) => Object.values(t ?? {}).filter((r) => r.group_id === GROUP);
            expect(ofGroup(view.lists)).toHaveLength(0);
            expect(ofGroup(view.tasks)).toHaveLength(0);
            expect(ofGroup(view.group_members)).toHaveLength(0);
          }
          if (visible.groups === 0) {
            expect(Object.keys(view.lists ?? {})).toHaveLength(0);
            expect(Object.keys(view.tasks ?? {})).toHaveLength(0);
            expect(Object.keys(view.group_members ?? {})).toHaveLength(0);
          }
        }
        for (const [id, i] of allOps) {
          // Nic nie ginie: każda operacja zastosowana albo odrzucona — i nigdy dwa razy (także operacja z kopii, którą
          // stary telefon zdążył wysłać). Wolno zginąć tylko temu, co nie opuściło starego telefonu przed odtworzeniem.
          const applied = server.applied.get(id) ?? 0;
          expect(applied <= 1).toBe(true);
          expect(applied === 1 || server.rejectedOps.has(id) || lostWithPhone.has(id)).toBe(true);
          // M-56: odrzucenie dociera do „Odrzuconych zmian” telefonu, także gdy pierwsza odpowiedź zginęła.
          if (beforeRestore.has(id)) continue;
          const rejected = phones[i]!.state.rejected.find((r) => r.op.op_id === id);
          expect(rejected?.code).toBe(server.rejectedOps.get(id));
        }
        // Identyfikatory pochodne (kopie powtórzeń): telefon nie ponawia utworzenia, które serwer już odrzucił.
        for (const p of phones) {
          const ids = p.state.rejected.flatMap((r) => (r.op.kind === 'create' ? [r.op.id] : []));
          expect(ids.filter((x) => x === nextId('r1') || x === nextId('r1s'))).toEqual([...new Set(ids.filter((x) => x === nextId('r1') || x === nextId('r1s')))]);
        }
      }),
      { numRuns: 800 },
    );
    // Każda badana sytuacja zdarzyła się wiele razy (próg z zapasem; przebiegi są losowe).
    for (const [k, v] of Object.entries(seen)) expect([k, v > 10]).toEqual([k, true]);
    // Kopie bywają odrzucane (lista zawężona albo usunięta, zanim telefon się dowiedział) — własność wyżej nie jest pusta.
    expect(derivedRejected > 10).toBe(true);
  });

  it('granica obrotów zgłasza nieskończone pobieranie (serwer z błędem M-1: resync w każdej porcji)', () => {
    let s = initialState('c');
    const looping: PullResponse = { groups: [{ group_id: GROUP, cursor: 1, has_more: true, resync: true, rows: [] }], scopes: [] };
    const step = () => {
      const req = pullRequest(s);
      const out = onPullResponse(s, looping, req);
      s = out.state;
      return out.needMore;
    };
    expect(() => untilQuiet(5, step, 'pobieranie')).toThrow('pobieranie się nie kończy (5 obrotów)');
    // Kontrola: skończone pobieranie przechodzi.
    expect(() => untilQuiet(5, () => false, 'pobieranie')).not.toThrow();
  });
});
