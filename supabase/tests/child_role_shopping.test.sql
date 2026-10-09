-- Audyt 3 (PK-12, migracja 20261010120000_child_role_shopping): rola „Dziecko” tylko dla konta połączonego kodem profilu
-- dziecka (Q6b A, N-42) i dopisywanie produktów do listy zakupów przez dziecko z kontem (Q6d A, N-44).
begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000012c1', 'o@crs.test'),
  ('00000000-0000-7000-8000-0000000012c3', 'm@crs.test'),
  ('00000000-0000-7000-8000-0000000012c4', 'tymek@crs.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
create function pg_temp.code(k text) returns text language sql as $$ select v ->> 'code' from pg_temp.c where c.k = code.k $$;
create function pg_temp.jid() returns text language sql security definer as $$ select join_id from public.groups where id = '12c00000-0000-7000-8000-000000000001' $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: C1 owner (a1), C3 dorosły członek z kontem (a3, dołączył sam), profil dziecka Tymek (b1); lista „Dom” i „Zakupy”.
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
set local role authenticated;
select public.create_group('12c00000-0000-7000-8000-000000000001', 'Rodzina', '12c00000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('12c00000-0000-7000-8000-0000000000a3', '12c00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000012c3', 'Jan', 'member'),
  ('12c00000-0000-7000-8000-0000000000b1', '12c00000-0000-7000-8000-000000000001', null, 'Tymek', 'child');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('12c00000-0000-7000-8000-0000000000e1', '12c00000-0000-7000-8000-000000000001', 'tasks', 'Dom', '12c00000-0000-7000-8000-0000000000a1'),
  ('12c00000-0000-7000-8000-0000000000e2', '12c00000-0000-7000-8000-000000000001', 'shopping', 'Zakupy', '12c00000-0000-7000-8000-0000000000a1');
insert into public.tasks (id, group_id, list_id, title) values
  ('12c00000-0000-7000-8000-0000000000d1', '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'Chleb');

-- ───────── 1–9: rola „Dziecko” (Q6b A) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
set local role authenticated;
select throws_ok($$ update public.group_members set role = 'child' where member_id = '12c00000-0000-7000-8000-0000000000a3' $$, 'P0001', 'forbidden:role', '1: dorosłego, który dołączył sam, owner nie zmieni na dziecko');
select is(pg_temp.push('12c00000-0000-7000-8000-0000000000f1', 1, '{"kind":"patch","entity":"group_members","id":"12c00000-0000-7000-8000-0000000000a3","set":{"role":"child"}}'),
  'forbidden:role', '2: ani przez sync_push (kod odrzucenia dla telefonu)');
select lives_ok($$ update public.group_members set role = 'admin' where member_id = '12c00000-0000-7000-8000-0000000000a3' $$, '3: inne zmiany roli bez zmian');
insert into pg_temp.c values ('k', public.create_child_code('12c00000-0000-7000-8000-0000000000b1'));
select is((select child_linked_at from public.group_members where member_id = '12c00000-0000-7000-8000-0000000000b1'), null, '4: profil bez konta — bez znacznika');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c4');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('k'), 'Tymek') ->> 'member_id', '12c00000-0000-7000-8000-0000000000b1', '5: dziecko łączy konto z profilem');
select isnt((select child_linked_at from public.group_members where member_id = '12c00000-0000-7000-8000-0000000000b1'), null, '6: znacznik połączenia ustawia serwer');
select throws_ok($$ update public.group_members set child_linked_at = null where member_id = '12c00000-0000-7000-8000-0000000000b1' $$, '42501', null, '7: telefon go nie zmienia (brak uprawnień)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
set local role authenticated;
select lives_ok($$ update public.group_members set role = 'member' where member_id = '12c00000-0000-7000-8000-0000000000b1' $$, '8: połączone dziecko owner zmienia w członka');
select lives_ok($$ update public.group_members set role = 'child' where member_id = '12c00000-0000-7000-8000-0000000000b1' $$, '9: i z powrotem (pasek „Cofnij”)');
select isnt((select child_linked_at from public.group_members where member_id = '12c00000-0000-7000-8000-0000000000b1'), null, '10: znacznik zostaje po zmianach roli');
select lives_ok($$ update public.group_members set color = '#00aa00' where member_id = '12c00000-0000-7000-8000-0000000000a3' $$, '11: inne zmiany osoby bez znacznika bez zmian');
reset role;
select pg_temp.as_user('');
select lives_ok($$ update public.group_members set role = 'child' where member_id = '12c00000-0000-7000-8000-0000000000a3' $$, '12: serwer (bez konta w żądaniu) — bez ograniczenia');
update public.group_members set role = 'admin' where member_id = '12c00000-0000-7000-8000-0000000000a3';

-- ───────── 13–22: dziecko dopisuje zakupy (Q6d A) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c4');
set local role authenticated;
select lives_ok($$ insert into public.tasks (id, group_id, list_id, title) values ('12c00000-0000-7000-8000-0000000000d2', '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'Szampon') $$,
  '13: dziecko dopisuje produkt do listy zakupów');
select is((select created_by from public.tasks where id = '12c00000-0000-7000-8000-0000000000d2'), '12c00000-0000-7000-8000-0000000000b1'::uuid, '14: twórcą jest dziecko');
select is(pg_temp.push('12c00000-0000-7000-8000-0000000000f4', 1, '{"kind":"create","entity":"tasks","id":"12c00000-0000-7000-8000-0000000000d3","group_id":"12c00000-0000-7000-8000-000000000001","set":{"list_id":"12c00000-0000-7000-8000-0000000000e2","parent_id":null,"title":"Pasta do zębów","sort_key":"a0","deadline_mode":"none","due_date":null,"due_time":null}}'),
  'ok', '15: tak samo przez sync_push (operacja szybkiego dodawania z telefonu)');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e1', 'Zadanie') $$,
  'P0001', 'forbidden:child', '16: zadań dalej nie dodaje (D34)');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'X', '12c00000-0000-7000-8000-0000000000a1') $$,
  'P0001', 'forbidden:child', '17: pozycja z osobą — nie');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, deadline_mode, due_date) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'X', 'own', '2026-10-10') $$,
  'P0001', 'forbidden:child', '18: z terminem — nie');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, parent_id) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'X', '12c00000-0000-7000-8000-0000000000d1') $$,
  'P0001', 'forbidden:child', '19: podpozycja — nie');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, note) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', '12c00000-0000-7000-8000-0000000000e2', 'X', 'duży') $$,
  'P0001', 'forbidden:child', '20: z notatką — nie');
select throws_ok($$ update public.tasks set title = 'Szampon 2' where id = '12c00000-0000-7000-8000-0000000000d2' $$, 'P0001', 'forbidden:child', '21: dopisanej pozycji nie zmienia (D34)');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '12c00000-0000-7000-8000-000000000001', gen_random_uuid(), 'X') $$,
  'P0001', 'forbidden:child', '22: nieznana lista — ten sam kod co dotąd');

select * from finish();
rollback;
