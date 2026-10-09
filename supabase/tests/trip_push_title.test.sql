-- Treść powiadomień o zakupach bez „Zakupy: Zakupy” (migracja 20261008560000_trip_push_title, audyt 2 P17, P-75):
-- przedrostek z private.push_texts() tylko, gdy nazwa listy nie zaczyna się od słowa „Zakupy” (jak strings['trip.title']).
begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'l@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'm@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- 1–4: reguła nazwy.
select is(private.trip_title('Zakupy'), 'Zakupy', '1: sama „Zakupy” — bez przedrostka');
select is(private.trip_title('zakupy na weekend'), 'zakupy na weekend', '2: nazwa zaczyna się od słowa „zakupy” — bez przedrostka');
select is(private.trip_title('Dom'), 'Zakupy: Dom', '3: inna nazwa — z przedrostkiem');
select is(private.trip_title('Zakupowe szaleństwo'), 'Zakupy: Zakupowe szaleństwo', '4: „Zakupowe” to nie słowo „Zakupy”');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('eeee0000-0000-7000-8000-000000000001', 'Rodzina', 'eeee0000-0000-7000-8000-0000000000b1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('eeee0000-0000-7000-8000-0000000000b2', 'eeee0000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'Magdalena', 'member');
insert into public.push_tokens (token, user_id, env) values (repeat('ef', 32), '00000000-0000-7000-8000-0000000000e2', 'production');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select pg_temp.push('eeee0000-0000-7000-8000-00000000c0e1', 1, '{"kind":"create","entity":"lists","id":"eeee0000-0000-7000-8000-0000000000c1","group_id":"eeee0000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy na weekend","responsible_member_id":"eeee0000-0000-7000-8000-0000000000b2"}}') is not null;
select pg_temp.push('eeee0000-0000-7000-8000-00000000c0e1', 2, '{"kind":"create","entity":"lists","id":"eeee0000-0000-7000-8000-0000000000c2","group_id":"eeee0000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Apteka","responsible_member_id":"eeee0000-0000-7000-8000-0000000000b1"}}') is not null;
select pg_temp.push('eeee0000-0000-7000-8000-00000000c0e1', 3, '{"kind":"create","entity":"handoffs","id":"eeee0000-0000-7000-8000-0000000007e1","group_id":"eeee0000-0000-7000-8000-000000000001","set":{"entity":"lists","entity_id":"eeee0000-0000-7000-8000-0000000000c2","to_member":"eeee0000-0000-7000-8000-0000000000b2"}}') is not null;
reset role;
select pg_temp.as_user('');

-- 5–6: przypisanie zakupów.
select is(public.assignment_push_claim((select id from public.activity where entity = 'lists' and entity_id = 'eeee0000-0000-7000-8000-0000000000c1'), '00000000-0000-7000-8000-0000000000e1', 24) ->> 'body',
  'Zakupy na weekend', '5: przypisanie listy „Zakupy na weekend” — bez „Zakupy: Zakupy”');
select is(public.assignment_push_claim((select id from public.activity where entity = 'lists' and entity_id = 'eeee0000-0000-7000-8000-0000000000c1'), '00000000-0000-7000-8000-0000000000e1', 24),
  null, '6: drugi raz — nic (warunki bez zmian)');

-- 7–8: przekazanie zakupów listy o innej nazwie — przedrostek zostaje; po zmianie nazwy na „Zakupy…” znika.
select is(public.handoff_push_claim('eeee0000-0000-7000-8000-0000000007e1', '00000000-0000-7000-8000-0000000000e1', 24) ->> 'body',
  'Zakupy: Apteka. Otwórz Organizer, żeby przyjąć albo odrzucić.', '7: przekazanie zakupów — z przedrostkiem');
update public.lists set name = 'Zakupy w aptece' where id = 'eeee0000-0000-7000-8000-0000000000c2';
update public.handoffs set push_sent_status = null where id = 'eeee0000-0000-7000-8000-0000000007e1';
select is(public.handoff_push_claim('eeee0000-0000-7000-8000-0000000007e1', '00000000-0000-7000-8000-0000000000e1', 24) ->> 'body',
  'Zakupy w aptece. Otwórz Organizer, żeby przyjąć albo odrzucić.', '8: nazwa zaczyna się od „Zakupy” — bez przedrostka');

select * from finish();
rollback;
