-- Stałe zadania serii (migracja 20261008130000_event_task_series, D65) i czyszczenie kosza z podpiętymi zadaniami.
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000d1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000d2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000d3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000d4', 'z@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
set local role authenticated;
select public.create_group('55550000-0000-7000-8000-000000000002', 'Obca', '55550000-0000-7000-8000-0000000000a4', 'Z');
select pg_temp.push('55550000-0000-7000-8000-00000000c0d4', 1, '{"kind":"create","entity":"lists","id":"55550000-0000-7000-8000-0000000000b9","group_id":"55550000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"Obca"}}') is not null;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select public.create_group('55550000-0000-7000-8000-000000000001', 'Rodzina', '55550000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('55550000-0000-7000-8000-0000000000a2', '55550000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d2', 'B', 'member'),
  ('55550000-0000-7000-8000-0000000000a3', '55550000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d3', 'C', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"55550000-0000-7000-8000-0000000000b1","group_id":"55550000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"lists","id":"55550000-0000-7000-8000-0000000000b2","group_id":"55550000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"private"}}') is not null;
select pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"lists","id":"55550000-0000-7000-8000-0000000000b3","group_id":"55550000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}}') is not null;
select pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 4, '{"kind":"create","entity":"events","id":"55550000-0000-7000-8000-0000000001e1","group_id":"55550000-0000-7000-8000-000000000001","set":{"title":"Tańce","start_date":"2026-10-05","start_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') is not null;

-- 1–5: definicja.
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 5, '{"kind":"create","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000005a1","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","list_id":"55550000-0000-7000-8000-0000000000b1","title":"Spakować strój"}}'), 'ok', '1: stałe zadanie serii');
select is((select created_by::text from public.event_task_series where id = '55550000-0000-7000-8000-0000000005a1'), '55550000-0000-7000-8000-0000000000a1', '2: autora ustawia serwer');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 6, '{"kind":"create","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000005a2","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","list_id":"55550000-0000-7000-8000-0000000000b3","title":"X"}}'), 'invalid_list:kind', '3: nie na liście zakupów');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 7, '{"kind":"create","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000005a2","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","list_id":"55550000-0000-7000-8000-0000000000b9","title":"X"}}'), 'invalid_list', '4: lista z innej grupy odrzucona');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 8, '{"kind":"create","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000005a3","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","list_id":"55550000-0000-7000-8000-0000000000b2","title":"Prezent dla trenerki"}}'), 'ok', '5: na liście prywatnej');

-- 6–8: kopie zadania (ten sam identyfikator z dwóch telefonów = jedno zadanie).
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d1', 9, '{"kind":"create","entity":"tasks","id":"55550000-0000-7000-8000-0000000004c1","group_id":"55550000-0000-7000-8000-000000000001","set":{"list_id":"55550000-0000-7000-8000-0000000000b1","title":"Spakować strój","deadline_mode":"event","event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","series_id":"55550000-0000-7000-8000-0000000005a1"}}'), 'ok', '6: kopia na wystąpieniu');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d2', 1, '{"kind":"create","entity":"tasks","id":"55550000-0000-7000-8000-0000000004c1","group_id":"55550000-0000-7000-8000-000000000001","set":{"list_id":"55550000-0000-7000-8000-0000000000b1","title":"Spakować strój","deadline_mode":"event","event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","series_id":"55550000-0000-7000-8000-0000000005a1"}}'), 'ok', '7: ta sama kopia z drugiego telefonu — powtórzenie');
select is((select count(*)::int from public.tasks where series_id = '55550000-0000-7000-8000-0000000005a1'), 1, '8: jedno zadanie');

-- 9–11: widoczność i uprawnienia.
select is((select count(*)::int from public.event_task_series), 1, '9: B nie widzi definicji z listy prywatnej A');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d3', 1, '{"kind":"patch","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000005a1","set":{"title":"Y"}}'), 'forbidden:child', '10: dziecko nie zmienia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0d4', 2, '{"kind":"create","entity":"tasks","id":"55550000-0000-7000-8000-0000000004c9","group_id":"55550000-0000-7000-8000-000000000002","set":{"list_id":"55550000-0000-7000-8000-0000000000b9","title":"X","series_id":"55550000-0000-7000-8000-0000000005a1"}}'), 'invalid_series', '11: definicja z innej grupy odrzucona');

-- 12–13: czyszczenie kosza nie przerywa się na serii z podpiętym zadaniem; zakończenie definicji.
reset role;
select pg_temp.as_user('');
update public.events set deleted_at = now() - interval '31 days' where id = '55550000-0000-7000-8000-0000000001e1';
update public.event_task_series set deleted_at = now() - interval '31 days' where id = '55550000-0000-7000-8000-0000000005a3';
select lives_ok($$ select private.purge_tombstones() $$, '12: czyszczenie przechodzi mimo zadania wskazującego usuniętą serię');
-- D182 (audyt 2, M-67): seria po 30 dniach w koszu znika także z przypiętym zadaniem — zadanie zostaje, odpięte.
select ok(not exists (select 1 from public.events where id = '55550000-0000-7000-8000-0000000001e1')
          and not exists (select 1 from public.event_task_series where id = '55550000-0000-7000-8000-0000000005a3')
          and not exists (select 1 from public.tasks where event_id = '55550000-0000-7000-8000-0000000001e1'),
  '13: seria i definicja usunięte, przypięte zadania odpięte (D182)');

select * from finish();
rollback;
