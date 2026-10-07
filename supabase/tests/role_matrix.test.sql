-- Macierz ról × operacji (docs/testing.md): owner, admin, member, child, obcy — na członkostwach, listach,
-- zadaniach i zaproszeniach. Każdy wiersz: kto, co, oczekiwany wynik.
begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000a0', 'o@x.test'), ('00000000-0000-7000-8000-0000000000a1', 'ad@x.test'),
  ('00000000-0000-7000-8000-0000000000a2', 'm@x.test'), ('00000000-0000-7000-8000-0000000000a3', 'k@x.test'),
  ('00000000-0000-7000-8000-0000000000a4', 'x@x.test');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000000a0', true);
set local role authenticated;
select public.create_group('77777777-0000-7000-8000-000000000001', 'G', '77777777-0000-7000-8000-0000000000f0', 'Owner');
insert into public.lists (id, group_id, kind, name) values ('77777777-0000-7000-8000-0000000000e1', '77777777-0000-7000-8000-000000000001', 'tasks', 'Dom');
insert into public.tasks (id, group_id, list_id, title) values ('77777777-0000-7000-8000-0000000000d1', '77777777-0000-7000-8000-000000000001', '77777777-0000-7000-8000-0000000000e1', 'T');
insert into public.group_members (member_id, group_id, display_name, role) values ('77777777-0000-7000-8000-0000000000c9', '77777777-0000-7000-8000-000000000001', 'Profil dziecka', 'child');
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77777777-0000-7000-8000-0000000000f1', '77777777-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a1', 'Admin', 'admin'),
  ('77777777-0000-7000-8000-0000000000f2', '77777777-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a2', 'Member', 'member'),
  ('77777777-0000-7000-8000-0000000000f3', '77777777-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000a3', 'Child', 'child');
set local role authenticated;

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

-- ADMIN
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
select lives_ok($$ insert into public.group_members (member_id, group_id, display_name, role) values (gen_random_uuid(), '77777777-0000-7000-8000-000000000001', 'Nowe dziecko', 'child') $$, 'admin: dodaje profil dziecka');
select lives_ok($$ update public.group_members set role = 'child' where member_id = '77777777-0000-7000-8000-0000000000f2' $$, 'admin: zmienia rolę membera');
select lives_ok($$ update public.group_members set role = 'member' where member_id = '77777777-0000-7000-8000-0000000000f2' $$, 'admin: i z powrotem');
select throws_ok($$ update public.group_members set role = 'admin' where member_id = '77777777-0000-7000-8000-0000000000f2' $$, 'P0001', 'forbidden:role', 'admin: nie mianuje adminów');
select throws_ok($$ update public.group_members set deleted_at = now() where member_id = '77777777-0000-7000-8000-0000000000f0' $$, 'P0001', 'forbidden:role', 'admin: nie usuwa ownera');
select lives_ok($$ update public.group_members set display_name = 'Zmienione' where member_id = '77777777-0000-7000-8000-0000000000c9' $$, 'admin: zmienia nazwę profilu dziecka');
select lives_ok($$ update public.groups set name = 'G2' where id = '77777777-0000-7000-8000-000000000001' $$, 'admin: zmienia nazwę grupy');
select lives_ok($$ update public.tasks set title = 'A' where id = '77777777-0000-7000-8000-0000000000d1' $$, 'admin: edytuje zadania');
select lives_ok($$ select public.create_invite('77777777-0000-7000-8000-000000000001') $$, 'admin: zaprasza członków');

-- MEMBER
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a2');
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role) values (gen_random_uuid(), '77777777-0000-7000-8000-000000000001', 'X', 'child') $$, 'P0001', 'forbidden', 'member: nie dodaje członków');
select throws_ok($$ update public.group_members set role = 'member' where member_id = '77777777-0000-7000-8000-0000000000f3' $$, 'P0001', 'forbidden:role', 'member: nie zmienia ról');
select is_empty($$ update public.groups set name = 'X' where id = '77777777-0000-7000-8000-000000000001' returning id $$, 'member: nie zmienia nazwy grupy');
select lives_ok($$ update public.tasks set title = 'M' where id = '77777777-0000-7000-8000-0000000000d1' $$, 'member: edytuje zadania');
select lives_ok($$ insert into public.lists (id, group_id, kind, name) values (gen_random_uuid(), '77777777-0000-7000-8000-000000000001', 'shopping', 'Zakupy') $$, 'member: tworzy listy');
select throws_ok($$ select public.create_invite('77777777-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', 'member: nie zaprasza');
select is((select count(*)::int from public.invites), 0, 'member: nie widzi zaproszeń');

-- CHILD (konto z rolą child)
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a3');
select lives_ok($$ update public.tasks set completed_at = now() where id = '77777777-0000-7000-8000-0000000000d1' $$, 'child: odhacza');
select throws_ok($$ update public.tasks set title = 'C' where id = '77777777-0000-7000-8000-0000000000d1' $$, 'P0001', 'forbidden:child', 'child: nie edytuje');
select throws_ok($$ update public.lists set name = 'C' where id = '77777777-0000-7000-8000-0000000000e1' $$, 'P0001', 'forbidden:child', 'child: nie edytuje list');
select throws_ok($$ select public.create_invite('77777777-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', 'child: nie zaprasza');
select lives_ok($$ update public.group_members set color = '#00ff00' where member_id = '77777777-0000-7000-8000-0000000000f3' $$, 'child: zmienia swój kolor');
select lives_ok($$ update public.group_members set deleted_at = now() where member_id = '77777777-0000-7000-8000-0000000000f3' $$, 'child: może wyjść z grupy');

-- OBCY
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a4');
select is((select count(*)::int from public.groups where id = '77777777-0000-7000-8000-000000000001'), 0, 'obcy: nie widzi grupy');
select is((select count(*)::int from public.group_members where group_id = '77777777-0000-7000-8000-000000000001'), 0, 'obcy: nie widzi członków');
select is_empty($$ update public.tasks set title = 'X' where id = '77777777-0000-7000-8000-0000000000d1' returning id $$, 'obcy: nie edytuje zadań');
select throws_ok($$ select public.create_invite('77777777-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', 'obcy: nie zaprasza');

-- OWNER
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a0');
select lives_ok($$ update public.group_members set role = 'admin' where member_id = '77777777-0000-7000-8000-0000000000f2' $$, 'owner: mianuje admina');
select lives_ok($$ update public.group_members set deleted_at = now() where member_id = '77777777-0000-7000-8000-0000000000f1' $$, 'owner: usuwa admina z grupy');

select * from finish();
rollback;
