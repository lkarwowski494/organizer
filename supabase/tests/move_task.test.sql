-- Przenoszenie zadań: komenda move_task w sync_push (migracja 20261007100000_move_task).
begin;
select plan(20);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000aa', 'a@x.test'), ('00000000-0000-7000-8000-0000000000ab', 'k@x.test');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000aa', true);
set local role authenticated;
select public.create_group('66660000-0000-7000-8000-000000000001', 'G', '66660000-0000-7000-8000-0000000000a1', 'Ala');

create function pg_temp.push(seq int, op jsonb) returns jsonb language sql as $$
  select public.sync_push('66660000-0000-7000-8000-0000000000c1', 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0
$$;
create function pg_temp.mv(seq int, id text, parent text, list text default null) returns text language sql as $$
  select coalesce(pg_temp.push(seq, jsonb_build_object('kind', 'cmd', 'cmd', 'move_task', 'args',
    jsonb_strip_nulls(jsonb_build_object('id', id, 'parent_id', parent, 'list_id', list)))) ->> 'code', 'ok')
$$;
create function pg_temp.depth(id text) returns int language sql as $$ select depth from public.tasks where tasks.id = $1::uuid $$;
create function pg_temp.parent(id text) returns text language sql as $$ select parent_id::text from public.tasks where tasks.id = $1::uuid $$;

-- Listy L1, L2 (zadaniowe), Z (zakupy); drzewo w L1: A → B → C; D osobno; E w L2.
select pg_temp.push(1, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000e1","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"L1"}}');
select pg_temp.push(2, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000e2","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"L2"}}');
select pg_temp.push(3, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000e3","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Z"}}');
select pg_temp.push(4, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-00000000000a","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000e1","title":"A"}}');
select pg_temp.push(5, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-00000000000b","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000e1","title":"B","parent_id":"66660000-0000-7000-8000-00000000000a"}}');
select pg_temp.push(6, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-00000000000c","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000e1","title":"C","parent_id":"66660000-0000-7000-8000-00000000000b"}}');
select pg_temp.push(7, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-00000000000d","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000e1","title":"D"}}');
select pg_temp.push(8, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-00000000000e","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000e2","title":"E"}}');

select is(pg_temp.mv(10, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-00000000000c'), 'cycle', '1: A pod własnego potomka C = cykl');
select is(pg_temp.mv(11, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-00000000000a'), 'cycle', '2: A pod samego siebie = cykl');
select is(pg_temp.mv(12, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-00000000000d'), 'depth_exceeded', '3: drzewo wysokości 2 pod D = 4 poziomy');
select is(pg_temp.mv(13, '66660000-0000-7000-8000-00000000000b', '66660000-0000-7000-8000-00000000000d'), 'ok', '4: B (z dzieckiem C) pod D');
select is(pg_temp.depth('66660000-0000-7000-8000-00000000000b'), 1, '5: B ma głębokość 1');
select is(pg_temp.depth('66660000-0000-7000-8000-00000000000c'), 2, '6: potomek C przeliczony na 2');
select is(pg_temp.parent('66660000-0000-7000-8000-00000000000c'), '66660000-0000-7000-8000-00000000000b', '7: C nadal pod B');
select is(pg_temp.mv(14, '66660000-0000-7000-8000-00000000000c', null), 'ok', '8: C na poziom główny');
select is(pg_temp.depth('66660000-0000-7000-8000-00000000000c'), 0, '9: C głębokość 0');
select is(pg_temp.mv(15, '66660000-0000-7000-8000-00000000000d', null, '66660000-0000-7000-8000-0000000000e2'), 'ok', '10: D (z B) do listy L2');
select is((select array_agg(list_id::text order by title) from public.tasks where title in ('B', 'D')), array['66660000-0000-7000-8000-0000000000e2', '66660000-0000-7000-8000-0000000000e2'], '11: poddrzewo przeniesione razem z D');
select is(pg_temp.mv(16, '66660000-0000-7000-8000-00000000000a', null, '66660000-0000-7000-8000-0000000000e3'), 'invalid_list:kind', '12: nie na listę zakupów');
select is(pg_temp.mv(17, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-00000000000e', '66660000-0000-7000-8000-0000000000e1'), 'invalid_parent', '13: rodzic z innej listy niż wskazana');
select is(pg_temp.mv(18, '66660000-0000-7000-8000-0000000000ff', null), 'not_found', '14: nieistniejące zadanie');
select is(pg_temp.mv(19, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-0000000000ff'), 'invalid_parent', '15: nieistniejący rodzic');
select throws_ok($$ update public.tasks set parent_id = null where id = '66660000-0000-7000-8000-00000000000b' $$, '42501', null, '16: bez komendy rodzica nie zmienia się');
reset role;
select ok(exists (select 1 from public.activity where entity_id = '66660000-0000-7000-8000-00000000000b' and changes ? 'parent_id'), '17: przeniesienie w aktywności');
update public.tasks set deleted_at = now() where id = '66660000-0000-7000-8000-00000000000e';
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000aa', true);
set local role authenticated;
select is(pg_temp.mv(20, '66660000-0000-7000-8000-00000000000a', '66660000-0000-7000-8000-00000000000e'), 'deleted:parent', '18: nie pod usunięte zadanie');
select is(pg_temp.mv(21, '66660000-0000-7000-8000-00000000000e', null), 'deleted', '19: usuniętego nie przenosi się');
-- Dziecko (konto z rolą child) nie przenosi.
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.group_members (member_id, group_id, user_id, display_name, role) values (gen_random_uuid(), '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000ab', 'Tymek', 'child');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000ab', true);
set local role authenticated;
select is((public.sync_push('66660000-0000-7000-8000-0000000000c2', 1, '[{"seq":1,"kind":"cmd","cmd":"move_task","args":{"id":"66660000-0000-7000-8000-00000000000a"}}]') -> 'results' -> 0 ->> 'code'), 'forbidden', '20: dziecko nie przenosi');

select * from finish();
rollback;
