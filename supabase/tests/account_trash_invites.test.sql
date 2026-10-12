-- Usunięcie konta, gdy grupa jest w koszu (audyt 3, N-14; migracja 20261010000000), od decyzji Q1 B (migracja
-- 20261010101000): tak samo jak przy grupie poza koszem (delete_account_data) przestają działać zaproszenia osobiste
-- usuniętej osoby, a kod roli grupy zostaje u następcy i po przywróceniu grupy wpuszcza. Pełny zestaw:
-- supabase/tests/account_deletion_invites.test.sql.
begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000014a1', 'a14@x.test'), ('00000000-0000-7000-8000-0000000014a2', 'b14@x.test'),
  ('00000000-0000-7000-8000-0000000014a3', 'c14@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
create function pg_temp.jid() returns text language sql security definer as $$
  select join_id from public.groups where id = '14140000-0000-7000-8000-000000000001' $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Grupa: Ala (owner, kod członka), Jan (admin, kod profilu dziecka Tymka).
select pg_temp.as_user('00000000-0000-7000-8000-0000000014a1');
set local role authenticated;
select public.create_group('14140000-0000-7000-8000-000000000001', 'Rodzina', '14140000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('14140000-0000-7000-8000-0000000000a2', '14140000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000014a2', 'Jan', 'admin');
select pg_temp.as_user('00000000-0000-7000-8000-0000000014a1');
set local role authenticated;
insert into pg_temp.c values ('ala', public.create_join_code('14140000-0000-7000-8000-000000000001'));
reset role;
select pg_temp.as_user('');
insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses, kind, code) values
  ('14140000-0000-7000-8000-000000000001', 'jan-hash', 'member', '14140000-0000-7000-8000-0000000000a2', now() + interval '1 day', 1, 'code', '999999');

-- Grupa w koszu, Ala usuwa konto.
update public.groups set deleted_at = now() - interval '1 day' where id = '14140000-0000-7000-8000-000000000001';
delete from auth.users where id = '00000000-0000-7000-8000-0000000014a1';

select is((select count(*)::int from public.invites where created_by = '14140000-0000-7000-8000-0000000000a1'), 0,
  '1: żadne zaproszenie nie wskazuje członkostwa usuniętego konta (także w grupie w koszu)');
select is((select created_by from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'ala')),
  '14140000-0000-7000-8000-0000000000a2'::uuid, '2: kod roli grupy przechodzi na następcę');
select ok((select revoked_at is null from public.invites where token_hash = 'jan-hash'), '3: kod innej osoby działa dalej');
select is((select role from public.group_members where member_id = '14140000-0000-7000-8000-0000000000a2'), 'owner', '4: grupę przejmuje Jan');

-- Jan przywraca grupę; Zosia próbuje dołączyć kodem Ali.
select pg_temp.as_user('00000000-0000-7000-8000-0000000014a2');
set local role authenticated;
select public.restore_group('14140000-0000-7000-8000-000000000001');
select pg_temp.as_user('00000000-0000-7000-8000-0000000014a3');
select is(public.join_group(pg_temp.jid(), (select v ->> 'code' from pg_temp.c where k = 'ala'), 'Zosia') ->> 'already_member', 'false',
  '5: po przywróceniu grupy kod roli wpuszcza (Q1 B)');
reset role;

select * from finish();
rollback;
