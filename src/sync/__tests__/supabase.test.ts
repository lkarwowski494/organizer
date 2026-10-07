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
  };
  const functions = { invoke: jest.fn(async () => ({ error: null as { message: string } | null })) };
  const client: SupabaseLike = {
    rpc: async <T,>(fn: string, args: object) => {
      const c = { fn, args: args as Record<string, unknown> };
      calls.push(c);
      return reply(c) as RpcResult<T>;
    },
    auth,
    functions,
  };
  return { client, calls, auth, functions };
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
    const { client, calls } = fakeClient(({ fn }) => ({ data: fn === 'sync_fetch_scope' ? { rows: [{ e: 'lists', v: 1, row: {} }] } : fn === 'create_invite' ? { invite_id: 'i', token: 't'.repeat(64), expires_at: 'x', max_uses: 10 } : fn === 'accept_invite' ? { group_id: 'g' } : { ok: 1 }, error: null, status: 200 }));
    const t = supabaseTransport(client);
    const a = supabaseAccount(client, async () => ({ identityToken: 'jwt' }));
    expect(await t.push({ client_id: 'c', schema_version: 1, ops: [] })).toEqual({ ok: 1 });
    expect(await t.pull({ g: 3 }, 1000)).toEqual({ ok: 1 });
    expect(await t.fetchScope('l')).toEqual([{ e: 'lists', v: 1, row: {} }]);
    await a.createGroup({ groupId: 'g', name: 'Rodzina', ownerMemberId: 'm', displayName: 'Ł' });
    expect(await a.createInvite('g', 'admin')).toEqual({ inviteId: 'i', token: 't'.repeat(64), url: `${config.URL_SCHEME}://invite/${'t'.repeat(64)}`, expiresAt: 'x', maxUses: 10 });
    expect(await a.acceptInvite('tok', 'Ł')).toEqual({ groupId: 'g' });
    await a.revokeInvite('i');
    await a.deleteGroup('g');
    await a.restoreGroup('g');
    await a.transferOwnership('g', 'm');
    const params = sqlParams();
    for (const c of calls) {
      expect(params.has(c.fn)).toBe(true);
      for (const k of Object.keys(c.args)) expect(params.get(c.fn)).toContain(k);
    }
    expect(calls.map((c) => c.fn)).toEqual(['sync_push', 'sync_pull', 'sync_fetch_scope', 'create_group', 'create_invite', 'accept_invite', 'revoke_invite', 'delete_group', 'restore_group', 'transfer_ownership']);
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
  it('Apple: token tożsamości do signInWithIdToken; brak tokenu i błąd zgłaszane', async () => {
    const { client, auth } = fakeClient();
    await supabaseAccount(client, async () => ({ identityToken: 'jwt' })).signInWithApple();
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'jwt' });
    await expect(supabaseAccount(client, async () => ({ identityToken: null })).signInWithApple()).rejects.toThrow('apple:no_identity_token');
    auth.signInWithIdToken.mockResolvedValueOnce({ error: { message: 'invalid' } });
    await expect(supabaseAccount(client, async () => ({ identityToken: 'x' })).signInWithApple()).rejects.toThrow('invalid');
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
