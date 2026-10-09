-- Przekazanie odpowiedzialności z potwierdzeniem (migracja 20261008150000_handoffs, D70).
begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000b1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000b2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000b3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000b4', 'o@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- Rodzina: Łukasz (owner, A), Magdalena (member, M), dziecko z kontem C, osoba O (member) — O nie widzi listy prywatnej.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
set local role authenticated;
select public.create_group('66660000-0000-7000-8000-000000000001', 'Rodzina', '66660000-0000-7000-8000-0000000000a1', 'Łukasz');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('66660000-0000-7000-8000-0000000000a2', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b2', 'Magdalena', 'member'),
  ('66660000-0000-7000-8000-0000000000a3', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b3', 'C', 'child'),
  ('66660000-0000-7000-8000-0000000000a4', '66660000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b4', 'O', 'member'),
  ('66660000-0000-7000-8000-0000000000a5', '66660000-0000-7000-8000-000000000001', null, 'Tymek', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
set local role authenticated;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 1, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c1","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 2, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-0000000004d1","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000c1","title":"Logopeda","assignee_member_id":"66660000-0000-7000-8000-0000000000a1"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 3, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-0000000004d2","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000c1","title":"Nie moje","assignee_member_id":"66660000-0000-7000-8000-0000000000a2"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 4, '{"kind":"create","entity":"events","id":"66660000-0000-7000-8000-0000000001e1","group_id":"66660000-0000-7000-8000-000000000001","set":{"title":"Tańce","start_date":"2026-10-05","start_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO","responsible_member_id":"66660000-0000-7000-8000-0000000000a1"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 5, '{"kind":"create","entity":"lists","id":"66660000-0000-7000-8000-0000000000c2","group_id":"66660000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"private"}}') is not null;
select pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 6, '{"kind":"create","entity":"tasks","id":"66660000-0000-7000-8000-0000000004d3","group_id":"66660000-0000-7000-8000-000000000001","set":{"list_id":"66660000-0000-7000-8000-0000000000c2","title":"Prezent","assignee_member_id":"66660000-0000-7000-8000-0000000000a1"}}') is not null;

-- 1–7: tworzenie.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 7, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f1","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d1","to_member":"66660000-0000-7000-8000-0000000000a2"}}'), 'ok', '1: przekazanie mojego zadania dorosłemu');
select is((select from_member::text || '/' || status from public.handoffs where id = '66660000-0000-7000-8000-0000000007f1'), '66660000-0000-7000-8000-0000000000a1/pending', '2: nadawcę i stan ustawia serwer');
select is((select assignee_member_id::text from public.tasks where id = '66660000-0000-7000-8000-0000000004d1'), '66660000-0000-7000-8000-0000000000a1', '3: do przyjęcia zadanie zostaje u mnie');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 8, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f2","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d1","to_member":"66660000-0000-7000-8000-0000000000a4"}}'), 'invalid:23505', '4: jedno oczekujące przekazanie na zadanie');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 9, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f2","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d2","to_member":"66660000-0000-7000-8000-0000000000a4"}}'), 'forbidden:not_responsible', '5: cudzego zadania nie przekazuję');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 10, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f2","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d3","to_member":"66660000-0000-7000-8000-0000000000a5"}}'), 'invalid_member', '6: nie dziecku');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 11, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f2","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d3","to_member":"66660000-0000-7000-8000-0000000000a4"}}'), 'invalid_member', '7: nie osobie, która nie widzi listy');

-- 8–12: widoczność i decyzja odbiorcy.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b4');
select is((select count(*)::int from public.handoffs), 0, '8: osoba trzecia nie widzi przekazania');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b4', 1, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f1","set":{"status":"accepted"}}'), 'not_found', '9: osoba trzecia nic nie zmienia (wiersz niewidoczny)');
select is((select status from public.handoffs where id = '66660000-0000-7000-8000-0000000007f1'), null, '10: (sprawdzone jako osoba trzecia: brak wiersza)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b2');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b2', 1, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f1","set":{"status":"accepted"}}'), 'ok', '11: odbiorca przyjmuje');
select is((select assignee_member_id::text from public.tasks where id = '66660000-0000-7000-8000-0000000004d1'), '66660000-0000-7000-8000-0000000000a2', '12: zadanie przechodzi w tej samej transakcji');

-- 13–15: przyjętego nie da się zmienić; odrzucenie i zamknięcie informacji przez nadawcę.
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b2', 2, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f1","set":{"status":"declined"}}'), 'invalid_value:status', '13: decyzja jest ostateczna');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b2', 3, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f3","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"66660000-0000-7000-8000-0000000004d1","to_member":"66660000-0000-7000-8000-0000000000a1"}}'), 'ok', '14: teraz Magdalena może oddać je z powrotem');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 12, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f3","set":{"status":"declined"}}'), 'ok', '15: odbiorca odrzuca');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b2');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b2', 4, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f3","set":{"closed":true}}'), 'ok', '16: nadawca zamyka informację o odrzuceniu');
select is((select assignee_member_id::text from public.tasks where id = '66660000-0000-7000-8000-0000000004d1'), '66660000-0000-7000-8000-0000000000a2', '17: po odrzuceniu zostaje u nadawcy');

-- 18–21: wydarzenia — jeden termin i cała seria; anulowanie przez nadawcę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 13, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f4","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"66660000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","to_member":"66660000-0000-7000-8000-0000000000a2"}}'), 'ok', '18: przekazanie jednego terminu');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b2');
select pg_temp.push('66660000-0000-7000-8000-00000000c0b2', 5, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f4","set":{"status":"accepted"}}') is not null;
select is((select responsible_member_id::text from public.event_overrides where event_id = '66660000-0000-7000-8000-0000000001e1' and occurrence_date = '2026-10-12'),
  '66660000-0000-7000-8000-0000000000a2', '19: przyjęty termin — wyjątek z nową osobą');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 14, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f5","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"66660000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","to_member":"66660000-0000-7000-8000-0000000000a4"}}'), 'forbidden:not_responsible', '20: tego terminu już nie przekażę (odpowiada Magdalena)');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 15, '{"kind":"create","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f5","group_id":"66660000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"66660000-0000-7000-8000-0000000001e1","to_member":"66660000-0000-7000-8000-0000000000a2"}}'), 'ok', '21: przekazanie całej serii');
select is(pg_temp.push('66660000-0000-7000-8000-00000000c0b1', 16, '{"kind":"patch","entity":"handoffs","id":"66660000-0000-7000-8000-0000000007f5","set":{"status":"cancelled"}}'), 'ok', '22: nadawca anuluje');

select * from finish();
rollback;
