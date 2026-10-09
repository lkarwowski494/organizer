-- Audyt 3, PK-01: zakres dat (N-1, 20261010010000_date_ranges), klucz kolejności, limit grupy i zapisów konta
-- (N-2 i Q12 część 3, 20261010011000_write_limits), id uczestnika (N-13, 20261010012000_participant_id_guard),
-- uprawnienia w schemacie private i sygnał do cudzej grupy (N-95, 20261010014000_private_grants).
-- Blokady limitów (N-98) sprawdza tests/db/concurrency.test.ts (dwa połączenia naraz).
begin;
select plan(47);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000101a1', 'a101@x.test'), ('00000000-0000-7000-8000-0000000101a2', 'b101@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
-- Wynik jednej operacji: 'ok' albo kod odrzucenia.
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.task(seq int, id text, s jsonb) returns text language sql as $$
  select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', seq, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', id,
    'group_id', '01010000-0000-7000-8000-000000000001', 'set', '{"list_id":"01010000-0000-7000-8000-0000000000b1","title":"Z"}'::jsonb || s))
$$;
create function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
-- Licznik grupy policzony od nowa ze wszystkich tabel spraw (wzorzec dla private.group_usage).
create function pg_temp.recount(g uuid) returns text language plpgsql as $$
declare t text; n bigint := 0; b bigint := 0; x bigint; y bigint;
begin
  foreach t in array array['group_members', 'lists', 'object_members', 'tasks', 'events', 'event_participants', 'event_overrides',
                           'event_task_series', 'handoffs', 'event_rsvps', 'my_day_scopes', 'shopping_trips'] loop
    execute format('select count(*), coalesce(sum(octet_length(to_jsonb(r)::text)), 0) from public.%I r where r.group_id = $1 and r.deleted_at is null', t) into x, y using g;
    n := n + x; b := b + y;
  end loop;
  return n || '/' || b;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.task(int, text, jsonb), pg_temp.err(text) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
select public.create_group('01010000-0000-7000-8000-000000000001', 'G', '01010000-0000-7000-8000-0000000000a1', 'A');
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"01010000-0000-7000-8000-0000000000b1","group_id":"01010000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') = 'ok';
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"lists","id":"01010000-0000-7000-8000-0000000000b2","group_id":"01010000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}}') = 'ok';
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"events","id":"01010000-0000-7000-8000-0000000001e1","group_id":"01010000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-20","audience":"members"}}') = 'ok';
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('01010000-0000-7000-8000-0000000000a2', '01010000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000101a2', 'Jan', 'member'),
  ('01010000-0000-7000-8000-0000000000a3', '01010000-0000-7000-8000-000000000001', null, 'Tymek', 'child');
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;

-- ───────── N-1: daty i godziny spoza zakresu odrzucone (sync_push), granice przyjęte ─────────
select is(pg_temp.task(10, '01010000-0000-7000-8000-000000000401', '{"deadline_mode":"own","due_date":"infinity"}'), 'invalid:23514', '1: termin infinity');
select is(pg_temp.task(11, '01010000-0000-7000-8000-000000000402', '{"deadline_mode":"own","due_date":"0044-03-15 BC"}'), 'invalid:23514', '2: rok p.n.e.');
select is(pg_temp.task(12, '01010000-0000-7000-8000-000000000403', '{"deadline_mode":"own","due_date":"5000000-01-01"}'), 'invalid:23514', '3: rok 5000000');
select is(pg_temp.task(13, '01010000-0000-7000-8000-000000000404', '{"deadline_mode":"own","due_date":"1899-12-31"}'), 'invalid:23514', '4: dzień przed zakresem');
select is(pg_temp.task(14, '01010000-0000-7000-8000-000000000405', '{"deadline_mode":"own","due_date":"2200-01-01"}'), 'invalid:23514', '5: dzień po zakresie');
select is(pg_temp.task(15, '01010000-0000-7000-8000-000000000406', '{"deadline_mode":"own","due_date":"2026-10-20","due_time":"24:00"}'), 'invalid:23514', '6: godzina 24:00');
select is(pg_temp.task(16, '01010000-0000-7000-8000-000000000407', '{"start_date":"-infinity"}'), 'invalid:23514', '7: start -infinity');
select is(pg_temp.task(17, '01010000-0000-7000-8000-000000000408', '{"completed_at":"infinity"}'), 'invalid:23514', '8: zrobione „w nieskończoności”');
select is(pg_temp.task(18, '01010000-0000-7000-8000-000000000409', '{"deadline_mode":"own","due_date":"1900-01-01","start_date":"1900-01-01"}'), 'ok', '9: pierwszy dzień zakresu');
select is(pg_temp.task(19, '01010000-0000-7000-8000-00000000040a', '{"deadline_mode":"own","due_date":"2199-12-31","due_time":"23:59"}'), 'ok', '10: ostatni dzień zakresu, 23:59');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 20, '{"kind":"create","entity":"events","id":"01010000-0000-7000-8000-0000000001e2","group_id":"01010000-0000-7000-8000-000000000001","set":{"title":"Koniec","start_date":"-infinity","rrule":"FREQ=DAILY"}}'),
  'invalid:23514', '11: wydarzenie od -infinity');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 21, '{"kind":"create","entity":"events","id":"01010000-0000-7000-8000-0000000001e3","group_id":"01010000-0000-7000-8000-000000000001","set":{"title":"Noc","start_date":"2026-10-20","start_time":"24:00"}}'),
  'invalid:23514', '12: wydarzenie o 24:00');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 22, '{"kind":"patch","entity":"group_members","id":"01010000-0000-7000-8000-0000000000a1","set":{"week_a":"infinity"}}'),
  'invalid:23514', '13: tydzień A w nieskończoności (dotąd przechodził: isodow z infinity to NULL)');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 23, '{"kind":"create","entity":"shopping_trips","id":"01010000-0000-7000-8000-000000000601","group_id":"01010000-0000-7000-8000-000000000001","set":{"list_id":"01010000-0000-7000-8000-0000000000b2","done_at":"-infinity"}}'),
  'invalid:23514', '14: zakupy zrobione -infinity');
-- Bezpośredni zapis do tabeli (PostgREST) — to samo ograniczenie.
select is(pg_temp.err($$ insert into public.tasks (id, group_id, list_id, title, deadline_mode, due_date) values
  ('01010000-0000-7000-8000-00000000040b', '01010000-0000-7000-8000-000000000001', '01010000-0000-7000-8000-0000000000b1', 'X', 'own', 'infinity') $$),
  '23514 new row for relation "tasks" violates check constraint "tasks_due_date_range"', '15: zapis z pominięciem sync_push też odrzucony');
reset role;
-- Każda kolumna date/time w public (także dodana w przyszłości) i chwile ustawiane przez telefon mają ograniczenie *_range.
select is((select array_agg(cl.relname || '.' || a.attname order by 1) from pg_attribute a join pg_class cl on cl.oid = a.attrelid
  where cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and (a.atttypid in ('date'::regtype, 'time'::regtype) or (cl.relname, a.attname) in (('tasks', 'completed_at'), ('shopping_trips', 'done_at')))
    and not exists (select 1 from pg_constraint k where k.conrelid = cl.oid and k.conname = cl.relname || '_' || a.attname || '_range' and k.convalidated)),
  null, '16: żadna kolumna daty ani godziny bez ograniczenia zakresu');
select is((select count(*)::int from pg_constraint where connamespace = 'public'::regnamespace and conname like '%\_range' and pg_get_constraintdef(oid) ~ '::(date|time)'), 19, '17: ograniczenia na wszystkich 19 kolumnach (17 dat i godzin, 2 chwile)');

-- ───────── N-2: klucz kolejności ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
select is(pg_temp.task(30, '01010000-0000-7000-8000-000000000411', jsonb_build_object('sort_key', repeat('z', 129))), 'invalid:23514', '18: klucz kolejności za długi');
select is(pg_temp.task(31, '01010000-0000-7000-8000-000000000412', jsonb_build_object('sort_key', repeat('z', 128))), 'ok', '19: klucz na granicy');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 32, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '01010000-0000-7000-8000-0000000000b1', 'set', jsonb_build_object('sort_key', repeat('z', 100000)))),
  'invalid:23514', '20: klucz listy za długi');

-- ───────── N-2, Q12 część 3: limit grupy ─────────
reset role;
select is((select live_rows || '/' || live_bytes from private.group_usage where group_id = '01010000-0000-7000-8000-000000000001'),
  pg_temp.recount('01010000-0000-7000-8000-000000000001'), '21: licznik grupy = przeliczenie od nowa');
-- Grupa pełna (liczba wierszy): nowa sprawa odrzucona z kodem, usunięcie przechodzi, przywrócenie nie (dopóki pełna).
update private.group_usage set live_rows = private.max_group_rows() where group_id = '01010000-0000-7000-8000-000000000001';
set local role authenticated;
select is(pg_temp.task(40, '01010000-0000-7000-8000-000000000421', '{}'), 'limit:group_rows', '22: grupa pełna — nowe zadanie odrzucone');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 41, '{"kind":"patch","entity":"tasks","id":"01010000-0000-7000-8000-000000000412","set":{"title":"Krótszy"}}'), 'ok', '23: zmiana bez nowego wiersza i bez wzrostu przechodzi');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 42, '{"kind":"delete","entity":"tasks","id":"01010000-0000-7000-8000-000000000412"}'), 'ok', '24: usunięcie przechodzi');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 43, '{"kind":"create","entity":"event_participants","id":"01010000-0000-7000-8000-000000000701","group_id":"01010000-0000-7000-8000-000000000001","set":{"event_id":"01010000-0000-7000-8000-0000000001e1","member_id":"01010000-0000-7000-8000-0000000000a3"}}'),
  'ok', '25: po usunięciu jest miejsce na jeden wiersz');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 44, '{"kind":"restore","entity":"tasks","id":"01010000-0000-7000-8000-000000000412"}'), 'limit:group_rows', '26: przywrócenie do pełnej grupy odrzucone');
select is(pg_temp.err($$ insert into public.tasks (id, group_id, list_id, title) values ('01010000-0000-7000-8000-000000000422', '01010000-0000-7000-8000-000000000001', '01010000-0000-7000-8000-0000000000b1', 'X') $$),
  'P0001 limit:group_rows', '27: bezpośredni zapis do pełnej grupy też odrzucony');
reset role;
update private.group_usage set live_rows = 0, live_bytes = private.max_group_bytes() - 10 where group_id = '01010000-0000-7000-8000-000000000001';
set local role authenticated;
select is(pg_temp.task(45, '01010000-0000-7000-8000-000000000423', '{}'), 'limit:group_size', '28: grupa pełna (rozmiar) — nowe zadanie odrzucone');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 46, '{"kind":"patch","entity":"tasks","id":"01010000-0000-7000-8000-000000000409","set":{"note":"dłuższa notatka"}}'), 'limit:group_size', '29: wzrost rozmiaru odrzucony');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 47, '{"kind":"patch","entity":"tasks","id":"01010000-0000-7000-8000-000000000409","set":{"title":"Y","start_date":null}}'), 'ok', '30: zmiana bez wzrostu przechodzi');
reset role;
-- Licznik dalej zgadza się z przeliczeniem (po zmianach, usunięciu, przywróceniu i odrzuceniach), także po usunięciu
-- wierszy na stałe (sprzątanie).
update private.group_usage set live_rows = split_part(pg_temp.recount(group_id), '/', 1)::bigint, live_bytes = split_part(pg_temp.recount(group_id), '/', 2)::bigint
  where group_id = '01010000-0000-7000-8000-000000000001';
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 48, '{"kind":"patch","entity":"tasks","id":"01010000-0000-7000-8000-000000000409","set":{"note":"notatka po zwolnieniu miejsca"}}') = 'ok';
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 49, '{"kind":"delete","entity":"tasks","id":"01010000-0000-7000-8000-00000000040a"}') = 'ok';
select pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 50, '{"kind":"restore","entity":"tasks","id":"01010000-0000-7000-8000-00000000040a"}') = 'ok';
reset role;
select pg_temp.as_user('');
delete from public.event_participants where id = '01010000-0000-7000-8000-000000000701';
select is((select live_rows || '/' || live_bytes from private.group_usage where group_id = '01010000-0000-7000-8000-000000000001'),
  pg_temp.recount('01010000-0000-7000-8000-000000000001'), '31: licznik po zmianach = przeliczenie od nowa');
-- Zapis serwera (bez konta, np. sprzątanie) do pełnej grupy przechodzi — tylko licznik rośnie.
update private.group_usage set live_rows = private.max_group_rows() where group_id = '01010000-0000-7000-8000-000000000001';
select is(pg_temp.err($$ insert into public.tasks (id, group_id, list_id, title) values ('01010000-0000-7000-8000-000000000424', '01010000-0000-7000-8000-000000000001', '01010000-0000-7000-8000-0000000000b1', 'Serwer') $$),
  'ok', '32: zapis serwera nie jest ograniczany');
-- Dołączenie poprawnym kodem do pełnej grupy: kod limitu (komunikat na telefonie), nie „zły kod” i nie nieudana próba.
insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000101a8', 'd101@x.test');
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
create temp table code as select public.create_join_code('01010000-0000-7000-8000-000000000001') as c;
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a8');
select is(public.join_group((select c ->> 'join_id' from code), (select c ->> 'code' from code), 'Zosia') ->> 'error', 'limit:group_rows', '33: dołączenie do pełnej grupy — limit:group_rows');
reset role;
select pg_temp.as_user('');
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000101a8'), 0, '34: bez wpisu nieudanej próby');
update private.group_usage set live_rows = 0 where group_id = '01010000-0000-7000-8000-000000000001';

-- ───────── N-2: limit zapisów konta na dobę (obie drogi) ─────────
insert into private.rate_counters (user_id, kind, window_start, n) values ('00000000-0000-7000-8000-0000000101a1', 'write_bytes', clock_timestamp(), private.write_bytes_per_day() - 100)
  on conflict (user_id, kind) do update set window_start = excluded.window_start, n = excluded.n;
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
select throws_ok($$ select public.sync_push('01010000-0000-7000-8000-00000000c0d1', 2, '[{"seq":60,"kind":"create","entity":"tasks","id":"01010000-0000-7000-8000-000000000431","group_id":"01010000-0000-7000-8000-000000000001","set":{"list_id":"01010000-0000-7000-8000-0000000000b1","title":"Za dużo"}}]') $$,
  '53300', 'rate_limited', '35: ponad limit zapisów całe wywołanie kończy się błędem przejściowym (telefon ponowi)');
reset role;
select is((select count(*)::int from private.sync_rejections r join private.sync_clients c using (client_id) where c.client_id = '01010000-0000-7000-8000-00000000c0d1' and r.seq = 60), 0, '36: bez trwałego odrzucenia');
set local role authenticated;
select is(pg_temp.err($$ insert into public.tasks (id, group_id, list_id, title) values ('01010000-0000-7000-8000-000000000432', '01010000-0000-7000-8000-000000000001', '01010000-0000-7000-8000-0000000000b1', 'X') $$),
  '53300 rate_limited', '37: bezpośredni zapis też liczony');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 61, '{"kind":"delete","entity":"tasks","id":"01010000-0000-7000-8000-000000000409"}'), 'ok', '38: usunięcie przechodzi mimo limitu');
reset role;
update private.rate_counters set window_start = clock_timestamp() - interval '1 day' where user_id = '00000000-0000-7000-8000-0000000101a1' and kind = 'write_bytes';
set local role authenticated;
select is(pg_temp.task(62, '01010000-0000-7000-8000-000000000433', '{}'), 'ok', '39: po dobie limit od nowa');
reset role;
select ok((select n from private.rate_counters where user_id = '00000000-0000-7000-8000-0000000101a1' and kind = 'write_bytes') between 1 and 5000, '40: zużyty rozmiar zapisanego wiersza');

-- ───────── N-13: id uczestnika ─────────
create temp table pid as select private.uuid_v5('d1b68427-56bc-5060-92d6-b370118f2099', '01010000-0000-7000-8000-0000000001e1|01010000-0000-7000-8000-0000000000a1') a_id;
grant select on pid to authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a2');
set local role authenticated;
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d2', 1, jsonb_build_object('kind', 'create', 'entity', 'event_participants', 'id', (select a_id from pid), 'group_id', '01010000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '01010000-0000-7000-8000-0000000001e1', 'member_id', '01010000-0000-7000-8000-0000000000a2'))), 'invalid_id', '41: Jan nie zajmie id uczestnika Ali, wpisując siebie');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d2', 2, '{"kind":"create","entity":"event_participants","id":"01010000-0000-7000-8000-000000000702","group_id":"01010000-0000-7000-8000-000000000001","set":{"event_id":"01010000-0000-7000-8000-0000000001e1","member_id":"01010000-0000-7000-8000-0000000000a2"}}'),
  'ok', '42: id z telefonu (UUIDv7, też starsze wersje aplikacji) przechodzi');
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
select is(pg_temp.push('01010000-0000-7000-8000-00000000c0d1', 70, jsonb_build_object('kind', 'create', 'entity', 'event_participants', 'id', (select a_id from pid), 'group_id', '01010000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('event_id', '01010000-0000-7000-8000-0000000001e1', 'member_id', '01010000-0000-7000-8000-0000000000a1'))), 'ok', '43: Ala dodaje siebie pod wyliczonym id');
reset role;
select is((select member_id::text from public.event_participants where id = (select a_id from pid)), '01010000-0000-7000-8000-0000000000a1', '44: uczestnikiem jest właściwa osoba');

-- ───────── N-95: private dla authenticated tylko z listy; sygnał tylko do własnych grup ─────────
select set_eq($$ select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'private'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['private.accept_invite(text,text)', 'private.apply_op(jsonb)', 'private.can_see_list(uuid)', 'private.claim_client(uuid)',
        'private.clock_minutes(time without time zone,time without time zone)', 'private.create_group_with_owner(uuid,text,text,uuid,text)',
        'private.create_invite(uuid,text,integer,integer)', 'private.create_join_code(uuid,text)', 'private.end_series(jsonb)',
        'private.event_duration(time without time zone,time without time zone,integer)', 'private.event_location_max_length()',
        'private.event_max_days()', 'private.forget_rejections(uuid,bigint)', 'private.group_colors()',
        'private.group_rows_since(uuid,bigint,integer)', 'private.issue_child_code(uuid,boolean)', 'private.issue_join_code(uuid,text,boolean)',
        'private.join_group(text,text,text)', 'private.legacy_entities()', 'private.lock_groups(uuid[])', 'private.max_task_depth()',
        'private.minute_of(time without time zone)', 'private.move_task(uuid,uuid,uuid,text)', 'private.my_group_ids()',
        'private.my_member_id(uuid)', 'private.my_role(uuid)', 'private.op_group(jsonb)', 'private.poke_groups(uuid[])',
        'private.pull_limit_max()', 'private.push_batch_max()', 'private.recall_rejection(uuid,bigint,text)',
        'private.remember_rejection(uuid,bigint,text,text)', 'private.restore_series(jsonb)', 'private.revoke_invite(uuid)', 'private.rotate_join_id(uuid)',
        'private.rrule_date_ok(text)', 'private.rrule_ok(text)', 'private.schema_version()', 'private.set_client_seq(uuid,bigint)',
        'private.set_group_trash(uuid,boolean)', 'private.shopping_categories()', 'private.split_event(jsonb)',
        'private.staple_cmd(text,jsonb)', 'private.staple_max_length()', 'private.staples_max()', 'private.staples_ok(text[])',
        'private.task_repeat_ok(text)', 'private.tasks_moved_out(uuid,bigint,bigint)', 'private.transfer_ownership(uuid,uuid)'],
  '45: authenticated wykonuje w private tylko funkcje potrzebne politykom, ograniczeniom i funkcjom INVOKER (nowa — dopisz świadomie)');
select pg_temp.as_user('');
insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000101a9', 'c101@x.test');
create temp table before_poke as select count(*) n from realtime.messages where topic = 'group:01010000-0000-7000-8000-000000000001';
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a9');
set local role authenticated;
select private.poke_groups(array['01010000-0000-7000-8000-000000000001'::uuid]);
reset role;
select is((select count(*) from realtime.messages where topic = 'group:01010000-0000-7000-8000-000000000001'), (select n from before_poke), '46: obcy nie wyśle sygnału do cudzej grupy');
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a2');
set local role authenticated;
select private.poke_groups(array['01010000-0000-7000-8000-000000000001'::uuid]);
reset role;
select is((select count(*) from realtime.messages where topic = 'group:01010000-0000-7000-8000-000000000001'), (select n from before_poke) + 1, '47: członek grupy — sygnał idzie');

select * from finish();
rollback;
