-- Grupy i członkostwa: rejestracja, widoczność, role, wyjście z grupy, wersje (migracja 20261006120000_core).
begin;
select plan(30);

-- Użytkownicy: A (właściciel grupy wspólnej), B (członek), C (obcy).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-7000-8000-00000000000a', 'a@example.test', '{"display_name":"Ala"}'),
  ('00000000-0000-7000-8000-00000000000b', 'b@example.test', '{}'),
  ('00000000-0000-7000-8000-00000000000c', 'c@example.test', '{}');

-- 1–4: rejestracja tworzy profil i grupę osobistą z właścicielem.
select is((select display_name from public.profiles where user_id = '00000000-0000-7000-8000-00000000000a'), 'Ala', 'profil z imieniem z metadanych');
select is((select display_name from public.profiles where user_id = '00000000-0000-7000-8000-00000000000b'), 'Ja', 'profil z imieniem domyślnym');
select is((select kind from public.groups where id = '00000000-0000-7000-8000-00000000000a'), 'personal', 'grupa osobista o id = user_id');
select is((select role from public.group_members where member_id = '00000000-0000-7000-8000-00000000000a'), 'owner', 'właściciel grupy osobistej');

-- Logowanie jako A.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;

select lives_ok($$ select public.create_group('11111111-0000-7000-8000-000000000001', 'Rodzina', '11111111-0000-7000-8000-0000000000a1', 'Ala') $$, '5: A tworzy grupę wspólną');
select is((select count(*)::int from public.groups), 2, '6: A widzi swoje 2 grupy');
select throws_ok($$ insert into public.groups (id, name) values (gen_random_uuid(), 'x') $$, '42501', null, '7: bez INSERT na groups');
select lives_ok($$ insert into public.group_members (member_id, group_id, display_name, role)
  values ('11111111-0000-7000-8000-0000000000c1', '11111111-0000-7000-8000-000000000001', 'Zosia', 'child') $$, '8: owner dodaje profil dziecka');
select throws_ok($$ insert into public.group_members (member_id, group_id, user_id, display_name)
  values (gen_random_uuid(), '11111111-0000-7000-8000-000000000001', '00000000-0000-7000-8000-00000000000c', 'C') $$,
  '42501', null, '9: konta nie dopisuje się ręcznie (user_id poza uprawnieniami kolumn)');
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role)
  values (gen_random_uuid(), '11111111-0000-7000-8000-000000000001', 'X', 'owner') $$, 'P0001', 'forbidden:role', '10: nie dodaje się drugiego ownera');
select throws_ok($$ delete from public.group_members where member_id = '11111111-0000-7000-8000-0000000000c1' $$, '42501', null, '11: brak twardego usuwania');
select throws_ok($$ update public.group_members set role = 'member' where member_id = '11111111-0000-7000-8000-0000000000a1' $$,
  'P0001', 'forbidden:owner_cannot_demote_self', '12: owner nie degraduje sam siebie');
select is((select version from public.groups where id = '11111111-0000-7000-8000-000000000001'), 2::bigint, '13: wersja grupy = liczba zapisów (owner + dziecko)');
select is((select version from public.group_members where member_id = '11111111-0000-7000-8000-0000000000c1'),
  (select version from public.groups where id = '11111111-0000-7000-8000-000000000001'), '14: wiersz dostaje bieżącą wersję grupy');
select lives_ok($$ update public.groups set name = 'Rodzina K.' where id = '11111111-0000-7000-8000-000000000001' $$, '15: owner zmienia nazwę grupy');
select throws_ok($$ update public.groups set plan = 'x' where id = '11111111-0000-7000-8000-000000000001' $$, '42501', null, '16: plan grupy niezmienialny przez klienta');

-- B dołącza (symulacja przyjęcia zaproszenia w kontekście serwera — funkcja accept_invite w kolejnej migracji).
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.group_members (member_id, group_id, user_id, display_name, role)
  values ('11111111-0000-7000-8000-0000000000b1', '11111111-0000-7000-8000-000000000001', '00000000-0000-7000-8000-00000000000b', 'Bartek', 'member');
select is((select count(*)::int from private.access_events where user_id = '00000000-0000-7000-8000-00000000000b' and kind = 'group_granted' and group_id = '11111111-0000-7000-8000-000000000001'), 1, '17: zdarzenie group_granted dla grupy wspólnej');
select is((select count(*)::int from realtime.messages where topic = 'user:00000000-0000-7000-8000-00000000000b'), 2, '18: poke na kanał użytkownika (grupa osobista + wspólna)');

-- Logowanie jako B (członek).
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
set local role authenticated;
select is((select count(*)::int from public.group_members where group_id = '11111111-0000-7000-8000-000000000001'), 3, '19: B widzi członków grupy');
select is((select display_name from public.profiles where user_id = '00000000-0000-7000-8000-00000000000a'), 'Ala', '20: B widzi profil członka swojej grupy');
select throws_ok($$ update public.group_members set role = 'admin' where member_id = '11111111-0000-7000-8000-0000000000b1' $$, 'P0001', 'forbidden:role', '21: member nie awansuje sam siebie');
select throws_ok($$ update public.group_members set display_name = 'Z' where member_id = '11111111-0000-7000-8000-0000000000c1' $$, 'P0001', 'forbidden', '22: member nie zmienia cudzego profilu');
select lives_ok($$ update public.group_members set color = '#ff0000' where member_id = '11111111-0000-7000-8000-0000000000b1' $$, '23: member zmienia swój kolor');
select throws_ok($$ update public.group_members set color = 'red' where member_id = '11111111-0000-7000-8000-0000000000b1' $$, '23514', null, '24: kolor tylko #rrggbb');
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role) values (gen_random_uuid(), '11111111-0000-7000-8000-000000000001', 'Y', 'child') $$, 'P0001', 'forbidden', '25: member nie dodaje członków');
select lives_ok($$ update public.group_members set deleted_at = now() where member_id = '11111111-0000-7000-8000-0000000000b1' $$, '26: member wychodzi z grupy');
select is((select count(*)::int from public.groups where id = '11111111-0000-7000-8000-000000000001'), 0, '27: po wyjściu B nie widzi grupy');

reset role;
select is((select count(*)::int from private.access_events where user_id = '00000000-0000-7000-8000-00000000000b' and kind = 'group_revoked'), 1, '28: zdarzenie group_revoked');

-- C (obcy) i anon.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000c', true);
set local role authenticated;
select is((select count(*)::int from public.group_members where group_id = '11111111-0000-7000-8000-000000000001'), 0, '29: obcy nie widzi członków');
reset role;
set local role anon;
select throws_ok($$ select * from public.groups $$, '42501', null, '30: anon nie ma dostępu');

select * from finish();
rollback;
