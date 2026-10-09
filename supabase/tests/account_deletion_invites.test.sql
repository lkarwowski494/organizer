-- Usunięcie konta a zaproszenia (audyt 3, PK-10, decyzja Q1 B koordynatora; migracja 20261010101000): jak przy odejściu
-- z grupy (Q7 A) przestają działać tylko zaproszenia osobiste usuniętej osoby (kody profili dzieci, dawne linki), a kod roli
-- grupy działa dalej dla innych. Żadne zaproszenie nie wskazuje już członkostwa usuniętej osoby — wystawiającym zostaje
-- właściciel grupy. Grupa bez następcy idzie do kosza, a jej kody przestają działać.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000101a1', 'ala@example.com'), ('00000000-0000-7000-8000-0000000101a2', 'jan@example.com'),
  ('00000000-0000-7000-8000-0000000101a3', 'ola@example.com'), ('00000000-0000-7000-8000-0000000101a4', 'zosia@example.com');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
create function pg_temp.inv(k text) returns public.invites language sql security definer as $$
  select * from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where c.k = inv.k) $$;
create function pg_temp.jid(g uuid) returns text language sql security definer as $$ select join_id from public.groups where id = g $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G (poza koszem): Ala owner, Jan admin, profil dziecka Tymek. H (w koszu): Jan owner, Ola member. S: tylko Jan i profil dziecka.
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a1');
set local role authenticated;
select public.create_group('10110000-0000-7000-8000-000000000001', 'Rodzina', '10110000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a2');
set local role authenticated;
select public.create_group('10110000-0000-7000-8000-000000000002', 'Działka', '10110000-0000-7000-8000-0000000000b2', 'Jan');
select public.create_group('10110000-0000-7000-8000-000000000003', 'Tylko my', '10110000-0000-7000-8000-0000000000c2', 'Jan');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('10110000-0000-7000-8000-0000000000a2', '10110000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000101a2', 'Jan', 'admin'),
  ('10110000-0000-7000-8000-0000000000a9', '10110000-0000-7000-8000-000000000001', null, 'Tymek', 'child'),
  ('10110000-0000-7000-8000-0000000000b3', '10110000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000101a3', 'Ola', 'member'),
  ('10110000-0000-7000-8000-0000000000c9', '10110000-0000-7000-8000-000000000003', null, 'Tymek', 'child');
-- Jan pierwszy naciska „Zaproś” (kod roli grupy), łączy profil Tymka i wystawia dawny link; w H i S — kody roli.
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a2');
set local role authenticated;
insert into pg_temp.c values ('role', public.create_join_code('10110000-0000-7000-8000-000000000001'));
insert into pg_temp.c values ('child', public.create_child_code('10110000-0000-7000-8000-0000000000a9'));
insert into pg_temp.c values ('link', jsonb_build_object('invite_id', public.create_invite('10110000-0000-7000-8000-000000000001') ->> 'invite_id'));
insert into pg_temp.c values ('h', public.create_join_code('10110000-0000-7000-8000-000000000002'));
insert into pg_temp.c values ('s', public.create_join_code('10110000-0000-7000-8000-000000000003'));
reset role;
select pg_temp.as_user('');
update public.groups set deleted_at = now() - interval '1 day' where id = '10110000-0000-7000-8000-000000000002';

-- Jan usuwa konto.
delete from auth.users where id = '00000000-0000-7000-8000-0000000101a2';

select ok((pg_temp.inv('role')).revoked_at is null, '1: kod roli grupy działa dalej');
select ok((pg_temp.inv('child')).revoked_at is not null, '2: kod profilu dziecka wystawiony przez usunięte konto nie działa');
select ok((pg_temp.inv('link')).revoked_at is not null, '3: dawny link usuniętego konta nie działa');
select is((pg_temp.inv('role')).created_by, '10110000-0000-7000-8000-0000000000a1'::uuid, '4: wystawiającym kodu roli zostaje właściciel grupy');
select is((select count(*)::int from public.invites where created_by in ('10110000-0000-7000-8000-0000000000a2', '10110000-0000-7000-8000-0000000000b2')), 0,
  '5: żadne zaproszenie grup z następcą nie wskazuje członkostwa usuniętego konta');
select is((pg_temp.inv('child')).created_by, '10110000-0000-7000-8000-0000000000a1'::uuid, '6: także unieważnione');
select ok((pg_temp.inv('h')).revoked_at is null, '7: grupa w koszu — kod roli zostaje (wróci z przywróceniem grupy)');
select is((pg_temp.inv('h')).created_by, '10110000-0000-7000-8000-0000000000b3'::uuid, '8: wystawiającym — następca, który przejął grupę');
select ok((select deleted_at is not null from public.groups where id = '10110000-0000-7000-8000-000000000003'), '9: grupa bez następcy w koszu');
select ok((pg_temp.inv('s')).revoked_at is not null, '10: jej kody nie działają');
select ok((select user_id is null and display_name = 'Usunięty użytkownik' from public.group_members where member_id = '10110000-0000-7000-8000-0000000000c2'),
  '11: wystawiający w grupie bez następcy to tylko podpis „Usunięty użytkownik”, bez konta');

-- Zosia dołącza do G kodem rozesłanym przez Jana.
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a4');
set local role authenticated;
select is(public.join_group(pg_temp.jid('10110000-0000-7000-8000-000000000001'), (select v ->> 'code' from pg_temp.c where k = 'role'), 'Zosia') ->> 'already_member', 'false',
  '12: inna osoba dołącza kodem roli po usunięciu konta, które go wystawiło');
reset role;
-- Ola przywraca H; kod roli wpuszcza.
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a3');
set local role authenticated;
select lives_ok($$ select public.restore_group('10110000-0000-7000-8000-000000000002') $$, '13: następca przywraca grupę');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000101a4');
set local role authenticated;
select is(public.join_group(pg_temp.jid('10110000-0000-7000-8000-000000000002'), (select v ->> 'code' from pg_temp.c where k = 'h'), 'Zosia') ->> 'already_member', 'false',
  '14: po przywróceniu kod roli wpuszcza');
reset role;

select * from finish();
rollback;
