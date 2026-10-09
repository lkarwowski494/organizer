/**
 * Supabase jako transport synchronizacji i konto. Klient opisany strukturalnie (tylko to, czego używamy),
 * żeby testy podawały atrapę; w aplikacji to `createClient` z @supabase/supabase-js.
 *
 * Wywołania RPC i funkcji serwera jak w migracjach (supabase/migrations) i supabase/functions — pełna lista to wywołania
 * `rpc(…)` i `functions.invoke(…)` w tym pliku (synchronizacja, grupy, zaproszenia i kody, powiadomienia, zgłoszenia,
 * usunięcie konta); nie wyliczamy ich tu, żeby komentarz się nie rozjeżdżał z kodem. Logowanie Apple wg dokumentacji Supabase
 * (https://supabase.com/docs/guides/auth/social-login/auth-apple, wariant Expo: AppleAuthentication.signInAsync
 * → auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })). W becie tylko Apple (decyzja
 * właściciela 8.10.2026, D177 / audyt 2 M-77): logowania linkiem z e-maila nie ma, więc aplikacja nie przyjmuje też sesji
 * z linku — cudzy link z tokenami nie przełączy jej na obce konto (M-76).
 */
import { inviteUrl, joinUrl } from '../domain/invite-link';
import type { PulledRow, PullResponse, PushResponse } from '../domain/sync-engine/client';
import { AccountError, type AccountApi, type AccountErrorCode, type Invite, type JoinInvite, type JoinResult } from './account';
import { type SyncTransport, TransportError, type TransportErrorKind } from './transport';

export type RpcError = { message: string; code?: string };
export type RpcResult<T> = { data: T | null; error: RpcError | null; status: number };

type Session = { refresh_token?: string; user: { id?: string; app_metadata?: { provider?: string; providers?: string[] } } };
type AuthError = { message: string; status?: number; code?: string } | null;
/** Błąd functions-js: FunctionsFetchError (bez odpowiedzi) albo FunctionsHttpError z odpowiedzią w `context`. */
type FunctionsError = { message: string; name?: string; context?: { json?(): Promise<unknown> } } | null;

export type SupabaseLike = {
  rpc<T>(fn: string, args: object): PromiseLike<RpcResult<T>>;
  auth: {
    signInWithIdToken(a: { provider: 'apple'; token: string }): Promise<{ error: AuthError }>;
    signOut(a: { scope: 'local' }): Promise<{ error: { message: string } | null }>;
    /** Konto na serwerze (GET /user); usunięte konto — błąd z kodem user_not_found (N-228). */
    getUser(): Promise<{ error: AuthError }>;
    updateUser(a: { data: Record<string, string> }): Promise<{ error: { message: string } | null }>;
    getSession(): Promise<{ data: { session: Session | null } }>;
  };
  /** Tylko aktualizacja własnego profilu (D100; RLS i GRANT update (display_name) — migracja core). */
  from(table: 'profiles'): { update(v: { display_name: string }): { eq(col: 'user_id', v: string): PromiseLike<{ error: { message: string } | null }> } };
  functions: { invoke(name: string, opts: { method: 'POST'; body?: object }): Promise<{ data?: unknown; error: FunctionsError }> };
};

/**
 * Sign in with Apple na iPhonie. `fullName` Apple podaje tylko przy pierwszym logowaniu; `authorizationCode` (ważny
 * 5 min, jednorazowy) służy przy usuwaniu konta do unieważnienia tokenu Apple (wymóg Apple, ADR 0016). `scopes: 'none'` —
 * ponowne potwierdzenie bez imienia i adresu. Anulowanie okna:
 * wyjątek z `code: 'ERR_REQUEST_CANCELED'` („rejects with ERR_REQUEST_CANCELED if the user cancels the sign-in
 * operation”, https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/).
 */
export type AppleSignIn = (req?: { scopes?: 'none' }) => Promise<{ identityToken: string | null; authorizationCode?: string | null; fullName?: { givenName?: string | null; familyName?: string | null } | null }>;

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

async function call<T>(client: Pick<SupabaseLike, 'rpc'>, fn: string, args: object): Promise<T> {
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

type JoinCodeRow = { invite_id: string; join_id: string; code: string; expires_at: string };
const joinInvite = (r: JoinCodeRow): JoinInvite => ({ inviteId: r.invite_id, joinId: r.join_id, code: r.code, url: joinUrl({ joinId: r.join_id, code: r.code }), expiresAt: r.expires_at });
/** Odpowiedź accept_invite / join_group; role i invite_role od migracji 20261010100000 (audyt 3, N-157). */
type JoinRow = { group_id: string; already_member?: boolean; role?: string; invite_role?: string };
const joinResult = (r: JoinRow): JoinResult =>
  r.already_member ? { groupId: r.group_id, alreadyMember: { role: r.role ?? null, inviteRole: r.invite_role ?? null } } : { groupId: r.group_id };

function check(r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(r.error.message);
}

/**
 * Ostatni token push zarejestrowany z tego telefonu (w aplikacji: pęk kluczy). Wylogowanie zdejmuje go z serwera także
 * wtedy, gdy rejestracja w tym uruchomieniu się nie udała albo jeszcze nie odbyła (audyt 2, N-11).
 */
export type PushTokenMemory = { load(): Promise<string | null>; save(token: string | null): Promise<void> };
const NO_MEMORY: PushTokenMemory = { load: async () => null, save: async () => {} };

/**
 * Wylogowanie bez internetu (audyt 2, decyzja koordynatora 8.10.2026): serwer nie wie, że token push tego telefonu
 * trzeba zdjąć. Telefon zapamiętuje zadanie „wyrejestruj token” z tokenem odświeżania starej sesji (w aplikacji: pęk
 * kluczy, tylko to urządzenie) i wykonuje je tą starą sesją, gdy wróci sieć — także wtedy, gdy zalogowane jest już inne
 * konto. Bez sesji żadna funkcja serwera nie działa (D41), stąd stara sesja, a nie wywołanie anonimowe.
 * Wylogowanie w zakresie „local” (D176) zamyka na serwerze tylko tę sesję (POST /logout?scope=local); bez sieci to
 * wywołanie się nie udaje, więc sesja na serwerze żyje dalej i jej token odświeżania jeszcze działa.
 */
export type SignOutJob = { token: string; refreshToken: string };
export type SignOutJobMemory = { load(): Promise<string | null>; save(value: string | null): Promise<void> };

/** Osobny klient na starą sesję: bez zapisu sesji w pęku kluczy i bez odświeżania w tle, nie rusza bieżącego konta. */
export type DetachedClient = {
  rpc: SupabaseLike['rpc'];
  auth: {
    refreshSession(a: { refresh_token: string }): Promise<{ data: { session: { refresh_token: string } | null }; error: AuthError }>;
    signOut(a: { scope: 'local' }): Promise<{ error: AuthError }>;
  };
};

export type AccountOptions = { pushToken?: PushTokenMemory; signOutJobs?: SignOutJobMemory; detached?: () => DetachedClient };

const isJob = (j: unknown): j is SignOutJob => typeof j === 'object' && j !== null && typeof (j as SignOutJob).token === 'string' && typeof (j as SignOutJob).refreshToken === 'string';
function parseJobs(raw: string | null): SignOutJob[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter(isJob) : [];
  } catch {
    return [];
  }
}
/** Błąd auth-js bez odpowiedzi serwera (status 0) albo po stronie serwera (5xx) — warto spróbować później. */
const retryable = (e: { status?: number }) => !e.status || e.status >= 500;

/** Okno Apple: anulowanie osobno (bez komunikatu), każdy inny błąd — „Coś poszło nie tak” (N-72, N-73). */
async function askApple(apple: AppleSignIn, req: { scopes?: 'none' }) {
  try {
    return await apple(req);
  } catch (e) {
    throw new AccountError((e as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED' ? 'canceled' : 'failed', String((e as Error | null)?.message ?? e));
  }
}

/** auth-js bez odpowiedzi serwera zwraca status 0 (AuthRetryableFetchError). */
const authCode = (e: NonNullable<AuthError>): AccountErrorCode => (e.status === 0 ? 'network' : 'failed');

/** Kod odpowiedzi funkcji delete-account (handler.ts) z `error.context` — functions-js daje stały komunikat (N-72). */
async function deleteErrorCode(e: NonNullable<FunctionsError>): Promise<AccountErrorCode | 'unknown'> {
  if (e.name === 'FunctionsFetchError') return 'network';
  const body = (await e.context?.json?.().catch(() => null)) as { error?: unknown } | null | undefined;
  if (body?.error === 'apple_code_invalid') return 'apple_mismatch';
  if (body?.error === 'apple_unavailable') return 'apple_unavailable';
  return 'unknown';
}

/** Konto z tożsamością Apple (app_metadata.providers — wszystkie połączone sposoby logowania). */
const isApple = (s: Session | null) => !!s && (s.user.app_metadata?.providers ?? [s.user.app_metadata?.provider]).includes('apple');

export function supabaseAccount(client: SupabaseLike, apple: AppleSignIn, opts: AccountOptions = {}): AccountApi {
  const memory = opts.pushToken ?? NO_MEMORY;
  const jobs = opts.signOutJobs;
  // Token APNs zarejestrowany w tym uruchomieniu (przy starcie, powrocie do aplikacji i zmianie tokenu — HandoffNotifier).
  let pushToken: string | null = null;
  let flushing: Promise<void> | null = null;
  const loadJobs = async () => (jobs ? parseJobs(await jobs.load().catch(() => null)) : []);
  const saveJobs = async (list: SignOutJob[]) => jobs?.save(list.length ? JSON.stringify(list) : null).catch(() => {});

  /** Jedno zadanie starą sesją: true = zrobione albo bez szans (sesja nieważna), false = spróbować później. */
  const runJob = async (job: SignOutJob, update: (j: SignOutJob) => Promise<void>): Promise<boolean> => {
    const old = opts.detached!();
    const r = await old.auth.refreshSession({ refresh_token: job.refreshToken });
    if (r.error || !r.data.session) return !(r.error && retryable(r.error));
    // Token odświeżania jest jednorazowy (rotacja) — nowy zapisany od razu, zanim cokolwiek się nie uda.
    await update({ ...job, refreshToken: r.data.session.refresh_token });
    try {
      await call(old, 'unregister_push_token', { p_token: job.token });
    } catch (e) {
      // Sesja nieważna mimo odświeżenia — kończymy; brak sieci albo błąd serwera — później.
      if ((e as TransportError).kind !== 'auth') return false;
    }
    // Stara sesja nie jest już potrzebna — zamknięta także na serwerze.
    await old.auth.signOut({ scope: 'local' }).catch(() => {});
    return true;
  };

  return {
    async signInWithApple() {
      const credential = await askApple(apple, {});
      if (!credential.identityToken) throw new AccountError('failed', 'apple:no_identity_token');
      const signed = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
      if (signed.error) throw new AccountError(authCode(signed.error), signed.error.message);
      // O-036: imię z Apple (tylko przy pierwszym logowaniu) do konta i profilu — w grupach widać imię, nie „Ja”.
      // Profil tak jak przy „Twoje imię” (setMyName; audyt 2, M-186): wyzwalacz bazy tworzy go przy założeniu konta,
      // zanim imię trafi do metadanych.
      const given = credential.fullName?.givenName?.trim();
      const full = [given, credential.fullName?.familyName?.trim()].filter(Boolean).join(' ');
      if (!given) return;
      check(await client.auth.updateUser({ data: { display_name: given, full_name: full } }));
      const user = (await client.auth.getSession()).data.session?.user.id;
      if (user) check(await client.from('profiles').update({ display_name: given }).eq('user_id', user));
    },
    async signOut() {
      // Audyt 8.10.2026: po wylogowaniu telefon nie dostaje już powiadomień tego konta — token z tego uruchomienia
      // albo zapamiętany (audyt 2, N-11).
      const token = pushToken ?? (await memory.load().catch(() => null));
      pushToken = null;
      let job: SignOutJob | null = null;
      if (token) {
        let handled = true;
        const unregister = () => call(client, 'unregister_push_token', { p_token: token });
        try {
          // Audyt 3, N-224: chwilowy błąd (sieć, serwer) — jedno ponowienie od razu, zanim sesja się skończy.
          await unregister().catch((e: TransportError) => (e.kind === 'auth' ? Promise.reject(e) : unregister()));
        } catch (e) {
          // Bez sieci albo błąd serwera: zadanie na później ze starą sesją. Sesja nieważna (auth) albo brak pamięci zadań —
          // token zostaje zapamiętany (zdejmie go następne wylogowanie albo przejmie inne konto przy rejestracji).
          const refreshToken = jobs && opts.detached && (e as TransportError).kind !== 'auth' ? (await client.auth.getSession()).data.session?.refresh_token : undefined;
          handled = !!refreshToken;
          if (refreshToken) {
            job = { token, refreshToken };
            await saveJobs([...(await loadJobs()), job]);
          }
        }
        // Token zdjęty albo przejęty przez zadanie — następne wylogowanie (innego konta) go nie powtarza.
        if (handled) await memory.save(null).catch(() => {});
      }
      // D176: tylko ten telefon (scope local; domyślny „global” wylogowałby też inne urządzenia konta).
      const r = await client.auth.signOut({ scope: 'local' });
      // Audyt 2 (S-24): auth-js bez sieci i tak usuwa sesję z telefonu, ale zwraca błąd (GoTrueClient._signOut) —
      // wylogowanie się udało, więc bez wyjątku. Błąd tylko, gdy sesja została.
      if (r.error && (await client.auth.getSession()).data.session) throw new Error(r.error.message);
      // Serwer zamknął sesję — zadanie starą sesją i tak by się nie udało. N-224: token wraca do pamięci, żeby zdjęło go
      // następne wylogowanie, a rejestracja przy następnym zalogowaniu przepisała na nowe konto (register_push_token).
      if (job && !r.error) {
        await saveJobs((await loadJobs()).filter((j) => j.refreshToken !== job.refreshToken));
        await memory.save(token).catch(() => {});
      }
    },
    finishSignOut() {
      // Jedno przejście naraz (start, powrót do aplikacji, zmiana konta i ponawianie mogą przyjść razem).
      flushing ??= (async () => {
        let list = await loadJobs();
        for (const job of [...list]) {
          let current = job;
          const update = async (next: SignOutJob) => {
            list = list.map((j) => (j === current ? next : j));
            current = next;
            await saveJobs(list);
          };
          const done = await runJob(job, update).catch(() => false);
          if (done) {
            list = list.filter((j) => j !== current);
            await saveJobs(list);
          }
        }
      })().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    async deleteAccount({ deleteEntries, beforeSignOut } = {}) {
      // M-303 (PWD-34 A): konto z Apple potwierdza usunięcie świeżym kodem autoryzacji — serwer sprawdza go w Apple
      // i unieważnia token Apple (wymóg Apple, O-036, ADR 0016). Okno Apple to ponowne potwierdzenie tożsamości.
      const code = isApple((await client.auth.getSession()).data.session) ? ((await askApple(apple, { scopes: 'none' })).authorizationCode ?? null) : undefined;
      if (code === null) throw new AccountError('failed', 'apple:no_authorization_code');
      // Funkcja serwerowa sprawdza JWT i usuwa użytkownika; dane sprząta wyzwalacz bazy (D49, ADR 0004). Wybór
      // „Usuń też moje wpisy” (N-71) tylko, gdy zaznaczony — starsza wersja funkcji go nie zna, a brak = jak dotąd.
      const body = { ...(code ? { appleAuthorizationCode: code } : {}), ...(deleteEntries ? { deleteEntries: true } : {}) };
      const r = await client.functions.invoke('delete-account', { method: 'POST', ...(Object.keys(body).length ? { body } : {}) });
      if (r.error) {
        const kind = await deleteErrorCode(r.error);
        // N-228: odpowiedź mogła zginąć po usunięciu (zerwana sieć) albo to ponowna próba po takim usunięciu (401 z funkcji).
        // Serwer Auth mówi user_not_found tylko o koncie, którego już nie ma — wtedy to sukces.
        const gone = (kind === 'network' || kind === 'unknown') && (await client.auth.getUser().catch(() => ({ error: null }))).error?.code === 'user_not_found';
        if (!gone) throw new AccountError(kind === 'unknown' ? 'failed' : kind, r.error.message);
      }
      // Konto już nie istnieje: tokeny push usunął serwer razem z kontem (push_tokens: on delete cascade).
      pushToken = null;
      await memory.save(null).catch(() => {});
      // Sprzątanie telefonu (M-64) przed końcem sesji — ekrany jeszcze działają.
      await beforeSignOut?.().catch(() => {});
      // Jak przy wylogowaniu (S-24): błąd liczy się tylko wtedy, gdy sesja została na telefonie.
      const out = await client.auth.signOut({ scope: 'local' });
      if (out.error && (await client.auth.getSession()).data.session) throw new AccountError('failed', out.error.message);
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
      return joinResult(await call<JoinRow>(client, 'accept_invite', { token, display_name: displayName }));
    },
    async revokeInvite(inviteId) {
      await call(client, 'revoke_invite', { invite_id: inviteId });
    },
    async createJoinCode(groupId, role) {
      return joinInvite(await call<JoinCodeRow>(client, 'create_join_code', { group_id: groupId, role }));
    },
    async renewJoinCode(groupId, role) {
      return joinInvite(await call<JoinCodeRow>(client, 'renew_join_code', { group_id: groupId, role }));
    },
    async createChildCode(memberId) {
      return joinInvite(await call<JoinCodeRow>(client, 'create_child_code', { member_id: memberId }));
    },
    async renewChildCode(memberId) {
      return joinInvite(await call<JoinCodeRow>(client, 'renew_child_code', { member_id: memberId }));
    },
    async joinGroup(joinId, code, displayName) {
      // Serwer zwraca błąd w treści (nie wyjątkiem), żeby zapis nieudanej próby nie został wycofany.
      const r = await call<Partial<JoinRow> & { error?: string }>(client, 'join_group', { join_id: joinId, code, display_name: displayName });
      if (r.error || !r.group_id) throw new TransportError('server', r.error ?? 'invite_invalid');
      return joinResult({ ...r, group_id: r.group_id });
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
      // Ten sam token jest już na serwerze z tego uruchomienia (powrót do aplikacji, nasłuch zmiany) — bez zapisu.
      if (token === pushToken) return;
      await call(client, 'register_push_token', { p_token: token, p_env: env });
      pushToken = token;
      await memory.save(token).catch(() => {});
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
    async notifyGroups(r) {
      // To urządzenie ma już zmiany — serwer go nie budzi (token z tego uruchomienia albo zapamiętany).
      const except = pushToken ?? (await memory.load().catch(() => null));
      const res = await client.functions.invoke('notify-handoff', { method: 'POST', body: { groups: r.groups, retry: r.retry, ...(except ? { except } : {}) } });
      check(res);
      const retry = (res.data as { retryInSec?: unknown } | null | undefined)?.retryInSec;
      return { retryInSec: typeof retry === 'number' ? retry : null };
    },
  };
}
