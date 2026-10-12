-- Grupa odłożona przez budżet porcji przy pobraniu od zera (seed 1482257602; migracja 20261012020000_pull_deferred_resync):
-- porcja dla kursora 0 przychodzi z resync, żeby telefon zebrał grupę w całości (client.ts, fromScratch).
begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000003a1', 'a03@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.ents() returns jsonb language sql as $$
  select '["groups","group_members","lists","object_members","tasks","activity","events","event_participants","event_overrides","event_task_series","handoffs","event_rsvps","my_day_scopes","shopping_trips"]'::jsonb
$$;
create function pg_temp.g_of(res jsonb, g text) returns jsonb language sql as $$
  select x from jsonb_array_elements(res -> 'groups') x where x ->> 'group_id' = g
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Ala: dwie grupy (rodzina R i działka D), w każdej lista z zadaniem.
select pg_temp.as_user('00000000-0000-7000-8000-0000000003a1');
set local role authenticated;
select public.create_group('03030000-0000-7000-8000-000000000001', 'Rodzina', '03030000-0000-7000-8000-0000000000a1', 'Ala');
select public.create_group('03030000-0000-7000-8000-000000000002', 'Działka', '03030000-0000-7000-8000-0000000000a2', 'Ala');
select public.sync_push('03030000-0000-7000-8000-00000000c0a1', 2, jsonb_build_array(
  '{"seq":1,"kind":"create","entity":"lists","id":"03030000-0000-7000-8000-0000000001a1","group_id":"03030000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}'::jsonb,
  '{"seq":2,"kind":"create","entity":"tasks","id":"03030000-0000-7000-8000-0000000002a1","group_id":"03030000-0000-7000-8000-000000000001","set":{"list_id":"03030000-0000-7000-8000-0000000001a1","title":"Pranie"}}'::jsonb,
  '{"seq":3,"kind":"create","entity":"lists","id":"03030000-0000-7000-8000-0000000001a2","group_id":"03030000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"Działka"}}'::jsonb,
  '{"seq":4,"kind":"create","entity":"tasks","id":"03030000-0000-7000-8000-0000000002a2","group_id":"03030000-0000-7000-8000-000000000002","set":{"list_id":"03030000-0000-7000-8000-0000000001a2","title":"Skosić"}}'::jsonb));

-- Pobranie od zera z porcją o jednym wierszu: Rodzina dostaje porcję, Działka wraca odłożona z kursorem 0.
create temp table first as select public.sync_pull('{}'::jsonb, 1, 2, pg_temp.ents()) r;
grant all on first to authenticated;
select is(pg_temp.g_of((select r from first), '03030000-0000-7000-8000-000000000002') ->> 'cursor', '0', '1: Działka odłożona z kursorem 0');
select is(pg_temp.g_of((select r from first), '03030000-0000-7000-8000-000000000002') ->> 'resync', 'false', '2: odłożona bez resync (bez wierszy)');

-- Telefon zapisał kursory z odpowiedzi — dla Działki 0 (po ponownym uruchomieniu bez porcji w toku) — i pobiera dalej.
create temp table cur as select jsonb_object_agg(g ->> 'group_id', jsonb_build_object('v', (g ->> 'cursor')::bigint, 'p', 0)) c
  from jsonb_array_elements((select r -> 'groups' from first)) g;
grant all on cur to authenticated;
create temp table second as select public.sync_pull((select c from cur), 1000, 2, pg_temp.ents()) r;
grant all on second to authenticated;
select is(pg_temp.g_of((select r from second), '03030000-0000-7000-8000-000000000002') ->> 'resync', 'true', '3: porcja Działki dla kursora 0 — resync (telefon zbiera grupę od nowa)');
select ok(jsonb_array_length(pg_temp.g_of((select r from second), '03030000-0000-7000-8000-000000000002') -> 'rows') > 0, '4: z wierszami grupy');
select is((select array_agg(distinct g ->> 'resync') from jsonb_array_elements((select r -> 'groups' from second)) g
           where ((select c from cur) -> (g ->> 'group_id') ->> 'v')::bigint > 0), array['false'], '5: grupa z kursorem > 0 bez resync');

-- Następna porcja Działki (kursor > 0) już bez resync — pobieranie się kończy.
select is(pg_temp.g_of(public.sync_pull(jsonb_build_object('03030000-0000-7000-8000-000000000002',
            jsonb_build_object('v', 1, 'p', 0)), 1000, 2, pg_temp.ents()), '03030000-0000-7000-8000-000000000002') ->> 'resync', 'false',
          '6: kursor > 0 — bez resync');
-- Protokół 1 (build 21) bez zmian: kursor 0 bez resync.
select is(pg_temp.g_of(public.sync_pull('{"03030000-0000-7000-8000-000000000002": 0}'::jsonb, 1000, 1, null), '03030000-0000-7000-8000-000000000002') ->> 'resync', 'false',
          '7: protokół 1 — kursor 0 bez resync, jak dotąd');

select * from finish();
rollback;
