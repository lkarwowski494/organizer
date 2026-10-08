-- Retencja i codzienne sprzątanie (audyt 2, paczka P16; migracja 20261008480000_retention).
begin;
select plan(33);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000016a1', 'a16@x.test'), ('00000000-0000-7000-8000-0000000016a2', 'b16@x.test'),
  ('00000000-0000-7000-8000-0000000016a3', 'c16@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Grupa G (A owner, B member) i czysta grupa H. Dane wstawia serwer (strażnicy przepuszczają kontekst serwerowy).
select pg_temp.as_user('00000000-0000-7000-8000-0000000016a1');
set local role authenticated;
select public.create_group('16160000-0000-7000-8000-000000000001', 'G', '16160000-0000-7000-8000-0000000000a1', 'A');
select public.create_group('16160000-0000-7000-8000-000000000002', 'H', '16160000-0000-7000-8000-0000000000a9', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('16160000-0000-7000-8000-0000000000a2', '16160000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000016a2', 'B', 'member');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('16160000-0000-7000-8000-0000000000b1', '16160000-0000-7000-8000-000000000001', 'tasks', 'Dom', '16160000-0000-7000-8000-0000000000a1'),
  ('16160000-0000-7000-8000-0000000000b2', '16160000-0000-7000-8000-000000000001', 'tasks', 'Prezent dla Ani - pierścionek', '16160000-0000-7000-8000-0000000000a1');
insert into public.events (id, group_id, title, note, location, start_date, start_time, rrule) values
  ('16160000-0000-7000-8000-0000000001e1', '16160000-0000-7000-8000-000000000001', 'Wizyta u psychiatry', 'notatka', 'Szpital Z', '2026-08-03', '10:00', 'FREQ=WEEKLY;BYDAY=MO');
insert into public.event_overrides (id, event_id, group_id, occurrence_date, start_date) values
  ('16160000-0000-7000-8000-0000000001f1', '16160000-0000-7000-8000-0000000001e1', '16160000-0000-7000-8000-000000000001', '2026-08-10', '2026-08-12');
insert into public.event_task_series (id, group_id, event_id, list_id, title) values
  ('16160000-0000-7000-8000-0000000005a1', '16160000-0000-7000-8000-000000000001', '16160000-0000-7000-8000-0000000001e1', '16160000-0000-7000-8000-0000000000b1', 'Skierowanie');
insert into public.tasks (id, group_id, list_id, title, deadline_mode, event_id, occurrence_date, series_id) values
  -- przypięte z terminem „jak spotkanie” na termin przeniesiony wyjątkiem (10 → 12 sierpnia)
  ('16160000-0000-7000-8000-0000000004d1', '16160000-0000-7000-8000-000000000001', '16160000-0000-7000-8000-0000000000b1', 'Skierowanie', 'event', '16160000-0000-7000-8000-0000000001e1', '2026-08-10', '16160000-0000-7000-8000-0000000005a1'),
  -- przypięte z terminem „jak spotkanie” bez wyjątku
  ('16160000-0000-7000-8000-0000000004d2', '16160000-0000-7000-8000-000000000001', '16160000-0000-7000-8000-0000000000b1', 'Wyniki', 'event', '16160000-0000-7000-8000-0000000001e1', '2026-08-17', null);
insert into public.tasks (id, group_id, list_id, title, deadline_mode, due_date, event_id, occurrence_date) values
  -- przypięte z własnym terminem
  ('16160000-0000-7000-8000-0000000004d3', '16160000-0000-7000-8000-000000000001', '16160000-0000-7000-8000-0000000000b1', 'Zakup', 'own', '2026-08-15', '16160000-0000-7000-8000-0000000001e1', '2026-08-17');
insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member, status, decided_at) values
  ('16160000-0000-7000-8000-0000000006f1', '16160000-0000-7000-8000-000000000001', 'tasks', '16160000-0000-7000-8000-0000000004d3', '16160000-0000-7000-8000-0000000000a1', '16160000-0000-7000-8000-0000000000a2', 'accepted', now() - interval '91 days'),
  ('16160000-0000-7000-8000-0000000006f2', '16160000-0000-7000-8000-000000000001', 'tasks', '16160000-0000-7000-8000-0000000004d2', '16160000-0000-7000-8000-0000000000a1', '16160000-0000-7000-8000-0000000000a2', 'declined', now() - interval '89 days'),
  ('16160000-0000-7000-8000-0000000006f3', '16160000-0000-7000-8000-000000000001', 'tasks', '16160000-0000-7000-8000-0000000004d1', '16160000-0000-7000-8000-0000000000a1', '16160000-0000-7000-8000-0000000000a2', 'pending', null);
-- Lista przemianowana i usunięta, wydarzenie usunięte — oba 31 dni temu.
update public.lists set name = 'Lista' where id = '16160000-0000-7000-8000-0000000000b2';
update public.lists set deleted_at = now() - interval '31 days' where id = '16160000-0000-7000-8000-0000000000b2';
update public.events set deleted_at = now() - interval '31 days' where id = '16160000-0000-7000-8000-0000000001e1';
-- Historia: stara (91 dni) i świeża.
update public.activity set created_at = now() - interval '91 days' where entity = 'lists' and entity_id = '16160000-0000-7000-8000-0000000000b1';

-- 1: wybór grup — czysta grupa H nie jest nawet blokowana.
select is(array(select private.purge_candidates()), array['16160000-0000-7000-8000-000000000001']::uuid[], '1: sprzątanie tylko w grupie z kandydatami');

create temp table v0 as select version, purged_version from public.groups where id = '16160000-0000-7000-8000-000000000001';
create temp table r as select private.purge_group('16160000-0000-7000-8000-000000000001') as res;
select is((select res ->> 'unpinned' from r), '3', '2: trzy zadania odpięte');

-- D182: zadania zostają, odpięte; „jak spotkanie” → własny termin = data terminu (po przeniesieniu wyjątkiem).
select is((select array[deadline_mode, due_date::text, coalesce(event_id::text, '-'), coalesce(series_id::text, '-')] from public.tasks where id = '16160000-0000-7000-8000-0000000004d1'),
  array['own', '2026-08-12', '-', '-'], '3: termin przeniesiony wyjątkiem staje się własnym terminem, bez definicji');
select is((select array[deadline_mode, due_date::text] from public.tasks where id = '16160000-0000-7000-8000-0000000004d2'), array['own', '2026-08-17'], '4: data terminu jako własny termin');
select is((select array[deadline_mode, due_date::text, coalesce(occurrence_date::text, '-')] from public.tasks where id = '16160000-0000-7000-8000-0000000004d3'), array['own', '2026-08-15', '-'], '5: własny termin zostaje');
select ok((select bool_and(version > (select version from v0)) from public.tasks where group_id = '16160000-0000-7000-8000-000000000001'), '6: odpięte zadania z nową wersją — telefony je pobiorą');
select is((select count(*)::int from public.events where id = '16160000-0000-7000-8000-0000000001e1'), 0, '7: wydarzenie usunięte po 30 dniach mimo przypiętych zadań');
select is((select count(*)::int from public.event_overrides where event_id = '16160000-0000-7000-8000-0000000001e1')
        + (select count(*)::int from public.event_task_series where event_id = '16160000-0000-7000-8000-0000000001e1'), 0, '8: wyjątki i definicje wydarzenia usunięte');
-- M-67: historia usuniętych rzeczy znika (nazwy list, także dawne; wydarzenie, wyjątek, definicja).
select is((select count(*)::int from public.activity where changes::text like '%pierścionek%' or entity_id in
  ('16160000-0000-7000-8000-0000000000b2', '16160000-0000-7000-8000-0000000001e1', '16160000-0000-7000-8000-0000000001f1', '16160000-0000-7000-8000-0000000005a1')), 0,
  '9: historia usuniętej listy, wydarzenia, wyjątku i definicji usunięta');
select is((select count(*)::int from public.lists where id = '16160000-0000-7000-8000-0000000000b2'), 0, '10: lista usunięta');
-- M-62: historia starsza niż 90 dni.
select is((select count(*)::int from public.activity where entity = 'lists' and entity_id = '16160000-0000-7000-8000-0000000000b1'), 0, '11: historia starsza niż 90 dni usunięta');
select ok((select count(*) from public.activity where group_id = '16160000-0000-7000-8000-000000000001') > 0, '12: świeża historia zostaje (m.in. odpięcie zadań)');
-- M-68: rozstrzygnięte przekazania po 90 dniach.
select is(array(select id::text from public.handoffs where group_id = '16160000-0000-7000-8000-000000000001' order by id),
  array['16160000-0000-7000-8000-0000000006f2', '16160000-0000-7000-8000-0000000006f3'], '13: rozstrzygnięte przekazanie starsze niż 90 dni usunięte, nowsze i oczekujące zostają');
select is((select res ->> 'handoffs' from r), '1', '14: liczba usuniętych przekazań w wyniku');
-- purged_version: najwyższa wersja usuniętych wierszy (reguła P1), poniżej bieżącej wersji grupy.
select ok((select purged_version from public.groups where id = '16160000-0000-7000-8000-000000000001') > (select purged_version from v0)
      and (select purged_version from public.groups where id = '16160000-0000-7000-8000-000000000001') < (select version from public.groups where id = '16160000-0000-7000-8000-000000000001'),
  '15: purged_version = najwyższa wersja usuniętych wierszy');
select is(array(select private.purge_candidates()), '{}'::uuid[], '16: po sprzątaniu brak kandydatów');

-- 17–18: grupa w koszu też jest sprzątana (zapis odpięcia przechodzi mimo blokady zapisów w koszu).
insert into public.events (id, group_id, title, start_date) values
  ('16160000-0000-7000-8000-0000000001e9', '16160000-0000-7000-8000-000000000002', 'X', '2026-08-03');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('16160000-0000-7000-8000-0000000000b9', '16160000-0000-7000-8000-000000000002', 'tasks', 'L', '16160000-0000-7000-8000-0000000000a9');
insert into public.tasks (id, group_id, list_id, title, deadline_mode, event_id, occurrence_date) values
  ('16160000-0000-7000-8000-0000000004d9', '16160000-0000-7000-8000-000000000002', '16160000-0000-7000-8000-0000000000b9', 'T', 'event', '16160000-0000-7000-8000-0000000001e9', '2026-08-03');
update public.events set deleted_at = now() - interval '31 days' where id = '16160000-0000-7000-8000-0000000001e9';
update public.groups set deleted_at = now() - interval '2 days' where id = '16160000-0000-7000-8000-000000000002';
select lives_ok($$ select private.purge_group('16160000-0000-7000-8000-000000000002') $$, '17: sprzątanie grupy w koszu');
select is((select event_id from public.tasks where id = '16160000-0000-7000-8000-0000000004d9'), null, '18: zadanie w grupie w koszu odpięte');

-- 19–24: retencja poza grupami (M-68).
insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses, revoked_at) values
  ('16160000-0000-7000-8000-000000000001', '\x01', 'member', '16160000-0000-7000-8000-0000000000a1', now() - interval '31 days', 1, null),
  ('16160000-0000-7000-8000-000000000001', '\x02', 'member', '16160000-0000-7000-8000-0000000000a1', now() + interval '1 day', 1, now() - interval '31 days'),
  ('16160000-0000-7000-8000-000000000001', '\x03', 'member', '16160000-0000-7000-8000-0000000000a1', now() - interval '29 days', 1, null);
insert into private.access_events (user_id, group_id, kind, created_at) values
  ('00000000-0000-7000-8000-0000000016a1', '16160000-0000-7000-8000-000000000001', 'group_granted', now() - interval '31 days');
insert into private.sync_clients (client_id, user_id, last_seq, last_seen_at) values
  ('16160000-0000-7000-8000-00000000c0d1', '00000000-0000-7000-8000-0000000016a1', 5, now() - interval '181 days'),
  ('16160000-0000-7000-8000-00000000c0d2', '00000000-0000-7000-8000-0000000016a1', 5, now() - interval '179 days');
insert into private.sync_rejections (client_id, seq, code) values ('16160000-0000-7000-8000-00000000c0d1', 3, 'forbidden');
insert into private.join_attempts (user_id, join_id, at) values ('00000000-0000-7000-8000-0000000016a3', '123456789', now() - interval '25 hours');
create temp table logs as select private.purge_logs() as res;
select is(array(select token_hash::text from public.invites where group_id = '16160000-0000-7000-8000-000000000001' and token_hash in ('\x01', '\x02', '\x03') order by 1), array['\x03'],
  '19: zaproszenia wygasłe albo unieważnione ponad 30 dni temu usunięte');
select is((select count(*)::int from private.access_events where created_at < now() - interval '30 days'), 0, '20: dziennik dostępu 30 dni');
select is(array(select client_id::text from private.sync_clients where user_id = '00000000-0000-7000-8000-0000000016a1' order by 1),
  array['16160000-0000-7000-8000-00000000c0d2'], '21: instalacja nieużywana 180 dni usunięta');
select is((select count(*)::int from private.sync_rejections where client_id = '16160000-0000-7000-8000-00000000c0d1'), 0, '22: razem z jej odrzuceniami');
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000016a3'), 0, '23: próby dołączenia po dobie');
select is((select res ->> 'sync_clients' from logs), '1', '24: wynik z licznikami');

-- 25–28: dziennik przebiegów i wpis diagnostyczny (M-194).
create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
insert into public.tasks (id, group_id, list_id, title, deleted_at) values
  ('16160000-0000-7000-8000-0000000004e1', '16160000-0000-7000-8000-000000000001', '16160000-0000-7000-8000-0000000000b1', 'Stare', now() - interval '31 days');
create trigger zz_boom before delete on public.tasks for each row execute function pg_temp.boom();
create temp table m as select private.daily_maintenance() as res;
drop trigger zz_boom on public.tasks;
select is((select jsonb_array_length(res -> 'skipped') from m), 1, '25: pominięta grupa w wyniku');
select is((select count(*)::int from public.client_errors where kind = 'diagnostic' and screen = 'daily_maintenance' and message like 'Sprzątanie bazy pominęło grupy: 1'), 1,
  '26: wpis diagnostyczny w client_errors');
select ok((select finished_at is not null and result ? 'tombstones' from private.maintenance_runs order by id desc limit 1), '27: przebieg zapisany z wynikiem');
insert into private.maintenance_runs (started_at) values (now() - interval '1 day');
select private.maintenance_end(private.maintenance_begin(), '{"skipped": []}');
select is((select count(*)::int from public.client_errors where kind = 'diagnostic' and message like '%nie zakończyło się'), 1, '28: przebieg, który się nie skończył, zgłoszony');

-- 29–31: usunięcie konta ownera grupy w koszu (M-183) i jego prób dołączenia (M-68).
select pg_temp.as_user('00000000-0000-7000-8000-0000000016a1');
set local role authenticated;
select public.create_group('16160000-0000-7000-8000-000000000003', 'Kosz', '16160000-0000-7000-8000-0000000000a5', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('16160000-0000-7000-8000-0000000000a6', '16160000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-0000000016a2', 'B', 'member');
update public.groups set deleted_at = now() - interval '3 days' where id = '16160000-0000-7000-8000-000000000003';
insert into private.join_attempts (user_id, join_id) values ('00000000-0000-7000-8000-0000000016a1', '123456789');
delete from auth.users where id = '00000000-0000-7000-8000-0000000016a1';
select is((select role from public.group_members where member_id = '16160000-0000-7000-8000-0000000000a6'), 'owner', '29: grupę w koszu przejmuje dorosły');
select is((select array[role, (deleted_at is not null)::text] from public.group_members where member_id = '16160000-0000-7000-8000-0000000000a5'), array['member', 'true'],
  '30: usunięty owner wychodzi z grupy w koszu');
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000016a1'), 0, '31: próby dołączenia znikają z kontem');

-- 32–33: uprawnienia.
select ok(not has_function_privilege('authenticated', 'private.purge_group(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.purge_logs()', 'execute'), '32: telefon nie uruchomi sprzątania');
select is((select command from cron.job where jobname = 'organizer-daily-maintenance'), 'call private.run_daily_maintenance()', '33: harmonogram woła procedurę');

select * from finish();
rollback;
