-- Zadania podpięte do wystąpienia wydarzenia (migracja 20261008110000_task_occurrence, D13).
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000f1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000f3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000f4', 'z@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f4');
set local role authenticated;
select public.create_group('44440000-0000-7000-8000-000000000002', 'Obca', '44440000-0000-7000-8000-0000000000a4', 'Z');
select pg_temp.push('44440000-0000-7000-8000-00000000c0f4', 1, '{"kind":"create","entity":"events","id":"44440000-0000-7000-8000-0000000001e9","group_id":"44440000-0000-7000-8000-000000000002","set":{"title":"Cudze","start_date":"2026-10-05"}}') is not null;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select public.create_group('44440000-0000-7000-8000-000000000001', 'Rodzina', '44440000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('44440000-0000-7000-8000-0000000000a3', '44440000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f3', 'C', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 1, '{"kind":"create","entity":"lists","id":"44440000-0000-7000-8000-0000000000b1","group_id":"44440000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 2, '{"kind":"create","entity":"events","id":"44440000-0000-7000-8000-0000000001e1","group_id":"44440000-0000-7000-8000-000000000001","set":{"title":"Tańce","start_date":"2026-10-05","start_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') is not null;
select pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 3, '{"kind":"create","entity":"events","id":"44440000-0000-7000-8000-0000000001e2","group_id":"44440000-0000-7000-8000-000000000001","set":{"title":"Usunięte","start_date":"2026-10-05"}}') is not null;
select pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 4, '{"kind":"delete","entity":"events","id":"44440000-0000-7000-8000-0000000001e2"}') is not null;

select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 5, '{"kind":"create","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f1","group_id":"44440000-0000-7000-8000-000000000001","set":{"list_id":"44440000-0000-7000-8000-0000000000b1","title":"Spakować strój","deadline_mode":"event","event_id":"44440000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12"}}'), 'ok', '1: zadanie na wystąpieniu, termin z wystąpienia');
select is((select occurrence_date::text from public.tasks where id = '44440000-0000-7000-8000-0000000004f1'), '2026-10-12', '2: data wystąpienia zapisana');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 6, '{"kind":"create","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f2","group_id":"44440000-0000-7000-8000-000000000001","set":{"list_id":"44440000-0000-7000-8000-0000000000b1","title":"X","deadline_mode":"event","event_id":"44440000-0000-7000-8000-0000000001e9","occurrence_date":"2026-10-05"}}'), 'invalid_event', '3: spotkanie z cudzej grupy odrzucone');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 7, '{"kind":"create","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f2","group_id":"44440000-0000-7000-8000-000000000001","set":{"list_id":"44440000-0000-7000-8000-0000000000b1","title":"X","deadline_mode":"event","event_id":"44440000-0000-7000-8000-0000000001e2","occurrence_date":"2026-10-05"}}'), 'deleted:event', '4: usunięte spotkanie odrzucone');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 8, '{"kind":"create","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f2","group_id":"44440000-0000-7000-8000-000000000001","set":{"list_id":"44440000-0000-7000-8000-0000000000b1","title":"X","deadline_mode":"event"}}'), 'invalid:23514', '5: tryb „event” bez spotkania odrzucony');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 9, '{"kind":"create","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f2","group_id":"44440000-0000-7000-8000-000000000001","set":{"list_id":"44440000-0000-7000-8000-0000000000b1","title":"X","event_id":"44440000-0000-7000-8000-0000000001e1"}}'), 'invalid:23514', '6: spotkanie bez daty wystąpienia odrzucone');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 10, '{"kind":"patch","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f1","set":{"occurrence_date":"2026-10-19"}}'), 'ok', '7: przepięcie na inne wystąpienie');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 11, '{"kind":"patch","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f1","set":{"deadline_mode":"own","due_date":"2026-10-17"}}'), 'ok', '8: własny termin przy zachowanym podpięciu (D13)');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f3', 1, '{"kind":"patch","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f1","set":{"event_id":null,"occurrence_date":null}}'), 'forbidden:child', '9: dziecko nie odpina (D34)');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 12, '{"kind":"patch","entity":"tasks","id":"44440000-0000-7000-8000-0000000004f1","set":{"event_id":null,"occurrence_date":null,"deadline_mode":"none","due_date":null}}'), 'ok', '10: odpięcie (zostaje jako przypięte)');

select * from finish();
rollback;
