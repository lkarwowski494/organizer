/**
 * Supabase jako transport synchronizacji i konto. Klient opisany strukturalnie (tylko to, czego używamy),
 * żeby testy podawały atrapę; w aplikacji to `createClient` z @supabase/supabase-js.
 *
 * Wywołania RPC jak w migracjach (supabase/migrations): sync_push, sync_pull, sync_fetch_scope,
 * create_group, create_invite, accept_invite, revoke_invite. Logowanie Apple wg dokumentacji Supabase
 * (https://supabase.com/docs/guides/auth/social-login/auth-apple, wariant Expo: AppleAuthentication.signInAsync
 * → auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })). Magic link: signInWithOtp
 * z emailRedirectTo = adres w schemacie aplikacji (D40), sesję z linku ustawia auth.setSession
 * (https://supabase.com/docs/guides/auth/native-mobile-deep-linking).
 */
import { config } from '../config';
import { inviteUrl, joinUrl } from '../domain/invite-link';
import type { PulledRow, PullResponse, PushResponse } from '../domain/sync-engine/client';
import type { AccountApi, Invite } from './account';
import { type SyncTransport, TransportError, type TransportErrorKind } from './transport';

export type RpcError = { message: string; code?: string };
export type RpcResult<T> = { data: T | null; error: RpcError | null; status: number };

export type SupabaseLike = {
  rpc<T>(fn: string, args: object): PromiseLike<RpcResult<T>>;
  auth: {
    signInWithIdToken(a: { provider: 'apple'; token: string }): Promise<{ error: { message: string } | null }>;
    signInWithOtp(a: { email: string; options: { emailRedirectTo: string } }): Promise<{ error: { message: string } | null }>;
    signOut(a?: { scope: 'local' | 'global' }): Promise<{ error: { message: string } | null }>;
    updateUser(a: { data: Record<string, string> }): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{ data: { session: { user: { id?: string; app_metadata?: { provider?: string } } } | null } }>;
  };
  /** Tylko aktualizacja własnego profilu (D100; RLS i GRANT update (display_name) — migracja core). */
  from(table: 'profiles'): { update(v: { display_name: string }): { eq(col: 'user_id', v: string): PromiseLike<{ error: { message: string } | null }> } };
  functions: { invoke(name: string, opts: { method: 'POST'; body?: object }): Promise<{ error: { message: string } | null }> };
};

/**
 * Sign in with Apple na iPhonie. `fullName` Apple podaje tylko przy pierwszym logowaniu; `authorizationCode` (ważny
 * 5 min, jednorazowy) służy przy usuwaniu konta do unieważnienia tokenu Apple (wymóg Apple, ADR 0016).
 */
export type AppleSignIn = (scopes?: 'none') => Promise<{ identityToken: string | null; authorizationCode?: string | null; fullName?: { givenName?: string | null; familyName?: string | null } | null }>;

/** Adres, na który wraca link z e-maila (Supabase: lista „Redirect URLs” = io.github.lkarwowski494.organizer://**). */
export const AUTH_REDIRECT = `${config.URL_SCHEME}://auth/callback`;

/**
 * Błędy trwałe protokołu (raise exception w sync_push / sync_pull, kod P0001): ponawianie nic nie zmieni, więc pętla
 * czeka na powrót do aplikacji, a wskaźnik mówi, co zrobić (upgrade_required → „Zaktualizuj aplikację”; audyt 2, M-57).
 */
export const FATAL_CODES: readonly string[] = ['upgrade_required', 'client_mismatch', 'batch_too_large', 'invalid_batch', 'invalid_batch:seq', 'invalid_entities'];

/**
 * Rodzaj błędu dla pętli: status 0 = fetch się nie udał (postgrest-js zwraca wtedy status 0),
 * 401 / kody PGRST30x = sesja (JWT) nieważna, kod trwały protokołu = fatal, reszta = błąd serwera (ponowienie z opóźnieniem).
 */
export function classify(r: { error: RpcError; status: number }): TransportErrorKind {
  if (r.status === 0) return 'network';
  if (r.status === 401 || r.error.code?.startsWith('PGRST30')) return 'auth';
  if (r.error.code === 'P0001' && FATAL_CODES.includes(r.error.message)) return 'fatal';
  return 'server';
}

async function call<T>(client: SupabaseLike, fn: string, args: object): Promise<T> {
  const r = await client.rpc<T>(fn, args);
  if (r.error) throw new TransportError(classify({ error: r.error, status: r.status }), r.error.message);
  return r.data as T;
}

export function supabaseTransport(client: SupabaseLike): SyncTransport {
  return {
    push: (req) => call<PushResponse>(client, 'sync_push', { client_id: req.client_id, schema_version: req.schema_version, ops: req.ops }),
    pull: (req, limit) => call<PullResponse>(client, 'sync_pull', { cursors: req.cursors, lim: limit, schema_version: req.schema_version, entities: req.entities }),
    fetchScope: async (listId) => (await call<{ rows: PulledRow[] }>(client, 'sync_fetch_scope', { list_id: listId })).rows,
  };
}

function check(r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(r.error.message);
}

export function supabaseAccount(client: SupabaseLike, apple: AppleSignIn): AccountApi {
  // Token APNs zarejestrowany w tej sesji aplikacji (rejestracja przy każdym starcie, HandoffNotifier).
  let pushToken: string | null = null;
  return {
    async signInWithApple() {
      const credential = await apple();
      if (!credential.identityToken) throw new Error('apple:no_identity_token');
      check(await client.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken }));
      // O-036: imię z Apple (tylko przy pierwszym logowaniu) do profilu — w grupach widać imię, nie „Ja”.
      const given = credential.fullName?.givenName?.trim();
      const full = [given, credential.fullName?.familyName?.trim()].filter(Boolean).join(' ');
      if (given) check(await client.auth.updateUser({ data: { display_name: given, full_name: full } }));
    },
    async sendMagicLink(email) {
      check(await client.auth.signInWithOtp({ email, options: { emailRedirectTo: AUTH_REDIRECT } }));
    },
    async signOut() {
      // Audyt 8.10.2026: po wylogowaniu telefon nie dostaje już powiadomień tego konta. Brak sieci nie blokuje
      // wylogowania — wtedy token zostaje na serwerze, aż APNs zgłosi go jako nieważny albo zaloguje się ktoś inny.
      if (pushToken) {
        try {
          await call(client, 'unregister_push_token', { p_token: pushToken });
          pushToken = null;
        } catch {
          // jak wyżej
        }
      }
      check(await client.auth.signOut());
    },
    async deleteAccount() {
      // Konto z Apple: świeży kod autoryzacji, żeby serwer unieważnił token Apple (wymóg Apple, O-036, ADR 0016).
      const provider = (await client.auth.getSession()).data.session?.user.app_metadata?.provider;
      const code = provider === 'apple' ? (await apple('none')).authorizationCode : null;
      if (provider === 'apple' && !code) throw new Error('apple:no_authorization_code');
      // Funkcja serwerowa sprawdza JWT i usuwa użytkownika; dane sprząta wyzwalacz bazy (D49, ADR 0004).
      check(await client.functions.invoke('delete-account', { method: 'POST', ...(code ? { body: { appleAuthorizationCode: code } } : {}) }));
      // Konto już nie istnieje, więc tylko lokalne wylogowanie (globalne wymagałoby ważnej sesji na serwerze).
      check(await client.auth.signOut({ scope: 'local' }));
    },
    async setMyName(name) {
      check(await client.auth.updateUser({ data: { display_name: name } }));
      const user = (await client.auth.getSession()).data.session?.user.id;
      if (user) check(await client.from('profiles').update({ display_name: name }).eq('user_id', user));
    },
    async createGroup(a) {
      await call(client, 'create_group', { group_id: a.groupId, name: a.name, owner_member_id: a.ownerMemberId, owner_display_name: a.displayName });
    },
    async createInvite(groupId, role): Promise<Invite> {
      const r = await call<{ invite_id: string; token: string; expires_at: string; max_uses: number }>(client, 'create_invite', { group_id: groupId, role });
      return { inviteId: r.invite_id, token: r.token, url: inviteUrl(r.token), expiresAt: r.expires_at, maxUses: r.max_uses };
    },
    async acceptInvite(token, displayName) {
      const r = await call<{ group_id: string }>(client, 'accept_invite', { token, display_name: displayName });
      return { groupId: r.group_id };
    },
    async revokeInvite(inviteId) {
      await call(client, 'revoke_invite', { invite_id: inviteId });
    },
    async createJoinCode(groupId, role) {
      const r = await call<{ invite_id: string; join_id: string; code: string; expires_at: string }>(client, 'create_join_code', { group_id: groupId, role });
      return { inviteId: r.invite_id, joinId: r.join_id, code: r.code, url: joinUrl({ joinId: r.join_id, code: r.code }), expiresAt: r.expires_at };
    },
    async joinGroup(joinId, code, displayName) {
      // Serwer zwraca błąd w treści (nie wyjątkiem), żeby zapis nieudanej próby nie został wycofany.
      const r = await call<{ group_id?: string; error?: string }>(client, 'join_group', { join_id: joinId, code, display_name: displayName });
      if (r.error || !r.group_id) throw new TransportError('server', r.error ?? 'invite_invalid');
      return { groupId: r.group_id };
    },
    async rotateJoinId(groupId) {
      return call<string>(client, 'rotate_join_id', { group_id: groupId });
    },
    async deleteGroup(groupId) {
      await call(client, 'delete_group', { group_id: groupId });
    },
    async restoreGroup(groupId) {
      await call(client, 'restore_group', { group_id: groupId });
    },
    async transferOwnership(groupId, memberId) {
      await call(client, 'transfer_ownership', { group_id: groupId, member_id: memberId });
    },
    async registerPushToken(token, env) {
      await call(client, 'register_push_token', { p_token: token, p_env: env });
      pushToken = token;
    },
    async notifyAssignment(activityId) {
      check(await client.functions.invoke('notify-handoff', { method: 'POST', body: { activityId } }));
    },
    async getPushMutes() {
      return (await call<string[] | null>(client, 'my_push_mutes', {})) ?? [];
    },
    async setPushMute(groupId, muted) {
      await call(client, 'set_push_mute', { p_group: groupId, p_muted: muted });
    },
    async reportError(e) {
      await call(client, 'report_client_error', { p_kind: e.kind, p_message: e.message, p_stack: e.stack, p_screen: e.screen, p_app_version: e.appVersion });
    },
    async sendFeedback(a) {
      await call(client, 'send_feedback', { p_message: a.message, p_screen: a.screen, p_app_version: a.appVersion });
    },
    async notifyHandoff(handoffId) {
      check(await client.functions.invoke('notify-handoff', { method: 'POST', body: { handoffId } }));
    },
  };
}

/** Sesja z linku w e-mailu: tokeny we fragmencie (#access_token=…&refresh_token=…) albo w zapytaniu. */
export function parseAuthCallback(url: string): { access_token: string; refresh_token: string } | { error: string } | null {
  if (!url.startsWith(AUTH_REDIRECT)) return null;
  const rest = url.slice(AUTH_REDIRECT.length).replace(/^[?#]/, '');
  const params = new URLSearchParams(rest.replace('#', '&'));
  const error = params.get('error_description') ?? params.get('error');
  if (error) return { error };
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}
