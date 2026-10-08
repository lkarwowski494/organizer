-- Działy i stałe zakupy (migracja 20261008230000_shopping_extras, D85, D86).
begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000f1', 'a@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('99970000-0000-7000-8000-000000000001', 'Dom', '99970000-0000-7000-8000-0000000000a1', 'Łukasz');
select pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"99970000-0000-7000-8000-0000000000c1","group_id":"99970000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}}') is not null;
select pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"lists","id":"99970000-0000-7000-8000-0000000000c2","group_id":"99970000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;

select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"tasks","id":"99970000-0000-7000-8000-0000000004d1","group_id":"99970000-0000-7000-8000-000000000001","set":{"list_id":"99970000-0000-7000-8000-0000000000c1","title":"Mleko","category":"dairy"}}'), 'ok', '1: pozycja z działem');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 4, '{"kind":"patch","entity":"tasks","id":"99970000-0000-7000-8000-0000000004d1","set":{"category":"pantry"}}'), 'ok', '2: zmiana działu');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 5, '{"kind":"patch","entity":"tasks","id":"99970000-0000-7000-8000-0000000004d1","set":{"category":"elektronika"}}'), 'invalid:23514', '3: nieznany dział odrzucony');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 6, '{"kind":"patch","entity":"tasks","id":"99970000-0000-7000-8000-0000000004d1","set":{"category":null}}'), 'ok', '4: powrót do podpowiedzi (null)');

select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 7, '{"kind":"patch","entity":"lists","id":"99970000-0000-7000-8000-0000000000c1","set":{"staples":["Mleko","Chleb żytni"]}}'), 'ok', '5: stałe zakupy');
select is((select staples from public.lists where id = '99970000-0000-7000-8000-0000000000c1'), '{Mleko,"Chleb żytni"}'::text[], '6: zapisane w kolejności');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 8, '{"kind":"patch","entity":"lists","id":"99970000-0000-7000-8000-0000000000c1","set":{"staples":["  "]}}'), 'invalid:23514', '7: pusta pozycja odrzucona');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 9, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '99970000-0000-7000-8000-0000000000c1',
  'set', jsonb_build_object('staples', (select jsonb_agg('p' || g) from generate_series(1, 51) g)))), 'invalid:23514', '8: ponad 50 pozycji odrzucone');
select is(pg_temp.push('99970000-0000-7000-8000-00000000c0d1', 10, '{"kind":"patch","entity":"lists","id":"99970000-0000-7000-8000-0000000000c2","set":{"staples":["Mleko"]}}'), 'invalid:23514', '9: stałe tylko na liście zakupów');
select is((select (r -> 'row' -> 'staples') from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') r
           where r ->> 'e' = 'lists' and r -> 'row' ->> 'id' = '99970000-0000-7000-8000-0000000000c1'), '["Mleko", "Chleb żytni"]'::jsonb, '10: telefon dostaje stałe zakupy w pobraniu');

select * from finish();
rollback;
