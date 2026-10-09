-- Łańcuch serii po „to i następne” (migracja 20261010050000_series_chain, audyt 3, PK-05): spóźnione zapisy przechodzą do
-- części, która ma ten dzień (N-23), przyjęcie przekazania całej serii na wszystkich częściach (N-113), przekazanie
-- odwołanego terminu nieaktualne (N-115), koniec serii na całym łańcuchu z wyjątkami i odpowiedziami (N-3, N-117) i jego
-- cofnięcie, późniejsze części w „ten i następne” (N-22).
begin;
select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000005e1', 'a5@x.test'),
  ('00000000-0000-7000-8000-0000000005e2', 'b5@x.test'),
  ('00000000-0000-7000-8000-0000000005e3', 'c5@x.test'),
  ('00000000-0000-7000-8000-0000000005e4', 'z5@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.cmd(client text, seq int, name text, args jsonb) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'cmd', 'cmd', name, 'args', args))
$$;
-- Id wyliczane na telefonie (src/domain/views/rsvp.ts, events.ts) — ze starej części, jak u telefonu bez podziału.
create function pg_temp.rsvp_id(e text, d text, m text) returns uuid language sql security definer as $$
  select private.uuid_v5('25e69e19-ed6c-5137-b6a6-d2fd2ff0a0e5'::uuid, e || '|' || d || '|' || m)
$$;
create function pg_temp.override_id(e text, d text) returns uuid language sql security definer as $$
  select private.uuid_v5('507f935e-7343-5bf0-a46c-cedc524fb294'::uuid, e || '|' || d)
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.cmd(text, int, text, jsonb),
  pg_temp.rsvp_id(text, text, text), pg_temp.override_id(text, text) to authenticated;

-- G: A (właściciel), B (członek), C (dziecko z kontem). Z ma swoją grupę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e1');
set local role authenticated;
select public.create_group('55550000-0000-7000-8000-000000000001', 'Rodzina', '55550000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e4');
select public.create_group('55550000-0000-7000-8000-000000000002', 'Obca', '55550000-0000-7000-8000-0000000000a4', 'Z');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('55550000-0000-7000-8000-0000000000a2', '55550000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000005e2', 'B', 'member'),
  ('55550000-0000-7000-8000-0000000000a3', '55550000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000005e3', 'C', 'child');

-- A: lista, chór (pon. 17:00 od 5.10, A odpowiada) ze stałym zadaniem, jednorazowe wydarzenie O z wyjątkiem w koszu,
-- przekazanie całej serii do B, potem „to i następne” od 2.11 na 18:00 (S1).
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e1');
set local role authenticated;
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"55550000-0000-7000-8000-0000000001f1","group_id":"55550000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom","visibility":"group","sort_key":"a0"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"events","id":"55550000-0000-7000-8000-0000000001e1","group_id":"55550000-0000-7000-8000-000000000001","set":{"title":"Chór","start_date":"2026-10-05","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO","audience":"group","responsible_member_id":"55550000-0000-7000-8000-0000000000a1"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"event_task_series","id":"55550000-0000-7000-8000-0000000007d1","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","list_id":"55550000-0000-7000-8000-0000000001f1","title":"Nuty"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"events","id":"55550000-0000-7000-8000-0000000001e2","group_id":"55550000-0000-7000-8000-000000000001","set":{"title":"Wywiadówka","start_date":"2026-10-21","start_time":"18:00","end_time":"19:00","audience":"group"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"event_overrides","id":"55550000-0000-7000-8000-000000000391","group_id":"55550000-0000-7000-8000-000000000001","set":{"event_id":"55550000-0000-7000-8000-0000000001e2","occurrence_date":"2026-10-21","title":"Zebranie"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 6, '{"kind":"delete","entity":"event_overrides","id":"55550000-0000-7000-8000-000000000391"}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 7, '{"kind":"create","entity":"handoffs","id":"55550000-0000-7000-8000-000000000501","group_id":"55550000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":null,"to_member":"55550000-0000-7000-8000-0000000000a2"}}') = 'ok';
select pg_temp.cmd('55550000-0000-7000-8000-00000000c0a1', 8, 'split_event', '{"id":"55550000-0000-7000-8000-0000000005e1","event_id":"55550000-0000-7000-8000-0000000001e1","date":"2026-11-02","set":{"title":"Chór","start_date":"2026-11-02","start_time":"18:00","end_time":"19:00","rrule":"FREQ=WEEKLY;BYDAY=MO","audience":"group","responsible_member_id":"55550000-0000-7000-8000-0000000000a1","location":null},"participants":[],"drop_overrides":[],"tasks":[]}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 9, jsonb_build_object('kind', 'create', 'entity', 'event_rsvps', 'id', pg_temp.rsvp_id('55550000-0000-7000-8000-0000000001e1', '2026-10-26', '55550000-0000-7000-8000-0000000000a1'), 'group_id', '55550000-0000-7000-8000-000000000001', 'set', '{"event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","member_id":"55550000-0000-7000-8000-0000000000a1","answer":"yes"}'::jsonb)) = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 10, jsonb_build_object('kind', 'create', 'entity', 'event_overrides', 'id', pg_temp.override_id('55550000-0000-7000-8000-0000000001e1', '2026-10-26'), 'group_id', '55550000-0000-7000-8000-000000000001', 'set', '{"event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","title":"Wyjazd"}'::jsonb)) = 'ok';

-- 1–5 (N-23): telefon B bez pobranego podziału zapisuje terminy od 2.11 do starej części — trafiają do S1.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e2');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 1, jsonb_build_object('kind', 'create', 'entity', 'event_rsvps', 'id', pg_temp.rsvp_id('55550000-0000-7000-8000-0000000001e1', '2026-11-09', '55550000-0000-7000-8000-0000000000a2'), 'group_id', '55550000-0000-7000-8000-000000000001', 'set', '{"event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-09","member_id":"55550000-0000-7000-8000-0000000000a2","answer":"no"}'::jsonb)), 'ok', '1: spóźnione „nie będę” przyjęte');
select is((select event_id::text from public.event_rsvps where occurrence_date = '2026-11-09'), '55550000-0000-7000-8000-0000000005e1', '1: odpowiedź w części, która ma 9.11');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 2, jsonb_build_object('kind', 'create', 'entity', 'event_overrides', 'id', pg_temp.override_id('55550000-0000-7000-8000-0000000001e1', '2026-11-16'), 'group_id', '55550000-0000-7000-8000-000000000001', 'set', '{"event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-16","cancelled":true}'::jsonb)), 'ok', '2: spóźnione odwołanie przyjęte');
select is((select event_id::text from public.event_overrides where occurrence_date = '2026-11-16'), '55550000-0000-7000-8000-0000000005e1', '2: odwołanie w części, która ma 16.11');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 3, '{"kind":"create","entity":"tasks","id":"55550000-0000-7000-8000-000000000611","group_id":"55550000-0000-7000-8000-000000000001","set":{"list_id":"55550000-0000-7000-8000-0000000001f1","title":"Strój","sort_key":"a0","deadline_mode":"event","event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-09"}}'), 'ok', '3: spóźnione zadanie na termin');
select is((select event_id::text from public.tasks where id = '55550000-0000-7000-8000-000000000611'), '55550000-0000-7000-8000-0000000005e1', '3: zadanie w części z tym dniem');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 4, '{"kind":"patch","entity":"tasks","id":"55550000-0000-7000-8000-000000000611","set":{"event_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-19"}}'), 'ok', '4: przepięcie zadania na termin starej części');
select is((select event_id::text from public.tasks where id = '55550000-0000-7000-8000-000000000611'), '55550000-0000-7000-8000-0000000001e1', '4: 19.10 należy do starej części — zostaje');
select is((select count(*)::int from public.event_rsvps where event_id = '55550000-0000-7000-8000-0000000001e1' and occurrence_date >= '2026-11-02'), 0, '5: stara część nie ma odpowiedzi po swoim końcu');

-- 6–10 (N-115, N-113): przekazanie terminu, który nadawca odwołał — nieaktualne; cała seria — na obu częściach.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e1');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 11, '{"kind":"create","entity":"handoffs","id":"55550000-0000-7000-8000-000000000502","group_id":"55550000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-23","to_member":"55550000-0000-7000-8000-0000000000a2"}}'), 'ok', '6: przekazanie terminu 23.11 ze starej części');
select is((select entity_id::text from public.handoffs where id = '55550000-0000-7000-8000-000000000502'), '55550000-0000-7000-8000-0000000005e1', '6: przekazanie przepięte do S1 (N-23)');
select pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 12, jsonb_build_object('kind', 'create', 'entity', 'event_overrides', 'id', pg_temp.override_id('55550000-0000-7000-8000-0000000005e1', '2026-11-23'), 'group_id', '55550000-0000-7000-8000-000000000001', 'set', '{"event_id":"55550000-0000-7000-8000-0000000005e1","occurrence_date":"2026-11-23","cancelled":true}'::jsonb)) = 'ok';
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e2');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 5, '{"kind":"patch","entity":"handoffs","id":"55550000-0000-7000-8000-000000000502","set":{"status":"accepted"}}'), 'stale', '7: odwołanego terminu nie da się przyjąć (N-115)');
select is((select count(*)::int from public.event_overrides where event_id = '55550000-0000-7000-8000-0000000005e1' and occurrence_date = '2026-11-23' and responsible_member_id is not null), 0, '7: bez wyjątku z osobą');
select is((select entity_id::text from public.handoffs where id = '55550000-0000-7000-8000-000000000501'), '55550000-0000-7000-8000-0000000005e1', '8: przekazanie serii przeszło z podziałem do najnowszej części');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 6, '{"kind":"patch","entity":"handoffs","id":"55550000-0000-7000-8000-000000000501","set":{"status":"accepted"}}'), 'ok', '9: przyjęcie całej serii');
select is((select array_agg(responsible_member_id::text order by start_date) from public.events where id in ('55550000-0000-7000-8000-0000000001e1', '55550000-0000-7000-8000-0000000005e1')),
  array['55550000-0000-7000-8000-0000000000a2', '55550000-0000-7000-8000-0000000000a2'], '9: B odpowiada za obie części (N-113)');
-- B przekazuje serię z powrotem, ale zanim A przyjmie, osoba zmienia się w obu częściach.
select pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 7, '{"kind":"create","entity":"handoffs","id":"55550000-0000-7000-8000-000000000503","group_id":"55550000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"55550000-0000-7000-8000-0000000001e1","occurrence_date":null,"to_member":"55550000-0000-7000-8000-0000000000a1"}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 8, '{"kind":"patch","entity":"events","id":"55550000-0000-7000-8000-0000000001e1","set":{"responsible_member_id":null}}') = 'ok';
select pg_temp.push('55550000-0000-7000-8000-00000000c0b2', 9, '{"kind":"patch","entity":"events","id":"55550000-0000-7000-8000-0000000005e1","set":{"responsible_member_id":null}}') = 'ok';
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e1');
select is(pg_temp.push('55550000-0000-7000-8000-00000000c0a1', 13, '{"kind":"patch","entity":"handoffs","id":"55550000-0000-7000-8000-000000000503","set":{"status":"accepted"}}'), 'stale', '10: nic do przejęcia w żadnej części — nieaktualne');

-- 11–15: odrzucenia end_series i restore_series.
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0a1', 14, 'end_series', '{}'), 'invalid_value', '11: end_series bez wydarzenia');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0a1', 15, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000009e9","date":null}'), 'not_found', '12: nieznane wydarzenie');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0a1', 16, 'restore_series', '{}'), 'invalid_value', '13: restore_series bez wydarzenia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e3');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0c3', 1, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000001e1","date":null}'), 'forbidden:child', '14: dziecko nie kończy serii');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0c3', 2, 'restore_series', '{"event_id":"55550000-0000-7000-8000-0000000001e1","events":[]}'), 'forbidden:child', '14: dziecko nie cofa');
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e4');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0d4', 1, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000001e1","date":null}'), 'not_found', '15: osoba spoza grupy nie widzi serii');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0d4', 2, 'restore_series', '{"event_id":"55550000-0000-7000-8000-0000000001e1","events":[]}'), 'not_found', '15: ani jej nie przywróci');

-- 16–22 (N-3, N-117): B odwołuje „ten i następne” od 19.10 z terminu starej części.
select pg_temp.as_user('00000000-0000-7000-8000-0000000005e2');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 10, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000001e1","date":"2026-10-19","title":"Chór"}'), 'ok', '16: koniec serii od 19.10');
select is((select rrule from public.events where id = '55550000-0000-7000-8000-0000000001e1'), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018', '17: stara część kończy się 18.10');
select ok((select deleted_at is not null from public.events where id = '55550000-0000-7000-8000-0000000005e1'), '18: część od 2.11 w koszu (wcześniej zostawała)');
select ok((select deleted_at is not null from public.event_rsvps where occurrence_date = '2026-10-26'), '19: odpowiedź A z 26.10 do kosza, choć odwołał B (N-117)');
select ok((select deleted_at is not null from public.event_overrides where occurrence_date = '2026-10-26'), '20: wyjątek 26.10 do kosza');
select is((select event_id::text from public.event_task_series where id = '55550000-0000-7000-8000-0000000007d1'), '55550000-0000-7000-8000-0000000001e1', '21: stałe zadanie przechodzi do części, która zostaje');
select ok((select deleted_at is null from public.event_task_series where id = '55550000-0000-7000-8000-0000000007d1'), '21: i żyje');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 11, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000005e1","date":null}'), 'deleted', '22: część w koszu — usunięta');

-- 23–27: cofnięcie (restore_series) — tylko wiersze tego łańcucha.
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 12, 'restore_series', jsonb_build_object('event_id', '55550000-0000-7000-8000-0000000001e1',
  'events', jsonb_build_array('55550000-0000-7000-8000-0000000005e1', '55550000-0000-7000-8000-0000000001e2'),
  'parts', jsonb_build_array(jsonb_build_object('id', '55550000-0000-7000-8000-0000000001e1', 'rrule', 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101')),
  'overrides', jsonb_build_array(pg_temp.override_id('55550000-0000-7000-8000-0000000001e1', '2026-10-26'), '55550000-0000-7000-8000-000000000391'),
  'rsvps', jsonb_build_array(pg_temp.rsvp_id('55550000-0000-7000-8000-0000000001e1', '2026-10-26', '55550000-0000-7000-8000-0000000000a1')))), 'ok', '23: cofnięcie');
select is((select rrule from public.events where id = '55550000-0000-7000-8000-0000000001e1'), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101', '24: reguła sprzed ucięcia');
select ok((select deleted_at is null from public.events where id = '55550000-0000-7000-8000-0000000005e1'), '25: część od 2.11 wraca');
select ok((select bool_and(deleted_at is null) from public.event_rsvps where occurrence_date = '2026-10-26'), '26: odpowiedź A wraca');
select ok((select deleted_at is not null from public.event_overrides where id = '55550000-0000-7000-8000-000000000391'), '27: wyjątek innego wydarzenia zostaje w koszu');

-- 28–31: „Usuń całą serię” z nowej części usuwa obie (wcześniej zostawała stara); cofnięcie przywraca stałe zadanie.
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 13, 'end_series', '{"event_id":"55550000-0000-7000-8000-0000000005e1","date":null}'), 'ok', '28: cała seria');
select is((select count(*)::int from public.events where id in ('55550000-0000-7000-8000-0000000001e1', '55550000-0000-7000-8000-0000000005e1') and deleted_at is null), 0, '29: obie części w koszu');
select ok((select z.deleted_at = e.deleted_at from public.event_task_series z join public.events e on e.id = z.event_id where z.id = '55550000-0000-7000-8000-0000000007d1'), '30: stałe zadanie razem z serią');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 14, 'restore_series', '{"event_id":"55550000-0000-7000-8000-0000000005e1","events":["55550000-0000-7000-8000-0000000001e1","55550000-0000-7000-8000-0000000005e1"]}'), 'ok', '31: cofnięcie');
select is((select count(*)::int from public.events where id in ('55550000-0000-7000-8000-0000000001e1', '55550000-0000-7000-8000-0000000005e1') and deleted_at is null)
  + (select count(*)::int from public.event_task_series where id = '55550000-0000-7000-8000-0000000007d1' and deleted_at is null), 3, '31: obie części i stałe zadanie wracają');

-- 32–36 (N-22): „ten i następne” od 19.10 z późniejszą częścią — tylko pola zmienione w formularzu; część spoza łańcucha
-- i część, która zaczyna się przed dniem podziału, bez zmian; część ucięta nowym końcem — do kosza.
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 15, 'split_event', '{"id":"55550000-0000-7000-8000-0000000005e2","event_id":"55550000-0000-7000-8000-0000000001e1","date":"2026-10-19","set":{"title":"Próba chóru","start_date":"2026-10-19","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO","audience":"group","responsible_member_id":"55550000-0000-7000-8000-0000000000a3","location":null},"participants":[],"drop_overrides":[],"tasks":[],"follow":[{"id":"55550000-0000-7000-8000-0000000005e1","set":{"title":"Próba chóru","responsible_member_id":"55550000-0000-7000-8000-0000000000a3","location":"Aula"}},{"id":"55550000-0000-7000-8000-0000000001e2","set":{"title":"Obce"}},{"id":"55550000-0000-7000-8000-0000000001e1","set":{"title":"Stara"}}]}'), 'ok', '32: podział z późniejszą częścią');
select is((select title || ' ' || start_time::text || ' ' || coalesce(location, '-') || ' ' || coalesce(responsible_member_id::text, 'nikt') from public.events where id = '55550000-0000-7000-8000-0000000005e1'),
  'Próba chóru 18:00:00 Aula nikt', '33: późniejsza część — nowa nazwa i miejsce, swoja godzina; dziecko nie odpowiada (D132)');
select is((select rrule from public.events where id = '55550000-0000-7000-8000-0000000005e2'), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101', '34: nowa część do dnia przed późniejszą');
select is((select string_agg(title, ',' order by start_date) from public.events where id in ('55550000-0000-7000-8000-0000000001e2', '55550000-0000-7000-8000-0000000001e1')), 'Chór,Wywiadówka', '35: wydarzenie spoza łańcucha i część sprzed podziału bez zmian');
select is(pg_temp.cmd('55550000-0000-7000-8000-00000000c0b2', 16, 'split_event', '{"id":"55550000-0000-7000-8000-0000000005e3","event_id":"55550000-0000-7000-8000-0000000005e2","date":"2026-10-26","set":{"title":"Próba chóru","start_date":"2026-10-26","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO;UNTIL=20261026","audience":"group","responsible_member_id":null,"location":null},"participants":[],"drop_overrides":[],"tasks":[],"follow":[{"id":"55550000-0000-7000-8000-0000000005e1","delete":true}]}'), 'ok', '36: koniec serii przed późniejszą częścią');
select ok((select deleted_at is not null from public.events where id = '55550000-0000-7000-8000-0000000005e1'), '36: późniejsza część do kosza');

select * from finish();
rollback;
