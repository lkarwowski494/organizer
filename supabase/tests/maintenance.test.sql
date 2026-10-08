-- Codzienne sprzątanie (migracja 20261008210000_maintenance, O-032, D82).
begin;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000e1', 'a@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('99980000-0000-7000-8000-000000000001', 'Dom', '99980000-0000-7000-8000-0000000000a1', 'Łukasz');
select public.create_group('99980000-0000-7000-8000-000000000002', 'Stara', '99980000-0000-7000-8000-0000000000a2', 'Łukasz');
select pg_temp.push('99980000-0000-7000-8000-00000000c0d1', 1, '{"kind":"create","entity":"lists","id":"99980000-0000-7000-8000-0000000000c1","group_id":"99980000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') is not null;
select pg_temp.push('99980000-0000-7000-8000-00000000c0d1', 2, '{"kind":"create","entity":"tasks","id":"99980000-0000-7000-8000-0000000004d1","group_id":"99980000-0000-7000-8000-000000000001","set":{"list_id":"99980000-0000-7000-8000-0000000000c1","title":"Stare"}}') is not null;
select pg_temp.push('99980000-0000-7000-8000-00000000c0d1', 3, '{"kind":"create","entity":"tasks","id":"99980000-0000-7000-8000-0000000004d2","group_id":"99980000-0000-7000-8000-000000000001","set":{"list_id":"99980000-0000-7000-8000-0000000000c1","title":"Świeże"}}') is not null;
select public.report_client_error('error', 'stary', null, null, null);
select public.report_client_error('error', 'nowy', null, null, null);
select public.send_feedback('stara uwaga', null, null);
select public.send_feedback('nowa uwaga', null, null);
reset role;
select pg_temp.as_user('');

-- Postarzamy: zadanie i grupę w koszu ponad 30 dni, zgłoszenia ponad 90 dni, wpis push ponad 7 dni.
update public.tasks set deleted_at = now() - interval '31 days' where id = '99980000-0000-7000-8000-0000000004d1';
update public.tasks set deleted_at = now() - interval '29 days' where id = '99980000-0000-7000-8000-0000000004d2';
update public.groups set deleted_at = now() - interval '31 days' where id = '99980000-0000-7000-8000-000000000002';
update public.client_errors set created_at = now() - interval '91 days' where message = 'stary';
update public.app_feedback set created_at = now() - interval '91 days' where message = 'stara uwaga';
insert into private.join_attempts (user_id, join_id, at) values ('00000000-0000-7000-8000-0000000000e1', '123456789', now() - interval '2 days'), ('00000000-0000-7000-8000-0000000000e1', '123456789', now());
insert into private.push_log (key, created_at) values ('assign|stary', now() - interval '8 days'), ('assign|nowy', now() - interval '1 day');

select is(private.daily_maintenance(), '{"tombstones": 1, "groups": 1, "client_errors": 1, "app_feedback": 1, "push_log": 1, "join_attempts": 1, "activity": 0, "handoffs": 0, "unpinned": 0, "invites": 0, "access_events": 0, "sync_clients": 0, "maintenance_runs": 0, "skipped": []}'::jsonb, '1: jedno sprzątanie, wynik per rodzaj');
select is((select array_agg(title order by title) from public.tasks where list_id = '99980000-0000-7000-8000-0000000000c1'), '{Świeże}', '2: z kosza znika tylko starsze niż 30 dni');
select ok(not exists (select 1 from public.groups where id = '99980000-0000-7000-8000-000000000002'), '3: grupa z kosza usunięta na stałe');
select is((select array_agg(message) from public.client_errors), '{nowy}', '4: stare zgłoszenia błędów usunięte');
select is((select array_agg(message) from public.app_feedback), '{"nowa uwaga"}', '5: stare uwagi usunięte');
select is((select array_agg(key) from private.push_log), '{assign|nowy}', '6: dziennik push trzyma 7 dni');
select is(private.daily_maintenance(), '{"tombstones": 0, "groups": 0, "client_errors": 0, "app_feedback": 0, "push_log": 0, "join_attempts": 0, "activity": 0, "handoffs": 0, "unpinned": 0, "invites": 0, "access_events": 0, "sync_clients": 0, "maintenance_runs": 0, "skipped": []}'::jsonb, '7: drugie przejście nic nie rusza');

-- Harmonogram: dwa zadania, o stałych porach, wołające właściwe funkcje.
select is((select array_agg(jobname || ' ' || schedule || ' ' || command order by jobname) from cron.job where jobname like 'organizer-%'),
  array['organizer-cron-history 27 3 * * * select private.cron_history_cleanup()', 'organizer-daily-maintenance 17 3 * * * call private.run_daily_maintenance()'],
  '8: dwa zadania w pg_cron');
insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time)
  values (1, 900001, 'x', 'succeeded', now() - interval '9 days', now() - interval '8 days'), (1, 900002, 'x', 'succeeded', now() - interval '2 days', now() - interval '2 days');
select is(private.cron_history_cleanup(), 1, '9: historia przebiegów starsza niż 7 dni usunięta');

select ok(not has_function_privilege('authenticated', 'private.daily_maintenance()', 'execute'), '10: telefon nie uruchomi sprzątania');
select ok(not has_function_privilege('anon', 'private.cron_history_cleanup()', 'execute'), '11: anon też nie');

select * from finish();
rollback;
