-- Stałe zakupy pojedynczo: polecenia staple_add / staple_remove (migracja 20261008370000_staple_commands, audyt 2, M-111).
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000d1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000d2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000d3', 'k@x.test'),
  ('00000000-0000-7000-8000-0000000000d4', 'o@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.add(list text, name text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'cmd', 'cmd', 'staple_add', 'args', jsonb_build_object('list_id', list, 'name', name))
$$;
create function pg_temp.del(list text, names text[]) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'cmd', 'cmd', 'staple_remove', 'args', jsonb_build_object('list_id', list, 'names', to_jsonb(names)))
$$;
create function pg_temp.staples(list text) returns text[] language sql as $$ select staples from public.lists where id = list::uuid $$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.add(text, text), pg_temp.del(text, text[]), pg_temp.staples(text) to authenticated;

-- Dom: A (owner), M (member), K (dziecko z kontem). O — osobna grupa, list Domu nie widzi.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('66660000-0000-7000-8000-000000000001', 'Dom', '66660000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c1","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c2","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c3","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Stara"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 4, '{"kind":"delete","entity":"lists","id":"66660000-0000-7000-8000-0000000000c3"}') is not null;
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('66660000-0000-7000-8000-0000000000a2', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d2', 'M', 'member'),
  ('66660000-0000-7000-8000-0000000000a3', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d3', 'K', 'child');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
set local role authenticated;
select public.create_group('66660000-0000-7000-8000-000000000002', 'Obcy', '66660000-0000-7000-8000-0000000000a4', 'O');
select pg_temp.push('66660000-0000-7000-8000-00000000c0a4', 1, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c4","group_id":"66660000-0000-7000-8000-000000000002","set":{"kind":"shopping","name":"Cudza"}}') is not null;

-- 1–6: dopisanie i usunięcie, bez dubli; dwa telefony ze starym stanem nie nadpisują sobie pozycji.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 5, pg_temp.add('66660000-0000-7000-8000-0000000000c1', 'Mleko')), 'ok', '1: dopisanie stałej pozycji');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 6, pg_temp.add('66660000-0000-7000-8000-0000000000c1', 'Mleko')), 'ok', '2: ta sama nazwa drugi raz — przechodzi bez zmian');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a2', 1, pg_temp.add('66660000-0000-7000-8000-0000000000c1', 'Chleb')), 'ok', '3: drugi telefon dopisuje swoją');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 7, pg_temp.add('66660000-0000-7000-8000-0000000000c1', 'Jajka')), 'ok', '4: pierwszy (stan sprzed „Chleb”) dopisuje kolejną');
select is(pg_temp.staples('66660000-0000-7000-8000-0000000000c1'), '{Mleko,Chleb,Jajka}'::text[], '5: żadna pozycja nie zginęła, bez dubli, w kolejności dopisania');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 8, pg_temp.del('66660000-0000-7000-8000-0000000000c1', '{Chleb,Brak}')), 'ok', '6: usunięcie wskazanych nazw');
select is(pg_temp.staples('66660000-0000-7000-8000-0000000000c1'), '{Mleko,Jajka}'::text[], '7: reszta zostaje w kolejności');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 9, pg_temp.del('66660000-0000-7000-8000-0000000000c1', '{Brak}')), 'ok', '8: usunięcie nazwy, której nie ma — przechodzi bez zmian');

-- 9–12: limity jak dla całej tablicy (lists_staples_ok, lists_staples_only_shopping).
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 10, pg_temp.add('66660000-0000-7000-8000-0000000000c2', 'Mleko')), 'invalid:23514', '9: lista zadań nie ma stałych zakupów');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 11, pg_temp.add('66660000-0000-7000-8000-0000000000c1', repeat('x', 201))), 'invalid:23514', '10: za długa nazwa');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 12, pg_temp.add('66660000-0000-7000-8000-0000000000c1', '   ')), 'invalid:23514', '11: pusta nazwa');
select pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 13, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '66660000-0000-7000-8000-0000000000c1',
  'set', jsonb_build_object('staples', (select jsonb_agg('p' || g) from generate_series(1, 50) g)))) is not null;
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 14, pg_temp.add('66660000-0000-7000-8000-0000000000c1', 'Nowa')), 'invalid:23514', '12: ponad 50 pozycji');

-- 13–17: kto i gdzie.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 15, pg_temp.add('66660000-0000-7000-8000-0000000000c3', 'Mleko')), 'deleted', '13: lista w koszu');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 16, pg_temp.del('66660000-0000-7000-8000-0000000000c3', '{Mleko}')), 'deleted', '14: lista w koszu — usunięcie też');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 17, pg_temp.add('66660000-0000-7000-8000-0000000000c4', 'Mleko')), 'not_found', '15: lista, której nie widzę');
reset role;
select is(pg_temp.staples('66660000-0000-7000-8000-0000000000c4'), '{}'::text[], '16: cudzej listy nie zmieniono');
set local role authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a3', 1, pg_temp.del('66660000-0000-7000-8000-0000000000c1', '{p1}')), 'forbidden:child', '17: dziecko nie zmienia stałych zakupów');

-- 18–21: złe argumenty.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 18, '{"kind":"cmd","cmd":"staple_add","args":{"list_id":"66660000-0000-7000-8000-0000000000c1"}}'), 'invalid_value:name', '18: bez nazwy');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 19, '{"kind":"cmd","cmd":"staple_remove","args":{"list_id":"66660000-0000-7000-8000-0000000000c1","names":"p1"}}'), 'invalid_value:names', '19: nazwy nie jako tablica');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 20, '{"kind":"cmd","cmd":"staple_add","args":{"name":"Mleko"}}'), 'invalid_value:list_id', '20: bez listy');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 21, '{"kind":"cmd","cmd":"staple_add","args":{"list_id":"zła","name":"Mleko"}}'), 'invalid_value', '21: zły identyfikator listy');

-- 22–24: zmiana dochodzi do telefonów i do historii; stary telefon (build 21) dalej wysyła całą tablicę.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 22, pg_temp.del('66660000-0000-7000-8000-0000000000c1', '{p1,p2}')), 'ok', '22: usunięcie dwóch naraz');
select is((select (r -> 'row' -> 'staples') -> 0 from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') r
           where r ->> 'e' = 'lists' and r -> 'row' ->> 'id' = '66660000-0000-7000-8000-0000000000c1'), '"p3"'::jsonb, '23: telefon dostaje nową tablicę w pobraniu (nowa wersja wiersza)');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0a1', 23, '{"kind":"patch","entity":"lists","id":"66660000-0000-7000-8000-0000000000c1","set":{"staples":["Mleko"]}}'), 'ok', '24: stary telefon — zmiana całej tablicy dalej przechodzi');

select * from finish();
rollback;
