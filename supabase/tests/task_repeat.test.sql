-- Powtarzanie zadań (migracja 20261008180000_task_repeat, D76).
begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000d1', 'a@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('99990000-0000-7000-8000-000000000001', 'Dom', '99990000-0000-7000-8000-0000000000a1', 'Łukasz');
select pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"99990000-0000-7000-8000-0000000000c1","group_id":"99990000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;

select is(pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"tasks","id":"99990000-0000-7000-8000-0000000004d1","group_id":"99990000-0000-7000-8000-000000000001","set":{"list_id":"99990000-0000-7000-8000-0000000000c1","title":"Śmieci","deadline_mode":"own","due_date":"2026-10-12","repeat":"FREQ=WEEKLY;BYDAY=MO"}}'), 'ok', '1: zadanie co tydzień');
select is(pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"tasks","id":"99990000-0000-7000-8000-0000000004d2","group_id":"99990000-0000-7000-8000-000000000001","set":{"list_id":"99990000-0000-7000-8000-0000000000c1","title":"Kwiaty","deadline_mode":"own","due_date":"2026-10-12","repeat":"AFTER=DAILY;INTERVAL=3"}}'), 'ok', '2: od wykonania co 3 dni');
select is(pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 4, '{"kind":"patch","entity":"tasks","id":"99990000-0000-7000-8000-0000000004d2","set":{"repeat":"AFTER=YEARLY;INTERVAL=1"}}'), 'invalid:23514', '3: zła reguła odrzucona');
select is(pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 5, '{"kind":"create","entity":"tasks","id":"99990000-0000-7000-8000-0000000004d3","group_id":"99990000-0000-7000-8000-000000000001","set":{"list_id":"99990000-0000-7000-8000-0000000000c1","title":"Bez terminu","repeat":"FREQ=DAILY"}}'), 'invalid:23514', '4: powtarzanie bez terminu odrzucone');
select is(pg_temp.push('99990000-0000-7000-8000-00000000c0d1', 6, '{"kind":"patch","entity":"tasks","id":"99990000-0000-7000-8000-0000000004d1","set":{"repeat":null,"deadline_mode":"none","due_date":null}}'), 'ok', '5: zdjęcie terminu razem z powtarzaniem');
select is((select repeat from public.tasks where id = '99990000-0000-7000-8000-0000000004d2'), 'AFTER=DAILY;INTERVAL=3', '6: reguła zapisana');

select * from finish();
rollback;
