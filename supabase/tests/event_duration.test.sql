-- D199 cz. 2: wydarzenia z godziną przez więcej niż jedną noc (events.duration_min, event_overrides.duration_min;
-- migracja 20261008531000_event_duration): zgodność z godzinami, jedna postać, build 21, wyjątki i „to i następne”.
begin;
select plan(37);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000009d2', 'd199b@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.split(client text, seq int, args jsonb) returns text language sql as $$
  select pg_temp.push(client, seq, jsonb_build_object('kind', 'cmd', 'cmd', 'split_event', 'args', args))
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.split(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000009d2');
set local role authenticated;
select public.create_group('99531000-0000-7000-8000-000000000001', 'Rodzina', '99531000-0000-7000-8000-0000000000a1', 'A');
reset role;

select has_column('public', 'events', 'duration_min', 'events.duration_min istnieje');
select has_column('public', 'event_overrides', 'duration_min', 'event_overrides.duration_min istnieje');
select ok((select bool_and('duration_min' = any (insert_cols) and 'duration_min' = any (patch_cols)) from private.sync_entities where entity in ('events', 'event_overrides')), 'duration_min w sync_entities');
select is(private.clock_minutes('18:00', '16:00'), 1320, 'długość z godzin przez północ');
set local role authenticated;
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000101","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"Wyjazd","start_date":"2026-10-09","start_time":"18:00","end_time":"16:00","duration_min":2760}}'), 'ok', 'wyjazd pt. 18:00 – nd. 16:00');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000101'), 2760, 'długość zapisana');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000102","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"Dyżur","start_date":"2026-10-09","start_time":"22:00","end_time":"06:00","duration_min":480}}'), 'ok', 'długość równa tej z godzin');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000102'), null, '…zapisana jako null (jedna postać)');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000103","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-09","start_time":"18:00","end_time":"16:00","duration_min":100}}'), 'ok', 'niezgodna z godzinami');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000103'), null, '…zerowana');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000104","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-09","start_time":"18:00","duration_min":2760}}'), 'ok', 'bez końca');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000104'), null, '…bez długości');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000105","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-09","start_time":"18:00","end_time":"18:00","duration_min":0}}'), 'invalid:23514', 'zero minut odrzucone');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000105","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-09","start_time":"18:00","end_time":"18:00","duration_min":46080}}'), 'invalid:23514', 'ponad 31 dni odrzucone');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 7, '{"kind":"patch","entity":"events","id":"99531000-0000-7000-8000-000000000101","set":{"start_time":"17:00","end_time":"15:00"}}'), 'ok', 'przesunięcie obu godzin bez długości');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000101'), 2760, '…długość zostaje (zgodna)');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 8, '{"kind":"patch","entity":"events","id":"99531000-0000-7000-8000-000000000101","set":{"start_time":"17:00","end_time":"20:00"}}'), 'ok', 'build 21: zmiana końca bez długości');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-000000000101'), null, '…wydarzenie wraca do godzin z buildu 21 (17:00–20:00)');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 9, '{"kind":"patch","entity":"events","id":"99531000-0000-7000-8000-000000000101","set":{"start_time":null,"end_time":null}}'), 'ok', 'na cały dzień');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 10, '{"kind":"create","entity":"events","id":"99531000-0000-7000-8000-000000000106","group_id":"99531000-0000-7000-8000-000000000001","set":{"title":"Wyjazd","start_date":"2026-10-09","start_time":"18:00","end_time":"16:00","duration_min":2760,"rrule":"FREQ=WEEKLY;BYDAY=FR"}}'), 'ok', 'seria wyjazdów');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 11, '{"kind":"create","entity":"event_overrides","id":"99531000-0000-7000-8000-000000000301","group_id":"99531000-0000-7000-8000-000000000001","set":{"start_time":"18:00","end_time":"16:00","duration_min":1320,"event_id":"99531000-0000-7000-8000-000000000106","occurrence_date":"2026-10-16"}}'), 'ok', 'termin krócej przy tych samych godzinach');
select is(((select start_time::text from public.event_overrides where id = '99531000-0000-7000-8000-000000000301'), (select duration_min from public.event_overrides where id = '99531000-0000-7000-8000-000000000301')), ('18:00:00'::text, 1320), '…godziny i długość zostają');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 12, '{"kind":"create","entity":"event_overrides","id":"99531000-0000-7000-8000-000000000302","group_id":"99531000-0000-7000-8000-000000000001","set":{"start_time":"18:00","end_time":"16:00","event_id":"99531000-0000-7000-8000-000000000106","occurrence_date":"2026-10-23"}}'), 'ok', 'build 21: pełne godziny serii');
select is(((select start_time::text from public.event_overrides where id = '99531000-0000-7000-8000-000000000302'), (select duration_min from public.event_overrides where id = '99531000-0000-7000-8000-000000000302')), (null::text, null::int), '…jak w serii (bez długości wyjątku)');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 13, '{"kind":"create","entity":"event_overrides","id":"99531000-0000-7000-8000-000000000303","group_id":"99531000-0000-7000-8000-000000000001","set":{"start_time":"18:00","end_time":"16:00","duration_min":2760,"event_id":"99531000-0000-7000-8000-000000000106","occurrence_date":"2026-10-30"}}'), 'ok', 'ta sama długość co seria');
select is(((select start_time::text from public.event_overrides where id = '99531000-0000-7000-8000-000000000303'), (select duration_min from public.event_overrides where id = '99531000-0000-7000-8000-000000000303')), (null::text, null::int), '…jak w serii');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 14, '{"kind":"create","entity":"event_overrides","id":"99531000-0000-7000-8000-000000000304","group_id":"99531000-0000-7000-8000-000000000001","set":{"start_time":"19:00","end_time":"17:00","duration_min":100,"event_id":"99531000-0000-7000-8000-000000000106","occurrence_date":"2026-11-06"}}'), 'ok', 'wyjątek z niezgodną długością');
select is(((select start_time::text from public.event_overrides where id = '99531000-0000-7000-8000-000000000304'), (select duration_min from public.event_overrides where id = '99531000-0000-7000-8000-000000000304')), ('19:00:00'::text, null::int), '…długość zerowana');
select is(pg_temp.push('99531000-0000-7000-8000-00000000c0a1', 15, '{"kind":"patch","entity":"event_overrides","id":"99531000-0000-7000-8000-000000000301","set":{"duration_min":2760}}'), 'ok', 'zmiana samej długości wyjątku');
select is(((select start_time::text from public.event_overrides where id = '99531000-0000-7000-8000-000000000301'), (select duration_min from public.event_overrides where id = '99531000-0000-7000-8000-000000000301')), (null::text, null::int), '…równa serii — jak w serii');
select is((select r -> 'row' -> 'duration_min' from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') r
           where r ->> 'e' = 'events' and r -> 'row' ->> 'id' = '99531000-0000-7000-8000-000000000106'), '2760'::jsonb, 'telefony dostają długość w pobraniu');
select is(pg_temp.split('99531000-0000-7000-8000-00000000c0a1', 16, jsonb_build_object('id', '99531000-0000-7000-8000-0000000005e1', 'event_id', '99531000-0000-7000-8000-000000000106', 'date', '2026-11-13', 'set', '{"title":"Wyjazd","start_time":"18:00","end_time":"16:00","rrule":"FREQ=WEEKLY;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null,"start_date":"2026-11-13","duration_min":2760}'::jsonb)), 'ok', 'to i następne z długością');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-0000000005e1'), 2760, 'nowa seria z długością');
select is(pg_temp.split('99531000-0000-7000-8000-00000000c0a1', 17, jsonb_build_object('id', '99531000-0000-7000-8000-0000000005e2', 'event_id', '99531000-0000-7000-8000-0000000005e1', 'date', '2026-11-27', 'set', '{"title":"Wyjazd","start_time":"18:00","end_time":"16:00","rrule":"FREQ=WEEKLY;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null,"start_date":"2026-11-27"}'::jsonb)), 'ok', 'podział bez długości (starszy telefon)');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-0000000005e2'), 2760, '…jak w dzielonej serii');
select is(pg_temp.split('99531000-0000-7000-8000-00000000c0a1', 18, jsonb_build_object('id', '99531000-0000-7000-8000-0000000005e3', 'event_id', '99531000-0000-7000-8000-0000000005e2', 'date', '2026-12-11', 'set', '{"title":"Wyjazd","start_time":"18:00","end_time":"16:00","rrule":"FREQ=WEEKLY;BYDAY=FR","audience":"group","responsible_member_id":null,"location":null,"start_date":"2026-12-11","duration_min":null}'::jsonb)), 'ok', 'podział z długością z godzin');
select is((select duration_min from public.events where id = '99531000-0000-7000-8000-0000000005e3'), null, '…bez długości');
reset role;

select * from finish();
rollback;
