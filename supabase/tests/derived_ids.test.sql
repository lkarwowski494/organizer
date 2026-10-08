-- Identyfikatory wyliczane na telefonie nie dają się zająć (audyt 2, M-72; migracja 20261008483000_derived_ids).
begin;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000020a1', 'a20@x.test'), ('00000000-0000-7000-8000-0000000020a2', 'b20@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;
-- Id, które wyliczy telefon ofiary (A): obecność A, wyjątek terminu, kopia serii, następny termin zadania A.
create temp table ids as select
  private.uuid_v5('25e69e19-ed6c-5137-b6a6-d2fd2ff0a0e5', '20200000-0000-7000-8000-0000000001e1|2026-10-12|20200000-0000-7000-8000-0000000000a1') rsvp,
  private.uuid_v5('507f935e-7343-5bf0-a46c-cedc524fb294', '20200000-0000-7000-8000-0000000001e1|2026-10-12') ovr,
  private.uuid_v5('6a7d3795-bf51-52d9-a13e-cf7ef1c121af', '20200000-0000-7000-8000-0000000005a1|2026-10-12') copy,
  private.next_task_id('20200000-0000-7000-8000-0000000004d1') nxt,
  private.uuid_v5('6a7d3795-bf51-52d9-a13e-cf7ef1c121af', 'cokolwiek') bogus;
grant select on ids to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000020a1');
set local role authenticated;
select public.create_group('20200000-0000-7000-8000-000000000001', 'G', '20200000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('20200000-0000-7000-8000-0000000000a2', '20200000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000020a2', 'B', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000020a1');
set local role authenticated;
select pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"20200000-0000-7000-8000-0000000000b1","group_id":"20200000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') = 'ok';
select pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"events","id":"20200000-0000-7000-8000-0000000001e1","group_id":"20200000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-05","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') = 'ok';
select pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"event_task_series","id":"20200000-0000-7000-8000-0000000005a1","group_id":"20200000-0000-7000-8000-000000000001","set":{"event_id":"20200000-0000-7000-8000-0000000001e1","list_id":"20200000-0000-7000-8000-0000000000b1","title":"Strój"}}') = 'ok';
select pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 4, '{"kind":"create","entity":"tasks","id":"20200000-0000-7000-8000-0000000004d1","group_id":"20200000-0000-7000-8000-000000000001","set":{"list_id":"20200000-0000-7000-8000-0000000000b1","title":"Śmieci","deadline_mode":"own","due_date":"2026-10-12","repeat":"FREQ=WEEKLY;BYDAY=MO"}}') = 'ok';

-- B próbuje zająć id A.
select pg_temp.as_user('00000000-0000-7000-8000-0000000020a2');
select pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 1, '{"kind":"create","entity":"lists","id":"20200000-0000-7000-8000-0000000000b2","group_id":"20200000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Moja","visibility":"private"}}') = 'ok';
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 2, jsonb_build_object('kind', 'create', 'entity', 'event_rsvps', 'id', (select rsvp from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'member_id', '20200000-0000-7000-8000-0000000000a2', 'answer', 'yes'))),
  'invalid_id', '1: odpowiedź B pod id odpowiedzi A odrzucona');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 3, jsonb_build_object('kind', 'create', 'entity', 'event_overrides', 'id', (select ovr from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-19', 'title', 'X'))),
  'invalid_id', '2: wyjątek innego terminu pod tym id odrzucony');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 4, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', (select copy from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '20200000-0000-7000-8000-0000000000b2', 'title', 'Strój', 'deadline_mode', 'event', 'event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'series_id', '20200000-0000-7000-8000-0000000005a1'))),
  'invalid_id', '3: kopia serii na innej liście (prywatnej) odrzucona');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 5, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', (select nxt from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '20200000-0000-7000-8000-0000000000b2', 'title', 'Śmieci'))),
  'invalid_id', '4: następny termin w innej liście odrzucony');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d2', 6, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', (select bogus from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '20200000-0000-7000-8000-0000000000b2', 'title', 'X'))),
  'invalid_id', '5: id w wersji 5 bez pochodzenia odrzucone');

-- A zapisuje swoje — przechodzi.
select pg_temp.as_user('00000000-0000-7000-8000-0000000020a1');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 5, jsonb_build_object('kind', 'create', 'entity', 'event_rsvps', 'id', (select rsvp from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'member_id', '20200000-0000-7000-8000-0000000000a1', 'answer', 'yes'))),
  'ok', '6: odpowiedź A');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 6, jsonb_build_object('kind', 'create', 'entity', 'event_overrides', 'id', (select ovr from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'title', 'Basen z tatą'))),
  'ok', '7: wyjątek terminu');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 7, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', (select copy from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '20200000-0000-7000-8000-0000000000b1', 'title', 'Strój', 'deadline_mode', 'event', 'event_id', '20200000-0000-7000-8000-0000000001e1', 'occurrence_date', '2026-10-12', 'series_id', '20200000-0000-7000-8000-0000000005a1'))),
  'ok', '8: kopia serii');
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 8, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', (select nxt from ids), 'group_id', '20200000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '20200000-0000-7000-8000-0000000000b1', 'title', 'Śmieci', 'deadline_mode', 'own', 'due_date', '2026-10-19', 'repeat', 'FREQ=WEEKLY;BYDAY=MO'))),
  'ok', '9: następny termin');
-- Starsze wersje aplikacji nadawały wyjątkom losowe id — nadal przechodzą.
select is(pg_temp.push('20200000-0000-7000-8000-00000000c0d1', 9, '{"kind":"create","entity":"event_overrides","id":"20200000-0000-7000-8000-0000000001f9","group_id":"20200000-0000-7000-8000-000000000001","set":{"event_id":"20200000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","title":"Y"}}'),
  'ok', '10: id spoza wersji 5 bez zmian');

select * from finish();
rollback;
