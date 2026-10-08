-- Zrobione zakupy (migracja 20261008510000_trip_done, PWD-11 A, audyt 2 M-280): data i plan ostatnich zakupów przy
-- liście zakupów, zapis przez synchronizację (także w jednym patchu z czyszczeniem terminu), tylko lista zakupów.
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000047e1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000047e4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.done(list uuid) returns text language sql security definer as $$
  select coalesce(trip_done_at::text, '-') || ' ' || coalesce(trip_done_date::text, '-') || ' ' || coalesce(due_date::text, '-') from public.lists where id = list
$$;
grant execute on all functions in schema pg_temp to authenticated;

select has_column('public', 'lists', 'trip_done_at', '1: kolumna trip_done_at');
select has_column('public', 'lists', 'trip_done_date', '2: kolumna trip_done_date');
select ok((select '{trip_done_at,trip_done_date}'::text[] <@ patch_cols and '{trip_done_at,trip_done_date}'::text[] <@ insert_cols from private.sync_entities where entity = 'lists'), '3: kolumny w synchronizacji');
select ok(has_column_privilege('authenticated', 'public.lists', 'trip_done_at', 'UPDATE') and has_column_privilege('authenticated', 'public.lists', 'trip_done_date', 'UPDATE'), '4: authenticated może je zmieniać');

select pg_temp.as_user('00000000-0000-7000-8000-0000000047e1');
set local role authenticated;
select public.create_group('47470000-0000-7000-8000-000000000001', 'G', '47470000-0000-7000-8000-0000000000f1', 'O');
reset role;
select pg_temp.as_user('');
insert into public.lists (id, group_id, kind, name, due_date, responsible_member_id, owner_member_id) values
  ('47470000-0000-7000-8000-0000000000a1', '47470000-0000-7000-8000-000000000001', 'shopping', 'Zakupy', '2026-10-09', '47470000-0000-7000-8000-0000000000f1', '47470000-0000-7000-8000-0000000000f1');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('47470000-0000-7000-8000-0000000000a2', '47470000-0000-7000-8000-000000000001', 'tasks', 'Dom', '47470000-0000-7000-8000-0000000000f1');

select pg_temp.as_user('00000000-0000-7000-8000-0000000047e1');
set local role authenticated;
select is(pg_temp.push('47470000-0000-7000-8000-00000000c001', 1, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '47470000-0000-7000-8000-0000000000a1',
  'set', jsonb_build_object('due_date', null, 'due_time', null, 'responsible_member_id', null, 'trip_done_at', '2026-10-08T09:00:00Z', 'trip_done_date', '2026-10-09'))), 'ok', '5: „Zakupy zrobione” jednym patchem');
select is(pg_temp.done('47470000-0000-7000-8000-0000000000a1'), '2026-10-08 09:00:00+00 2026-10-09 -', '6: zapisane, termin wyczyszczony');
select is(pg_temp.push('47470000-0000-7000-8000-00000000c001', 2, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '47470000-0000-7000-8000-0000000000a1',
  'set', jsonb_build_object('trip_done_at', null, 'trip_done_date', null, 'due_date', '2026-10-09'))), 'ok', '7: „Cofnij” przywraca poprzednie');
select is(pg_temp.done('47470000-0000-7000-8000-0000000000a1'), '- - 2026-10-09', '8: po cofnięciu');
select is(pg_temp.push('47470000-0000-7000-8000-00000000c001', 3, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '47470000-0000-7000-8000-0000000000a2',
  'set', jsonb_build_object('trip_done_at', '2026-10-08T09:00:00Z'))), 'invalid:23514', '9: lista zadań — odrzucone (ograniczenie)');
reset role;

select pg_temp.as_user('00000000-0000-7000-8000-0000000047e4');
set local role authenticated;
select is(pg_temp.push('47470000-0000-7000-8000-00000000c004', 1, jsonb_build_object('kind', 'patch', 'entity', 'lists', 'id', '47470000-0000-7000-8000-0000000000a1',
  'set', jsonb_build_object('trip_done_at', '2026-10-08T09:00:00Z'))), 'not_found', '10: obcy nie widzi listy');
reset role;

select * from finish();
rollback;
