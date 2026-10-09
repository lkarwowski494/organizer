-- Powiadomienie o przypisaniu i wyciszanie grup (migracja 20261008200000_assign_push, D81).
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a1', 'l@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000a3', 'o@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('aaaa0000-0000-7000-8000-000000000001', 'Rodzina', 'aaaa0000-0000-7000-8000-0000000000b1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('aaaa0000-0000-7000-8000-0000000000b2', 'aaaa0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2', 'Magdalena', 'member');
insert into public.push_tokens (token, user_id, env) values (repeat('cd', 32), '00000000-0000-7000-8000-0000000000a2', 'production');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select pg_temp.push('aaaa0000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"aaaa0000-0000-7000-8000-0000000000c1","group_id":"aaaa0000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('aaaa0000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"tasks","id":"aaaa0000-0000-7000-8000-0000000004d1","group_id":"aaaa0000-0000-7000-8000-000000000001","set":{"list_id":"aaaa0000-0000-7000-8000-0000000000c1","title":"Wynieść śmieci","assignee_member_id":"aaaa0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('aaaa0000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"lists","id":"aaaa0000-0000-7000-8000-0000000000c2","group_id":"aaaa0000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Bazar","responsible_member_id":"aaaa0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('aaaa0000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"tasks","id":"aaaa0000-0000-7000-8000-0000000004d2","group_id":"aaaa0000-0000-7000-8000-000000000001","set":{"list_id":"aaaa0000-0000-7000-8000-0000000000c1","title":"Moje","assignee_member_id":"aaaa0000-0000-7000-8000-0000000000b1"}}') is not null;
reset role;
select pg_temp.as_user('');

create temp table ids as select
  (select id from public.activity where entity = 'tasks' and entity_id = 'aaaa0000-0000-7000-8000-0000000004d1') as task_a,
  (select id from public.activity where entity = 'lists' and entity_id = 'aaaa0000-0000-7000-8000-0000000000c2') as list_a,
  (select id from public.activity where entity = 'tasks' and entity_id = 'aaaa0000-0000-7000-8000-0000000004d2') as self_a,
  (select id from public.activity where entity = 'lists' and entity_id = 'aaaa0000-0000-7000-8000-0000000000c1') as plain_a;

select is(public.assignment_push_claim((select task_a from ids), '00000000-0000-7000-8000-0000000000a2', 24), null, '1: nie autor — nic');
select is(public.assignment_push_claim((select task_a from ids), '00000000-0000-7000-8000-0000000000a1', 24),
  jsonb_build_object('title', 'Łukasz przypisuje Ci zadanie', 'body', 'Wynieść śmieci', 'tokens', jsonb_build_array(jsonb_build_object('token', repeat('cd', 32), 'env', 'production')),
                     'key', 'assign|' || (select task_a from ids), 'path', 'task/aaaa0000-0000-7000-8000-0000000004d1'), '2: przypisanie zadania — do osoby z tokenem');
select is(public.assignment_push_claim((select task_a from ids), '00000000-0000-7000-8000-0000000000a1', 24), null, '3: drugi raz — nic');
select is(public.assignment_push_claim((select self_a from ids), '00000000-0000-7000-8000-0000000000a1', 24), null, '4: przypisanie sobie — nic');
select is(public.assignment_push_claim((select plain_a from ids), '00000000-0000-7000-8000-0000000000a1', 24), null, '5: wpis bez przypisania — nic');
select is(public.assignment_push_claim(gen_random_uuid(), '00000000-0000-7000-8000-0000000000a1', 24), null, '6: nieznany wpis — nic');

-- Wyciszenie grupy przez odbiorcę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
set local role authenticated;
select public.set_push_mute('aaaa0000-0000-7000-8000-000000000001', true);
select is(public.my_push_mutes(), array['aaaa0000-0000-7000-8000-000000000001'::uuid], '7: moje wyciszenia');
select throws_ok($$ select public.assignment_push_claim(gen_random_uuid(), (select auth.uid()), 24) $$, '42501', null, '8: claim tylko dla funkcji');
reset role;
select pg_temp.as_user('');
select is(public.assignment_push_claim((select list_a from ids), '00000000-0000-7000-8000-0000000000a1', 24), null, '9: grupa wyciszona — bez powiadomienia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
set local role authenticated;
select public.set_push_mute('aaaa0000-0000-7000-8000-000000000001', false);
reset role;
select pg_temp.as_user('');
select is(public.assignment_push_claim((select list_a from ids), '00000000-0000-7000-8000-0000000000a1', 24) - 'tokens' - 'key' - 'title',
  jsonb_build_object('body', 'Zakupy: Bazar', 'path', 'list/aaaa0000-0000-7000-8000-0000000000c2'), '10: po odciszeniu — zakupy (otwiera listę, PWD-16)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a3');
set local role authenticated;
select throws_ok($$ select public.set_push_mute('aaaa0000-0000-7000-8000-000000000001', true) $$, 'P0001', 'forbidden', '11: spoza grupy nie wycisza');

select * from finish();
rollback;
