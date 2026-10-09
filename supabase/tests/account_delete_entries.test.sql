-- „Usuń też moje wpisy w grupach” przy usuwaniu konta (migracja 20261010240000_account_delete_entries, audyt 3 N-71, Q5 C).
begin;
select plan(21);

-- A = Ala (usuwa konto z wyborem), B = Bartek (zostaje), C = Celina (usuwa konto bez wyboru).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-7000-8000-0000000024a1', 'a@x.test', '{"display_name":"Ala"}'),
  ('00000000-0000-7000-8000-0000000024b1', 'b@x.test', '{"display_name":"Bartek"}'),
  ('00000000-0000-7000-8000-0000000024c1', 'c@x.test', '{"display_name":"Celina"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true)
$$;
create function pg_temp.push(client text, seq int, op jsonb) returns void language plpgsql as $$
declare r jsonb := public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0;
begin
  if r ->> 'status' <> 'ok' then raise exception 'push nie przeszedł: % (%)', r, op; end if;
end $$;
create function pg_temp.gone(tbl text, id text) returns boolean language plpgsql as $$
declare d timestamptz;
begin
  execute format('select deleted_at from public.%I where id = $1', tbl) into d using id::uuid;
  return d is not null;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- ── Grupa „Rodzina”: właściciel B, A i C członkami.
select pg_temp.as_user('00000000-0000-7000-8000-0000000024b1');
set local role authenticated;
select public.create_group('24240000-0000-7000-8000-000000000001', 'Rodzina', '24240000-0000-7000-8000-0000000000b1', 'Bartek');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('24240000-0000-7000-8000-0000000000a1', '24240000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000024a1', 'Ala', 'member'),
  ('24240000-0000-7000-8000-0000000000c1', '24240000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000024c1', 'Celina', 'member');

-- B: lista zadań, swoje zadanie i cotygodniowe wydarzenie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000024b1');
set local role authenticated;
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 1, '{"kind":"create","entity":"lists","id":"24240000-0000-7000-8000-0000000001f1","group_id":"24240000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 2, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000002b1","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Rachunki"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 3, '{"kind":"create","entity":"events","id":"24240000-0000-7000-8000-0000000003b1","group_id":"24240000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2020-01-06","rrule":"FREQ=WEEKLY;BYDAY=MO"}}');
reset role;

-- A: lista zakupów z rzeczą, zadanie (B dodaje do niego podzadanie), wydarzenie, stałe zadanie na wydarzeniu B,
-- odpowiedź o obecności; C: zadanie i odpowiedź.
select pg_temp.as_user('00000000-0000-7000-8000-0000000024a1');
set local role authenticated;
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"24240000-0000-7000-8000-0000000001f2","group_id":"24240000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Zakupy"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000002a2","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f2","title":"Mleko"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000002a1","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Lekarz Tymka","note":"ul. Przykładowa 1"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 4, '{"kind":"create","entity":"events","id":"24240000-0000-7000-8000-0000000003a1","group_id":"24240000-0000-7000-8000-000000000001","set":{"title":"Kino","start_date":"2030-01-07"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"event_task_series","id":"24240000-0000-7000-8000-0000000004a1","group_id":"24240000-0000-7000-8000-000000000001","set":{"event_id":"24240000-0000-7000-8000-0000000003b1","list_id":"24240000-0000-7000-8000-0000000001f1","title":"Strój"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"event_rsvps","id":"24240000-0000-7000-8000-0000000005a1","group_id":"24240000-0000-7000-8000-000000000001","set":{"event_id":"24240000-0000-7000-8000-0000000003b1","occurrence_date":"2030-01-07","member_id":"24240000-0000-7000-8000-0000000000a1","answer":"yes"}}');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000024b1');
set local role authenticated;
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 4, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000002b2","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Skierowanie","parent_id":"24240000-0000-7000-8000-0000000002a1"}}');
-- Kopie stałego zadania A zrobione telefonem B: dawna (zostaje w historii) i przyszła (znika, jak przy „Zakończ”).
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 5, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000006b1","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Strój","deadline_mode":"event","event_id":"24240000-0000-7000-8000-0000000003b1","occurrence_date":"2020-01-13","series_id":"24240000-0000-7000-8000-0000000004a1"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 6, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000006b2","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Strój","deadline_mode":"event","event_id":"24240000-0000-7000-8000-0000000003b1","occurrence_date":"2030-01-07","series_id":"24240000-0000-7000-8000-0000000004a1"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0b1', 7, '{"kind":"create","entity":"event_rsvps","id":"24240000-0000-7000-8000-0000000005b1","group_id":"24240000-0000-7000-8000-000000000001","set":{"event_id":"24240000-0000-7000-8000-0000000003b1","occurrence_date":"2030-01-07","member_id":"24240000-0000-7000-8000-0000000000b1","answer":"no"}}');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000024c1');
set local role authenticated;
select pg_temp.push('24240000-0000-7000-8000-00000000c0c1', 1, '{"kind":"create","entity":"tasks","id":"24240000-0000-7000-8000-0000000002c1","group_id":"24240000-0000-7000-8000-000000000001","set":{"list_id":"24240000-0000-7000-8000-0000000001f1","title":"Kwiaty"}}');
select pg_temp.push('24240000-0000-7000-8000-00000000c0c1', 2, '{"kind":"create","entity":"event_rsvps","id":"24240000-0000-7000-8000-0000000005c1","group_id":"24240000-0000-7000-8000-000000000001","set":{"event_id":"24240000-0000-7000-8000-0000000003b1","occurrence_date":"2030-01-07","member_id":"24240000-0000-7000-8000-0000000000c1","answer":"maybe"}}');
reset role;

-- ── Wybór: bez sesji odrzucony; z sesją zapisany i nadpisywany.
select pg_temp.as_user('');
set local role authenticated;
select throws_ok($$ select public.prepare_account_deletion(true) $$, 'P0001', 'not_authenticated', '1: bez sesji — not_authenticated');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000024a1');
set local role authenticated;
select lives_ok($$ select public.prepare_account_deletion(false) $$, '2: wybór zapisany');
select lives_ok($$ select public.prepare_account_deletion(true) $$, '3: i zmieniony (ostatni wygrywa)');
select throws_ok($$ select * from private.account_deletion_options $$, '42501', null, '4: telefon nie czyta wyborów');
reset role;
select is((select delete_entries from private.account_deletion_options where user_id = '00000000-0000-7000-8000-0000000024a1'), true, '5: zapisany ostatni wybór');
select is(has_function_privilege('anon', 'public.prepare_account_deletion(boolean)', 'execute'), false, '6: anon nie wywoła');

-- ── C usuwa konto bez wyboru: jego wpisy zostają (jak dotąd).
select pg_temp.as_user('');
delete from auth.users where id = '00000000-0000-7000-8000-0000000024c1';
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000002c1'), false, '7: bez wyboru zadanie zostaje');
select is(pg_temp.gone('event_rsvps', '24240000-0000-7000-8000-0000000005c1'), false, '8: bez wyboru odpowiedź zostaje');

-- ── A usuwa konto z wyborem.
create temp table v0 on commit drop as select version from public.groups where id = '24240000-0000-7000-8000-000000000001';
delete from auth.users where id = '00000000-0000-7000-8000-0000000024a1';
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000002a1'), true, '9: zadanie A w koszu');
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000002b2'), true, '10: z podzadaniem (dodanym przez B)');
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000002a2'), true, '11: rzecz na liście zakupów A w koszu');
select is(pg_temp.gone('events', '24240000-0000-7000-8000-0000000003a1'), true, '12: wydarzenie A w koszu');
select is(pg_temp.gone('event_task_series', '24240000-0000-7000-8000-0000000004a1'), true, '13: stałe zadanie A w koszu');
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000006b2'), true, '14: przyszła niezrobiona kopia znika');
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000006b1'), false, '15: dawna kopia zostaje w historii');
select is(pg_temp.gone('event_rsvps', '24240000-0000-7000-8000-0000000005a1'), true, '16: odpowiedź A w koszu');
select is(pg_temp.gone('tasks', '24240000-0000-7000-8000-0000000002b1'), false, '17: zadanie B zostaje');
select is(pg_temp.gone('events', '24240000-0000-7000-8000-0000000003b1') or pg_temp.gone('event_rsvps', '24240000-0000-7000-8000-0000000005b1')
  or pg_temp.gone('lists', '24240000-0000-7000-8000-0000000001f2'), false, '18: wydarzenie i odpowiedź B oraz lista A (z wpisami innych) zostają');
select ok((select version from public.tasks where id = '24240000-0000-7000-8000-0000000002a1') > (select version from v0), '19: nowa wersja — telefony innych pobiorą usunięcie');
select is((select actor_name from public.activity where entity_id = '24240000-0000-7000-8000-0000000002a1' and verb = 'delete'),
  private.deleted_user_label(), '20: w historii „usuwa” podpisane „Usunięty użytkownik”');
select is((select count(*)::int from private.account_deletion_options), 0, '21: wybory usuniętych kont znikają z nimi');
select * from finish();
rollback;
