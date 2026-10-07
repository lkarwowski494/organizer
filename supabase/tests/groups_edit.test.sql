-- Edycja grup: kolor, kosz z przywróceniem, przekazanie własności (migracja 20261008090000_groups_edit).
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000f1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000f2', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000f3', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000f4', 'c@x.test');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.role_of(mid text) returns text language sql as $$ select role from public.group_members where member_id = mid::uuid $$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.role_of(text) to authenticated;

-- G: owner O, admin A, member M, dziecko z kontem C, dziecko bez konta K.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('44440000-0000-7000-8000-000000000001', 'Rodzina', '44440000-0000-7000-8000-0000000000a1', 'O');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('44440000-0000-7000-8000-0000000000a2', '44440000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f2', 'A', 'admin'),
  ('44440000-0000-7000-8000-0000000000a3', '44440000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f3', 'M', 'member'),
  ('44440000-0000-7000-8000-0000000000a4', '44440000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f4', 'C', 'child'),
  ('44440000-0000-7000-8000-0000000000a5', '44440000-0000-7000-8000-000000000001', null, 'Tymek', 'child');

-- 1–5: kolor.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 1, '{"kind":"patch","entity":"groups","id":"44440000-0000-7000-8000-000000000001","set":{"color":"teal"}}'), 'ok', '1: owner ustawia kolor');
select is((select color from public.groups where id = '44440000-0000-7000-8000-000000000001'), 'teal', '2: kolor zapisany i widoczny');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 2, '{"kind":"patch","entity":"groups","id":"44440000-0000-7000-8000-000000000001","set":{"color":"amber"}}'), 'invalid:23514', '3: kolor spoza palety odrzucony');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f2', 1, '{"kind":"patch","entity":"groups","id":"44440000-0000-7000-8000-000000000001","set":{"color":"red"}}'), 'forbidden:role', '4: admin nie zmienia koloru');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f2', 2, '{"kind":"patch","entity":"groups","id":"44440000-0000-7000-8000-000000000001","set":{"name":"Rodzina K."}}'), 'ok', '5: admin zmienia nazwę');

-- 6–9: role, imię dziecka, usunięcie członka (strażnik członkostw).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 3, '{"kind":"patch","entity":"group_members","id":"44440000-0000-7000-8000-0000000000a3","set":{"role":"admin"}}'), 'ok', '6: owner nadaje admina');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 4, '{"kind":"patch","entity":"group_members","id":"44440000-0000-7000-8000-0000000000a3","set":{"role":"member"}}'), 'ok', '7: owner odbiera admina');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f2', 3, '{"kind":"patch","entity":"group_members","id":"44440000-0000-7000-8000-0000000000a5","set":{"display_name":"Tymoteusz"}}'), 'ok', '8: admin zmienia imię dziecka');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f2', 4, '{"kind":"delete","entity":"group_members","id":"44440000-0000-7000-8000-0000000000a5"}'), 'ok', '9: admin usuwa profil dziecka');

-- 10–14: przekazanie własności.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select throws_ok($$ select public.transfer_ownership('44440000-0000-7000-8000-000000000001', '44440000-0000-7000-8000-0000000000a3') $$, 'P0001', 'forbidden', '10: tylko owner przekazuje');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select throws_ok($$ select public.transfer_ownership('44440000-0000-7000-8000-000000000001', '44440000-0000-7000-8000-0000000000a4') $$, 'P0001', 'invalid_member', '11: dziecko (też z kontem) nie dostaje własności');
select lives_ok($$ select public.transfer_ownership('44440000-0000-7000-8000-000000000001', '44440000-0000-7000-8000-0000000000a3') $$, '12: owner przekazuje memberowi');
select is(pg_temp.role_of('44440000-0000-7000-8000-0000000000a3') || '/' || pg_temp.role_of('44440000-0000-7000-8000-0000000000a1'), 'owner/admin', '13: nowy owner, dawny owner zostaje adminem');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f1', 5, '{"kind":"patch","entity":"group_members","id":"44440000-0000-7000-8000-0000000000a2","set":{"role":"owner"}}'), 'forbidden:role', '14: zwykła zmiana roli nie nadaje ownera');

-- 15–22: kosz. Owner teraz: M.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select throws_ok($$ select public.delete_group('44440000-0000-7000-8000-000000000001') $$, 'P0001', 'forbidden', '15: admin nie usuwa grupy');
select throws_ok($$ select public.delete_group('00000000-0000-7000-8000-0000000000f1') $$, 'P0001', 'forbidden:personal_group', '16: grupy osobistej nie usuwa się');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select lives_ok($$ select public.delete_group('44440000-0000-7000-8000-000000000001') $$, '17: owner przenosi grupę do kosza');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f3', 1, '{"kind":"create","entity":"lists","id":"44440000-0000-7000-8000-0000000011aa","group_id":"44440000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"L"}}'), 'deleted:group', '18: grupa w koszu nie przyjmuje zmian');
select ok((select (r ->> 'deleted_at') is not null from (select x.r from private.group_rows_since('44440000-0000-7000-8000-000000000001', 0, 100) x where x.e = 'groups') q), '19: członkowie pobierają grupę z datą usunięcia (telefon ją ukrywa)');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f3', 2, '{"kind":"patch","entity":"groups","id":"44440000-0000-7000-8000-000000000001","set":{"name":"X"}}'), 'deleted:group', '20: w koszu nawet nazwa się nie zmienia');
select lives_ok($$ select public.restore_group('44440000-0000-7000-8000-000000000001') $$, '21: owner przywraca');
select is(pg_temp.push('44440000-0000-7000-8000-00000000c0f3', 3, '{"kind":"create","entity":"lists","id":"44440000-0000-7000-8000-0000000011aa","group_id":"44440000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"L"}}'), 'ok', '22: po przywróceniu grupa znów przyjmuje zmiany');

-- 23–24: deleted_at grupy nie zmienia się poza funkcją kosza; przeterminowanego nie da się przywrócić.
select throws_ok($$ update public.groups set deleted_at = now() where id = '44440000-0000-7000-8000-000000000001' $$, '42501', null, '23: bezpośrednia zmiana deleted_at zablokowana');
reset role;
select pg_temp.as_user('');
update public.groups set deleted_at = now() - interval '31 days' where id = '44440000-0000-7000-8000-000000000001';
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
set local role authenticated;
select throws_ok($$ select public.restore_group('44440000-0000-7000-8000-000000000001') $$, 'P0001', 'deleted:expired', '24: po terminie kosza przywrócenie niemożliwe');
reset role;

select * from finish();
rollback;
