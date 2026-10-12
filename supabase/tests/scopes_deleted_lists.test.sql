-- „scopes” z ukrytymi listami z kosza (migracja 20261011010000_scopes_deleted_lists): usunięta ukryta lista, którą nadal
-- widzę, zostaje w „scopes” — telefon nie bierze jej za utracony dostęp (nie czyści nagrobków jej zadań) i pobiera jej
-- zawartość, gdy dostęp dostał tuż przed usunięciem (regresje z symulatora synchronizacji, seed -694076517).
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000005d1', 'sdl-a@x.test'),
  ('00000000-0000-7000-8000-0000000005d3', 'sdl-c@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('sdl.seq', true), ''), '0')::int + 1;
begin
  perform set_config('sdl.seq', s::text, true);
  return coalesce(public.sync_push('d5d50000-0000-7000-8000-0000000000e1', 2, jsonb_build_array(op || jsonb_build_object('seq', s, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
create function pg_temp.g_of(res jsonb) returns jsonb language sql as $$
  select g from jsonb_array_elements(res -> 'groups') g where g ->> 'group_id' = 'd5d50000-0000-7000-8000-000000000001'
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: A (właścicielka), C. Listy: H (ukryta, A), H2 (ukryta, A — bez dostępu C), L (cała grupa). Zadania T1, T2 w H.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d1');
set local role authenticated;
select public.create_group('d5d50000-0000-7000-8000-000000000001', 'G', 'd5d50000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('d5d50000-0000-7000-8000-0000000000a3', 'd5d50000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000005d3', 'C', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d1');
set local role authenticated;
select pg_temp.m(jsonb_build_object('kind', 'create', 'entity', 'lists', 'id', 'd5d50000-0000-7000-8000-0000000000b' || i,
  'group_id', 'd5d50000-0000-7000-8000-000000000001', 'set', jsonb_build_object('kind', 'tasks', 'name', 'L' || i,
  'visibility', case when i = 3 then 'group' else 'restricted' end)))
  from generate_series(1, 3) i;
select pg_temp.m(jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', 'd5d50000-0000-7000-8000-0000000000c' || i,
  'group_id', 'd5d50000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', 'd5d50000-0000-7000-8000-0000000000b1', 'title', 'T' || i)))
  from generate_series(1, 2) i;
select is((public.sync_pull('{}'::jsonb, 1000, 2) -> 'scopes'),
  '["d5d50000-0000-7000-8000-0000000000b1", "d5d50000-0000-7000-8000-0000000000b2"]'::jsonb, '1: A — obie ukryte listy w „scopes”, bez listy całej grupy');

-- A usuwa T1; C pobiera (kursor za nagrobkiem T1, którego C nie widzi); A daje C dostęp do H i usuwa H oraz H2.
select pg_temp.m('{"kind":"delete","entity":"tasks","id":"d5d50000-0000-7000-8000-0000000000c1"}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d3');
create temp table c0 as select public.sync_pull('{}'::jsonb, 1000, 2) res;
grant select on c0 to authenticated;
select is((select res -> 'scopes' from c0), '[]'::jsonb, '2: C bez dostępu — „scopes” puste');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d1');
select pg_temp.m('{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"d5d50000-0000-7000-8000-0000000000b1","member_id":"d5d50000-0000-7000-8000-0000000000a3"}}');
select pg_temp.m('{"kind":"delete","entity":"lists","id":"d5d50000-0000-7000-8000-0000000000b1"}');
select pg_temp.m('{"kind":"delete","entity":"lists","id":"d5d50000-0000-7000-8000-0000000000b2"}');

-- A: usunięte listy nadal w „scopes” i w „lists” grupy (kosz, D151) — telefon nie czyści ich wierszy.
create temp table a1 as select public.sync_pull('{}'::jsonb, 1000, 2) res;
select is((select res -> 'scopes' from a1),
  '["d5d50000-0000-7000-8000-0000000000b1", "d5d50000-0000-7000-8000-0000000000b2"]'::jsonb, '3: A — usunięte ukryte listy zostają w „scopes”');
select ok((select pg_temp.g_of(res) -> 'lists' @> '["d5d50000-0000-7000-8000-0000000000b1", "d5d50000-0000-7000-8000-0000000000b2"]'::jsonb from a1), '4: A — i w „lists” grupy');

-- C: H (dostęp, usunięta) w „scopes” — telefon pobierze ją przez sync_fetch_scope; H2 (bez dostępu) nie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d3');
create temp table c1 as select public.sync_pull(jsonb_build_object('d5d50000-0000-7000-8000-000000000001',
  jsonb_build_object('v', (pg_temp.g_of((select res from c0)) ->> 'cursor')::bigint, 'p', 0)), 1000, 2) res;
select is((select res -> 'scopes' from c1), '["d5d50000-0000-7000-8000-0000000000b1"]'::jsonb, '5: C — usunięta lista z dostępem w „scopes”, bez listy bez dostępu');
-- Zwykłe pobranie nie niesie nagrobka T1 (wersja sprzed kursora C) — dlatego potrzebny sync_fetch_scope.
select ok((select not exists (select 1 from jsonb_array_elements(pg_temp.g_of(res) -> 'rows') x
                               where x -> 'row' ->> 'id' = 'd5d50000-0000-7000-8000-0000000000c1') from c1), '6: pobranie bez T1');
select ok((select exists (select 1 from jsonb_array_elements(public.sync_fetch_scope('d5d50000-0000-7000-8000-0000000000b1') -> 'rows') x
                          where x -> 'row' ->> 'id' = 'd5d50000-0000-7000-8000-0000000000c1' and x -> 'row' ->> 'deleted_at' is not null)),
  '7: sync_fetch_scope usuniętej listy przynosi nagrobek T1');

-- Cofnięcie dostępu: usunięta lista znika ze „scopes” C (utrata dostępu nadal działa).
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d1');
select is(pg_temp.p('{"kind":"cmd","cmd":"revoke_scope","args":{"list_id":"d5d50000-0000-7000-8000-0000000000b1","member_id":"d5d50000-0000-7000-8000-0000000000a3"}}'), 'ok', '8: A cofa dostęp do usuniętej H');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005d3');
select is((public.sync_pull('{}'::jsonb, 1000, 2) -> 'scopes'), '[]'::jsonb, '9: C — po cofnięciu „scopes” puste');

select * from finish();
rollback;
