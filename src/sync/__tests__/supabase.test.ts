import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../../config';
import { AUTH_REDIRECT, classify, parseAuthCallback, type RpcResult, supabaseAccount, supabaseTransport, type SupabaseLike } from '../supabase';
import { TransportError } from '../transport';

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(reply: (c: Call) => RpcResult<unknown> = () => ({ data: {}, error: null, status: 200 })) {
  const calls: Call[] = [];
  const auth = {
    signInWithIdToken: jest.fn(async () => ({ error: null as { message: string } | null })),
    signInWithOtp: jest.fn(async () => ({ error: null as { message: string } | null })),
    signOut: jest.fn(async () => ({ error: null as { message: string } | null })),
    updateUser: jest.fn(async () => ({ error: null as { message: string } | null })),
    getSession: jest.fn(async () => ({ data: { session: null as { user: { id?: string; app_metadata?: { provider?: string } } } | null } })),
  };
  const functions = { invoke: jest.fn(async () => ({ error: null as { message: string } | null })) };
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
    expect(await t.push({ client_id: 'c', schema_version: 1, ops: [] })).toEqual({ ok: 1 });
    expect(await t.pull({ g: 3 }, 1000)).toEqual({ ok: 1 });
    expect(await t.fetchScope('l')).toEqual([{ e: 'lists', v: 1, row: {} }]);
    await a.createGroup({ groupId: 'g', name: 'Rodzina', ownerMemberId: 'm', displayName: 'Ł' });
    expect(await a.createInvite('g', 'admin')).toEqual({ inviteId: 'i', token: 't'.repeat(64), url: `${config.URL_SCHEME}://invite/${'t'.repeat(64)}`, expiresAt: 'x', maxUses: 10 });
    expect(await a.acceptInvite('tok', 'Ł')).toEqual({ groupId: 'g' });
    await a.revokeInvite('i');
    await a.createJoinCode('g', 'member');
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
    expect(calls.map((c) => c.fn)).toEqual(['sync_push', 'sync_pull', 'sync_fetch_scope', 'create_group', 'create_invite', 'accept_invite', 'revoke_invite', 'create_join_code', 'rotate_join_id', 'delete_group', 'restore_group', 'transfer_ownership', 'register_push_token', 'report_client_error', 'send_feedback', 'my_push_mutes', 'set_push_mute']);
    expect(calls[1]!.args).toEqual({ cursors: { g: 3 }, lim: 1000 });
  });

  it('błędy: sieć, sesja, serwer — z treścią komunikatu', async () => {
    const replies: RpcResult<unknown>[] = [
      { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      { data: null, error: { message: 'JWT expired', code: 'PGRST303' }, status: 401 },
      { data: null, error: { message: 'invite_expired', code: 'P0001' }, status: 400 },
    ];
    const { client } = fakeClient(() => replies.shift()!);
    const t = supabaseTransport(client);
    await expect(t.pull({}, 1)).rejects.toMatchObject({ kind: 'network' });
    await expect(t.pull({}, 1)).rejects.toMatchObject({ kind: 'auth', message: 'JWT expired' });
    const e = await supabaseAccount(client, async () => ({ identityToken: null })).acceptInvite('t', 'x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransportError);
    expect(e).toMatchObject({ kind: 'server', message: 'invite_expired' });
  });

  it('klasyfikacja', () => {
    expect(classify({ error: { message: '' }, status: 0 })).toBe('network');
    expect(classify({ error: { message: '' }, status: 401 })).toBe('auth');
    expect(classify({ error: { message: '', code: 'PGRST301' }, status: 403 })).toBe('auth');
    expect(classify({ error: { message: '' }, status: 500 })).toBe('server');
  });
});

describe('Supabase: konto', () => {
  it('ID grupy + kod: kod z linkiem; dołączenie; błąd w treści odpowiedzi', async () => {
    const replies: RpcResult<unknown>[] = [
      { data: { invite_id: 'i', join_id: '482913507', code: '731064', expires_at: 'x' }, error: null, status: 200 },
      { data: { group_id: 'gf' }, error: null, status: 200 },
      { data: { error: 'rate_limited' }, error: null, status: 200 },
      { data: {}, error: null, status: 200 },
    ];
    const { client, calls } = fakeClient(() => replies.shift()!);
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    expect(await a.createJoinCode('g', 'admin')).toEqual({ inviteId: 'i', joinId: '482913507', code: '731064', url: `${config.invites.JOIN_LINK}?g=482913507&c=731064`, expiresAt: 'x' });
    expect(await a.joinGroup('482913507', '731064', 'Ala')).toEqual({ groupId: 'gf' });
    expect(calls[1]).toEqual({ fn: 'join_group', args: { join_id: '482913507', code: '731064', display_name: 'Ala' } });
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

  it('magic link z adresem powrotu w schemacie aplikacji, wylogowanie, usunięcie konta', async () => {
    const { client, auth, functions } = fakeClient();
    const a = supabaseAccount(client, async () => ({ identityToken: null }));
    await a.sendMagicLink('ala@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ala@example.com', options: { emailRedirectTo: `${config.URL_SCHEME}://auth/callback` } });
    await a.signOut();
    expect(auth.signOut).toHaveBeenLastCalledWith();
    await a.deleteAccount();
    expect(functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
    functions.invoke.mockResolvedValueOnce({ error: { message: 'unauthorized' } });
    await expect(a.deleteAccount()).rejects.toThrow('unauthorized');
    // Konto z Apple: świeży kod autoryzacji do unieważnienia tokenu; bez kodu — nie usuwamy.
    const appleFn = jest.fn(async () => ({ identityToken: 'jwt', authorizationCode: 'code-1' }));
    auth.getSession.mockResolvedValue({ data: { session: { user: { app_metadata: { provider: 'apple' } } } } });
    await supabaseAccount(client, appleFn).deleteAccount();
    expect(appleFn).toHaveBeenCalledWith('none');
    expect(functions.invoke).toHaveBeenLastCalledWith('delete-account', { method: 'POST', body: { appleAuthorizationCode: 'code-1' } });
    await expect(supabaseAccount(client, async () => ({ identityToken: 'jwt', authorizationCode: null })).deleteAccount()).rejects.toThrow('apple:no_authorization_code');
    auth.getSession.mockResolvedValue({ data: { session: { user: {} } } });
    await a.deleteAccount();
    expect(functions.invoke).toHaveBeenLastCalledWith('delete-account', { method: 'POST' });
    await a.notifyHandoff('h1');
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { handoffId: 'h1' } });
    await a.notifyAssignment('a1');
    expect(functions.invoke).toHaveBeenLastCalledWith('notify-handoff', { method: 'POST', body: { activityId: 'a1' } });
  });
});

describe('link z e-maila', () => {
  it('tokeny we fragmencie albo w zapytaniu, błąd, obcy adres', () => {
    expect(parseAuthCallback(`${AUTH_REDIRECT}#access_token=a&refresh_token=r&type=magiclink`)).toEqual({ access_token: 'a', refresh_token: 'r' });
    expect(parseAuthCallback(`${AUTH_REDIRECT}?access_token=a&refresh_token=r`)).toEqual({ access_token: 'a', refresh_token: 'r' });
    expect(parseAuthCallback(`${AUTH_REDIRECT}#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`)).toEqual({ error: 'Email link is invalid or has expired' });
    expect(parseAuthCallback(`${AUTH_REDIRECT}?error=server_error`)).toEqual({ error: 'server_error' });
    expect(parseAuthCallback(`${AUTH_REDIRECT}#access_token=a`)).toBeNull();
    expect(parseAuthCallback(`${config.URL_SCHEME}://invite/x`)).toBeNull();
  });
});
