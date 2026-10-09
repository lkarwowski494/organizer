-- Członkostwo po audycie 2 (migracja 20261008360000_member_names_roles): imiona bez znaków sterujących i kierunkowych,
-- kto zmienia imię i kolor (PW-54 A), profil bez konta tylko jako dziecko (B-19), przywrócenie usuniętej osoby (D165),
-- powtórzone utworzenie grupy (R-27).
begin;
select plan(39);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000e2', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000e3', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000e4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.name_of(mid text) returns text language sql security definer as $$ select display_name from public.group_members where member_id = mid::uuid $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: E1 owner (f1), E2 admin (f2), E3 member (f3), profil dziecka (f9).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('e0e00000-0000-7000-8000-000000000001', 'G', 'e0e00000-0000-7000-8000-0000000000f1', 'Ola');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('e0e00000-0000-7000-8000-0000000000f2', 'e0e00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e2', 'Adam', 'admin'),
  ('e0e00000-0000-7000-8000-0000000000f3', 'e0e00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e3', 'Marta', 'member');

-- ───────── Imiona (B-18) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select lives_ok($$ insert into public.group_members (member_id, group_id, display_name, role)
  values ('e0e00000-0000-7000-8000-0000000000f9', 'e0e00000-0000-7000-8000-000000000001', E' Ty\u202Emek\u200E\n', 'child') $$, '1: profil dziecka z RLO, LRM i nową linią');
select is(pg_temp.name_of('e0e00000-0000-7000-8000-0000000000f9'), 'Tymek', '2: imię bez znaków sterujących i kierunkowych');
select lives_ok($$ insert into public.group_members (member_id, group_id, display_name, role)
  values ('e0e00000-0000-7000-8000-0000000000f8', 'e0e00000-0000-7000-8000-000000000001', E'Zosia \U0001F468\u200D\U0001F469\u200D\U0001F467 \u2764\uFE0F', 'child') $$, '3: emoji z łącznikiem ZWJ');
select is(pg_temp.name_of('e0e00000-0000-7000-8000-0000000000f8'), E'Zosia \U0001F468\u200D\U0001F469\u200D\U0001F467 \u2764\uFE0F', '4: łącznik ZWJ i wariant emoji zostają');
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role)
  values (gen_random_uuid(), 'e0e00000-0000-7000-8000-000000000001', E'\u202E\n\t', 'child') $$, '23514', null, '5: imię z samych znaków sterujących — odrzucone (pusto)');
select lives_ok($$ update public.group_members set display_name = E'Ola\u2028Bank PKO' where member_id = 'e0e00000-0000-7000-8000-0000000000f1' $$, '6: zmiana własnego imienia z separatorem wiersza');
select is(pg_temp.name_of('e0e00000-0000-7000-8000-0000000000f1'), 'Ola Bank PKO', '7: separator wiersza zamieniony na spację');
select lives_ok($$ update public.profiles set display_name = E'\u2066Ola\u2069' where user_id = '00000000-0000-7000-8000-0000000000e1' $$, '8: profil konta');
select is((select display_name from public.profiles where user_id = '00000000-0000-7000-8000-0000000000e1'), 'Ola', '9: profil bez znaków kierunkowych');

-- ───────── Profil bez konta tylko jako dziecko (B-19) ─────────
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role) values (gen_random_uuid(), 'e0e00000-0000-7000-8000-000000000001', 'X', 'member') $$,
  'P0001', 'forbidden:role', '10: owner nie tworzy „członka” bez konta');
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name) values (gen_random_uuid(), 'e0e00000-0000-7000-8000-000000000001', 'X') $$,
  'P0001', 'forbidden:role', '11: domyślna rola (member) bez konta — odrzucona');
select throws_ok($$ update public.group_members set role = 'admin' where member_id = 'e0e00000-0000-7000-8000-0000000000f9' $$,
  'P0001', 'forbidden:role', '12: profil dziecka nie zostaje adminem');
select lives_ok($$ update public.group_members set role = 'admin' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '13: regresja: owner zmienia rolę osoby z kontem');
select lives_ok($$ update public.group_members set role = 'member' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '14: i z powrotem');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
set local role authenticated;
select throws_ok($$ insert into public.group_members (member_id, group_id, display_name, role) values (gen_random_uuid(), 'e0e00000-0000-7000-8000-000000000001', 'X', 'admin') $$,
  'P0001', 'forbidden:role', '15: admin nie tworzy admina bez konta');
select throws_ok($$ update public.group_members set role = 'member' where member_id = 'e0e00000-0000-7000-8000-0000000000f9' $$,
  'P0001', 'forbidden:role', '16: admin nie robi z profilu dziecka członka');

-- ───────── Imię i kolor osoby z kontem (PW-54 A) ─────────
select throws_ok($$ update public.group_members set display_name = 'Bank PKO' where member_id = 'e0e00000-0000-7000-8000-0000000000f1' $$,
  'P0001', 'forbidden', '17: admin nie zmienia imienia ownera');
select throws_ok($$ update public.group_members set display_name = 'Inna' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$,
  'P0001', 'forbidden', '18: admin nie zmienia imienia członka z kontem');
select throws_ok($$ update public.group_members set color = '#ff0000' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$,
  'P0001', 'forbidden', '19: ani jego koloru');
select lives_ok($$ update public.group_members set display_name = 'Tymoteusz' where member_id = 'e0e00000-0000-7000-8000-0000000000f9' $$, '20: admin zmienia imię profilu dziecka');
select lives_ok($$ update public.group_members set display_name = 'Adaś' where member_id = 'e0e00000-0000-7000-8000-0000000000f2' $$, '21: admin zmienia swoje imię');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select lives_ok($$ update public.group_members set display_name = 'Marta K.' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '22: owner zmienia imię osoby z kontem');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e3');
set local role authenticated;
select lives_ok($$ update public.group_members set display_name = 'Marta' where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '23: członek zmienia swoje imię');
reset role;

-- ───────── Przywrócenie usuniętej osoby (PW-35 A, D165) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f3';
select isnt((select removed_at from public.group_members where member_id = 'e0e00000-0000-7000-8000-0000000000f3'), null, '24: usunięcie przez ownera zostawia ślad (removed_at)');
select lives_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '25: owner przywraca usuniętą osobę');
select ok((select deleted_at is null and removed_at is null from public.group_members where member_id = 'e0e00000-0000-7000-8000-0000000000f3'), '26: osoba z powrotem (ten sam member_id), bez śladu usunięcia');
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f3';
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
set local role authenticated;
select lives_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$, '27: admin też przywraca członka (prawa jak przy usunięciu)');
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f3';
reset role;
-- Po 30 dniach (kosz) — konto wraca już tylko zaproszeniem, profil dziecka wcale.
select pg_temp.as_user('');
alter table public.group_members disable trigger group_members_t_removal;
update public.group_members set deleted_at = now() - make_interval(days => private.tombstone_days(), secs => 1),
  removed_at = now() - make_interval(days => private.tombstone_days(), secs => 1)
  where member_id = 'e0e00000-0000-7000-8000-0000000000f3';
alter table public.group_members enable trigger group_members_t_removal;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f3' $$,
  'P0001', 'forbidden:user_requires_invite', '28: po 30 dniach konto wraca tylko przez zaproszenie');
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f8';
reset role;
select pg_temp.as_user('');
update public.group_members set deleted_at = now() - make_interval(days => private.tombstone_days(), secs => 1) where member_id = 'e0e00000-0000-7000-8000-0000000000f8';
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f8' $$,
  'P0001', 'deleted:expired', '29: profil dziecka po 30 dniach — nie');
reset role;
-- Samodzielne wyjście: nikt go nie cofa (wraca przez zaproszenie).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e2');
set local role authenticated;
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f2';
select is((select removed_at from public.group_members where member_id = 'e0e00000-0000-7000-8000-0000000000f2'), null, '30: samodzielne wyjście bez śladu usunięcia');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f2' $$,
  'P0001', 'forbidden:user_requires_invite', '31: wyjścia z grupy owner nie cofa');

-- ───────── Powtórzone utworzenie grupy (R-27) ─────────
select lives_ok($$ select public.create_group('e0e00000-0000-7000-8000-000000000002', 'Druga', 'e0e00000-0000-7000-8000-0000000000a1', 'Ola') $$, '32: pierwsze utworzenie');
select lives_ok($$ select public.create_group('e0e00000-0000-7000-8000-000000000002', 'Druga', 'e0e00000-0000-7000-8000-0000000000a1', 'Ola') $$, '33: ponowienie z tymi samymi id — sukces');
select lives_ok($$ select public.create_group('e0e00000-0000-7000-8000-000000000002', 'Druga', gen_random_uuid(), 'Ola') $$, '34: ponowienie z innym id członka — też sukces');
select is((select count(*)::int from public.group_members where group_id = 'e0e00000-0000-7000-8000-000000000002'), 1, '35: jedna grupa, jeden właściciel');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e4');
set local role authenticated;
select throws_ok($$ select public.create_group('e0e00000-0000-7000-8000-000000000002', 'Cudza', gen_random_uuid(), 'X') $$, '23505', null, '36: cudza grupa o tym id — błąd jak dotąd');
reset role;

-- ───────── Kto przywraca usuniętą osobę (D165): owner i admin jak przy usunięciu, nikt inny ─────────
-- E5 admin (f5), E6 członek (f6), E7 admin usunięty przez ownera (f7).
select pg_temp.as_user('');
insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000e5', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000e6', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000000e7', 'd@x.test');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('e0e00000-0000-7000-8000-0000000000f5', 'e0e00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e5', 'Basia', 'admin'),
  ('e0e00000-0000-7000-8000-0000000000f6', 'e0e00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e6', 'Celina', 'member'),
  ('e0e00000-0000-7000-8000-0000000000f7', 'e0e00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000e7', 'Darek', 'admin');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
update public.group_members set deleted_at = now() where member_id = 'e0e00000-0000-7000-8000-0000000000f7';
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e5');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f7' $$,
  'P0001', 'forbidden:role', '37: admin nie przywraca admina (usunąć go też nie może)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e6');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f7' $$,
  'P0001', 'forbidden:role', '38: członek nie przywraca nikogo');
reset role;
-- Osoba usunięta nie widzi już grupy (RLS), więc jej próba nic nie zmienia — wraca przez owner/admin albo zaproszenie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e7');
set local role authenticated;
update public.group_members set deleted_at = null where member_id = 'e0e00000-0000-7000-8000-0000000000f7';
reset role;
select pg_temp.as_user('');
select ok((select deleted_at is not null from public.group_members where member_id = 'e0e00000-0000-7000-8000-0000000000f7'), '39: osoba usunięta sama się nie przywraca');

select * from finish();
rollback;
