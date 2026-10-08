-- Wydarzenia, uczestnicy, zmiany pojedynczych wystąpień (migracja 20261008100000_events).
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000e3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000e4', 'z@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- G: owner A, member B, dziecko z kontem C (+ profil dziecka bez konta K). H: osobna grupa Z.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('33330000-0000-7000-8000-000000000001', 'Rodzina', '33330000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
select public.create_group('33330000-0000-7000-8000-000000000002', 'Obca', '33330000-0000-7000-8000-0000000000a4', 'Z');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('33330000-0000-7000-8000-0000000000a2', '33330000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'B', 'member'),
  ('33330000-0000-7000-8000-0000000000a3', '33330000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e3', 'C', 'child'),
  ('33330000-0000-7000-8000-0000000000a5', '33330000-0000-7000-8000-000000000001', null, 'Kuba', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
set local role authenticated;
-- 1–6: tworzenie i walidacja.
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 1, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001e1","group_id":"33330000-0000-7000-8000-000000000001","set":{"title":"Tańce","start_date":"2026-10-05","start_time":"18:00","end_time":"19:00","rrule":"FREQ=WEEKLY;BYDAY=MO","audience":"members"}}'), 'ok', '1: członek tworzy serię');
select is((select created_by::text from public.events where id = '33330000-0000-7000-8000-0000000001e1'), '33330000-0000-7000-8000-0000000000a2', '2: autora ustawia serwer');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 2, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001e2","group_id":"33330000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-05","rrule":"FREQ=HOURLY"}}'), 'invalid:23514', '3: reguła spoza wzorca odrzucona');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 3, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001e2","group_id":"33330000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-05","end_time":"17:00"}}'), 'invalid:23514', '4: koniec bez początku odrzucony (koniec przed początkiem = następnego dnia, D199: event_days.test.sql)');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 4, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001e2","group_id":"33330000-0000-7000-8000-000000000001","set":{"title":"Całodniowe","start_date":"2026-10-10"}}'), 'ok', '5: wydarzenie całodniowe bez reguły');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 5, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001e3","group_id":"33330000-0000-7000-8000-000000000002","set":{"title":"Cudze","start_date":"2026-10-10"}}'), 'forbidden', '6: nie w cudzej grupie');

-- 7–10: uczestnicy.
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 6, '{"kind":"create","entity":"event_participants","id":"33330000-0000-7000-8000-0000000002e1","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","member_id":"33330000-0000-7000-8000-0000000000a5"}}'), 'ok', '7: uczestnik — profil dziecka');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 7, '{"kind":"create","entity":"event_participants","id":"33330000-0000-7000-8000-0000000002e2","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","member_id":"33330000-0000-7000-8000-0000000000a4"}}'), 'invalid_member', '8: uczestnik spoza grupy odrzucony');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 8, '{"kind":"create","entity":"event_participants","id":"33330000-0000-7000-8000-0000000002e3","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","member_id":"33330000-0000-7000-8000-0000000000a5"}}'), 'invalid:23505', '9: ta sama osoba drugi raz odrzucona');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 9, '{"kind":"delete","entity":"event_participants","id":"33330000-0000-7000-8000-0000000002e1"}'), 'ok', '10: usunięcie uczestnika');

-- 11–15: zmiana pojedynczego wystąpienia i całej serii.
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 10, '{"kind":"create","entity":"event_overrides","id":"33330000-0000-7000-8000-0000000003e1","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","start_date":"2026-10-13","start_time":"17:00","end_time":"18:00"}}'), 'ok', '11: przeniesienie jednych zajęć');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 11, '{"kind":"create","entity":"event_overrides","id":"33330000-0000-7000-8000-0000000003e2","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","cancelled":true}}'), 'invalid:23505', '12: jedno wystąpienie = jedna zmiana');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 12, '{"kind":"patch","entity":"event_overrides","id":"33330000-0000-7000-8000-0000000003e1","set":{"cancelled":true}}'), 'ok', '13: odwołanie wystąpienia');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 13, '{"kind":"patch","entity":"events","id":"33330000-0000-7000-8000-0000000001e1","set":{"rrule":"FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130","start_time":"18:30","end_time":"19:30"}}'), 'ok', '14: zmiana całej serii (godzina, koniec)');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 14, '{"kind":"create","entity":"event_overrides","id":"33330000-0000-7000-8000-0000000003e3","group_id":"33330000-0000-7000-8000-000000000002","set":{"event_id":"33330000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-19","cancelled":true}}'), 'forbidden', '15: zmiana wystąpienia nie przechodzi przez cudzą grupę');

-- 16–17: dziecko z kontem tylko widzi.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e3');
select is((select count(*)::int from public.events where group_id = '33330000-0000-7000-8000-000000000001'), 2, '16: dziecko widzi wydarzenia grupy');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e3', 1, '{"kind":"patch","entity":"events","id":"33330000-0000-7000-8000-0000000001e1","set":{"title":"Zmiana"}}'), 'forbidden:child', '17: dziecko nie zmienia wydarzeń (D34)');

-- 18–20: osoba spoza grupy, pobieranie, usunięcie serii.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
select is((select count(*)::int from public.events where group_id = '33330000-0000-7000-8000-000000000001'), 0, '18: obcy nie widzi wydarzeń');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
select ok((select count(*) = 3 from private.group_rows_since('33330000-0000-7000-8000-000000000001', 0, 1000) x where x.e in ('events', 'event_overrides')), '19: pobieranie zmian zawiera serie i zmiany wystąpień');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e1', 1, '{"kind":"delete","entity":"events","id":"33330000-0000-7000-8000-0000000001e1"}'), 'ok', '20: usunięcie serii (do kosza)');
reset role;

-- 21–24: kto zawozi (D66, migracja event_responsible).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 30, '{"kind":"create","entity":"events","id":"33330000-0000-7000-8000-0000000001f1","group_id":"33330000-0000-7000-8000-000000000001","set":{"title":"Logopeda","start_date":"2026-10-08","responsible_member_id":"33330000-0000-7000-8000-0000000000a2"}}'), 'ok', '21: dorosły z grupy odpowiada');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 31, '{"kind":"patch","entity":"events","id":"33330000-0000-7000-8000-0000000001f1","set":{"responsible_member_id":"33330000-0000-7000-8000-0000000000a5"}}'), 'invalid_member', '22: dziecko nie zawozi');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 32, '{"kind":"patch","entity":"events","id":"33330000-0000-7000-8000-0000000001f1","set":{"responsible_member_id":"33330000-0000-7000-8000-0000000000a4"}}'), 'invalid_member', '23: osoba spoza grupy odrzucona');
select is(pg_temp.push('33330000-0000-7000-8000-00000000c0e2', 33, '{"kind":"create","entity":"event_overrides","id":"33330000-0000-7000-8000-0000000003f1","group_id":"33330000-0000-7000-8000-000000000001","set":{"event_id":"33330000-0000-7000-8000-0000000001f1","occurrence_date":"2026-10-08","responsible_member_id":"33330000-0000-7000-8000-0000000000a1"}}'), 'ok', '24: inna osoba w jednym wystąpieniu');
select * from finish();
rollback;
