-- D199: wydarzenia przez kilka dni (events.days, event_overrides.days) i przez północ (koniec nie później niż początek
-- = następnego dnia); zgodność z buildem 21 i „to i następne” (migracja 20261008530000_event_days).
begin;
select plan(38);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000009d1', 'd199@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.split(client text, seq int, args jsonb) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'cmd', 'cmd', 'split_event', 'args', args))
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.split(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000009d1');
set local role authenticated;
select public.create_group('99530000-0000-7000-8000-000000000001', 'Rodzina', '99530000-0000-7000-8000-0000000000a1', 'A');
reset role;

select has_column('public', 'events', 'days', 'events.days istnieje');
select has_column('public', 'event_overrides', 'days', 'event_overrides.days istnieje');
select ok((select bool_and('days' = any (insert_cols) and 'days' = any (patch_cols)) from private.sync_entities where entity in ('events', 'event_overrides')), 'days w sync_entities obu tabel');
select is(private.event_max_days(), 31, 'limit dni = config.events.MAX_DAYS');
select ok(has_column_privilege('authenticated', 'public.events', 'days', 'UPDATE') and has_column_privilege('authenticated', 'public.event_overrides', 'days', 'INSERT'), 'authenticated zapisuje days');
set local role authenticated;
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000101","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Obóz","start_date":"2026-07-01","days":14}}'), 'ok', 'obóz: całodniowe przez 14 dni');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000101'), 14, 'długość zapisana');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000102","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-07-01","days":0}}'), 'invalid:23514', '0 dni odrzucone');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000102","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-07-01","days":32}}'), 'invalid:23514', 'ponad limit odrzucone');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000103","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Dyżur","start_date":"2026-10-12","start_time":"22:00","end_time":"06:00"}}'), 'ok', 'nocny dyżur: koniec przed początkiem = następnego dnia');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000104","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Doba","start_date":"2026-10-12","start_time":"08:00","end_time":"08:00"}}'), 'ok', 'doba: koniec równy początkowi');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000105","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-12","end_time":"06:00"}}'), 'invalid:23514', 'koniec bez początku odrzucony');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 7, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000106","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Wyjazd","start_date":"2026-10-16","start_time":"18:00","days":3}}'), 'ok', 'z godziną i długością: przyjęte');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000106'), 1, 'z godziną długość = 1 (mówią ją godziny)');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 8, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000107","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Stare","start_date":"2026-10-16"}}'), 'ok', 'build 21: utworzenie bez days');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000107'), 1, 'domyślnie jeden dzień');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 9, '{"kind":"patch","entity":"events","id":"99530000-0000-7000-8000-000000000101","set":{"start_time":"10:00","end_time":"12:00"}}'), 'ok', 'build 21: obóz zmieniony na „o godzinie” bez days — nie odrzucony');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000101'), 1, 'wtedy days = 1');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 10, '{"kind":"patch","entity":"events","id":"99530000-0000-7000-8000-000000000101","set":{"start_time":null,"end_time":null,"days":5}}'), 'ok', 'z powrotem całodniowe przez 5 dni');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000101'), 5, 'długość zmieniona');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 11, '{"kind":"patch","entity":"events","id":"99530000-0000-7000-8000-000000000101","set":{"days":40}}'), 'invalid:23514', 'zmiana ponad limit odrzucona');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000101'), 5, 'bez zmiany po odrzuceniu');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 12, '{"kind":"create","entity":"events","id":"99530000-0000-7000-8000-000000000108","group_id":"99530000-0000-7000-8000-000000000001","set":{"title":"Weekend","start_date":"2026-10-16","rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=FR","days":3}}'), 'ok', 'seria: weekend co dwa tygodnie, 3 dni');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 13, '{"kind":"create","entity":"event_overrides","id":"99530000-0000-7000-8000-000000000301","group_id":"99530000-0000-7000-8000-000000000001","set":{"days":2,"event_id":"99530000-0000-7000-8000-000000000108","occurrence_date":"2026-10-30"}}'), 'ok', 'wyjątek: ten termin 2 dni');
select is((select days from public.event_overrides where id = '99530000-0000-7000-8000-000000000301'), 2, 'długość wyjątku zapisana');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 14, '{"kind":"create","entity":"event_overrides","id":"99530000-0000-7000-8000-000000000302","group_id":"99530000-0000-7000-8000-000000000001","set":{"days":0,"event_id":"99530000-0000-7000-8000-000000000108","occurrence_date":"2026-11-13"}}'), 'invalid:23514', 'wyjątek: 0 dni odrzucone');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 15, '{"kind":"create","entity":"event_overrides","id":"99530000-0000-7000-8000-000000000303","group_id":"99530000-0000-7000-8000-000000000001","set":{"start_time":"23:00","end_time":"07:00","event_id":"99530000-0000-7000-8000-000000000103","occurrence_date":"2026-10-12"}}'), 'ok', 'wyjątek przez północ przyjęty');
select is(pg_temp.push('99530000-0000-7000-8000-00000000c0a1', 16, '{"kind":"create","entity":"event_overrides","id":"99530000-0000-7000-8000-000000000304","group_id":"99530000-0000-7000-8000-000000000001","set":{"end_time":"07:00","event_id":"99530000-0000-7000-8000-000000000104","occurrence_date":"2026-10-12"}}'), 'invalid:23514', 'wyjątek: koniec bez początku odrzucony');
select is((select r -> 'row' -> 'days' from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') r
           where r ->> 'e' = 'events' and r -> 'row' ->> 'id' = '99530000-0000-7000-8000-000000000108'), '3'::jsonb, 'telefony dostają długość w pobraniu');
select is(pg_temp.split('99530000-0000-7000-8000-00000000c0a1', 17, jsonb_build_object('id', '99530000-0000-7000-8000-0000000005e1', 'event_id', '99530000-0000-7000-8000-000000000108', 'date', '2026-11-13', 'set', '{"title":"Weekend","start_date":"2026-11-13","start_time":null,"end_time":null,"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null,"days":4}'::jsonb)), 'ok', 'to i następne: nowa długość');
select is((select days from public.events where id = '99530000-0000-7000-8000-0000000005e1'), 4, 'nowa seria trwa 4 dni');
select is((select days from public.events where id = '99530000-0000-7000-8000-000000000108'), 3, 'stara seria bez zmian długości');
select is(pg_temp.split('99530000-0000-7000-8000-00000000c0a1', 18, jsonb_build_object('id', '99530000-0000-7000-8000-0000000005e1', 'event_id', '99530000-0000-7000-8000-000000000108', 'date', '2026-11-13', 'set', '{"title":"Weekend","start_date":"2026-11-13","start_time":null,"end_time":null,"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null}'::jsonb)), 'ok', 'powtórzone polecenie bez days (starszy telefon)');
select is((select days from public.events where id = '99530000-0000-7000-8000-0000000005e1'), 4, 'długość nowej serii zostaje');
select is(pg_temp.split('99530000-0000-7000-8000-00000000c0a1', 19, jsonb_build_object('id', '99530000-0000-7000-8000-0000000005e2', 'event_id', '99530000-0000-7000-8000-0000000005e1', 'date', '2026-11-27', 'set', '{"title":"Weekend","start_date":"2026-11-27","start_time":null,"end_time":null,"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null}'::jsonb)), 'ok', 'podział bez days');
select is((select days from public.events where id = '99530000-0000-7000-8000-0000000005e2'), 4, 'bez days — jak w dzielonej serii');
select is(pg_temp.split('99530000-0000-7000-8000-00000000c0a1', 20, jsonb_build_object('id', '99530000-0000-7000-8000-0000000005e3', 'event_id', '99530000-0000-7000-8000-0000000005e2', 'date', '2026-12-11', 'set', '{"title":"Weekend","start_date":"2026-12-11","start_time":"18:00","end_time":"20:00","rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null,"days":4}'::jsonb)), 'ok', 'podział na „o godzinie”');
select is((select days from public.events where id = '99530000-0000-7000-8000-0000000005e3'), 1, 'z godziną — 1 dzień');
reset role;

select * from finish();
rollback;
