-- Powiadomienie o osobie odpowiedzialnej za wydarzenie (migracja 20261008240000_event_push, D88).
begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a1', 'l@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'm@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('bbbb0000-0000-7000-8000-000000000001', 'Rodzina', 'bbbb0000-0000-7000-8000-0000000000b1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('bbbb0000-0000-7000-8000-0000000000b2', 'bbbb0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2', 'Magdalena', 'member');
insert into public.push_tokens (token, user_id, env) values (repeat('ef', 32), '00000000-0000-7000-8000-0000000000a2', 'production');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select is(pg_temp.push('bbbb0000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"events","id":"bbbb0000-0000-7000-8000-0000000001e1","group_id":"bbbb0000-0000-7000-8000-000000000001","set":{"title":"Dentysta","start_date":"2026-10-14","start_time":"16:00","responsible_member_id":"bbbb0000-0000-7000-8000-0000000000b2"}}'), 'ok', '1: wydarzenie z osobą odpowiedzialną');
select pg_temp.push('bbbb0000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"events","id":"bbbb0000-0000-7000-8000-0000000001e2","group_id":"bbbb0000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-12","start_time":"17:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') is not null;
select is(pg_temp.push('bbbb0000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"event_overrides","id":"bbbb0000-0000-7000-8000-0000000001f1","group_id":"bbbb0000-0000-7000-8000-000000000001","set":{"event_id":"bbbb0000-0000-7000-8000-0000000001e2","occurrence_date":"2026-10-19","responsible_member_id":"bbbb0000-0000-7000-8000-0000000000b2"}}'), 'ok', '2: jeden termin serii z osobą');
select pg_temp.push('bbbb0000-0000-7000-8000-00000000c0a1', 4, '{"kind":"patch","entity":"events","id":"bbbb0000-0000-7000-8000-0000000001e2","set":{"responsible_member_id":"bbbb0000-0000-7000-8000-0000000000b2"}}') is not null;
reset role;
select pg_temp.as_user('');

create temp table ids as select
  (select id from public.activity where entity = 'events' and entity_id = 'bbbb0000-0000-7000-8000-0000000001e1') as one_a,
  (select id from public.activity where entity = 'event_overrides' and entity_id = 'bbbb0000-0000-7000-8000-0000000001f1') as occ_a,
  (select id from public.activity where entity = 'events' and entity_id = 'bbbb0000-0000-7000-8000-0000000001e2' and changes ? 'responsible_member_id') as series_a;

select is(public.assignment_push_claim((select one_a from ids), '00000000-0000-7000-8000-0000000000a1', 24),
  jsonb_build_object('title', 'Łukasz przypisuje Ci wydarzenie', 'body', 'Dentysta (' || private.pl_long_date('2026-10-14') || ')', 'tokens', jsonb_build_array(jsonb_build_object('token', repeat('ef', 32), 'env', 'production')),
                     'key', 'assign|' || (select one_a from ids), 'path', 'event/bbbb0000-0000-7000-8000-0000000001e1/2026-10-14'),
  '3: jednorazowe — nazwa i dzień (audyt 2, M-138: jak w aplikacji)');
select is(public.assignment_push_claim((select occ_a from ids), '00000000-0000-7000-8000-0000000000a1', 24) ->> 'body', 'Basen (' || private.pl_long_date('2026-10-19') || ')', '4: jeden termin serii — nazwa z serii i dzień terminu');
select is(public.assignment_push_claim((select series_a from ids), '00000000-0000-7000-8000-0000000000a1', 24) ->> 'body', 'Basen', '5: cała seria — sama nazwa');

select * from finish();
rollback;
