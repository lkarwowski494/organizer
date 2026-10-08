/** Atrapy trybu E2E (D143): „serwer” w pamięci, zegar, ustawienia i powiadomienia z src/app/e2e.ts. */
import { config } from '../../config';
import type { Op } from '../../domain/sync-engine/client';
import { WHATS_NEW_SEEN } from '../../features/today/WhatsNew';
import { WELCOME_SEEN } from '../../features/welcome/WelcomeScreen';
import { E2E_IDS, E2E_START_MS, E2eServer, e2eAccount, e2eClock, e2eDeps, e2ePrefs, e2ePush, e2eSeed, e2eTransport } from '../e2e';

const NOW = '2026-10-07T08:00:00.000Z';
const req = (ops: Op[], client_id = 'c1') => ({ client_id, schema_version: config.sync.SCHEMA_VERSION, ops });
const rowsOf = (s: E2eServer, cursors = {}) => s.pull({ cursors }, 1000).groups.flatMap((g) => g.rows);
const find = (s: E2eServer, id: string) => rowsOf(s).find((r) => r.row.id === id || r.row.member_id === id)?.row;

describe('E2eServer', () => {
  it('dane demo: dwie grupy, troje członków „Rodziny” (Kuba bez konta), lista zakupów i wydarzenie cykliczne', () => {
    const s = new E2eServer(e2eSeed(), () => NOW);
    const res = s.pull({ cursors: {} }, 1000);
    expect(res.groups.map((g) => g.group_id).sort()).toEqual([E2E_IDS.me, E2E_IDS.family].sort());
    const fam = res.groups.find((g) => g.group_id === E2E_IDS.family)!;
    const members = fam.rows.filter((r) => r.e === 'group_members').map((r) => [r.row.display_name, r.row.role, r.row.user_id]);
    expect(members).toEqual([
      ['Łukasz', 'owner', E2E_IDS.me],
      ['Ala', 'member', E2E_IDS.ala],
      ['Kuba', 'child', null],
    ]);
    expect(fam.rows.find((r) => r.e === 'events')!.row.rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(fam.rows.some((r) => r.e === 'lists' && r.row.kind === 'shopping')).toBe(true);
    // Kursor = wersja grupy; każdy wiersz ma własną wersję.
    expect(fam.cursor).toBe(Math.max(...fam.rows.map((r) => r.v)));
    expect(fam.rows.every((r) => r.row.version === r.v)).toBe(true);
    expect(s.pull({ cursors: { [E2E_IDS.family]: { v: fam.cursor, p: 0 }, [E2E_IDS.me]: { v: 999, p: 0 } } }, 1000).groups.every((g) => g.rows.length === 0)).toBe(true);
  });

  it('pobieranie porcjami: has_more i kursor ostatniego wiersza', () => {
    const s = new E2eServer(e2eSeed(), () => NOW);
    const first = s.pull({ cursors: {} }, 2).groups.find((g) => g.group_id === E2E_IDS.family)!;
    expect(first.rows).toHaveLength(2);
    expect(first.has_more).toBe(true);
    expect(first.cursor).toBe(first.rows[1]!.v);
    const rest = s.pull({ cursors: { [E2E_IDS.family]: { v: first.cursor, p: 0 } } }, 1000).groups.find((g) => g.group_id === E2E_IDS.family)!;
    expect(rest.has_more).toBe(false);
    expect(rest.rows[0]!.v).toBe(first.cursor + 1);
  });

  it('push: tworzenie, edycja, usunięcie, przywrócenie; duplikaty i komendy', () => {
    const s = new E2eServer(e2eSeed(), () => NOW);
    const g = E2E_IDS.family;
    const before = s.pull({ cursors: {} }, 1000).groups.find((x) => x.group_id === g)!.cursor;
    const ops: Op[] = [
      { seq: 1, op_id: 'o1', kind: 'create', entity: 'tasks', id: 't1', group_id: g, set: { title: 'A', list_id: E2E_IDS.homeList } },
      { seq: 2, op_id: 'o2', kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'B' } },
      { seq: 3, op_id: 'o3', kind: 'create', entity: 'tasks', id: 't1', group_id: g, set: { title: 'powtórka' } },
      { seq: 4, op_id: 'o4', kind: 'cmd', cmd: 'grant_scope', args: { list_id: 'x', user: 'y' } },
      { seq: 5, op_id: 'o5', kind: 'patch', entity: 'tasks', id: 'brak', set: { title: 'nic' } },
      { seq: 6, op_id: 'o6', kind: 'create', entity: 'group_members', id: 'm9', group_id: g, set: { display_name: 'Ola', role: 'child', user_id: null } },
    ];
    expect(s.push(req(ops))).toEqual({ last_seq: 6, results: ops.map((o) => ({ seq: o.seq, status: 'ok' })) });
    expect(find(s, 't1')).toMatchObject({ title: 'B', group_id: g, deleted_at: null });
    expect(find(s, 'm9')).toMatchObject({ member_id: 'm9', display_name: 'Ola' });
    expect(find(s, 'brak')).toBeUndefined();
    // Powtórzone numery tej instalacji to duplikaty; inna instalacja liczy osobno.
    expect(s.push(req([ops[1]!]))).toEqual({ last_seq: 6, results: [{ seq: 2, status: 'duplicate' }] });
    s.push(req([{ seq: 1, op_id: 'p1', kind: 'delete', entity: 'tasks', id: 't1' }], 'c2'));
    expect(find(s, 't1')!.deleted_at).toBe(NOW);
    // Usunięty: edycja i ponowne usunięcie nic nie zmieniają; przywrócenie — tak.
    s.push(req([{ seq: 2, op_id: 'p2', kind: 'patch', entity: 'tasks', id: 't1', set: { title: 'C' } }, { seq: 3, op_id: 'p3', kind: 'delete', entity: 'tasks', id: 't1' }], 'c2'));
    expect(find(s, 't1')).toMatchObject({ title: 'B', deleted_at: NOW });
    s.push(req([{ seq: 4, op_id: 'p4', kind: 'restore', entity: 'tasks', id: 't1' }, { seq: 5, op_id: 'p5', kind: 'restore', entity: 'tasks', id: 't1' }], 'c2'));
    expect(find(s, 't1')!.deleted_at).toBeNull();
    const fresh = s.pull({ cursors: { [g]: { v: before, p: 0 } } }, 1000).groups.find((x) => x.group_id === g)!;
    expect(fresh.rows.map((r) => r.row.id ?? r.row.member_id)).toEqual(['m9', 't1']);
  });

  it('audyt 2 (M-111): stałe zakupy jako polecenia — jak na serwerze; inne polecenia bez zmian danych', () => {
    const s = new E2eServer(e2eSeed(), () => NOW);
    const list = () => s.pull({ cursors: {} }, 1000).groups.flatMap((x) => x.rows).find((r) => r.e === 'lists' && r.row.id === E2E_IDS.shoppingList)!.row;
    const before = list().version;
    s.push(req([
      { seq: 1, op_id: 'o1', kind: 'cmd', cmd: 'staple_add', args: { list_id: E2E_IDS.shoppingList, name: 'Mleko' } },
      { seq: 2, op_id: 'o2', kind: 'cmd', cmd: 'staple_add', args: { list_id: E2E_IDS.shoppingList, name: 'Chleb' } },
      { seq: 3, op_id: 'o3', kind: 'cmd', cmd: 'staple_remove', args: { list_id: E2E_IDS.shoppingList, names: ['Mleko'] } },
      { seq: 4, op_id: 'o4', kind: 'cmd', cmd: 'staple_add', args: { list_id: 'brak', name: 'Mleko' } },
    ]));
    expect(list()).toMatchObject({ staples: ['Chleb'] });
    expect(Number(list().version)).toBeGreaterThan(Number(before));
    s.push(req([{ seq: 1, op_id: 'p1', kind: 'delete', entity: 'lists', id: E2E_IDS.shoppingList }, { seq: 2, op_id: 'p2', kind: 'cmd', cmd: 'staple_add', args: { list_id: E2E_IDS.shoppingList, name: 'Woda' } }], 'c3'));
    expect(list()).toMatchObject({ staples: ['Chleb'] });
  });

  it('nowa grupa jak RPC create_group i transport z tymi samymi danymi', async () => {
    const s = new E2eServer(e2eSeed(), () => NOW);
    s.createGroup({ groupId: 'g2', name: 'Działka', ownerMemberId: 'm2', displayName: 'Łukasz' }, E2E_IDS.me);
    const t = e2eTransport(s);
    const g2 = (await t.pull({ cursors: {}, schema_version: 2, entities: [] }, 1000)).groups.find((g) => g.group_id === 'g2')!;
    expect(g2.rows.map((r) => r.e)).toEqual(['groups', 'group_members']);
    expect(g2.rows[1]!.row).toMatchObject({ role: 'owner', user_id: E2E_IDS.me });
    expect(await t.fetchScope('x')).toEqual([]);
    expect((await t.push(req([]))).last_seq).toBe(0);
  });
});

describe('atrapy E2E', () => {
  it('zegar zaczyna 7.10.2026 08:00 UTC i płynie dalej', () => {
    let real = 1_000;
    const clock = e2eClock(() => real);
    expect(clock()).toBe(E2E_START_MS);
    real += 90_000;
    expect(clock()).toBe(E2E_START_MS + 90_000);
    expect(new Date(e2eClock()()).toISOString().slice(0, 10)).toBe('2026-10-07');
  });

  it('wprowadzenie i „Co nowego” obejrzane; zapis działa', async () => {
    const p = e2ePrefs();
    expect(await p.get(WELCOME_SEEN)).toBe('1');
    expect(Number(await p.get(WHATS_NEW_SEEN))).toBe(Number.MAX_SAFE_INTEGER);
    expect(await p.get('inne')).toBeNull();
    await p.set('inne', 'x');
    expect(await p.get('inne')).toBe('x');
  });

  it('powiadomienia wyłączone, bez okna zgody', async () => {
    expect(await e2ePush.status()).toBe('denied');
    expect(await e2ePush.request()).toBe(false);
    expect(await e2ePush.token()).toBeNull();
    expect(await e2ePush.dismissed()).toBe(true);
    expect(await e2ePush.reminderSettings()).toBeNull();
    await expect(Promise.all([e2ePush.dismiss(), e2ePush.replaceReminders([]), e2ePush.saveReminderSettings({} as never)])).resolves.toBeDefined();
  });

  it('konto: operacje bez serwera nie udają sukcesu', async () => {
    const auth = { signIn: jest.fn(async () => {}), signOut: jest.fn() };
    const a = e2eAccount(new E2eServer([], () => NOW), auth);
    for (const f of [() => a.createInvite('g', 'member'), () => a.acceptInvite('t', 'x'), () => a.createJoinCode('g', 'member'), () => a.joinGroup('1', '2', 'x'), () => a.rotateJoinId('g'), () => a.deleteGroup('g'), () => a.restoreGroup('g'), () => a.transferOwnership('g', 'm')]) {
      await expect(f()).rejects.toThrow('e2e_offline');
    }
    await a.deleteAccount();
    expect(auth.signOut).toHaveBeenCalled();
    expect(await a.getPushMutes()).toEqual([]);
    await expect(Promise.all([a.sendMagicLink('a@b.c'), a.setMyName('x'), a.revokeInvite('i'), a.registerPushToken('t', 'sandbox'), a.notifyHandoff('h'), a.notifyAssignment('a'), a.setPushMute('g', true), a.reportError({ kind: 'error', message: 'm', stack: null, screen: null, appVersion: '1' }), a.sendFeedback({ message: 'm', screen: null, appVersion: '1' })])).resolves.toBeDefined();
  });

  it('zależności: sesja demo na symulatorze; błąd sprawdzenia = brak sesji; wygląd zapamiętany w pamięci', async () => {
    const native = { openDb: jest.fn(), newId: () => 'id' };
    const ok = e2eDeps({ ...native, isSimulator: async () => true });
    expect(await ok.session.current()).toEqual({ userId: E2E_IDS.me, displayName: 'Łukasz' });
    await ok.session.setFromLink({ access_token: 'a', refresh_token: 'r' });
    expect(await ok.links.initial()).toBeNull();
    ok.links.onUrl(() => {})();
    ok.subscribe(['x'], () => {})();
    expect(await ok.calendar.add({ title: 't', start: new Date(), end: new Date(), allDay: false })).toBe('canceled');
    expect(ok.travel).toBeUndefined();
    expect(await ok.appearance!.load()).toBeNull();
    await ok.appearance!.save('dark');
    expect(await ok.appearance!.load()).toBe('dark');
    const seen: unknown[] = [];
    const off = ok.session.onChange((s) => seen.push(s));
    await ok.account.signOut();
    expect(await ok.session.current()).toBeNull();
    await ok.account.signInWithApple();
    off();
    await ok.account.signOut();
    expect(seen).toEqual([null, { userId: E2E_IDS.me, displayName: 'Łukasz' }]);

    const broken = e2eDeps({ ...native, isSimulator: () => Promise.reject(new Error('brak modułu')) });
    expect(await broken.session.current()).toBeNull();
    await expect(broken.account.signInWithApple()).rejects.toThrow('e2e_not_simulator');
  });
});
