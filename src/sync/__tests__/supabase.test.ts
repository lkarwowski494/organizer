import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../../config';
import { classify, type DetachedClient, FATAL_CODES, type RpcResult, supabaseAccount, supabaseTransport, type SupabaseLike } from '../supabase';
import { TransportError } from '../transport';

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(reply: (c: Call) => RpcResult<unknown> = () => ({ data: {}, error: null, status: 200 })) {
  const calls: Call[] = [];
  const auth = {
    signInWithIdToken: jest.fn(async () => ({ error: null as { message: string } | null })),
    signOut: jest.fn(async (_a: { scope: 'local' }) => ({ error: null as { message: string } | null })),
    updateUser: jest.fn(async () => ({ error: null as { message: string } | null })),
    getSession: jest.fn(async () => ({ data: { session: null as { refresh_token?: string; user: { id?: string; app_metadata?: { provider?: string; providers?: string[] } } } | null } })),
  };
  const functions = { invoke: jest.fn(async (_name: string, _opts: object): Promise<{ data?: unknown; error: { message: string } | null }> => ({ error: null })) };
  const profileUpdate = { error: null as { message: string } | null };
  const profiles: { table: string; values: object; col: string; id: string }[] = [];
  const from = (table: 'profiles') => ({
    update: (values: { display_name: string }) => ({ eq: async (col: 'user_id', id: string) => (profiles.push({ table, values, col, id }), profileUpdate) }),
  });
  const client: SupabaseLike = {
    rpc: async <T,>(fn: string, args: object) => {
      const c = { fn, args: args as Record<string, unknown> };
      calls.push(c);
      return reply(c) as RpcResult<T>;
    },
    auth,
    from,
    functions,
  };
  return { client, calls, auth, functions, profiles, profileUpdate };
}

/** Nazwy parametrów publicznych funkcji z migracji SQL (ostatnia definicja wygrywa). */
function sqlParams(): Map<string, string[]> {
  const dir = join(__dirname, '../../../supabase/migrations');
  const sql = readdirSync(dir).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const out = new Map<string, string[]>();
  for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/gi)) {
    out.set(m[1]!, m[2]!.split(',').map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean));
  }
  return out;
}

describe('Supabase: transport synchronizacji', () => {
  it('wywołania RPC z argumentami zgodnymi z sygnaturami SQL (kontrakt)', async () => {
    const { client, calls } = fakeClient(({ fn }) => ({ data: fn === 'sync_fetch_scope' ? { rows: [{ e: 'lists', v: 1, row: {} }] } : fn === 'create_invite' ? { invite_id: 'i', token: 't'.repeat(64), expires_at: 'x', max_uses: 10 } : fn === 'accept_invite' ? { group_id: 'g' } : fn === 'create_join_code' ? { invite_id: 'i2', join_id: '482913507', code: '731064', expires_at: 'x' } : { ok: 1 }, error: null, status: 200 }));
    const t = supabaseTransport(client);
    const a = supabaseAccount(client, async () => ({ identityToken: 'jwt' }));
    expect(await t.push({ client_id: 'c', schema_version: config.sync.SCHEMA_VERSION, ops: [] })).toEqual({ ok: 1 });
    expect(await t.pull({ cursors: { g: { v: 3, p: 1 } }, schema_version: config.sync.SCHEMA_VERSION, entities: ['tasks'] }, 1000)).toEqual({ ok: 1 });
    expect(await t.fetchScope('l')).toEqual([{ e: 'lists', v: 1, row: {} }]);
    await a.createGroup({ groupId: 'g', name: 'Rodzina', ownerMemberId: 'm', displayName: 'Ł' });
    expect(await a.createInvite('g', 'admin')).toEqual({ inviteId: 'i', token: 't'.repeat(64), url: `${config.URL_SCHEME}://invite/${'t'.repeat(64)}`, expiresAt: 'x', maxUses: 10 });
    expect(await a.acceptInvite('tok', 'Ł')).toEqual({ groupId: 'g' });
    await a.revokeInvite('i');
    await a.createJoinCode('g', 'member');
    await a.renewJoinCode('g', 'member');
    await a.rotateJoinId('g');
    await a.deleteGroup('g');
    await a.restoreGroup('g');
    await a.transferOwnership('g', 'm');
    await a.registerPushToken('ab'.repeat(32), 'production');
    await a.reportError({ kind: 'crash', message: 'TypeError: x', stack: 'at f', screen: 'render', appVersion: '1.0 (12)' });
    await a.sendFeedback({ message: 'Brakuje X', screen: 'Settings', appVersion: '1.0 (12)' });
    expect(await a.getPushMutes()).toEqual({ ok: 1 });
    await a.setPushMute('g', true);
    const params = sqlParams();
    for (const c of calls) {
      expect(params.has(c.fn)).toBe(true);
      for (const k of Object.keys(c.args)) expect(params.get(c.fn)).toContain(k);
    }
    expect(calls.map((c) => c.fn)).toEqual(['sync_push', 'sync_pull', 'sync_fetch_scope', 'create_group', 'create_invite', 'accept_invite', 'revoke_invite', 'create_join_code', 'renew_join_code', 'rotate_join_id', 'delete_group', 'restore_group', 'transfer_ownership', 'register_push_token', 'report_client_error', 'send_feedback', 'my_push_mutes', 'set_push_mute']);
    // Protokół 2 (audyt 2, M-1, M-58): kursor z epoką, wersja protokołu i encje znane telefonowi.
    expect(calls[1]!.args).toEqual({ cursors: { g: { v: 3, p: 1 } }, lim: 1000, schema_version: 2, entities: ['tasks'] });
  });

  it('błędy: sieć, sesja, serwer — z treścią komunikatu', async () => {
    const replies: RpcResult<unknown>[] = [
      { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      { data: null, error: { message: 'JWT expired', code: 'PGRST303' }, status: 401 },
      { data: null, error: { message: 'invite_expired', code: 'P0001' }, status: 400 },
    ];
    const { client } = fakeClient(() => replies.shift()!);
    const t = supabaseTransport(client);
    const pull = { cursors: {}, schema_version: config.sync.SCHEMA_VERSION, entities: [] };
    await expect(t.pull(pull, 1)).rejects.toMatchObject({ kind: 'network' });
    await expect(t.pull(pull, 1)).rejects.toMatchObject({ kind: 'auth', message: 'JWT expired' });
    const e = await supabaseAccount(client, async () => ({ identityToken: null })).acceptInvite('t', 'x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError);
    expect(e).toMatchObject({ kind: 'server', message: 'invite_expired' });
  });

  it('klasyfikacja', () => {
    expect(classify({ error: { message: '' }, status: 0 })).toBe('network');
    expect(classify({ error: { message: '' }, status: 401 })).toBe('auth');
    expect(classify({ error: { message: '', code: 'PGRST301' }, status: 403 })).toBe('auth');
    expect(classify({ error: { message: '' }, status: 500 })).toBe('server');
    // Audyt 2 (M-57): błędy trwałe protokołu — bez ponowień w kółko; inne odrzucenia serwera nadal ponawiane.
    for (const code of FATAL_CODES) expect(classify({ error: { message: code, code: 'P0001' }, status: 400 })).toBe('fatal');
    expect(classify({ error: { message: 'not_authenticated', code: 'P0001' }, status: 400 })).toBe('server');
    expect(classify({ error: { message: 'upgrade_required', code: '22P02' }, status: 400 })).toBe('server');
  });

  it('upgrade_required z serwera: TransportError „fatal” z kodem (wskaźnik „Zaktualizuj aplikację”)', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'upgrade_required', code: 'P0001' }, status: 400 }));
    const t = supabaseTransport(client);
    await expect(t.push({ client_id: 'c', schema_version: config.sync.SCHEMA_VERSION, ops: [] })).rejects.toMatchObject({ kind: 'fatal', message: 'upgrade_required' });
  });
});

describe('Supabase: konto', () => {
  it('ID grupy + kod: kod z linkiem; dołączenie; błąd w treści odpowiedzi', async () => {
    const replies: RpcResult<unknown>[] = [
      { data: { invite_id: 'i', join_id: '482913507', code: '731064', expires_at: 'x' }, error: null, status: 200 },
      { data: { invite_id: 'i3', join_id: '482913507', code: '555111', expires_at: 'y' }, error: null, status: 200 },
      { data: { group_id: 'gf' }, error: null, status: 200 },
      { data: { error: 'rate_limited' }, error: null, status: 200 },
      { data: {}, error: null, status: 200 },
    ];
    const { client, calls } = fakeClient(() => replies.shift()!);
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    expect(await a.createJoinCode('g', 'admin')).toEqual({ inviteId: 'i', joinId: '482913507', code: '731064', url: `${config.invites.JOIN_LINK}?g=482913507&c=731064`, expiresAt: 'x' });
    // PW-41 A: „Nowy kod” — kolejny kod tej roli.
    expect(await a.renewJoinCode('g', 'admin')).toEqual({ inviteId: 'i3', joinId: '482913507', code: '555111', url: `${config.invites.JOIN_LINK}?g=482913507&c=555111`, expiresAt: 'y' });
    expect(calls[1]).toEqual({ fn: 'renew_join_code', args: { group_id: 'g', role: 'admin' } });
    expect(await a.joinGroup('482913507', '731064', 'Ala')).toEqual({ groupId: 'gf' });
    expect(calls[2]).toEqual({ fn: 'join_group', args: { join_id: '482913507', code: '731064', display_name: 'Ala' } });
    await expect(a.joinGroup('1', '2', 'x')).rejects.toMatchObject({ kind: 'server', message: 'rate_limited' });
    await expect(a.joinGroup('1', '2', 'x')).rejects.toMatchObject({ message: 'invite_invalid' });
    const params = sqlParams();
    for (const c of calls) for (const k of Object.keys(c.args)) expect(params.get(c.fn)).toContain(k);
  });

  it('wyciszenia: brak danych z serwera = pusta lista', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null, status: 200 }));
    expect(await supabaseAccount(client, async () => ({ identityToken: 'jwt' })).getPushMutes()).toEqual([]);
  });

  it('Apple: token tożsamości do signInWithIdToken; brak tokenu i błąd zgłaszane', async () => {
    const { client, auth } = fakeClient();
    await supabaseAccount(client, async () => ({ identityToken: 'jwt' })).signInWithApple();
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'jwt' });
    await expect(supabaseAccount(client, async () => ({ identityToken: null })).signInWithApple()).rejects.toThrow('apple:no_identity_token');
    auth.signInWithIdToken.mockResolvedValueOnce({ error: { message: 'invalid' } });
    await expect(supabaseAccount(client, async () => ({ identityToken: 'x' })).signInWithApple()).rejects.toThrow('invalid');
    expect(auth.updateUser).not.toHaveBeenCalled();
    // Pierwsze logowanie: Apple podaje imię — trafia do profilu (O-036); bez imienia — profil bez zmian.
    await supabaseAccount(client, async () => ({ identityToken: 'jwt', fullName: { givenName: ' Łukasz ', familyName: 'Karwowski' } })).signInWithApple();
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { display_name: 'Łukasz', full_name: 'Łukasz Karwowski' } });
    await supabaseAccount(client, async () => ({ identityToken: 'jwt', fullName: { givenName: 'Ala', familyName: null } })).signInWithApple();
    expect(auth.updateUser).toHaveBeenLastCalledWith({ data: { display_name: 'Ala', full_name: 'Ala' } });
    await supabaseAccount(client, async () => ({ identityToken: 'jwt', fullName: { givenName: null } })).signInWithApple();
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
  });

  it('moje imię (D100): metadane konta i profil; bez sesji tylko metadane; błąd zgłaszany', async () => {
    const { client, auth, profiles, profileUpdate } = fakeClient();
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    await a.setMyName('Łukasz');
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { display_name: 'Łukasz' } });
    expect(profiles).toEqual([]);
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await a.setMyName('Łukasz');
    expect(profiles).toEqual([{ table: 'profiles', values: { display_name: 'Łukasz' }, col: 'user_id', id: 'u1' }]);
    profileUpdate.error = { message: 'denied' };
    await expect(a.setMyName('X')).rejects.toThrow('denied');
    auth.updateUser.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(a.setMyName('X')).rejects.toThrow('offline');
  });

  it('wylogowanie zdejmuje token powiadomień tego telefonu; brak sieci nie blokuje wylogowania (audyt 8.10.2026)', async () => {
    let fail = false;
    const { client, calls, auth } = fakeClient((c) => (fail && c.fn === 'unregister_push_token' ? { data: null, error: { message: 'offline' }, status: 0 } : { data: {}, error: null, status: 200 }));
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    await a.signOut();
    expect(calls.map((c) => c.fn)).toEqual([]);
    await a.registerPushToken('ab', 'production');
    await a.signOut();
    expect(calls.at(-1)).toEqual({ fn: 'unregister_push_token', args: { p_token: 'ab' } });
    expect(auth.signOut).toHaveBeenCalledTimes(2);
    // Raz zdjęty — przy kolejnym wylogowaniu już nie wołamy.
    await a.signOut();
    expect(calls.filter((c) => c.fn === 'unregister_push_token')).toHaveLength(1);
    await a.registerPushToken('cd', 'production');
    fail = true;
    await a.signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(4);
  });

  it('audyt 2 (N-11, S-24): token z poprzedniego uruchomienia zdjęty przy wylogowaniu; bez sieci wylogowanie bez wyjątku', async () => {
    const saved: { v: string | null } = { v: 'ef'.repeat(32) };
    const memory = { load: jest.fn(async () => saved.v), save: jest.fn(async (v: string | null) => void (saved.v = v)) };
    let offline = false;
    const { client, calls, auth } = fakeClient((c) => (offline ? { data: null, error: { message: 'Failed to fetch' }, status: 0 } : { data: {}, error: null, status: 200 }));
    const a = supabaseAccount(client, async () => ({ identityToken: null }), { pushToken: memory });
    // Rejestracja w tym uruchomieniu się nie udała (start bez sieci) — zdejmujemy token zapamiętany wcześniej.
    await a.signOut();
    expect(calls).toEqual([{ fn: 'unregister_push_token', args: { p_token: 'ef'.repeat(32) } }]);
    expect(saved.v).toBeNull();
    // Rejestracja zapamiętuje token; ten sam token drugi raz w tym uruchomieniu — bez zapisu na serwerze.
    await a.registerPushToken('ab'.repeat(32), 'production');
    await a.registerPushToken('ab'.repeat(32), 'production');
    expect(calls.filter((c) => c.fn === 'register_push_token')).toHaveLength(1);
    expect(saved.v).toBe('ab'.repeat(32));
    // Bez sieci: wyrejestrowanie się nie udaje (token zostaje zapamiętany), auth-js usuwa sesję i zwraca błąd — bez wyjątku.
    offline = true;
    auth.signOut.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    await expect(a.signOut()).resolves.toBeUndefined();
    expect(saved.v).toBe('ab'.repeat(32));
    // Błąd, po którym sesja została na telefonie — wylogowanie się nie udało.
    auth.signOut.mockResolvedValueOnce({ error: { message: 'boom' } });
    auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u' } } } });
    await expect(a.signOut()).rejects.toThrow('boom');
    // Zapis i odczyt pamięci mogą zawieść — wylogowanie i rejestracja działają dalej.
    offline = false;
    memory.load.mockRejectedValueOnce(new Error('keychain'));
    await expect(a.signOut()).resolves.toBeUndefined();
    memory.save.mockRejectedValueOnce(new Error('keychain'));
    await a.registerPushToken('cd'.repeat(32), 'sandbox');
    memory.save.mockRejectedValueOnce(new Error('keychain'));
    await a.signOut();
    expect(calls.at(-1)).toEqual({ fn: 'unregister_push_token', args: { p_token: 'cd'.repeat(32) } });
    // Po nowym logowaniu w tym samym uruchomieniu ten sam token rejestruje się znowu.
    await a.registerPushToken('cd'.repeat(32), 'sandbox');
    expect(calls.filter((c) => c.fn === 'register_push_token')).toHaveLength(3);
    // Usunięcie konta: tokeny usuwa serwer, pamięć telefonu czyszczona.
    memory.save.mockClear();
    await a.deleteAccount();
    expect(memory.save).toHaveBeenLastCalledWith(null);
    memory.save.mockRejectedValueOnce(new Error('keychain'));
    await expect(a.deleteAccount()).resolves.toBeUndefined();
  });

  it('wylogowanie tylko tego telefonu (D176), usunięcie konta', async () => {
    const { client, auth, functions } = fakeClient();
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    await a.signOut();
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
    await a.deleteAccount();
    expect(functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
    functions.invoke.mockResolvedValueOnce({ error: { message: 'unauthorized' } });
    await expect(a.deleteAccount()).rejects.toThrow('unauthorized');
    // Konto z Apple (M-303): świeży kod autoryzacji — potwierdzenie i unieważnienie tokenu; bez kodu — nie usuwamy.
    const appleFn = jest.fn(async () => ({ identityToken: 'jwt', authorizationCode: 'code-1' }));
    auth.getSession.mockResolvedValue({ data: { session: { user: { app_metadata: { provider: 'apple' } } } } });
    await supabaseAccount(client, appleFn).deleteAccount();
    expect(appleFn).toHaveBeenCalledWith('none');
    expect(functions.invoke).toHaveBeenLastCalledWith('delete-account', { method: 'POST', body: { appleAuthorizationCode: 'code-1' } });
    await expect(supabaseAccount(client, async () => ({ identityToken: 'jwt', authorizationCode: null })).deleteAccount()).rejects.toThrow('apple:no_authorization_code');
    await expect(supabaseAccount(client, async () => ({ identityToken: 'jwt' })).deleteAccount()).rejects.toThrow('apple:no_authorization_code');
    // Apple dołączone do konta z innym pierwszym sposobem logowania (providers) — też kod.
    auth.getSession.mockResolvedValue({ data: { session: { user: { app_metadata: { provider: 'email', providers: ['email', 'apple'] } } } } });
    await supabaseAccount(client, appleFn).deleteAccount();
    expect(functions.invoke).toHaveBeenLastCalledWith('delete-account', { method: 'POST', body: { appleAuthorizationCode: 'code-1' } });
    auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
    await a.deleteAccount();
    expect(functions.invoke).toHaveBeenLastCalledWith('delete-account', { method: 'POST' });
    // M-64: sprzątanie telefonu po udanym usunięciu na serwerze, przed końcem sesji; jego błąd nie zatrzymuje wylogowania.
    const order: string[] = [];
    functions.invoke.mockImplementationOnce(async () => (order.push('server'), { error: null }));
    auth.signOut.mockImplementationOnce(async () => (order.push('signOut'), { error: null }));
    await a.deleteAccount(async () => void order.push('before'));
    expect(order).toEqual(['server', 'before', 'signOut']);
    const before = jest.fn(async () => {});
    functions.invoke.mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(a.deleteAccount(before)).rejects.toThrow('x');
    expect(before).not.toHaveBeenCalled();
    await expect(a.deleteAccount(async () => Promise.reject(new Error('kalendarz')))).resolves.toBeUndefined();
    await a.notifyHandoff('h1');
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { handoffId: 'h1' } });
    await a.notifyAssignment('a1');
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { activityId: 'a1' } });
  });

  it('D159: ciche powiadomienia dla grup — bez tego urządzenia (token z uruchomienia albo zapamiętany), retryInSec z odpowiedzi', async () => {
    const { client, functions } = fakeClient();
    let saved: string | null = null;
    const memory = { load: jest.fn(async () => saved), save: jest.fn(async (t: string | null) => void (saved = t)) };
    const a = supabaseAccount(client, async () => ({ identityToken: 'jwt' }), { pushToken: memory });
    functions.invoke.mockResolvedValueOnce({ data: { sent: 1, retryInSec: 600 }, error: null });
    expect(await a.notifyGroups({ groups: ['g1'], retry: false })).toEqual({ retryInSec: 600 });
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { groups: ['g1'], retry: false } });
    saved = 'ab';
    functions.invoke.mockResolvedValueOnce({ data: { sent: 0, retryInSec: null }, error: null });
    expect(await a.notifyGroups({ groups: ['g1'], retry: true })).toEqual({ retryInSec: null });
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { groups: ['g1'], retry: true, except: 'ab' } });
    await a.registerPushToken('cd', 'production');
    functions.invoke.mockResolvedValueOnce({ error: null });
    expect(await a.notifyGroups({ groups: ['g1'], retry: false })).toEqual({ retryInSec: null });
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { groups: ['g1'], retry: false, except: 'cd' } });
    memory.load.mockRejectedValueOnce(new Error('pęk kluczy'));
    const b = supabaseAccount(client, async () => ({ identityToken: 'jwt' }), { pushToken: memory });
    functions.invoke.mockResolvedValueOnce({ data: null, error: { message: 'apns_failed' } });
    await expect(b.notifyGroups({ groups: ['g1'], retry: false })).rejects.toThrow('apns_failed');
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { groups: ['g1'], retry: false } });
  });
});

describe('imię z Apple w profilu (audyt 2, M-186)', () => {
  it('pierwsze logowanie z imieniem: metadane konta i profil; bez sesji tylko metadane; błąd profilu zgłaszany', async () => {
    const { client, auth, profiles, profileUpdate } = fakeClient();
    const apple = async () => ({ identityToken: 'jwt', fullName: { givenName: 'Ala', familyName: 'Nowak' } });
    await supabaseAccount(client, apple).signInWithApple();
    expect(profiles).toEqual([]);
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    await supabaseAccount(client, apple).signInWithApple();
    expect(profiles).toEqual([{ table: 'profiles', values: { display_name: 'Ala' }, col: 'user_id', id: 'u1' }]);
    profileUpdate.error = { message: 'denied' };
    await expect(supabaseAccount(client, apple).signInWithApple()).rejects.toThrow('denied');
  });
});

describe('wylogowanie bez internetu: zaległe wyrejestrowanie tokenu starą sesją', () => {
  type Reply = { data: { session: { refresh_token: string } | null }; error: { message: string; status?: number } | null };
  function setup(opts: { offline?: boolean; logoutFails?: boolean } = {}) {
    const state = { offline: !!opts.offline, jobs: null as string | null, pushToken: 'ab'.repeat(32) as string | null };
    const { client, calls, auth } = fakeClient((c) => (state.offline && c.fn === 'unregister_push_token' ? { data: null, error: { message: 'Failed to fetch' }, status: 0 } : { data: {}, error: null, status: 200 }));
    auth.getSession.mockResolvedValue({ data: { session: { refresh_token: 'rt-old', user: { id: 'u1' } } } });
    if (opts.logoutFails) auth.signOut.mockImplementation(async () => (auth.getSession.mockResolvedValue({ data: { session: null } }), { error: { message: 'Failed to fetch' } }));
    // Stara sesja: odświeżenie tokenem z zadania, RPC i zamknięcie.
    const oldCalls: Call[] = [];
    const refresh = jest.fn(async (_a: { refresh_token: string }): Promise<Reply> => ({ data: { session: { refresh_token: 'rt-new' } }, error: null }));
    let rpcReply: RpcResult<unknown> = { data: null, error: null, status: 200 };
    const oldSignOut = jest.fn(async () => ({ error: null }));
    const detached = jest.fn(
      (): DetachedClient => ({
        rpc: async <T,>(fn: string, args: object) => (oldCalls.push({ fn, args: args as Record<string, unknown> }), rpcReply as RpcResult<T>),
        auth: { refreshSession: refresh, signOut: oldSignOut },
      }),
    );
    const signOutJobs = { load: jest.fn(async () => state.jobs), save: jest.fn(async (v: string | null) => void (state.jobs = v)) };
    const pushToken = { load: async () => state.pushToken, save: async (v: string | null) => void (state.pushToken = v) };
    const a = supabaseAccount(client, async () => ({ identityToken: null }), { pushToken, signOutJobs, detached });
    return { a, state, calls, auth, oldCalls, refresh, oldSignOut, detached, signOutJobs, setRpc: (r: RpcResult<unknown>) => (rpcReply = r) };
  }

  it('bez sieci: zadanie z tokenem odświeżania starej sesji; po powrocie sieci wyrejestrowanie tą sesją i jej zamknięcie', async () => {
    const t = setup({ offline: true, logoutFails: true });
    await t.a.signOut();
    expect(JSON.parse(t.state.jobs!)).toEqual([{ token: 'ab'.repeat(32), refreshToken: 'rt-old' }]);
    // Token przejęło zadanie — następne wylogowanie (innego konta) nie zdejmuje go swoją sesją.
    expect(t.state.pushToken).toBeNull();
    // Zamknięcie starej sesji bez odpowiedzi — zadanie i tak zrobione.
    t.oldSignOut.mockRejectedValueOnce(new Error('fetch') as never);
    await t.a.finishSignOut();
    expect(t.refresh).toHaveBeenCalledWith({ refresh_token: 'rt-old' });
    expect(t.oldCalls).toEqual([{ fn: 'unregister_push_token', args: { p_token: 'ab'.repeat(32) } }]);
    expect(t.oldSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(t.state.jobs).toBeNull();
    // Nic więcej do zrobienia.
    await t.a.finishSignOut();
    expect(t.detached).toHaveBeenCalledTimes(1);
  });

  it('serwer zamknął sesję mimo błędu wyrejestrowania — zadanie bez sensu, usunięte od razu', async () => {
    const t = setup({ offline: true });
    await t.a.signOut();
    expect(t.state.jobs).toBeNull();
    expect(t.signOutJobs.save).toHaveBeenCalledTimes(2);
  });

  it('nadal bez sieci: zadanie zostaje (z nowym tokenem odświeżania po rotacji); nieważna sesja — zadanie porzucone', async () => {
    const t = setup({ offline: true, logoutFails: true });
    await t.a.signOut();
    // Odświeżenie bez sieci (status 0) i błąd serwera (5xx) — próbujemy później.
    t.refresh.mockResolvedValueOnce({ data: { session: null }, error: { message: 'fetch', status: 0 } });
    await t.a.finishSignOut();
    t.refresh.mockResolvedValueOnce({ data: { session: null }, error: { message: '5xx', status: 503 } });
    await t.a.finishSignOut();
    expect(JSON.parse(t.state.jobs!)).toHaveLength(1);
    // Odświeżone, ale RPC bez sieci: zadanie zostaje z nowym tokenem (stary jest już zużyty).
    t.setRpc({ data: null, error: { message: 'Failed to fetch' }, status: 0 });
    await t.a.finishSignOut();
    expect(JSON.parse(t.state.jobs!)).toEqual([{ token: 'ab'.repeat(32), refreshToken: 'rt-new' }]);
    // RPC odrzucone jako brak sesji — kończymy (nic już tą sesją nie zrobimy).
    t.setRpc({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 });
    await t.a.finishSignOut();
    expect(t.state.jobs).toBeNull();
    // Token odświeżania nieważny (np. sesja zamknięta) — porzucone; bez sesji w odpowiedzi — też.
    t.state.jobs = JSON.stringify([{ token: 't1', refreshToken: 'r1' }, { token: 't2', refreshToken: 'r2' }]);
    t.refresh.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Invalid Refresh Token', status: 400 } }).mockResolvedValueOnce({ data: { session: null }, error: null });
    await t.a.finishSignOut();
    expect(t.state.jobs).toBeNull();
    // Wyjątek po drodze (np. pęk kluczy) — zadanie zostaje, bez wyjątku na zewnątrz.
    t.state.jobs = JSON.stringify([{ token: 't3', refreshToken: 'r3' }]);
    t.refresh.mockRejectedValueOnce(new Error('boom'));
    await expect(t.a.finishSignOut()).resolves.toBeUndefined();
    expect(JSON.parse(t.state.jobs)).toHaveLength(1);
  });

  it('dwa wywołania naraz — jedno przejście; uszkodzony zapis i błąd pęku kluczy nie przeszkadzają', async () => {
    const t = setup();
    t.state.jobs = JSON.stringify([{ token: 't1', refreshToken: 'r1' }, { zly: 1 }]);
    await Promise.all([t.a.finishSignOut(), t.a.finishSignOut()]);
    expect(t.detached).toHaveBeenCalledTimes(1);
    expect(t.state.jobs).toBeNull();
    t.state.jobs = '{zły';
    await t.a.finishSignOut();
    t.state.jobs = '{"a":1}';
    await t.a.finishSignOut();
    expect(t.detached).toHaveBeenCalledTimes(1);
    // Dwa zadania, oba bez sieci po odświeżeniu: każde ze swoim nowym tokenem.
    t.state.jobs = JSON.stringify([{ token: 't1', refreshToken: 'r1' }, { token: 't2', refreshToken: 'r2' }]);
    t.refresh.mockResolvedValueOnce({ data: { session: { refresh_token: 'n1' } }, error: null }).mockResolvedValueOnce({ data: { session: { refresh_token: 'n2' } }, error: null });
    t.setRpc({ data: null, error: { message: 'Failed to fetch' }, status: 0 });
    await t.a.finishSignOut();
    expect(JSON.parse(t.state.jobs).map((j: { refreshToken: string }) => j.refreshToken)).toEqual(['n1', 'n2']);
    t.setRpc({ data: null, error: null, status: 200 });
    t.state.jobs = null;
    t.signOutJobs.load.mockRejectedValueOnce(new Error('keychain'));
    await expect(t.a.finishSignOut()).resolves.toBeUndefined();
    t.state.jobs = JSON.stringify([{ token: 't1', refreshToken: 'r1' }]);
    t.signOutJobs.save.mockRejectedValue(new Error('keychain'));
    await expect(t.a.finishSignOut()).resolves.toBeUndefined();
  });

  it('bez pamięci zadań albo bez klienta starej sesji: wylogowanie jak dotąd; sesja nieważna — bez zadania', async () => {
    const { client, auth } = fakeClient(() => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }));
    auth.getSession.mockResolvedValue({ data: { session: { refresh_token: 'rt', user: {} } } });
    const pushToken = { load: async () => 'ab', save: async () => {} };
    await expect(supabaseAccount(client, async () => ({ identityToken: null }), { pushToken }).signOut()).resolves.toBeUndefined();
    await expect(supabaseAccount(client, async () => ({ identityToken: null })).finishSignOut()).resolves.toBeUndefined();
    const t = setup();
    t.setRpc({ data: null, error: null, status: 200 });
    const jwt = fakeClient(() => ({ data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }));
    jwt.auth.getSession.mockResolvedValue({ data: { session: { refresh_token: 'rt', user: {} } } });
    const jobs = { load: jest.fn(async () => null), save: jest.fn(async () => {}) };
    await supabaseAccount(jwt.client, async () => ({ identityToken: null }), { pushToken, signOutJobs: jobs, detached: t.detached }).signOut();
    expect(jobs.save).not.toHaveBeenCalled();
    // Bez sesji (brak tokenu odświeżania) — też bez zadania.
    const none = fakeClient(() => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }));
    await supabaseAccount(none.client, async () => ({ identityToken: null }), { pushToken, signOutJobs: jobs, detached: t.detached }).signOut();
    expect(jobs.save).not.toHaveBeenCalled();
  });
});
