-- Przekazanie jednego terminu serii (migracja 20261008486000_join_handoff_fixes): „nikt konkretny” w terminie
-- (responsible_cleared) i wyjątek z identyfikatorem jak na telefonie przy przyjęciu.
begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000018a1', 'a18@x.test'), ('00000000-0000-7000-8000-0000000018a2', 'b18@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000018a1');
set local role authenticated;
select public.create_group('18180000-0000-7000-8000-000000000001', 'G', '18180000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('18180000-0000-7000-8000-0000000000a2', '18180000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000018a2', 'B', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000018a1');
set local role authenticated;
select pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"events","id":"18180000-0000-7000-8000-0000000001e1","group_id":"18180000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-05","rrule":"FREQ=WEEKLY;BYDAY=MO","responsible_member_id":"18180000-0000-7000-8000-0000000000a1"}}') = 'ok';
-- 12.10: „nikt konkretny” (wyjątek bez osoby z zaznaczeniem); 26.10: wyjątek z tytułem, bez zmiany osoby.
select pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"event_overrides","id":"18180000-0000-7000-8000-0000000001f1","group_id":"18180000-0000-7000-8000-000000000001","set":{"event_id":"18180000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","responsible_cleared":true}}') = 'ok';
select pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"event_overrides","id":"18180000-0000-7000-8000-0000000001f2","group_id":"18180000-0000-7000-8000-000000000001","set":{"event_id":"18180000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","title":"Basen z tatą","responsible_cleared":false}}') = 'ok';

select is(pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 4, '{"kind":"create","entity":"handoffs","id":"18180000-0000-7000-8000-0000000006f1","group_id":"18180000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"18180000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","to_member":"18180000-0000-7000-8000-0000000000a2"}}'),
  'forbidden:not_responsible', '1: termin „nikt konkretny” — osoba serii nie przekazuje go');
select is(pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 5, '{"kind":"create","entity":"handoffs","id":"18180000-0000-7000-8000-0000000006f2","group_id":"18180000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"18180000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-19","to_member":"18180000-0000-7000-8000-0000000000a2"}}'),
  'ok', '2: termin bez wyjątku — osoba serii przekazuje');
select is(pg_temp.push('18180000-0000-7000-8000-00000000c0d1', 6, '{"kind":"create","entity":"handoffs","id":"18180000-0000-7000-8000-0000000006f3","group_id":"18180000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"18180000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","to_member":"18180000-0000-7000-8000-0000000000a2"}}'),
  'ok', '3: wyjątek bez osoby i bez zaznaczenia — osoba serii przekazuje');

select pg_temp.as_user('00000000-0000-7000-8000-0000000018a2');
select is(pg_temp.push('18180000-0000-7000-8000-00000000c0d2', 1, '{"kind":"patch","entity":"handoffs","id":"18180000-0000-7000-8000-0000000006f2","set":{"status":"accepted"}}'), 'ok', '4: przyjęcie terminu bez wyjątku');
-- Ten sam wektor co overrideId() na telefonie, policzony niezależnie: Python uuid.uuid5(OVERRIDE_NAMESPACE, „event|2026-10-19”).
select is((select id::text from public.event_overrides where event_id = '18180000-0000-7000-8000-0000000001e1' and occurrence_date = '2026-10-19'),
  'aebd41a1-b759-5fe1-8fcc-d59a7396712f', '5: wyjątek z identyfikatorem jak na telefonie');
select is(pg_temp.push('18180000-0000-7000-8000-00000000c0d2', 2, '{"kind":"patch","entity":"handoffs","id":"18180000-0000-7000-8000-0000000006f3","set":{"status":"accepted"}}'), 'ok', '6: przyjęcie terminu z wyjątkiem');
select is((select array[responsible_member_id::text, responsible_cleared::text, title] from public.event_overrides where id = '18180000-0000-7000-8000-0000000001f2'),
  array['18180000-0000-7000-8000-0000000000a2', 'false', 'Basen z tatą'], '7: istniejący wyjątek dostaje osobę, reszta bez zmian');

select * from finish();
rollback;
