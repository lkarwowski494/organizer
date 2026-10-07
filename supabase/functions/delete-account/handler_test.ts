import { handle } from './handler.ts';

const ID = '0199a3b4-0000-7000-8000-000000000001';

function env(vars: Record<string, string>) {
  return { get: (k: string) => vars[k] };
}
const ENV = env({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEYS: '{"default":"pub"}', SUPABASE_SECRET_KEYS: '{"default":"sec"}' });

function fakeFetch(userStatus = 200, user: object = { id: ID }, delStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return Promise.resolve(new Response(JSON.stringify(user), { status: userStatus }));
    return Promise.resolve(new Response('{}', { status: delStatus }));
  }) as typeof fetch;
  return { f, calls };
}
const post = (auth?: string) => new Request('https://fn/delete-account', { method: 'POST', headers: auth ? { authorization: auth } : {} });

function assertEq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

Deno.test('usuwa zalogowanego użytkownika kluczem tajnym', async () => {
  const { f, calls } = fakeFetch();
  const r = await handle(post('Bearer jwt'), ENV, f);
  assertEq(r.status, 200);
  assertEq(calls.map((c) => c.url), ['https://x.supabase.co/auth/v1/user', `https://x.supabase.co/auth/v1/admin/users/${ID}`]);
  assertEq((calls[0]!.init!.headers as Record<string, string>).authorization, 'Bearer jwt');
  assertEq((calls[0]!.init!.headers as Record<string, string>).apikey, 'pub');
  assertEq(calls[1]!.init!.method, 'DELETE');
  assertEq((calls[1]!.init!.headers as Record<string, string>).authorization, 'Bearer sec');
});

Deno.test('bez sesji, zła metoda, nieważny JWT, dziwne id: nic nie usuwa', async () => {
  for (const [req, f, status] of [
    [post(), fakeFetch(), 401],
    [new Request('https://fn', { method: 'GET' }), fakeFetch(), 405],
    [post('Bearer jwt'), fakeFetch(401), 401],
    [post('Bearer jwt'), fakeFetch(200, { id: '../../x' }), 401],
    [post('Bearer jwt'), fakeFetch(200, {}), 401],
  ] as const) {
    const r = await handle(req, ENV, f.f);
    assertEq(r.status, status);
    assertEq(f.calls.some((c) => c.init?.method === 'DELETE'), false);
  }
});

Deno.test('błąd usuwania i brak konfiguracji; starsze nazwy kluczy działają', async () => {
  assertEq((await handle(post('Bearer jwt'), ENV, fakeFetch(200, { id: ID }, 500).f)).status, 502);
  assertEq((await handle(post('Bearer jwt'), env({}), fakeFetch().f)).status, 500);
  assertEq((await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'u' }), fakeFetch().f)).status, 500);
  const legacy = fakeFetch();
  const r = await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv' }), legacy.f);
  assertEq(r.status, 200);
  assertEq((legacy.calls[1]!.init!.headers as Record<string, string>).apikey, 'srv');
  const empty = fakeFetch();
  assertEq((await handle(post('Bearer jwt'), env({ SUPABASE_URL: 'https://x', SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_ANON_KEY: 'a', SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 's' }), empty.f)).status, 200);
});
