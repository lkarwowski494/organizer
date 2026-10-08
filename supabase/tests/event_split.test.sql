-- „To i następne” jednym poleceniem (migracja 20261008320000_event_split, audyt 2: M-3, M-12, M-96), „nikt konkretny”
-- w jednym terminie (M-94) i godziny wyjątku jak w serii (M-95, PW-33 wariant A).
begin;
select plan(66);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000007e1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000007e2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000007e3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000007e4', 'z@x.test'),
  ('00000000-0000-7000-8000-0000000007e5', 'r@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.split(client text, seq int, args jsonb) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'cmd', 'cmd', 'split_event', 'args', args))
$$;
-- Polecenie podziału serii u w dniu d z wartościami nowej serii (domyślnie: poniedziałki 18:00–19:00).
create function pg_temp.args(sid text, u text, d text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', sid, 'event_id', u, 'date', d,
    'set', jsonb_build_object('title', 'Chór', 'start_date', d, 'start_time', '18:00', 'end_time', '19:00', 'rrule', 'FREQ=WEEKLY;BYDAY=MO',
                              'audience', 'group', 'responsible_member_id', null, 'location', null) || coalesce(extra -> 'set', '{}'),
    'participants', coalesce(extra -> 'participants', '[]'), 'drop_overrides', coalesce(extra -> 'drop_overrides', '[]'), 'tasks', coalesce(extra -> 'tasks', '[]'))
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.split(text, int, jsonb), pg_temp.args(text, text, text, jsonb) to authenticated;

-- G: A (owner), B (członek), C (dziecko z kontem), Tymek (profil dziecka), R (członek, wyjdzie z grupy). Z ma swoją grupę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000001', 'Rodzina', '77770000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e4');
select public.create_group('77770000-0000-7000-8000-000000000002', 'Obca', '77770000-0000-7000-8000-0000000000a4', 'Z');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77770000-0000-7000-8000-0000000000a2', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007e2', 'B', 'member'),
  ('77770000-0000-7000-8000-0000000000a3', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007e3', 'C', 'child'),
  ('77770000-0000-7000-8000-0000000000a5', '77770000-0000-7000-8000-000000000001', null, 'Tymek', 'child'),
  ('77770000-0000-7000-8000-0000000000a6', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007e5', 'R', 'member');

-- A: lista, chór (poniedziałki 17:00–18:00, A odpowiada, Tymek uczestnikiem), wyjątki, obecność, przekazanie, zadania, definicja.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
set local role authenticated;
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000001f1","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom","visibility":"group","sort_key":"a0"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e1","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Chór","note":"Nuty","start_date":"2026-10-05","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO","audience":"members","responsible_member_id":"77770000-0000-7000-8000-0000000000a1","kind":"lesson"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"event_participants","id":"77770000-0000-7000-8000-0000000002e1","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","member_id":"77770000-0000-7000-8000-0000000000a5"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000312","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","title":"Próba"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000319","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-19","responsible_member_id":"77770000-0000-7000-8000-0000000000a2"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000326","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26","cancelled":true}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 7, '{"kind":"create","entity":"event_rsvps","id":"77770000-0000-7000-8000-000000000419","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-02","member_id":"77770000-0000-7000-8000-0000000000a1","answer":"yes"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 8, '{"kind":"create","entity":"event_rsvps","id":"77770000-0000-7000-8000-000000000426","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-09","member_id":"77770000-0000-7000-8000-0000000000a5","answer":"no"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 9, '{"kind":"create","entity":"handoffs","id":"77770000-0000-7000-8000-000000000502","group_id":"77770000-0000-7000-8000-000000000001","set":{"entity":"events","entity_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-02","to_member":"77770000-0000-7000-8000-0000000000a2"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 10, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-000000000612","group_id":"77770000-0000-7000-8000-000000000001","set":{"list_id":"77770000-0000-7000-8000-0000000001f1","title":"Strój","sort_key":"a0","deadline_mode":"event","event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 11, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-000000000619","group_id":"77770000-0000-7000-8000-000000000001","set":{"list_id":"77770000-0000-7000-8000-0000000001f1","title":"Nuty","sort_key":"a0","deadline_mode":"event","event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-11-02","completed_at":"2026-10-08T10:00:00Z"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 12, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-000000000626","group_id":"77770000-0000-7000-8000-000000000001","set":{"list_id":"77770000-0000-7000-8000-0000000001f1","title":"Bilet","sort_key":"a0","deadline_mode":"event","event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-26"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 13, '{"kind":"create","entity":"event_task_series","id":"77770000-0000-7000-8000-0000000007d1","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","list_id":"77770000-0000-7000-8000-0000000001f1","title":"Nuty"}}') = 'ok';
reset role;
-- R wychodzi z grupy (był uczestnikiem w formularzu telefonu B).
select pg_temp.as_user('');
update public.group_members set deleted_at = now() where member_id = '77770000-0000-7000-8000-0000000000a6';

-- 1–8: odrzucenia (nic się nie zmienia).
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
set local role authenticated;
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 1, '{"id":"77770000-0000-7000-8000-0000000005e1"}'), 'invalid_value', '1: brak pól');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 2, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000009e9', '2026-10-19')), 'not_found', '2: nieznana seria');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 3, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19', '{"set":{"start_date":"2026-10-18"}}')), 'invalid_value:start_date', '3: nowa seria przed dniem podziału');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 4, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19', '{"set":{"title":""}}')), 'invalid:23514', '4: zły tytuł — całe polecenie odrzucone');
select is((select rrule from public.events where id = '77770000-0000-7000-8000-0000000001e1'), 'FREQ=WEEKLY;BYDAY=MO', '5: po odrzuceniu stara seria nieucięta (M-3)');
select is((select count(*)::int from public.event_overrides where event_id = '77770000-0000-7000-8000-0000000001e1'), 3, '6: wyjątki na swoim miejscu');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e3');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0c3', 1, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19')), 'forbidden:child', '7: dziecko nie dzieli serii (D34)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e4');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0d4', 1, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19')), 'not_found', '8: osoba spoza grupy nie widzi serii');

-- 9–26: podział od 19.10 (B, offline z formularzem, w którym R był jeszcze uczestnikiem).
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 5, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19',
  '{"set":{"audience":"members","responsible_member_id":"77770000-0000-7000-8000-0000000000a1"},
    "participants":[{"id":"77770000-0000-7000-8000-0000000002f1","member_id":"77770000-0000-7000-8000-0000000000a5"},{"id":"77770000-0000-7000-8000-0000000002f2","member_id":"77770000-0000-7000-8000-0000000000a6"}],
    "drop_overrides":["77770000-0000-7000-8000-000000000326"],
    "tasks":[{"id":"77770000-0000-7000-8000-000000000626","action":"relink","date":"2026-11-30"}]}')), 'ok', '9: podział przyjęty');
select is((select rrule from public.events where id = '77770000-0000-7000-8000-0000000001e1'), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018', '10: stara seria kończy się dzień wcześniej');
select is((select split_from::text || ' ' || kind || ' ' || note || ' ' || start_time::text || ' ' || created_by::text from public.events where id = '77770000-0000-7000-8000-0000000005e1'),
  '77770000-0000-7000-8000-0000000001e1 lesson Nuty 18:00:00 77770000-0000-7000-8000-0000000000a2', '11: nowa seria wskazuje poprzedniczkę; rodzaj i notatka z niej, autor — B');
select is((select responsible_member_id::text from public.events where id = '77770000-0000-7000-8000-0000000005e1'), '77770000-0000-7000-8000-0000000000a1', '12: osoba odpowiedzialna z formularza');
select is((select array_agg(member_id::text) from public.event_participants where event_id = '77770000-0000-7000-8000-0000000005e1' and deleted_at is null), array['77770000-0000-7000-8000-0000000000a5'], '13: uczestnicy tylko z grupy');
select is((select array_agg(id::text order by occurrence_date) from public.event_overrides where event_id = '77770000-0000-7000-8000-0000000001e1'), array['77770000-0000-7000-8000-000000000312'], '14: wyjątek sprzed dnia podziału zostaje');
select is((select string_agg(id::text || ':' || (deleted_at is not null)::text, ',' order by occurrence_date) from public.event_overrides where event_id = '77770000-0000-7000-8000-0000000005e1'),
  '77770000-0000-7000-8000-000000000319:false,77770000-0000-7000-8000-000000000326:true', '15: wyjątki od tego dnia przechodzą z tym samym id; termin, którego nowa seria nie ma — do kosza');
select is((select string_agg(event_id::text || '/' || answered_by::text, ',' order by occurrence_date) from public.event_rsvps where group_id = '77770000-0000-7000-8000-000000000001'),
  '77770000-0000-7000-8000-0000000005e1/77770000-0000-7000-8000-0000000000a1,77770000-0000-7000-8000-0000000005e1/77770000-0000-7000-8000-0000000000a1',
  '16: obecność innego dorosłego i dziecka przechodzi (M-12), kto odpowiedział — bez zmian');
select is((select entity_id::text || ' ' || status from public.handoffs where id = '77770000-0000-7000-8000-000000000502'), '77770000-0000-7000-8000-0000000005e1 pending', '17: oczekujące przekazanie terminu przechodzi');
select is((select string_agg(coalesce(event_id::text, '-') || '@' || coalesce(occurrence_date::text, '-'), ',' order by id) from public.tasks where list_id = '77770000-0000-7000-8000-0000000001f1'),
  '77770000-0000-7000-8000-0000000001e1@2026-10-12,77770000-0000-7000-8000-0000000005e1@2026-11-02,77770000-0000-7000-8000-0000000005e1@2026-11-30',
  '18: zadania od tego dnia (także zrobione) przechodzą; decyzja z podglądu: najbliższy termin');
select is((select event_id::text from public.event_task_series where id = '77770000-0000-7000-8000-0000000007d1'), '77770000-0000-7000-8000-0000000005e1', '19: definicja stałego zadania przechodzi');
select ok((select changes ? 'split_from' from public.activity where entity = 'events' and entity_id = '77770000-0000-7000-8000-0000000005e1' and verb = 'create'), '20: wpis aktywności nowej serii zawiera split_from (powiadomienia rozpoznają podział)');
select ok((select bool_and(not (changes ? 'responsible_member_id')) from public.activity where entity = 'event_overrides' and entity_id = '77770000-0000-7000-8000-000000000319' and verb = 'update'), '21: przeniesiony wyjątek bez zmiany osoby odpowiedzialnej');
select is(current_setting('request.jwt.claim.sub', true), '00000000-0000-7000-8000-0000000007e2', '22: po poleceniu znów kontekst użytkownika (strażnicy działają dalej)');
-- Telefon bez wiadomości o podziale odpowiada na termin starej serii — trafia w przeniesiony wiersz.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 14, '{"kind":"patch","entity":"event_rsvps","id":"77770000-0000-7000-8000-000000000419","set":{"answer":"maybe"}}'), 'ok', '23: odpowiedź na przeniesiony wiersz (E-25)');
-- Przekazany termin w nowej serii: odbiorca przyjmuje — zmienia się wyjątek nowej serii.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 6, '{"kind":"patch","entity":"handoffs","id":"77770000-0000-7000-8000-000000000502","set":{"status":"accepted"}}'), 'ok', '24: przyjęcie przekazania po podziale');
select is((select responsible_member_id::text from public.event_overrides where event_id = '77770000-0000-7000-8000-0000000005e1' and occurrence_date = '2026-11-02'), '77770000-0000-7000-8000-0000000000a2', '25: odpowiada B w terminie nowej serii (E-12)');
-- Telefon nie może sam przepiąć wyjątku ani odpowiedzi (bez polecenia).
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 7, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000312","set":{"event_id":"77770000-0000-7000-8000-0000000005e1"}}'), 'invalid_field:event_id', '26: event_id wyjątku nie do zmiany z telefonu');

-- 27–30: polecenie powtórzone (drugi telefon, ten sam termin): wartości jak zmiana całej nowej serii, bez ponownego dzielenia.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0a1', 15, pg_temp.args('77770000-0000-7000-8000-0000000005e1', '77770000-0000-7000-8000-0000000001e1', '2026-10-19', '{"set":{"start_time":"19:00","end_time":null,"responsible_member_id":"77770000-0000-7000-8000-0000000000a6"}}')), 'ok', '27: powtórzone polecenie przyjęte');
-- R wyszła z grupy: nikt konkretny (D132) — zamiast odrzucenia całego polecenia.
select is((select start_time::text || ' ' || coalesce(end_time::text, '-') || ' ' || coalesce(responsible_member_id::text, '-') from public.events where id = '77770000-0000-7000-8000-0000000005e1'), '19:00:00 - -', '28: ostatni zapis wygrywa; osoba spoza grupy nie przechodzi');
select is((select count(*)::int from public.events where group_id = '77770000-0000-7000-8000-000000000001'), 2, '29: bez drugiej nowej serii (bez dubli terminów)');
select is((select count(*)::int from public.event_participants where event_id = '77770000-0000-7000-8000-0000000005e1' and deleted_at is null), 0, '30: uczestnicy jak w powtórzonym poleceniu (cała grupa)');

-- 31–33: drugi telefon dzieli starą serię później (2.11), nie wiedząc o podziale — dzieli następczynię.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 8, pg_temp.args('77770000-0000-7000-8000-0000000005e2', '77770000-0000-7000-8000-0000000001e1', '2026-11-02')), 'ok', '31: podział od 2.11 przyjęty');
select is((select rrule from public.events where id = '77770000-0000-7000-8000-0000000005e1'), 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261101', '32: następczyni kończy się 1.11 (stara seria bez zmian)');
select is((select split_from::text from public.events where id = '77770000-0000-7000-8000-0000000005e2'), '77770000-0000-7000-8000-0000000005e1', '33: nowa część łańcucha');

-- 34–37: wtorki — podział od 3.11, potem od 20.10 (drugi telefon): nowa seria wchodzi między, bez dubli.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 9, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e3","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-06","start_time":"16:00","rrule":"FREQ=WEEKLY;BYDAY=TU"}}'), 'ok', '34: seria we wtorki');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 10, pg_temp.args('77770000-0000-7000-8000-0000000005e3', '77770000-0000-7000-8000-0000000001e3', '2026-11-03', '{"set":{"rrule":"FREQ=WEEKLY;BYDAY=TU"}}')), 'ok', '35: podział od 3.11');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 11, pg_temp.args('77770000-0000-7000-8000-0000000005e4', '77770000-0000-7000-8000-0000000001e3', '2026-10-20', '{"set":{"rrule":"FREQ=WEEKLY;BYDAY=TU"}}')), 'ok', '36: podział od 20.10');
select is((select string_agg(id::text || '<' || coalesce(split_from::text, '-') || ':' || rrule, ' ' order by start_date) from public.events where title = 'Basen' or id in ('77770000-0000-7000-8000-0000000005e3', '77770000-0000-7000-8000-0000000005e4')),
  '77770000-0000-7000-8000-0000000001e3<-:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261019 77770000-0000-7000-8000-0000000005e4<77770000-0000-7000-8000-0000000001e3:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102 77770000-0000-7000-8000-0000000005e3<77770000-0000-7000-8000-0000000005e4:FREQ=WEEKLY;BYDAY=TU',
  '37: łańcuch bez nakładania się terminów');

-- 38–42: pozostałe odrzucenia.
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 12, pg_temp.args('77770000-0000-7000-8000-0000000001e3', '77770000-0000-7000-8000-0000000001e1', '2026-10-12')), 'invalid_value:id', '38: identyfikator zwykłego wydarzenia');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 13, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e4","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Raz","start_date":"2026-10-06"}}'), 'ok', '39: jednorazowe');
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 14, pg_temp.args('77770000-0000-7000-8000-0000000005e5', '77770000-0000-7000-8000-0000000001e4', '2026-10-06')), 'invalid_value:rrule', '40: jednorazowego nie dzielimy');
select pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 15, '{"kind":"delete","entity":"events","id":"77770000-0000-7000-8000-0000000005e2"}') = 'ok';
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 16, pg_temp.args('77770000-0000-7000-8000-0000000005e2', '77770000-0000-7000-8000-0000000001e1', '2026-11-02')), 'deleted', '41: powtórzone polecenie dla usuniętej nowej serii');
select pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 17, '{"kind":"delete","entity":"events","id":"77770000-0000-7000-8000-0000000001e4"}') = 'ok';
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 18, pg_temp.args('77770000-0000-7000-8000-0000000005e6', '77770000-0000-7000-8000-0000000001e4', '2026-10-06')), 'deleted', '42: usunięta seria');

-- 43–44: build 21 dalej dzieli po staremu (osobne operacje) — bez zmian.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 19, '{"kind":"patch","entity":"events","id":"77770000-0000-7000-8000-0000000005e4","set":{"rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261026"}}'), 'ok', '43: build 21 — koniec starej serii');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 20, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e5","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-27","start_time":"17:00","rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261102"}}'), 'ok', '44: build 21 — nowa seria osobno');
reset role;

-- 45–46: poza poleceniem strażnicy dalej nie pozwalają przepiąć wyjątku ani odpowiedzi do innej serii.
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
select throws_ok($$ update public.event_overrides set event_id = '77770000-0000-7000-8000-0000000005e1' where id = '77770000-0000-7000-8000-000000000312' $$, 'P0001', 'immutable_column:event_id', '45: event_id wyjątku niezmienne');
select throws_ok($$ update public.event_rsvps set event_id = '77770000-0000-7000-8000-0000000001e1' where id = '77770000-0000-7000-8000-000000000419' $$, 'P0001', 'immutable_column:event_id', '46: event_id odpowiedzi niezmienne');

-- 47–51: M-94 — „nikt konkretny” w jednym terminie serii, która ma osobę odpowiedzialną (znaczenie liczy telefon:
-- occurrenceResponsible w src/domain/views/event-rows.ts).
set local role authenticated;
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 21, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000391","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-05","responsible_cleared":true}}'), 'ok', '47: znacznik przyjęty');
select is((select responsible_cleared from public.event_overrides where id = '77770000-0000-7000-8000-000000000391'), true, '48: zapisany');
select is((select r -> 'row' -> 'responsible_cleared' from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') r
           where r ->> 'e' = 'event_overrides' and r -> 'row' ->> 'id' = '77770000-0000-7000-8000-000000000391'), 'true'::jsonb, '49: telefony dostają znacznik w pobraniu');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 16, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000391","set":{"responsible_member_id":"77770000-0000-7000-8000-0000000000a1"}}'), 'ok', '50: wskazanie osoby w tym terminie');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 17, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000391","set":{"responsible_cleared":false}}'), 'ok', '51: znacznik do zdjęcia z telefonu');

-- 52–57: M-95 (PW-33, wariant A) — godziny wyjątku równe godzinom serii w chwili zapisu znaczą „jak w serii”.
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 18, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e6","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Angielski","start_date":"2026-10-07","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=WE"}}'), 'ok', '52: seria w środy 17:00–18:00');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 19, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000361","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e6","occurrence_date":"2026-10-14","title":"Test","start_time":"17:00","end_time":"18:00"}}'), 'ok', '53: build 21: wyjątek z samą nazwą (pełne godziny)');
select is((select coalesce(start_time::text, '-') || ' ' || coalesce(end_time::text, '-') from public.event_overrides where id = '77770000-0000-7000-8000-000000000361'), '- -', '54: godziny serii zapisane jako „jak w serii”');
select is(pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 20, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000362","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e6","occurrence_date":"2026-10-21","start_time":"16:00","end_time":"17:00"}}'), 'ok', '55: własna godzina');
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 21, '{"kind":"patch","entity":"events","id":"77770000-0000-7000-8000-0000000001e6","set":{"start_time":"16:00","end_time":"17:00"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 22, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000362","set":{"title":"Zmiana nazwy","start_time":"16:00","end_time":"17:00"}}') = 'ok';
select is((select start_time::text from public.event_overrides where id = '77770000-0000-7000-8000-000000000362'), '16:00:00', '56: zmiana nazwy nie rusza zapisanej własnej godziny (choć dziś równa serii)');
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 23, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000362","set":{"start_time":"16:00","end_time":"17:30"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 24, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000362","set":{"start_time":"16:00","end_time":"17:00"}}') = 'ok';
select is((select coalesce(start_time::text, '-') from public.event_overrides where id = '77770000-0000-7000-8000-000000000362'), '-', '57: zmiana godzin na godziny serii — „jak w serii”');
reset role;

-- 58–62: naprawa wyjątków sprzed decyzji (historia z activity): kopia godzin serii z chwili zapisu → „jak w serii”.
alter table public.event_overrides disable trigger event_overrides_a_series_time;
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e1');
set local role authenticated;
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 25, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e7","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Rytmika","start_date":"2026-10-08","start_time":"10:00","end_time":"10:45","rrule":"FREQ=WEEKLY;BYDAY=TH"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 26, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000371","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e7","occurrence_date":"2026-10-15","title":"Pokaz","start_time":"10:00","end_time":"10:45"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 27, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000372","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e7","occurrence_date":"2026-10-22","start_time":"09:00","end_time":"09:45"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 28, '{"kind":"patch","entity":"events","id":"77770000-0000-7000-8000-0000000001e7","set":{"start_time":"11:00","end_time":"11:45"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 29, '{"kind":"create","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000373","group_id":"77770000-0000-7000-8000-000000000001","set":{"event_id":"77770000-0000-7000-8000-0000000001e7","occurrence_date":"2026-10-29","responsible_member_id":"77770000-0000-7000-8000-0000000000a2","start_time":"11:00","end_time":"11:45"}}') = 'ok';
select pg_temp.push('77770000-0000-7000-8000-00000000c0a1', 30, '{"kind":"patch","entity":"event_overrides","id":"77770000-0000-7000-8000-000000000371","set":{"title":"Pokaz końcowy"}}') = 'ok';
reset role;
alter table public.event_overrides enable trigger event_overrides_a_series_time;
select pg_temp.as_user('');
select is(private.repair_override_times(), 2, '58: dwa wyjątki ze skopiowanymi godzinami serii');
select is((select coalesce(start_time::text, '-') from public.event_overrides where id = '77770000-0000-7000-8000-000000000371'), '-', '59: kopia godzin sprzed zmiany serii → termin idzie za serią (teraz 11:00)');
select is((select start_time::text from public.event_overrides where id = '77770000-0000-7000-8000-000000000372'), '09:00:00', '60: własna godzina zostaje');
select is((select coalesce(start_time::text, '-') from public.event_overrides where id = '77770000-0000-7000-8000-000000000373'), '-', '61: kopia godzin po zmianie serii');
select is(private.repair_override_times(), 0, '62: powtórzenie bez skutku');

-- 63–66: M-28 — powiadomienie „przypisuje Ci wydarzenie” po podziale tylko przy prawdziwej zmianie osoby.
select is(private.event_split_source('77770000-0000-7000-8000-0000000005e1'), '77770000-0000-7000-8000-0000000001e1'::uuid, '63: nowa seria wskazuje serię, którą kontynuuje');
insert into public.push_tokens (token, user_id, env) values (repeat('ab', 32), '00000000-0000-7000-8000-0000000007e1', 'production');
select is(public.assignment_push_claim((select id from public.activity where entity_id = '77770000-0000-7000-8000-0000000005e1' and verb = 'create'), '00000000-0000-7000-8000-0000000007e2', 24), null,
  '64: podział z tą samą osobą odpowiedzialną — bez „przypisuje Ci”');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007e2');
set local role authenticated;
select pg_temp.push('77770000-0000-7000-8000-00000000c0b2', 30, '{"kind":"create","entity":"events","id":"77770000-0000-7000-8000-0000000001e8","group_id":"77770000-0000-7000-8000-000000000001","set":{"title":"Judo","start_date":"2026-10-05","start_time":"16:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}') = 'ok';
select is(pg_temp.split('77770000-0000-7000-8000-00000000c0b2', 31, pg_temp.args('77770000-0000-7000-8000-0000000005e8', '77770000-0000-7000-8000-0000000001e8', '2026-10-19',
  '{"set":{"title":"Judo","responsible_member_id":"77770000-0000-7000-8000-0000000000a1"}}')), 'ok', '65: podział z nową osobą odpowiedzialną');
reset role;
select is(public.assignment_push_claim((select id from public.activity where entity_id = '77770000-0000-7000-8000-0000000005e8' and verb = 'create'), '00000000-0000-7000-8000-0000000007e2', 24) ->> 'title',
  'B przypisuje Ci wydarzenie', '66: prawdziwa zmiana osoby — powiadomienie');

select * from finish();
rollback;
