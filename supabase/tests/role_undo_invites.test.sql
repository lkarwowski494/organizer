-- Audyt 3 (jak N-40): „Cofnij” po zmianie roli administratora na członka przywraca jego zaproszenia osobiste, które ta zmiana
-- unieważniła (migracja 20261010110100_role_undo_invites). Unieważnione wcześniej i kod profilu, który ma już nowszy kod,
-- nie wracają.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000012c1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000012c2', 'ala@x.test'),
  ('00000000-0000-7000-8000-0000000012c3', 'jan@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('ru.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('ru.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create temp table c (k text primary key, j jsonb);
grant all on c to authenticated;
create function pg_temp.revoked(k text) returns boolean language sql security definer as $$
  select revoked_at is not null from public.invites where id = ((select j from pg_temp.c where c.k = revoked.k) ->> 'invite_id')::uuid $$;
create function pg_temp.role(r text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'patch', 'entity', 'group_members', 'id', '12120000-0000-7000-8000-0000000000a2', 'set', jsonb_build_object('role', r)) $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Grupa: Ola (owner, a1), Ala (admin, a2), Jan (admin, a3), profile dzieci Tymek (a8) i Zosia (a9).
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
set local role authenticated;
select public.create_group('12120000-0000-7000-8000-000000000001', 'Dom', '12120000-0000-7000-8000-0000000000a1', 'Ola');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('12120000-0000-7000-8000-0000000000a2', '12120000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000012c2', 'Ala', 'admin'),
  ('12120000-0000-7000-8000-0000000000a3', '12120000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000012c3', 'Jan', 'admin'),
  ('12120000-0000-7000-8000-0000000000a8', '12120000-0000-7000-8000-000000000001', null, 'Tymek', 'child'),
  ('12120000-0000-7000-8000-0000000000a9', '12120000-0000-7000-8000-000000000001', null, 'Zosia', 'child');
-- Zaproszenia osobiste Ali: link, kody profili Tymka i Zosi, link odwołany wcześniej; Jan: link.
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c2');
set local role authenticated;
insert into c values ('ala_link', public.create_invite('12120000-0000-7000-8000-000000000001'));
insert into c values ('ala_old', public.create_invite('12120000-0000-7000-8000-000000000001'));
select public.revoke_invite((select (j ->> 'invite_id')::uuid from c where k = 'ala_old'));
insert into c values ('ala_tymek', public.create_child_code('12120000-0000-7000-8000-0000000000a8'));
insert into c values ('ala_zosia', public.create_child_code('12120000-0000-7000-8000-0000000000a9'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c3');
set local role authenticated;
insert into c values ('jan_link', public.create_invite('12120000-0000-7000-8000-000000000001'));
reset role;

-- ───────── Ola zmienia rolę Ali na członka i naciska „Cofnij” ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
select is(pg_temp.p('12c10000-0000-7000-8000-000000000001', pg_temp.role('member')), 'ok', '1: Ola zmienia rolę Ali na członka');
select ok(pg_temp.revoked('ala_link') and pg_temp.revoked('ala_tymek'), '2: zaproszenia osobiste Ali przestają działać (Q7 A, jak dotąd)');
-- W tym czasie Ola łączy Zosię nowym kodem (jeden działający kod profilu).
set local role authenticated;
insert into c values ('ola_zosia', public.create_child_code('12120000-0000-7000-8000-0000000000a9'));
reset role;
select is(pg_temp.p('12c10000-0000-7000-8000-000000000001', pg_temp.role('admin')), 'ok', '3: „Cofnij” — Ala znowu administratorem');
select ok(not pg_temp.revoked('ala_link'), '4: link Ali znowu działa');
select ok(not pg_temp.revoked('ala_tymek'), '5: kod profilu Tymka znowu działa');
select ok(pg_temp.revoked('ala_zosia'), '6: kod Zosi nie wraca — profil ma już nowszy kod');
select ok(not pg_temp.revoked('ola_zosia'), '7: nowszy kod Zosi działa');
select ok(pg_temp.revoked('ala_old'), '8: link odwołany wcześniej zostaje odwołany');
select ok(not pg_temp.revoked('jan_link'), '9: zaproszenia innych bez zmian');

-- Drugi raz: odwołany ręcznie w czasie zmiany link nie wraca.
select is(pg_temp.p('12c10000-0000-7000-8000-000000000001', pg_temp.role('member')), 'ok', '10: znowu członek');
select pg_temp.as_user('');
update public.invites set revoked_at = revoked_at + interval '1 second' where id = ((select j from c where k = 'ala_link') ->> 'invite_id')::uuid;
select pg_temp.as_user('00000000-0000-7000-8000-0000000012c1');
select is(pg_temp.p('12c10000-0000-7000-8000-000000000001', pg_temp.role('admin')), 'ok', '11: znowu administrator');
select ok(pg_temp.revoked('ala_link') and not pg_temp.revoked('ala_tymek'), '12: wraca tylko to, co unieważniła zmiana roli');

select * from finish();
rollback;
