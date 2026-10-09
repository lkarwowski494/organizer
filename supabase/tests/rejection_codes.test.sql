-- Kody odrzucenia bez testu do audytu 2 (M-154 / Q-11, D47: „każda funkcja RPC z testem sukcesu i każdego kodu
-- odrzucenia”) i RPC tokenów push. Strażniki kolumn niezmiennych (immutable_column:*) są drugą linią obrony: telefon
-- nie ma GRANT na te kolumny (schema_contracts.test.sql), więc test sprawdza strażnika z tożsamością właściciela na
-- roli bez ograniczeń GRANT — tak, jak gdyby uprawnienie kolumny się otworzyło. Kompletność pilnuje test statyczny
-- src/config/__tests__/pgtap-coverage.contract.test.ts (każdy kod z ostatnich definicji funkcji występuje w tych testach).
begin;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e0', 'o@rc.test'), ('00000000-0000-7000-8000-0000000000e1', 'ad@rc.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'm@rc.test'), ('00000000-0000-7000-8000-0000000000e3', 'k@rc.test'),
  ('00000000-0000-7000-8000-0000000000e4', 'x@rc.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

-- Grupa G (owner b0 = członek 90), admin b1 (91), member b2 (92), dziecko z kontem b3 (93); obcy b4 ma swoją grupę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e0');
set local role authenticated;
select public.create_group('89898989-0000-7000-8000-000000000001', 'G', '89898989-0000-7000-8000-000000000090', 'Owner');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
select public.create_group('89898989-0000-7000-8000-000000000002', 'Obca', '89898989-0000-7000-8000-000000000094', 'Obcy');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('89898989-0000-7000-8000-000000000091', '89898989-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e1', 'Admin', 'admin'),
  ('89898989-0000-7000-8000-000000000092', '89898989-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'Member', 'member'),
  ('89898989-0000-7000-8000-000000000093', '89898989-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e3', 'Dziecko', 'child'),
  ('89898989-0000-7000-8000-000000000095', '89898989-0000-7000-8000-000000000001', null, 'Profil', 'child');
-- Dane G: lista z zadaniem przypisanym dziecku, lista ograniczona ownera (z udostępnieniem memberowi), wydarzenie
-- cotygodniowe z uczestnikiem, wyjątkiem, odpowiedzią membera i serią zadań, przekazanie od ownera do membera, zaproszenie.
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('89898989-0000-7000-8000-0000000000e1', '89898989-0000-7000-8000-000000000001', 'tasks', 'Dom', '89898989-0000-7000-8000-000000000090');
insert into public.lists (id, group_id, kind, name, owner_member_id, visibility) values
  ('89898989-0000-7000-8000-0000000000e2', '89898989-0000-7000-8000-000000000001', 'tasks', 'Prezent', '89898989-0000-7000-8000-000000000090', 'restricted');
insert into public.object_members (scope_entity, scope_id, member_id, group_id) values
  ('lists', '89898989-0000-7000-8000-0000000000e2', '89898989-0000-7000-8000-000000000092', '89898989-0000-7000-8000-000000000001');
insert into public.tasks (id, group_id, list_id, title, assignee_member_id) values
  ('89898989-0000-7000-8000-0000000000d1', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Zadanie', '89898989-0000-7000-8000-000000000093'),
  ('89898989-0000-7000-8000-0000000000d2', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Moje', '89898989-0000-7000-8000-000000000090'),
  ('89898989-0000-7000-8000-0000000000d3', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Do przekazania', '89898989-0000-7000-8000-000000000090'),
  ('89898989-0000-7000-8000-0000000000d4', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Do przekazania', '89898989-0000-7000-8000-000000000091'),
  ('89898989-0000-7000-8000-0000000000d5', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Do przekazania', '89898989-0000-7000-8000-000000000092'),
  ('89898989-0000-7000-8000-0000000000d6', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Do przekazania', '89898989-0000-7000-8000-000000000093');
insert into public.events (id, group_id, title, start_date, start_time, end_time, rrule, audience) values
  ('89898989-0000-7000-8000-0000000000c1', '89898989-0000-7000-8000-000000000001', 'Basen', '2026-10-07', '17:00', '18:00', 'FREQ=WEEKLY;BYDAY=WE', 'members');
insert into public.event_participants (id, event_id, group_id, member_id) values
  ('89898989-0000-7000-8000-0000000000c2', '89898989-0000-7000-8000-0000000000c1', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-000000000093');
insert into public.event_overrides (id, event_id, group_id, occurrence_date, title) values
  ('89898989-0000-7000-8000-0000000000c3', '89898989-0000-7000-8000-0000000000c1', '89898989-0000-7000-8000-000000000001', '2026-10-14', 'Basen później');
insert into public.event_rsvps (id, event_id, group_id, occurrence_date, member_id, answer) values
  ('89898989-0000-7000-8000-0000000000c4', '89898989-0000-7000-8000-0000000000c1', '89898989-0000-7000-8000-000000000001', '2026-10-07', '89898989-0000-7000-8000-000000000092', 'yes');
insert into public.event_task_series (id, event_id, group_id, list_id, title) values
  ('89898989-0000-7000-8000-0000000000c5', '89898989-0000-7000-8000-0000000000c1', '89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-0000000000e1', 'Ręcznik');
insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member) values
  ('89898989-0000-7000-8000-0000000000c6', '89898989-0000-7000-8000-000000000001', 'tasks', '89898989-0000-7000-8000-0000000000d2', '89898989-0000-7000-8000-000000000090', '89898989-0000-7000-8000-000000000092');
insert into public.invites (group_id, token_hash, created_by, expires_at, max_uses) values
  ('89898989-0000-7000-8000-000000000001', '\x00', '00000000-0000-7000-8000-0000000000e0', now() + interval '1 day', 5);
insert into public.push_tokens (token, user_id, env) select encode(sha256(id::text::bytea), 'hex'), id, 'production' from auth.users where email like '%@rc.test';
insert into public.push_mutes (user_id, group_id) select id, '89898989-0000-7000-8000-000000000001' from auth.users where email in ('o@rc.test', 'ad@rc.test', 'm@rc.test', 'k@rc.test');
insert into public.app_feedback (user_id, message) select id, 'uwaga' from auth.users where email like '%@rc.test';
insert into public.client_errors (user_id, kind, message) select id, 'error', 'błąd' from auth.users where email like '%@rc.test';
insert into public.profiles (user_id, display_name) select id, 'P' from auth.users where email like '%@rc.test' on conflict (user_id) do nothing;


-- Strażniki kolumn niezmiennych (jako owner, rola bez ograniczeń GRANT).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e0');
select throws_ok($$ update public.groups set kind = 'personal' where id = '89898989-0000-7000-8000-000000000001' $$, 'P0001', 'immutable_column:kind', 'grupa: rodzaj niezmienny');
select throws_ok($$ update public.groups set join_id = '123456789' where id = '89898989-0000-7000-8000-000000000001' $$, 'P0001', 'immutable_column:join_id', 'grupa: ID do dołączania tylko przez rotate_join_id');
select throws_ok($$ update public.lists set kind = 'shopping' where id = '89898989-0000-7000-8000-0000000000e1' $$, 'P0001', 'immutable_column:kind', 'lista: rodzaj niezmienny');
select throws_ok($$ update public.lists set owner_member_id = '89898989-0000-7000-8000-000000000091' where id = '89898989-0000-7000-8000-0000000000e1' $$, 'P0001', 'immutable_column:owner_member_id', 'lista: twórca niezmienny');
select throws_ok($$ update public.tasks set list_id = '89898989-0000-7000-8000-0000000000e2' where id = '89898989-0000-7000-8000-0000000000d1' $$, 'P0001', 'immutable_column:list_id', 'zadanie: lista tylko przez move_task');
select throws_ok($$ update public.tasks set parent_id = '89898989-0000-7000-8000-0000000000d2' where id = '89898989-0000-7000-8000-0000000000d1' $$, 'P0001', 'immutable_column:parent_id', 'zadanie: rodzic niezmienny');
select throws_ok($$ update public.group_members set user_id = '00000000-0000-7000-8000-0000000000e4' where member_id = '89898989-0000-7000-8000-000000000095' $$, 'P0001', 'immutable_column:user_id', 'członek: konto niezmienne (łączenie tylko kodem dziecka)');
select throws_ok($$ update public.group_members set member_id = gen_random_uuid() where member_id = '89898989-0000-7000-8000-000000000095' $$, 'P0001', 'immutable_column:member_id', 'członek: identyfikator niezmienny');
select throws_ok($$ update public.event_overrides set occurrence_date = '2026-10-28' where id = '89898989-0000-7000-8000-0000000000c3' $$, 'P0001', 'immutable_column:occurrence_date', 'wyjątek: dzień wystąpienia niezmienny');
select throws_ok($$ update public.event_overrides set event_id = gen_random_uuid() where id = '89898989-0000-7000-8000-0000000000c3' $$, 'P0001', 'immutable_column:event_id', 'wyjątek: wydarzenie niezmienne');
select throws_ok($$ update public.event_rsvps set member_id = '89898989-0000-7000-8000-000000000091' where id = '89898989-0000-7000-8000-0000000000c4' $$, 'P0001', 'immutable_column:member_id', 'obecność: osoba niezmienna');
select throws_ok($$ update public.event_task_series set list_id = '89898989-0000-7000-8000-0000000000e2' where id = '89898989-0000-7000-8000-0000000000c5' $$, 'P0001', 'immutable_column:list_id', 'seria zadań: lista niezmienna');
select throws_ok($$ update public.object_members set scope_id = '89898989-0000-7000-8000-0000000000e1' where scope_id = '89898989-0000-7000-8000-0000000000e2' $$, 'P0001', 'immutable_column:scope', 'udostępnienie: zakres niezmienny');
select throws_ok($$ insert into public.object_members (scope_entity, scope_id, member_id, group_id) values ('tasks', '89898989-0000-7000-8000-0000000000d1', '89898989-0000-7000-8000-000000000091', '89898989-0000-7000-8000-000000000001') $$, 'P0001', 'invalid_scope', 'udostępnienie: tylko listy');
select throws_ok($$ insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member) values (gen_random_uuid(), '89898989-0000-7000-8000-000000000001', 'lists', gen_random_uuid(), '89898989-0000-7000-8000-000000000090', '89898989-0000-7000-8000-000000000091') $$, 'P0001', 'invalid_entity', 'przekazanie: nieistniejąca rzecz');
select throws_ok($$ update public.handoffs set to_member = '89898989-0000-7000-8000-000000000091' where id = '89898989-0000-7000-8000-0000000000c6' $$, 'P0001', 'immutable_column', 'przekazanie: poza stanem nic się nie zmienia');
-- Bez tożsamości (zadania serwera): grupa wiersza też niezmienna (stamp_version), wersja tylko dla istniejącej grupy.
select pg_temp.as_user('');
select throws_ok($$ update public.lists set group_id = '89898989-0000-7000-8000-000000000002' where id = '89898989-0000-7000-8000-0000000000e1' $$, 'P0001', 'immutable_column:group_id', 'wiersz: grupa niezmienna także bez tożsamości');
select throws_ok($$ select private.bump_group_version(gen_random_uuid()) $$, 'P0001', 'group_not_found', 'licznik wersji: tylko istniejąca grupa');

-- Bez zalogowania (rola authenticated bez sub): RPC odrzucają, zanim cokolwiek zmienią.
set local role authenticated;
select throws_ok($$ select public.create_group(gen_random_uuid(), 'X', gen_random_uuid(), 'Ja') $$, 'P0001', 'not_authenticated', 'create_group bez zalogowania');
select throws_ok($$ select public.sync_pull('{}'::jsonb, 10, 2, null) $$, 'P0001', 'not_authenticated', 'sync_pull bez zalogowania');
select throws_ok($$ select public.sync_push(gen_random_uuid(), 2, '[]'::jsonb) $$, 'P0001', 'not_authenticated', 'sync_push bez zalogowania (claim_client)');
select throws_ok($$ select public.accept_invite(repeat('ab', 32), 'Ja') $$, 'P0001', 'not_authenticated', 'accept_invite bez zalogowania');
select throws_ok($$ select public.join_group('123456789', '123456', 'Ja') $$, 'P0001', 'not_authenticated', 'join_group bez zalogowania');
select throws_ok($$ select public.delete_group('89898989-0000-7000-8000-000000000001') $$, 'P0001', 'not_authenticated', 'delete_group bez zalogowania (set_group_trash)');
select throws_ok($$ select public.transfer_ownership('89898989-0000-7000-8000-000000000001', '89898989-0000-7000-8000-000000000091') $$, 'P0001', 'not_authenticated', 'transfer_ownership bez zalogowania');
select throws_ok($$ select public.register_push_token(repeat('ab', 32), 'production') $$, 'P0001', 'unauthorized', 'register_push_token bez zalogowania');
select throws_ok($$ select public.report_client_error('error', 'x', null, null, null) $$, 'P0001', 'unauthorized', 'report_client_error bez zalogowania');
select throws_ok($$ select public.send_feedback('uwaga', null, null) $$, 'P0001', 'unauthorized', 'send_feedback bez zalogowania');

-- Tokeny push: wyrejestrowanie usuwa tylko mój token; drop_push_token tylko dla funkcji (service_role).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
select lives_ok($$ select public.unregister_push_token(encode(sha256('00000000-0000-7000-8000-0000000000e0'::bytea), 'hex')) $$, 'unregister_push_token cudzego tokenu: bez błędu (nic nie zdradza)');
select lives_ok($$ select public.unregister_push_token(upper(encode(sha256('00000000-0000-7000-8000-0000000000e1'::bytea), 'hex'))) $$, 'unregister_push_token mojego tokenu (wielkość liter bez znaczenia)');
select throws_ok($$ select public.drop_push_token(encode(sha256('00000000-0000-7000-8000-0000000000e0'::bytea), 'hex')) $$, '42501', null, 'drop_push_token: telefon nie wywoła');
select is(public.my_push_mutes(), array['89898989-0000-7000-8000-000000000001']::uuid[], 'my_push_mutes: tylko moje wyciszenia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
select is(public.my_push_mutes(), '{}'::uuid[], 'my_push_mutes: cudzych wyciszeń nie widać');
reset role;
select pg_temp.as_user('');
select is((select array_agg(u.email::text order by u.email) from public.push_tokens t join auth.users u on u.id = t.user_id),
  array['k@rc.test', 'm@rc.test', 'o@rc.test', 'x@rc.test'], 'po wyrejestrowaniu: mój token zniknął, cudzy (owner) został');

select * from finish();
rollback;
