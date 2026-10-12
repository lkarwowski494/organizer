-- „gone” w porcjach (migracja 20261010330000_moved_out_paging): zadanie przeniesione z widocznej listy, którego nowy
-- wiersz nie mieści się w porcji z przeniesieniem, trafia do „gone” — inaczej po zawężeniu nowej listy telefon trzymałby
-- starą kopię na zawsze (regresja z symulatora synchronizacji).
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000d1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000d3', 'c@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('mop.seq', true), ''), '0')::int + 1;
begin
  perform set_config('mop.seq', s::text, true);
  return coalesce(public.sync_push('d1d10000-0000-7000-8000-0000000000e1', 2, jsonb_build_array(op || jsonb_build_object('seq', s, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
create function pg_temp.g_of(res jsonb) returns jsonb language sql as $$
  select g from jsonb_array_elements(res -> 'groups') g where g ->> 'group_id' = 'd1d10000-0000-7000-8000-000000000001'
$$;
create function pg_temp.pull(since bigint, lim int) returns jsonb language sql as $$
  select pg_temp.g_of(public.sync_pull(jsonb_build_object('d1d10000-0000-7000-8000-000000000001', jsonb_build_object('v', since, 'p', 0)), lim, 2))
$$;
-- Wiersz zadania T w porcji (null, gdy go nie ma).
create function pg_temp.t_row(g jsonb) returns jsonb language sql as $$
  select x -> 'row' from jsonb_array_elements(g -> 'rows') x where x ->> 'e' = 'tasks' and x -> 'row' ->> 'id' = 'd1d10000-0000-7000-8000-0000000000c1'
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: A (właścicielka), C. Listy L i L2 (cała grupa), H (ukryta, tylko A). Zadanie T i T6 w L.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('d1d10000-0000-7000-8000-000000000001', 'G', 'd1d10000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('d1d10000-0000-7000-8000-0000000000a3', 'd1d10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d3', 'C', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select pg_temp.m(jsonb_build_object('kind', 'create', 'entity', 'lists', 'id', 'd1d10000-0000-7000-8000-0000000000b' || i,
  'group_id', 'd1d10000-0000-7000-8000-000000000001', 'set', jsonb_build_object('kind', 'tasks', 'name', 'L' || i,
  'visibility', case when i = 2 then 'restricted' else 'group' end)))
  from generate_series(1, 3) i;
select pg_temp.m(jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', 'd1d10000-0000-7000-8000-0000000000c' || i,
  'group_id', 'd1d10000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', 'd1d10000-0000-7000-8000-0000000000b1', 'title', 'T' || i)))
  from unnest(array[1, 6]) i;

-- C pobiera całość; potem A przenosi T do ukrytej H, zmienia T6 (zmiana widoczna dla C) i przenosi T do L2.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
create temp table c0 as select (pg_temp.g_of(public.sync_pull('{}'::jsonb, 1000, 2)) ->> 'cursor')::bigint v;
grant select on c0 to authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.p('{"kind":"cmd","cmd":"move_task","args":{"id":"d1d10000-0000-7000-8000-0000000000c1","list_id":"d1d10000-0000-7000-8000-0000000000b2"}}'), 'ok', '1: T do ukrytej H');
select is(pg_temp.p('{"kind":"patch","entity":"tasks","id":"d1d10000-0000-7000-8000-0000000000c6","set":{"note":"n"}}'), 'ok', '2: zmiana T6');
select is(pg_temp.p('{"kind":"cmd","cmd":"move_task","args":{"id":"d1d10000-0000-7000-8000-0000000000c1","list_id":"d1d10000-0000-7000-8000-0000000000b3"}}'), 'ok', '3: T z H do L2');

-- Porcja o jednym wierszu: kursor przechodzi za pierwsze przeniesienie, nowy wiersz T czeka na następną porcję.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
create temp table page1 as select pg_temp.pull((select v from c0), 1) g;
grant select on page1 to authenticated;
select ok((select pg_temp.t_row(g) is null and (g ->> 'has_more')::boolean from page1), '4: porcja bez nowego wiersza T (będzie dalej)');
select is((select g -> 'gone' from page1), '["d1d10000-0000-7000-8000-0000000000c1"]'::jsonb, '5: T w „gone”, bo kursor mija jego przeniesienie z L');
-- Porcja obejmująca też nowy wiersz T: bez „gone” (telefon dostaje T w L2).
create temp table whole as select pg_temp.pull((select v from c0), 1000) g;
select is((select g -> 'gone' from whole), '[]'::jsonb, '6: T i jego nowy wiersz w jednej porcji: bez „gone”');
select is((select pg_temp.t_row(g) ->> 'list_id' from whole), 'd1d10000-0000-7000-8000-0000000000b3', '7: T w L2');
-- Bez zawężenia następna porcja przynosi nowy wiersz T (telefon go odzyskuje).
select is((select pg_temp.t_row(pg_temp.pull((g ->> 'cursor')::bigint, 1000)) ->> 'list_id' from page1), 'd1d10000-0000-7000-8000-0000000000b3', '8: następna porcja: T w L2');

-- A zawęża L2: dalsze porcje C nie mówią o T nic — dlatego „gone” musiało przyjść w porcji 1.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select pg_temp.m('{"kind":"patch","entity":"lists","id":"d1d10000-0000-7000-8000-0000000000b3","set":{"visibility":"restricted"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
select ok((select pg_temp.t_row(x) is null and not (x -> 'gone') ? 'd1d10000-0000-7000-8000-0000000000c1'
           from (select pg_temp.pull((g ->> 'cursor')::bigint, 1000) x from page1) y), '9: po zawężeniu L2 dalsze porcje bez T');

select * from finish();
rollback;
