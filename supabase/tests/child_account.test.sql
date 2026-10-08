-- Dziecko z własnym kontem (migracja 20261008440000_child_account, decyzja właściciela z 8.10.2026: PW-14 B, D155):
-- kod przypięty do profilu dziecka i połączenie konta z tym profilem, a potem zasady dziecka z kontem — każda po stronie
-- serwera: tylko odhacza, bez list, zakupów i przekazań, obecność tylko za siebie, nie wychodzi samo, rolę zmienia owner.
begin;
select plan(53);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000c1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000c2', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000c3', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000c4', 'kuba@x.test'),
  ('00000000-0000-7000-8000-0000000000c5', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create table pg_temp.c (k text primary key, v jsonb);
grant all on pg_temp.c to authenticated;
create function pg_temp.code(k text) returns text language sql as $$ select v ->> 'code' from pg_temp.c where c.k = code.k $$;
create function pg_temp.jid() returns text language sql security definer as $$ select join_id from public.groups where id = 'c0c00000-0000-7000-8000-000000000001' $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: C1 owner (a1), C2 admin (a2), C3 member (a3); profile dzieci bez konta: Kuba (b1), Zosia (b2), Ola (b3).
-- Lista „Dom” z zadaniem Kuby i lista zakupów z terminem; wydarzenie z Kubą jako uczestnikiem.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select public.create_group('c0c00000-0000-7000-8000-000000000001', 'Rodzina', 'c0c00000-0000-7000-8000-0000000000a1', 'Ola');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('c0c00000-0000-7000-8000-0000000000a2', 'c0c00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c2', 'Adam', 'admin'),
  ('c0c00000-0000-7000-8000-0000000000a3', 'c0c00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c3', 'Marta', 'member'),
  ('c0c00000-0000-7000-8000-0000000000b1', 'c0c00000-0000-7000-8000-000000000001', null, 'Kuba', 'child'),
  ('c0c00000-0000-7000-8000-0000000000b2', 'c0c00000-0000-7000-8000-000000000001', null, 'Zosia', 'child'),
  ('c0c00000-0000-7000-8000-0000000000b3', 'c0c00000-0000-7000-8000-000000000001', null, 'Ola', 'child');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('c0c00000-0000-7000-8000-0000000000e1', 'c0c00000-0000-7000-8000-000000000001', 'tasks', 'Dom', 'c0c00000-0000-7000-8000-0000000000a1');
insert into public.lists (id, group_id, kind, name, owner_member_id, due_date) values
  ('c0c00000-0000-7000-8000-0000000000e2', 'c0c00000-0000-7000-8000-000000000001', 'shopping', 'Zakupy', 'c0c00000-0000-7000-8000-0000000000a1', '2026-10-10');
insert into public.tasks (id, group_id, list_id, title, assignee_member_id) values
  ('c0c00000-0000-7000-8000-0000000000d1', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Posprzątać pokój', 'c0c00000-0000-7000-8000-0000000000b1'),
  ('c0c00000-0000-7000-8000-0000000000d2', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Rachunek', 'c0c00000-0000-7000-8000-0000000000a3'),
  ('c0c00000-0000-7000-8000-0000000000d3', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Przedszkole', null),
  ('c0c00000-0000-7000-8000-0000000000d6', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e2', 'Chleb', null),
  ('c0c00000-0000-7000-8000-0000000000d7', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e2', 'Sok', 'c0c00000-0000-7000-8000-0000000000b1');
insert into public.tasks (id, group_id, list_id, title, parent_id, depth) values
  ('c0c00000-0000-7000-8000-0000000000d4', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Odkurzyć', 'c0c00000-0000-7000-8000-0000000000d1', 1);
insert into public.events (id, group_id, title, start_date, start_time, audience) values
  ('c0c00000-0000-7000-8000-0000000001e1', 'c0c00000-0000-7000-8000-000000000001', 'Basen', '2026-10-12', '17:00', 'members');
insert into public.event_participants (id, event_id, group_id, member_id) values
  (gen_random_uuid(), 'c0c00000-0000-7000-8000-0000000001e1', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000b1');
insert into public.tasks (id, group_id, list_id, title, event_id, occurrence_date, deadline_mode) values
  ('c0c00000-0000-7000-8000-0000000000d5', 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Ręcznik', 'c0c00000-0000-7000-8000-0000000001e1', '2026-10-12', 'event');

-- ───────── 1–10: kod przypięty do profilu dziecka ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c3');
set local role authenticated;
select throws_ok($$ select public.create_child_code('c0c00000-0000-7000-8000-0000000000b1') $$, 'P0001', 'forbidden', '1: członek nie łączy profilu z kontem');
select throws_ok($$ select public.renew_child_code('c0c00000-0000-7000-8000-0000000000b1') $$, 'P0001', 'forbidden', '2: ani nie tworzy nowego kodu');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c5');
set local role authenticated;
select throws_ok($$ select public.create_child_code('c0c00000-0000-7000-8000-0000000000b1') $$, 'P0001', 'forbidden', '3: obcy też nie');
select throws_ok($$ select public.create_child_code(gen_random_uuid()) $$, 'P0001', 'forbidden', '4: nieznany profil — ten sam błąd');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
set local role authenticated;
insert into pg_temp.c values ('k1', public.create_child_code('c0c00000-0000-7000-8000-0000000000b1'));
select is((select v ->> 'join_id' from pg_temp.c where k = 'k1'), pg_temp.jid(), '5: admin dostaje ID grupy i kod profilu');
select is((select (v ->> 'max_uses')::int from pg_temp.c where k = 'k1'), 1, '6: kod działa raz');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select is(public.create_child_code('c0c00000-0000-7000-8000-0000000000b1') ->> 'code', pg_temp.code('k1'), '7: owner widzi ten sam ważny kod (jeden aktywny na profil)');
select public.create_join_code('c0c00000-0000-7000-8000-000000000001') is not null;
insert into pg_temp.c values ('k2', public.renew_child_code('c0c00000-0000-7000-8000-0000000000b1'));
reset role;
select is((select count(*)::int from public.invites where member_id = 'c0c00000-0000-7000-8000-0000000000b1' and revoked_at is null), 1, '8: „Nowy kod” unieważnia poprzedni');
select is((select count(*)::int from public.invites where group_id = 'c0c00000-0000-7000-8000-000000000001' and member_id is null and revoked_at is null), 1, '9: zwykłego kodu członka nie rusza (osobny licznik)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select throws_ok($$ select public.create_child_code('c0c00000-0000-7000-8000-0000000000a3') $$, 'P0001', 'invalid_member', '10: dorosłego z kontem nie łączymy');
update public.group_members set deleted_at = now() where member_id = 'c0c00000-0000-7000-8000-0000000000b3';
select throws_ok($$ select public.create_child_code('c0c00000-0000-7000-8000-0000000000b3') $$, 'P0001', 'invalid_member', '11: ani usuniętego profilu');
reset role;
select throws_ok($$ insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses) values ('c0c00000-0000-7000-8000-000000000001', '\x00', 'child', 'c0c00000-0000-7000-8000-0000000000a1', now() + interval '1 hour', 1) $$,
  '23514', null, '12: zwykłe zaproszenie nie ma roli dziecko (tylko kod profilu)');

-- ───────── 13–24: połączenie konta z profilem ─────────
-- Rodzic wpisuje kod dziecka na swoim telefonie: błąd z wyjaśnieniem, kod się nie zużywa.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c3');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('k2'), 'Marta') ->> 'error', 'invite_child_account', '13: konto z grupy nie łączy się z profilem');
select is(public.join_group(pg_temp.jid(), pg_temp.code('k1'), 'Marta') ->> 'error', 'invite_revoked', '14: poprzedni kod profilu nie działa');
reset role;
select is((select uses from public.invites where id = (select (v ->> 'invite_id')::uuid from pg_temp.c where k = 'k2')), 0, '15: kod nie zużyty');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c4');
set local role authenticated;
insert into pg_temp.c values ('j', public.join_group(pg_temp.jid(), pg_temp.code('k2'), 'Kuba K.'));
select is((select v ->> 'member_id' from pg_temp.c where k = 'j'), 'c0c00000-0000-7000-8000-0000000000b1', '16: konto dziecka to ten sam member_id co profil');
select is(private.my_role('c0c00000-0000-7000-8000-000000000001'), 'child', '17: z rolą dziecko');
select is((select display_name from public.group_members where member_id = 'c0c00000-0000-7000-8000-0000000000b1'), 'Kuba K.', '18: imię wpisane przy dołączaniu (jak przy powrocie, R-25)');
select is((select count(*)::int from public.tasks where assignee_member_id = 'c0c00000-0000-7000-8000-0000000000b1'), 2, '19: zadania profilu zostają i są widoczne dziecku');
select is((select count(*)::int from public.event_participants where member_id = 'c0c00000-0000-7000-8000-0000000000b1'), 1, '20: udział w wydarzeniach też');
select is((select count(*)::int from public.group_members where group_id = 'c0c00000-0000-7000-8000-000000000001' and deleted_at is null), 5, '21: bez nowego wiersza członka');
reset role;
select is((select kind from private.access_events where user_id = '00000000-0000-7000-8000-0000000000c4' and group_id = 'c0c00000-0000-7000-8000-000000000001'), 'group_granted', '22: telefon dziecka dostaje sygnał dostępu');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c5');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('k2'), 'X') ->> 'error', 'invite_used_up', '23: drugi raz kod nie działa');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select throws_ok($$ select public.create_child_code('c0c00000-0000-7000-8000-0000000000b1') $$, 'P0001', 'invalid_member', '24: profil połączony — nowego kodu nie ma');

-- ───────── 25–28: kod profilu, który zniknął albo należał do kogoś innego ─────────
insert into pg_temp.c values ('z', public.create_child_code('c0c00000-0000-7000-8000-0000000000b2'));
update public.group_members set deleted_at = now() where member_id = 'c0c00000-0000-7000-8000-0000000000b2';
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c5');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('z'), 'X') ->> 'error', 'invite_revoked', '25: profil usunięty — kod nie działa');
select is((select count(*)::int from public.group_members where group_id = 'c0c00000-0000-7000-8000-000000000001'), 0, '26: i nic nie dołączył');
select throws_ok($$ update public.group_members set user_id = '00000000-0000-7000-8000-0000000000c5' where member_id = 'c0c00000-0000-7000-8000-0000000000b2' $$, '42501', null, '27: konta nie przypnie się bez kodu (brak uprawnień)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select throws_ok($$ update public.group_members set user_id = null where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, '42501', null, '28: ani nie odepnie');

-- ───────── 29–35: role i wyjście z grupy ─────────
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c4');
set local role authenticated;
select throws_ok($$ update public.group_members set deleted_at = now() where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, 'P0001', 'forbidden:child', '29: dziecko nie wychodzi samo z grupy');
select lives_ok($$ update public.group_members set color = '#00ff00' where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, '30: swój kolor zmienia');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
set local role authenticated;
select throws_ok($$ update public.group_members set role = 'member' where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, 'P0001', 'forbidden:role', '31: admin nie zmienia roli dziecka');
select throws_ok($$ update public.group_members set role = 'child' where member_id = 'c0c00000-0000-7000-8000-0000000000a3' $$, 'P0001', 'forbidden:role', '32: ani dorosłego (R-14)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select lives_ok($$ update public.group_members set role = 'member' where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, '33: owner zmienia dziecko z kontem w członka');
select lives_ok($$ update public.group_members set role = 'child' where member_id = 'c0c00000-0000-7000-8000-0000000000b1' $$, '34: i z powrotem');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
set local role authenticated;
select lives_ok($$ update public.group_members set deleted_at = now() where member_id = 'c0c00000-0000-7000-8000-0000000000a3' $$, '35: admin nadal usuwa członka');
select lives_ok($$ update public.group_members set deleted_at = null where member_id = 'c0c00000-0000-7000-8000-0000000000a3' $$, '36: i przywraca (D165)');

-- ───────── 37–44: dziecko z kontem tylko odhacza i odpowiada za siebie ─────────
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c4');
set local role authenticated;
select lives_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d1' $$, '37: dziecko odhacza swoje zadanie');
select throws_ok($$ update public.tasks set title = 'X' where id = 'c0c00000-0000-7000-8000-0000000000d1' $$, 'P0001', 'forbidden:child', '38: nie edytuje');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), 'c0c00000-0000-7000-8000-000000000001', 'c0c00000-0000-7000-8000-0000000000e1', 'Nowe') $$, 'P0001', 'forbidden:child', '39: nie dodaje zadań');
select throws_ok($$ insert into public.lists (id, group_id, kind, name) values (gen_random_uuid(), 'c0c00000-0000-7000-8000-000000000001', 'tasks', 'Moja') $$, 'P0001', 'forbidden:child', '40: nie zakłada list w grupie (R-12, P-71)');
select throws_ok($$ update public.lists set due_date = null where id = 'c0c00000-0000-7000-8000-0000000000e2' $$, 'P0001', 'forbidden:child', '41: nie kończy zakupów (R-11)');
select throws_ok($$ insert into public.handoffs (id, group_id, entity, entity_id, to_member) values (gen_random_uuid(), 'c0c00000-0000-7000-8000-000000000001', 'tasks', 'c0c00000-0000-7000-8000-0000000000d1', 'c0c00000-0000-7000-8000-0000000000a1') $$, 'P0001', 'forbidden:child', '42: nie przekazuje');
select is(pg_temp.push('c0c00000-0000-7000-8000-00000000c0c4', 1, '{"kind":"create","entity":"event_rsvps","id":"c0c00000-0000-7000-8000-000000000701","group_id":"c0c00000-0000-7000-8000-000000000001","set":{"event_id":"c0c00000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","member_id":"c0c00000-0000-7000-8000-0000000000b1","answer":"yes"}}'),
  'ok', '43: obecność za siebie');
select is(pg_temp.push('c0c00000-0000-7000-8000-00000000c0c4', 2, '{"kind":"create","entity":"event_rsvps","id":"c0c00000-0000-7000-8000-000000000702","group_id":"c0c00000-0000-7000-8000-000000000001","set":{"event_id":"c0c00000-0000-7000-8000-0000000001e1","occurrence_date":"2026-10-12","member_id":"c0c00000-0000-7000-8000-0000000000a1","answer":"no"}}'),
  'forbidden:not_self', '44: nie za innych');

-- ───────── 47–53: dziecko odhacza tylko swoje sprawy (migracja 20261008441000) ─────────
select throws_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d2' $$, 'P0001', 'forbidden:not_own', '47: nie odhacza zadania dorosłego');
select throws_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d3' $$, 'P0001', 'forbidden:not_own', '48: ani nieprzypisanego zadania rodziców (P-70)');
select lives_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d4' $$, '49: podzadanie swojego zadania — tak');
select lives_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d5' $$, '50: zadanie przy swoim wydarzeniu — tak');
select throws_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d6' $$, 'P0001', 'forbidden:not_own', '51: pozycja zakupów, za które odpowiada dorosły — nie');
select lives_ok($$ update public.tasks set completed_at = now() where id = 'c0c00000-0000-7000-8000-0000000000d7' $$, '52: pozycja przypisana do dziecka — tak');
select lives_ok($$ update public.tasks set completed_at = null where id = 'c0c00000-0000-7000-8000-0000000000d1' $$, '53: cofnięcie odhaczenia swojego — tak');

-- ───────── 45–46: powrót i usunięcie konta ─────────
-- Konto, które już jest (było) w grupie, nie połączy się z innym profilem.
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
insert into public.group_members (member_id, group_id, display_name, role) values ('c0c00000-0000-7000-8000-0000000000b4', 'c0c00000-0000-7000-8000-000000000001', 'Ewa', 'child');
insert into pg_temp.c values ('e', public.create_child_code('c0c00000-0000-7000-8000-0000000000b4'));
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c4');
set local role authenticated;
select is(public.join_group(pg_temp.jid(), pg_temp.code('e'), 'Kuba') ->> 'error', 'invite_child_account', '45: dziecko z kontem nie przejmie drugiego profilu');
-- Usunięcie konta dziecka (wymóg App Store) działa mimo zakazu wyjścia: robi je serwer.
reset role;
select pg_temp.as_user('');
delete from auth.users where id = '00000000-0000-7000-8000-0000000000c4';
select is((select deleted_at is not null and user_id is null from public.group_members where member_id = 'c0c00000-0000-7000-8000-0000000000b1'), true, '46: usunięcie konta dziecka zdejmuje je z grupy');

select * from finish();
rollback;
