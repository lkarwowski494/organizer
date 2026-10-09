-- Audyt 3, PK-01, N-95 (A3-06-6): obrona w głąb dla schematu private. Schemat nie jest wystawiony w API (supabase/config.toml:
-- [api] schemas = public, graphql_public; pilnuje src/config/__tests__/sql.contract.test.ts), ale gdyby ktoś go dodał,
-- konto nie powinno móc wołać funkcji, których nie potrzebuje, ani budzić cudzych grup.
--  * Rola authenticated wykonuje w private tylko funkcje z listy w supabase/tests/server_limits.test.sql — wołane przez
--    polityki RLS, ograniczenia CHECK, wyzwalacze bez SECURITY DEFINER i funkcje SECURITY INVOKER (sync_push, sync_pull,
--    publiczne RPC). Odbieramy trzy niepotrzebne: is_uuid_v5 (tylko strażnicy id, DEFINER), occurrence_responsible (tylko
--    funkcje DEFINER), tombstone_days (tylko sprzątanie i funkcje DEFINER).
--  * private.poke_groups wysyła sygnał Realtime tylko do grup, w których wołający jest albo był członkiem (wiersz w
--    group_members — także po wyjściu z grupy, żeby pozostali dostali sygnał o tej zmianie). Sygnał nie niesie treści,
--    tylko numer wersji grupy.
-- Zastępuje: private.poke_groups(uuid[]) (20261006120200_sync).

create or replace function private.poke_groups(gids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  for g in select distinct x from unnest(gids) x
           where exists (select 1 from public.group_members m where m.group_id = x and m.user_id = (select auth.uid())) loop
    perform realtime.send(jsonb_build_object('v', (select version from public.groups where id = g)),
                          'poke', 'group:' || g, true);
  end loop;
end $$;

revoke execute on function private.is_uuid_v5(uuid), private.occurrence_responsible(public.events, date), private.tombstone_days() from authenticated;
