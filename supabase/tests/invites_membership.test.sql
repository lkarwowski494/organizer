-- Zaproszenia i dołączanie po audycie 3 (migracja 20261010100000_invites_membership, paczka PK-10):
-- „Zaproś” po usunięciu osoby daje nowy kod (N-38), kod roli należy do grupy (N-39, decyzja Q7 A), „już jesteś w tej grupie”
-- z rolą (N-157) i przed ważnością kodu (N-158), sygnał grupie po dołączeniu, przekazaniu własności i sprzątaniu (N-90).
begin;
select plan(44);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000010e1', 'ala@example.com'),
  ('00000000-0000-7000-8000-0000000010e2', 'jan@example.com'),
  ('00000000-0000-7000-8000-0000000010e3', 'ola@example.com'),
  ('00000000-0000-7000-8000-0000000010e4', 'babcia@example.com'),
  ('00000000-0000-7000-8000-0000000010e5', 'piotr@example.com'),
  ('00000000-0000-7000-8000-0000000010e6', 'ewa@example.com');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
create function pg_temp.code(k text) returns text language sql as $$ select v ->> 'code' from pg_temp.c where c.k = code.k $$;
create function pg_temp.inv(k text) returns uuid language sql as $$ select (v ->> 'invite_id')::uuid from pg_temp.c where c.k = inv.k $$;
create function pg_temp.jid() returns text language sql security definer as $$ select join_id from public.groups where id = '10100000-0000-7000-8000-000000000001' $$;
create function pg_temp.revoked(k text) returns boolean language sql security definer as $$
  select revoked_at is not null from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where c.k = revoked.k)
$$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('pk10.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('pk10.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
-- Sygnały grupy G w realtime.messages (bez treści spraw, tylko numer wersji).
create function pg_temp.pokes() returns int language sql security definer as $$
  select count(*)::int from realtime.messages where topic = 'group:10100000-0000-7000-8000-000000000001' and event = 'poke'
$$;
-- Wersja z sygnału wysłanego od ostatniego pg_temp.mark_pokes(). Nie „ostatni wg id”: w Supabase realtime.messages.id
-- to losowy UUID (klucz (id, inserted_at), migracja MessagesUsingUuid serwera Realtime:
-- https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/repo/migrations/20241108114728_messages_using_uuid.ex),
-- a inserted_at = now() jest jedno na całą transakcję testu, więc kolejności wiadomości nie da się odczytać.
-- Podzapytanie skalarne rzuca błąd, gdy nowych sygnałów jest więcej niż jeden.
create table pg_temp.seen_pokes (id text primary key);
create function pg_temp.mark_pokes() returns void language sql security definer as $$
  delete from pg_temp.seen_pokes;
  insert into pg_temp.seen_pokes select id::text from realtime.messages where topic = 'group:10100000-0000-7000-8000-000000000001';
$$;
create function pg_temp.new_poke_v() returns bigint language sql security definer as $$
  select (select (payload ->> 'v')::bigint from realtime.messages
          where topic = 'group:10100000-0000-7000-8000-000000000001' and event = 'poke'
            and id::text not in (select id from pg_temp.seen_pokes))
$$;
create function pg_temp.gv() returns bigint language sql security definer as $$ select version from public.groups where id = '10100000-0000-7000-8000-000000000001' $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: Ala owner (a1), Jan admin (a2), Ola member (a3), Piotr admin (a5); profil dziecka Tymek (b1) i Zosia (b2).
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
select public.create_group('10100000-0000-7000-8000-000000000001', 'Rodzina', '10100000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('10100000-0000-7000-8000-0000000000a2', '10100000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000010e2', 'Jan', 'admin'),
  ('10100000-0000-7000-8000-0000000000a3', '10100000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000010e3', 'Ola', 'member'),
  ('10100000-0000-7000-8000-0000000000a5', '10100000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000010e5', 'Piotr', 'admin'),
  ('10100000-0000-7000-8000-0000000000b1', '10100000-0000-7000-8000-000000000001', null, 'Tymek', 'child'),
  ('10100000-0000-7000-8000-0000000000b2', '10100000-0000-7000-8000-000000000001', null, 'Zosia', 'child');

-- ───────── N-39 (Q7 A): kod roli należy do grupy ─────────
-- Piotr (admin) pierwszy naciska „Zaproś”; Ala dostaje ten sam kod i rozsyła go babci. Jan też go widzi, łączy profil
-- Tymka i wystawia dawny link z tokenem.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e5');
set local role authenticated;
insert into pg_temp.c values ('role', public.create_join_code('10100000-0000-7000-8000-000000000001'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
select is(public.create_join_code('10100000-0000-7000-8000-000000000001') ->> 'code', pg_temp.code('role'), '1: owner widzi kod wystawiony przez admina (wspólny dla grupy)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e2');
set local role authenticated;
insert into pg_temp.c values ('jan_child', public.create_child_code('10100000-0000-7000-8000-0000000000b1'));
insert into pg_temp.c values ('jan_link', jsonb_build_object('invite_id', public.create_invite('10100000-0000-7000-8000-000000000001') ->> 'invite_id'));
reset role;
-- Ala odbiera Janowi rolę administratora: jego zaproszenia osobiste przestają działać, kod roli zostaje.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
select is(pg_temp.p('10c10000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"group_members","id":"10100000-0000-7000-8000-0000000000a2","set":{"role":"member"}}'), 'ok', '2: owner zmienia rolę admina na członka');
select ok(pg_temp.revoked('jan_child'), '3: kod profilu dziecka wystawiony przez byłego admina nie działa');
select ok(pg_temp.revoked('jan_link'), '4: jego dawny link też');
select ok(not pg_temp.revoked('role'), '5: kod roli grupy działa dalej');
-- Zmiana roli bez utraty uprawnień (member → admin) nic nie unieważnia.
select is(pg_temp.p('10c10000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"group_members","id":"10100000-0000-7000-8000-0000000000a2","set":{"role":"admin"}}'), 'ok', '6: z powrotem admin');
select ok(not pg_temp.revoked('role'), '7: kod roli bez zmian');
-- Jan znowu łączy profil Tymka (nowy kod) i sam wychodzi z grupy.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e2');
set local role authenticated;
insert into pg_temp.c values ('jan_child2', public.create_child_code('10100000-0000-7000-8000-0000000000b1'));
reset role;
select ok(not pg_temp.revoked('jan_child2'), '8: nowy kod profilu działa');
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e2');
select is(pg_temp.p('10c10000-0000-7000-8000-000000000002', '{"kind":"delete","entity":"group_members","id":"10100000-0000-7000-8000-0000000000a2"}'), 'ok', '9: admin sam wychodzi z grupy');
select ok(pg_temp.revoked('jan_child2'), '10: po wyjściu jego kod profilu dziecka nie działa');
select ok(not pg_temp.revoked('role'), '11: kod roli grupy działa dalej');
-- Piotr (admin) łączy profil Zosi, Ala usuwa Piotra: kod roli rozesłany przez Alę zostaje, kod Zosi — nie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e5');
set local role authenticated;
insert into pg_temp.c values ('piotr_child', public.create_child_code('10100000-0000-7000-8000-0000000000b2'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
select is(pg_temp.p('10c10000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"10100000-0000-7000-8000-0000000000a5"}'), 'ok', '12: owner usuwa admina');
select ok(pg_temp.revoked('piotr_child'), '13: kod profilu dziecka usuniętego admina nie działa');
select ok(not pg_temp.revoked('role'), '14: kod roli, który właściciel rozesłał, działa dalej');
-- Babcia dołącza kodem rozesłanym przed usunięciem admina (wcześniej: invite_revoked).
update public.invites set created_at = created_at - interval '2 minutes' where id = pg_temp.inv('role');
-- Usunięcie minutę temu (wyzwalacze pominięte: strażnik nie pozwala zmienić removed_at).
set local session_replication_role = replica;
update public.group_members set removed_at = removed_at - interval '1 minute', deleted_at = deleted_at - interval '1 minute'
  where member_id = '10100000-0000-7000-8000-0000000000a5';
set local session_replication_role = origin;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e4');
set local role authenticated;
create temp table v0 as select pg_temp.pokes() n;
select pg_temp.mark_pokes();
select is(public.join_group(pg_temp.jid(), pg_temp.code('role'), 'Babcia') ->> 'already_member', 'false', '15: babcia dołącza kodem właściciela');
reset role;

-- ───────── N-90: sygnał grupie po dołączeniu ─────────
select is(pg_temp.pokes(), (select n from v0) + 1, '16: dołączenie wysyła sygnał grupie');
select is(pg_temp.new_poke_v(), pg_temp.gv(), '17: z bieżącą wersją grupy');

-- ───────── N-38: „Zaproś” po usunięciu osoby ─────────
-- Piotr usunięty minutę temu, kod roli sprzed dwóch minut: „Zaproś” daje nowy kod, stary działa dalej dla innych.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
insert into pg_temp.c values ('after', public.create_join_code('10100000-0000-7000-8000-000000000001'));
select isnt(pg_temp.code('after'), pg_temp.code('role'), '18: „Zaproś” po usunięciu osoby daje nowy kod');
select is(public.create_join_code('10100000-0000-7000-8000-000000000001') ->> 'code', pg_temp.code('after'), '19: kolejne „Zaproś” — ten sam nowy kod');
reset role;
select ok(not pg_temp.revoked('role'), '20: kod sprzed usunięcia nadal działa dla innych');
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e5');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('role'), 'Piotr') ->> 'error', 'invite_removed', '21: usunięty nie wraca starym kodem');
select is(public.join_group(pg_temp.jid(), pg_temp.code('after'), 'Piotr') ->> 'already_member', 'false', '22: wraca kodem z „Zaproś”');
reset role;
select is((select deleted_at from public.group_members where member_id = '10100000-0000-7000-8000-0000000000a5'), null, '23: Piotr z powrotem (ten sam member_id)');
-- „Nowy kod” nadal unieważnia wszystkie kody tej roli.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
insert into pg_temp.c values ('renew', public.renew_join_code('10100000-0000-7000-8000-000000000001'));
reset role;
select ok(pg_temp.revoked('role') and pg_temp.revoked('after'), '24: „Nowy kod” unieważnia oba poprzednie');
select is((select count(*)::int from public.invites where group_id = '10100000-0000-7000-8000-000000000001' and kind = 'code' and role = 'member' and revoked_at is null), 1, '25: jeden aktywny kod członka');

-- ───────── N-157 i N-158: już jestem w grupie ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
insert into pg_temp.c values ('adm', public.create_join_code('10100000-0000-7000-8000-000000000001', 'admin'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e3');
set local role authenticated;
create temp table r1 as select public.join_group(pg_temp.jid(), pg_temp.code('adm'), 'Ola') r;
select is((select r ->> 'already_member' from r1), 'true', '26: członek z kodem administratora — już w grupie');
select is((select array[r ->> 'role', r ->> 'invite_role'] from r1), array['member', 'admin'], '27: odpowiedź podaje moją rolę i rolę kodu');
reset role;
select is((select role from public.group_members where member_id = '10100000-0000-7000-8000-0000000000a3'), 'member', '28: rola bez zmian');
select is((select uses from public.invites where id = pg_temp.inv('adm')), 0, '29: kod nie zużyty');
-- Stary (unieważniony) i wygasły kod własnej grupy: „już w grupie”, bez nieudanej próby.
update public.invites set expires_at = now() - interval '1 second' where id = pg_temp.inv('adm');
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e3');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('role'), 'Ola') ->> 'already_member', 'true', '30: unieważniony kod własnej grupy — już w grupie');
select is(public.join_group(pg_temp.jid(), pg_temp.code('adm'), 'Ola') ->> 'already_member', 'true', '31: wygasły też');
reset role;
select is((select count(*)::int from private.join_attempts where user_id = '00000000-0000-7000-8000-0000000010e3'), 0, '32: bez nieudanych prób z limitu');
-- Obcy z tym samym starym kodem: błąd jak dotąd (nie zdradzamy nic więcej).
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e6');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('role'), 'Ewa') ->> 'error', 'invite_revoked', '33: obcy ze starym kodem — invite_revoked');
select is(public.join_group(pg_temp.jid(), pg_temp.code('adm'), 'Ewa') ->> 'error', 'invite_expired', '34: z wygasłym — invite_expired');
reset role;
-- Kod profilu dziecka wpisany przez aktywnego członka (rodzic na swoim telefonie): jak dotąd invite_child_account.
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
insert into pg_temp.c values ('tymek', public.create_child_code('10100000-0000-7000-8000-0000000000b1'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e3');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('tymek'), 'Ola') ->> 'error', 'invite_child_account', '35: kod profilu dziecka u członka — invite_child_account');
reset role;
-- Połączenie profilu dziecka z kontem wysyła sygnał grupie i zostawia imię profilu, gdy telefon nie podał imienia (N-164).
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e6');
set local role authenticated;
delete from v0;
insert into v0 select pg_temp.pokes();
create temp table r2 as select public.join_group(pg_temp.jid(), pg_temp.code('tymek'), null) r;
select is((select array[r ->> 'already_member', r ->> 'role', r ->> 'invite_role'] from r2), array['false', 'child', 'child'], '36: konto dziecka łączy się z profilem');
reset role;
select is((select display_name from public.group_members where member_id = '10100000-0000-7000-8000-0000000000b1'), 'Tymek', '37: bez imienia z telefonu zostaje imię nadane przez rodzica');
select is(pg_temp.pokes(), (select n from v0) + 1, '38: połączenie profilu wysyła sygnał grupie');

-- ───────── N-90: przekazanie własności ─────────
delete from v0;
insert into v0 select pg_temp.pokes();
select pg_temp.mark_pokes();
select pg_temp.as_user('00000000-0000-7000-8000-0000000010e1');
set local role authenticated;
select lives_ok($$ select public.transfer_ownership('10100000-0000-7000-8000-000000000001', '10100000-0000-7000-8000-0000000000a3') $$, '39: owner przekazuje własność');
reset role;
select is(pg_temp.pokes(), (select n from v0) + 1, '40: przekazanie własności wysyła sygnał grupie');
select is(pg_temp.new_poke_v(), pg_temp.gv(), '41: z wersją po zmianie ról');
select ok(not pg_temp.revoked('renew'), '42: owner → admin przy przekazaniu nie unieważnia kodów');

-- ───────── N-90: nocne sprzątanie ─────────
-- Rozstrzygnięte przekazanie sprzed handoff_days(): sprzątanie usuwa je i podbija epokę (purged_version) — sygnał.
select pg_temp.as_user('');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('10100000-0000-7000-8000-0000000000e1', '10100000-0000-7000-8000-000000000001', 'tasks', 'Dom', '10100000-0000-7000-8000-0000000000a1');
insert into public.tasks (id, group_id, list_id, title) values
  ('10100000-0000-7000-8000-0000000000d1', '10100000-0000-7000-8000-000000000001', '10100000-0000-7000-8000-0000000000e1', 'Rachunek');
insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member, status, decided_at) values
  ('10100000-0000-7000-8000-0000000000f1', '10100000-0000-7000-8000-000000000001', 'tasks', '10100000-0000-7000-8000-0000000000d1',
   '10100000-0000-7000-8000-0000000000a1', '10100000-0000-7000-8000-0000000000a3', 'declined', now() - interval '100 days');
delete from v0;
insert into v0 select pg_temp.pokes();
select private.purge_group('10100000-0000-7000-8000-000000000001');
select is(pg_temp.pokes(), (select n from v0) + 1, '43: sprzątanie, które zmieniło grupę, wysyła sygnał');
-- Drugie sprzątanie bez niczego do usunięcia: bez sygnału.
delete from v0;
insert into v0 select pg_temp.pokes();
select private.purge_group('10100000-0000-7000-8000-000000000001');
select is(pg_temp.pokes(), (select n from v0), '44: sprzątanie bez zmian — bez sygnału');

select * from finish();
rollback;
