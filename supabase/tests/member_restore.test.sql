-- Audyt 3 (N-40, N-87): „Cofnij” po „Usuń z grupy” i przywrócenie z kosza osób przywracają wszystko, co zabrało usunięcie
-- (migracja 20261010110000_member_restore): oczekujące przekazania, dostęp do list „Wybrane osoby”, zaproszenia osobiste
-- i zakres Moich spraw. Powrót zaproszeniem przywraca tylko rzeczy samej osoby (listy „Tylko ja”, zakres).
begin;
select plan(36);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000011c1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000011c2', 'ala@x.test'),
  ('00000000-0000-7000-8000-0000000011c3', 'jan@x.test'),
  ('00000000-0000-7000-8000-0000000011c4', 'ewa@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('mr.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('mr.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
grant execute on all functions in schema pg_temp to authenticated;
create function pg_temp.status(hid text) returns text language sql security definer as $$ select status from public.handoffs where id = hid::uuid $$;
create function pg_temp.member_del(mid text) returns timestamptz language sql security definer as $$ select deleted_at from public.group_members where member_id = mid::uuid $$;
create temp table c (k text primary key, j jsonb);
grant all on c to authenticated;
create function pg_temp.revoked(k text) returns timestamptz language sql security definer as $$
  select revoked_at from public.invites where id = ((select j from pg_temp.c where c.k = revoked.k) ->> 'invite_id')::uuid $$;
create function pg_temp.access(list text, mid text) returns timestamptz language sql security definer as $$
  select deleted_at from public.object_members where scope_id = list::uuid and member_id = mid::uuid $$;
create function pg_temp.scope(mid text) returns jsonb language sql security definer as $$
  select jsonb_build_object('scope', scope, 'deleted', deleted_at is not null, 'at', deleted_at) from public.my_day_scopes where member_id = mid::uuid $$;

-- Grupa: Ola (owner, a1), Ala (admin, a2), Jan (a3), Ewa (a4), profil dziecka Tymek (a9).
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c1');
set local role authenticated;
select public.create_group('11110000-0000-7000-8000-000000000001', 'Dom', '11110000-0000-7000-8000-0000000000a1', 'Ola');
insert into c values ('owner_link', public.create_invite('11110000-0000-7000-8000-000000000001'));
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000011c2', 'Ala', 'admin'),
  ('11110000-0000-7000-8000-0000000000a3', '11110000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000011c3', 'Jan', 'member'),
  ('11110000-0000-7000-8000-0000000000a4', '11110000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000011c4', 'Ewa', 'member'),
  ('11110000-0000-7000-8000-0000000000a9', '11110000-0000-7000-8000-000000000001', null, 'Tymek', 'child');
-- Listy: całej grupy (b1), „Wybrane osoby” z dostępem Ali, Jana i Ewy (b2), druga ograniczona, z której Alę wypisano wcześniej (b3).
insert into public.lists (id, group_id, kind, name, owner_member_id, visibility) values
  ('11110000-0000-7000-8000-0000000000b1', '11110000-0000-7000-8000-000000000001', 'tasks', 'Dom', '11110000-0000-7000-8000-0000000000a1', 'group'),
  ('11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-000000000001', 'tasks', 'Prezent', '11110000-0000-7000-8000-0000000000a1', 'restricted'),
  ('11110000-0000-7000-8000-0000000000b3', '11110000-0000-7000-8000-000000000001', 'tasks', 'Urodziny', '11110000-0000-7000-8000-0000000000a1', 'restricted');
insert into public.object_members (scope_entity, scope_id, member_id, group_id, deleted_at) values
  ('lists', '11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-000000000001', null),
  ('lists', '11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a3', '11110000-0000-7000-8000-000000000001', null),
  ('lists', '11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a4', '11110000-0000-7000-8000-000000000001', null),
  ('lists', '11110000-0000-7000-8000-0000000000b3', '11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-000000000001', now() - interval '1 day');
insert into public.tasks (id, group_id, list_id, title, assignee_member_id) values
  ('11110000-0000-7000-8000-0000000000d1', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b1', 'Pranie', '11110000-0000-7000-8000-0000000000a3'),
  ('11110000-0000-7000-8000-0000000000d2', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b1', 'Rachunki', '11110000-0000-7000-8000-0000000000a2'),
  ('11110000-0000-7000-8000-0000000000d3', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b1', 'Paczka', '11110000-0000-7000-8000-0000000000a2'),
  ('11110000-0000-7000-8000-0000000000d4', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b1', 'Odkurzanie', '11110000-0000-7000-8000-0000000000a3'),
  ('11110000-0000-7000-8000-0000000000d6', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b2', 'Kwiaty', '11110000-0000-7000-8000-0000000000a3'),
  ('11110000-0000-7000-8000-0000000000d7', '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000b1', 'Śmieci', '11110000-0000-7000-8000-0000000000a1');
insert into public.events (id, group_id, title, start_date, responsible_member_id) values
  ('11110000-0000-7000-8000-0000000000e1', '11110000-0000-7000-8000-000000000001', 'Basen', '2026-10-20', '11110000-0000-7000-8000-0000000000a2');
-- Przekazania: f1 Jan → Ala, f2 Ala → Jan, f3 Ala → Ewa (zadanie zmieni osobę w czasie usunięcia), f4 anulowane wcześniej,
-- f5 Jan → Ala na liście „Wybrane osoby”, f6 Ala → Jan (wydarzenie), f7 Ola → Ewa.
insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member, status, decided_at) values
  ('11110000-0000-7000-8000-0000000000f1', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d1', '11110000-0000-7000-8000-0000000000a3', '11110000-0000-7000-8000-0000000000a2', 'pending', null),
  ('11110000-0000-7000-8000-0000000000f2', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d2', '11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-0000000000a3', 'pending', null),
  ('11110000-0000-7000-8000-0000000000f3', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d3', '11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-0000000000a4', 'pending', null),
  ('11110000-0000-7000-8000-0000000000f4', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d4', '11110000-0000-7000-8000-0000000000a3', '11110000-0000-7000-8000-0000000000a2', 'cancelled', now() - interval '1 hour'),
  ('11110000-0000-7000-8000-0000000000f5', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d6', '11110000-0000-7000-8000-0000000000a3', '11110000-0000-7000-8000-0000000000a2', 'pending', null),
  ('11110000-0000-7000-8000-0000000000f6', '11110000-0000-7000-8000-000000000001', 'events', '11110000-0000-7000-8000-0000000000e1', '11110000-0000-7000-8000-0000000000a2', '11110000-0000-7000-8000-0000000000a3', 'pending', null),
  ('11110000-0000-7000-8000-0000000000f7', '11110000-0000-7000-8000-000000000001', 'tasks', '11110000-0000-7000-8000-0000000000d7', '11110000-0000-7000-8000-0000000000a1', '11110000-0000-7000-8000-0000000000a4', 'pending', null);
insert into public.my_day_scopes (id, group_id, member_id, scope) values
  (private.uuid_v5('2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9'::uuid, '11110000-0000-7000-8000-0000000000a2'), '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000a2', 'mine'),
  (private.uuid_v5('2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9'::uuid, '11110000-0000-7000-8000-0000000000a4'), '11110000-0000-7000-8000-000000000001', '11110000-0000-7000-8000-0000000000a4', 'mineAndEvents');
-- Zaproszenia osobiste Ali: link, kod profilu Tymka i link odwołany wcześniej.
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c2');
set local role authenticated;
insert into c values ('ala_link', public.create_invite('11110000-0000-7000-8000-000000000001'));
insert into c values ('ala_old', public.create_invite('11110000-0000-7000-8000-000000000001'));
select public.revoke_invite((select (j ->> 'invite_id')::uuid from c where k = 'ala_old'));
insert into c values ('ala_child', public.create_child_code('11110000-0000-7000-8000-0000000000a9'));
reset role;

-- ───────── Usunięcie Ali przez Olę ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c1');
select is(pg_temp.p('11c10000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a2"}'), 'ok', '1: Ola usuwa Alę');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f2'), 'cancelled', '2: przekazania Ali anulowane (jak dotąd)');
select is((select decided_at from public.handoffs where id = '11110000-0000-7000-8000-0000000000f2'), pg_temp.member_del('11110000-0000-7000-8000-0000000000a2'), '3: ze znacznikiem usunięcia');
select is(pg_temp.revoked('ala_link'), pg_temp.member_del('11110000-0000-7000-8000-0000000000a2'), '4: link Ali unieważniony ze znacznikiem usunięcia');
select is(pg_temp.access('11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a2'), pg_temp.member_del('11110000-0000-7000-8000-0000000000a2'), '5: dostęp do listy „Wybrane osoby” odebrany');
-- N-87: zakres nie znika bez śladu — nagrobek (telefon dostaje usunięcie, przywrócenie trafia w ten sam wiersz).
select is(pg_temp.scope('11110000-0000-7000-8000-0000000000a2') - 'at', '{"scope":"mine","deleted":true}'::jsonb, '6: zakres Moich spraw Ali w koszu, nie skasowany');
select is((pg_temp.scope('11110000-0000-7000-8000-0000000000a2') ->> 'at')::timestamptz, pg_temp.member_del('11110000-0000-7000-8000-0000000000a2'), '7: ze znacznikiem usunięcia');
-- W czasie usunięcia Ola daje paczkę (f3) Ewie.
select is(pg_temp.p('11c10000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"tasks","id":"11110000-0000-7000-8000-0000000000d3","set":{"assignee_member_id":"11110000-0000-7000-8000-0000000000a4"}}'), 'ok', '8: Ola zmienia osobę zadania z przekazania f3');

-- ───────── „Cofnij” ─────────
select is(pg_temp.p('11c10000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a2"}'), 'ok', '9: „Cofnij” przywraca Alę');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f1'), 'pending', '10: przekazanie do Ali znowu czeka');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f2'), 'pending', '11: przekazanie od Ali znowu czeka');
select is((select decided_at from public.handoffs where id = '11110000-0000-7000-8000-0000000000f2'), null, '12: bez daty decyzji');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f3'), 'cancelled', '13: zadanie ma już inną osobę — przekazanie zostaje anulowane');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f4'), 'cancelled', '14: anulowane przed usunięciem zostaje anulowane');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f5'), 'pending', '15: przekazanie na liście „Wybrane osoby” wraca (dostęp wrócił wcześniej)');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f6'), 'pending', '16: przekazanie wydarzenia wraca');
select is(pg_temp.access('11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a2'), null, '17: dostęp do listy „Wybrane osoby” wraca');
select isnt(pg_temp.access('11110000-0000-7000-8000-0000000000b3', '11110000-0000-7000-8000-0000000000a2'), null, '18: dostęp odebrany przed usunięciem nie wraca');
select is(pg_temp.revoked('ala_link'), null, '19: link Ali znowu działa');
select is(pg_temp.revoked('ala_child'), null, '20: kod profilu Tymka znowu działa');
select isnt(pg_temp.revoked('ala_old'), null, '21: link odwołany wcześniej zostaje odwołany');
select is(pg_temp.scope('11110000-0000-7000-8000-0000000000a2') - 'at', '{"scope":"mine","deleted":false}'::jsonb, '22: zakres Moich spraw wraca');

-- ───────── Drugie usunięcie: w tym czasie Jan wychodzi, a Ola łączy Tymka nowym kodem ─────────
select is(pg_temp.p('11c10000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a2"}'), 'ok', '23: Ola znowu usuwa Alę');
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c3');
select is(pg_temp.p('11c30000-0000-7000-8000-000000000003', '{"kind":"delete","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a3"}'), 'ok', '24: Jan sam wychodzi');
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c1');
set local role authenticated;
insert into c values ('owner_child', public.create_child_code('11110000-0000-7000-8000-0000000000a9'));
reset role;
select is(pg_temp.p('11c10000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a2"}'), 'ok', '25: „Cofnij”');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f1'), 'cancelled', '26: przekazanie od osoby, której już nie ma, nie wraca');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f6'), 'cancelled', '27: ani do niej');
select isnt(pg_temp.revoked('ala_child'), null, '28: kod Ali nie wraca, gdy profil ma już nowy kod');
select is((select count(*)::int from public.invites where member_id = '11110000-0000-7000-8000-0000000000a9' and revoked_at is null), 1, '29: jeden działający kod profilu');
select is(pg_temp.revoked('ala_link'), null, '30: link Ali wraca');

-- ───────── Powrót zaproszeniem (Ewa sama wyszła): wraca tylko to, co jej ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000011c4');
select is(pg_temp.p('11c40000-0000-7000-8000-000000000004', '{"kind":"delete","entity":"group_members","id":"11110000-0000-7000-8000-0000000000a4"}'), 'ok', '31: Ewa sama wychodzi');
set local role authenticated;
select is(public.accept_invite((select j ->> 'token' from c where k = 'owner_link')) ->> 'already_member', 'false', '32: Ewa wraca linkiem Oli');
reset role;
select is(pg_temp.scope('11110000-0000-7000-8000-0000000000a4') - 'at', '{"scope":"mineAndEvents","deleted":false}'::jsonb, '33: jej zakres Moich spraw wraca (jak listy „Tylko ja”)');
select isnt(pg_temp.access('11110000-0000-7000-8000-0000000000b2', '11110000-0000-7000-8000-0000000000a4'), null, '34: dostęp do listy „Wybrane osoby” nadaje ponownie właściciel listy');
select is(pg_temp.status('11110000-0000-7000-8000-0000000000f7'), 'cancelled', '35: przekazanie do niej nie wraca');

-- Usunięcie konta: zakres zostaje nagrobkiem (wcześniej twarde usunięcie).
select pg_temp.as_user('');
delete from auth.users where id = '00000000-0000-7000-8000-0000000011c4';
select is((pg_temp.scope('11110000-0000-7000-8000-0000000000a4') ->> 'deleted')::boolean, true, '36: po usunięciu konta zakres w koszu');

select * from finish();
rollback;
