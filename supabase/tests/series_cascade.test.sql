-- Definicje stałych zadań razem z listą i wydarzeniem (audyt 2, M-74; migracja 20261008391000_series_cascade).
begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000017a1', 'a17@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push('17170000-0000-7000-8000-00000000c0d1', 2, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000017a1');
set local role authenticated;
select public.create_group('17170000-0000-7000-8000-000000000001', 'G', '17170000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.push(1, '{"kind":"create","entity":"lists","id":"17170000-0000-7000-8000-0000000000b1","group_id":"17170000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') = 'ok';
select pg_temp.push(2, '{"kind":"create","entity":"events","id":"17170000-0000-7000-8000-0000000001e1","group_id":"17170000-0000-7000-8000-000000000001","set":{"title":"Tańce","start_date":"2026-10-05","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') = 'ok';
select pg_temp.push(3, '{"kind":"create","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a1","group_id":"17170000-0000-7000-8000-000000000001","set":{"event_id":"17170000-0000-7000-8000-0000000001e1","list_id":"17170000-0000-7000-8000-0000000000b1","title":"Strój"}}') = 'ok';
select pg_temp.push(4, '{"kind":"create","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a2","group_id":"17170000-0000-7000-8000-000000000001","set":{"event_id":"17170000-0000-7000-8000-0000000001e1","list_id":"17170000-0000-7000-8000-0000000000b1","title":"Woda"}}') = 'ok';
-- Definicja usunięta wcześniej sama.
select pg_temp.push(5, '{"kind":"delete","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a2"}') = 'ok';

select is(pg_temp.push(6, '{"kind":"delete","entity":"lists","id":"17170000-0000-7000-8000-0000000000b1"}'), 'ok', '1: usunięcie listy');
select is((select deleted_at from public.event_task_series where id = '17170000-0000-7000-8000-0000000005a1'),
          (select deleted_at from public.lists where id = '17170000-0000-7000-8000-0000000000b1'), '2: definicja w koszu z tym samym znacznikiem');
select is(pg_temp.push(7, '{"kind":"create","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a3","group_id":"17170000-0000-7000-8000-000000000001","set":{"event_id":"17170000-0000-7000-8000-0000000001e1","list_id":"17170000-0000-7000-8000-0000000000b1","title":"X"}}'),
  'deleted:list', '3: nowa definicja na usuniętej liście odrzucona');
select is(pg_temp.push(8, '{"kind":"restore","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a1"}'), 'deleted:list', '4: przywrócenie definicji przy usuniętej liście odrzucone');
select is(pg_temp.push(9, '{"kind":"restore","entity":"lists","id":"17170000-0000-7000-8000-0000000000b1"}'), 'ok', '5: przywrócenie listy');
select is(array(select (deleted_at is null)::text from public.event_task_series where group_id = '17170000-0000-7000-8000-000000000001' order by id),
  array['true', 'false'], '6: wraca definicja usunięta z listą, wcześniej usunięta zostaje w koszu');

select is(pg_temp.push(10, '{"kind":"delete","entity":"events","id":"17170000-0000-7000-8000-0000000001e1"}'), 'ok', '7: usunięcie wydarzenia');
select ok((select deleted_at is not null from public.event_task_series where id = '17170000-0000-7000-8000-0000000005a1'), '8: definicja w koszu razem z wydarzeniem');
select is(pg_temp.push(11, '{"kind":"create","entity":"event_task_series","id":"17170000-0000-7000-8000-0000000005a4","group_id":"17170000-0000-7000-8000-000000000001","set":{"event_id":"17170000-0000-7000-8000-0000000001e1","list_id":"17170000-0000-7000-8000-0000000000b1","title":"X"}}'),
  'deleted:event', '9: nowa definicja na usuniętym wydarzeniu odrzucona');
select pg_temp.push(12, '{"kind":"restore","entity":"events","id":"17170000-0000-7000-8000-0000000001e1"}') = 'ok';
select ok((select deleted_at is null from public.event_task_series where id = '17170000-0000-7000-8000-0000000005a1'), '10: przywrócenie wydarzenia przywraca definicję');

select * from finish();
rollback;
