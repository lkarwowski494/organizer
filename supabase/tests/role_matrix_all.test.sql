-- Pełna macierz ról (audyt 2, M-154 / Q-12): każda tabela public z RLS × 5 ról (owner, admin, member, child z kontem,
-- obcy) × 4 operacje (odczyt, wstawienie, zmiana, usunięcie). Tabela oczekiwań pg_temp.want; każda komórka wykonuje się
-- jako dana osoba w osobnej podtransakcji wycofywanej po pomiarze, więc wszystkie działają na tych samych danych.
-- Encje synchronizacji (private.sync_entities) zapisujemy jak telefon — przez sync_push (create / patch / delete);
-- pozostałe tabele — wprost w SQL (aplikacja ich tak nie zmienia, więc oczekiwany wynik to brak uprawnień albo 0 wierszy).
-- Wynik: 'visible' / 'hidden' (odczyt), 'ok', '0 rows' (RLS bez błędu) albo kod odrzucenia / SQLSTATE.
-- Meta-asercje: każda tabela z RLS ma w macierzy 5 ról × 4 operacje, a macierz nie zna tabel spoza bazy.
begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000b0', 'o@x.test'), ('00000000-0000-7000-8000-0000000000b1', 'ad@x.test'),
  ('00000000-0000-7000-8000-0000000000b2', 'm@x.test'), ('00000000-0000-7000-8000-0000000000b3', 'k@x.test'),
  ('00000000-0000-7000-8000-0000000000b4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

-- Grupa G (owner b0 = członek 90), admin b1 (91), member b2 (92), dziecko z kontem b3 (93); obcy b4 ma swoją grupę.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b0');
set local role authenticated;
select public.create_group('88888888-0000-7000-8000-000000000001', 'G', '88888888-0000-7000-8000-000000000090', 'Owner');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b4');
select public.create_group('88888888-0000-7000-8000-000000000002', 'Obca', '88888888-0000-7000-8000-000000000094', 'Obcy');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('88888888-0000-7000-8000-000000000091', '88888888-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', 'Admin', 'admin'),
  ('88888888-0000-7000-8000-000000000092', '88888888-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b2', 'Member', 'member'),
  ('88888888-0000-7000-8000-000000000093', '88888888-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b3', 'Dziecko', 'child'),
  ('88888888-0000-7000-8000-000000000095', '88888888-0000-7000-8000-000000000001', null, 'Profil', 'child');
-- Dane G: lista z zadaniem przypisanym dziecku, lista ograniczona ownera (z udostępnieniem memberowi), wydarzenie
-- cotygodniowe z uczestnikiem, wyjątkiem, odpowiedzią membera i serią zadań, przekazanie od ownera do membera, zaproszenie.
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('88888888-0000-7000-8000-0000000000e1', '88888888-0000-7000-8000-000000000001', 'tasks', 'Dom', '88888888-0000-7000-8000-000000000090');
insert into public.lists (id, group_id, kind, name, owner_member_id, visibility) values
  ('88888888-0000-7000-8000-0000000000e2', '88888888-0000-7000-8000-000000000001', 'tasks', 'Prezent', '88888888-0000-7000-8000-000000000090', 'restricted');
insert into public.object_members (scope_entity, scope_id, member_id, group_id) values
  ('lists', '88888888-0000-7000-8000-0000000000e2', '88888888-0000-7000-8000-000000000092', '88888888-0000-7000-8000-000000000001');
insert into public.tasks (id, group_id, list_id, title, assignee_member_id) values
  ('88888888-0000-7000-8000-0000000000d1', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Zadanie', '88888888-0000-7000-8000-000000000093'),
  ('88888888-0000-7000-8000-0000000000d2', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Moje', '88888888-0000-7000-8000-000000000090'),
  ('88888888-0000-7000-8000-0000000000d3', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Do przekazania', '88888888-0000-7000-8000-000000000090'),
  ('88888888-0000-7000-8000-0000000000d4', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Do przekazania', '88888888-0000-7000-8000-000000000091'),
  ('88888888-0000-7000-8000-0000000000d5', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Do przekazania', '88888888-0000-7000-8000-000000000092'),
  ('88888888-0000-7000-8000-0000000000d6', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Do przekazania', '88888888-0000-7000-8000-000000000093');
insert into public.events (id, group_id, title, start_date, start_time, end_time, rrule, audience) values
  ('88888888-0000-7000-8000-0000000000c1', '88888888-0000-7000-8000-000000000001', 'Basen', '2026-10-07', '17:00', '18:00', 'FREQ=WEEKLY;BYDAY=WE', 'members');
insert into public.event_participants (id, event_id, group_id, member_id) values
  ('88888888-0000-7000-8000-0000000000c2', '88888888-0000-7000-8000-0000000000c1', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-000000000093');
insert into public.event_overrides (id, event_id, group_id, occurrence_date, title) values
  ('88888888-0000-7000-8000-0000000000c3', '88888888-0000-7000-8000-0000000000c1', '88888888-0000-7000-8000-000000000001', '2026-10-14', 'Basen później');
insert into public.event_rsvps (id, event_id, group_id, occurrence_date, member_id, answer) values
  ('88888888-0000-7000-8000-0000000000c4', '88888888-0000-7000-8000-0000000000c1', '88888888-0000-7000-8000-000000000001', '2026-10-07', '88888888-0000-7000-8000-000000000092', 'yes');
insert into public.event_task_series (id, event_id, group_id, list_id, title) values
  ('88888888-0000-7000-8000-0000000000c5', '88888888-0000-7000-8000-0000000000c1', '88888888-0000-7000-8000-000000000001', '88888888-0000-7000-8000-0000000000e1', 'Ręcznik');
insert into public.handoffs (id, group_id, entity, entity_id, from_member, to_member) values
  ('88888888-0000-7000-8000-0000000000c6', '88888888-0000-7000-8000-000000000001', 'tasks', '88888888-0000-7000-8000-0000000000d2', '88888888-0000-7000-8000-000000000090', '88888888-0000-7000-8000-000000000092');
insert into public.invites (group_id, token_hash, created_by, expires_at, max_uses) values
  ('88888888-0000-7000-8000-000000000001', '\x00', '00000000-0000-7000-8000-0000000000b0', now() + interval '1 day', 5);
insert into public.push_tokens (token, user_id, env) select encode(sha256(id::text::bytea), 'hex'), id, 'production' from auth.users where email like '%@x.test';
insert into public.push_mutes (user_id, group_id) select id, '88888888-0000-7000-8000-000000000001' from auth.users where email in ('o@x.test', 'ad@x.test', 'm@x.test', 'k@x.test');
insert into public.app_feedback (user_id, message) select id, 'uwaga' from auth.users where email like '%@x.test';
insert into public.client_errors (user_id, kind, message) select id, 'error', 'błąd' from auth.users where email like '%@x.test';
insert into public.profiles (user_id, display_name) select id, 'P' from auth.users where email like '%@x.test' on conflict (user_id) do nothing;

-- Osoby macierzy: użytkownik, członek w G (obcy: członek swojej grupy), urządzenie (client_id).
create table pg_temp.who (role text primary key, uid uuid, member uuid, client uuid);
insert into pg_temp.who values
  ('owner', '00000000-0000-7000-8000-0000000000b0', '88888888-0000-7000-8000-000000000090', '88888888-0000-7000-8000-0000000000f0'),
  ('admin', '00000000-0000-7000-8000-0000000000b1', '88888888-0000-7000-8000-000000000091', '88888888-0000-7000-8000-0000000000f1'),
  ('member', '00000000-0000-7000-8000-0000000000b2', '88888888-0000-7000-8000-000000000092', '88888888-0000-7000-8000-0000000000f2'),
  ('child', '00000000-0000-7000-8000-0000000000b3', '88888888-0000-7000-8000-000000000093', '88888888-0000-7000-8000-0000000000f3'),
  ('stranger', '00000000-0000-7000-8000-0000000000b4', '88888888-0000-7000-8000-000000000094', '88888888-0000-7000-8000-0000000000f4');

-- Operacja jak z telefonu: wynik 'ok' albo kod odrzucenia z sync_push.
create function pg_temp.push(client uuid, op jsonb) returns text language sql as $$
  select coalesce(r -> 'results' -> 0 ->> 'code', r -> 'results' -> 0 ->> 'status')
  from (select public.sync_push(client, 2, jsonb_build_array(op || jsonb_build_object('seq', 1, 'op_id', gen_random_uuid()))) r) x
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Polecenia macierzy: %1$s = client_id, %2$s = member_id osoby (w G), G = grupa. Odczyt liczy wiersze G widoczne dla osoby.
create table pg_temp.ops (tbl text, op text, q text, primary key (tbl, op));
create function pg_temp.sync_ops(tbl text, create_set text, patch_set text, target text) returns void language sql as $$
  insert into pg_temp.ops values
    (tbl, 'insert', format($q$select pg_temp.push('%%1$s', jsonb_build_object('kind', 'create', 'entity', %L, 'id', gen_random_uuid(), 'group_id', '88888888-0000-7000-8000-000000000001', 'set', %s))$q$, tbl, create_set)),
    (tbl, 'update', format($q$select pg_temp.push('%%1$s', jsonb_build_object('kind', 'patch', 'entity', %L, 'id', %L, 'set', %s))$q$, tbl, target, patch_set)),
    (tbl, 'delete', format($q$select pg_temp.push('%%1$s', jsonb_build_object('kind', 'delete', 'entity', %L, 'id', %L))$q$, tbl, target))
$$;
select pg_temp.sync_ops('groups', $j$jsonb_build_object('name', 'Nowa')$j$, $j$jsonb_build_object('name', 'Inna')$j$, '88888888-0000-7000-8000-000000000001');
select pg_temp.sync_ops('group_members', $j$jsonb_build_object('display_name', 'Nowe dziecko', 'role', 'child')$j$, $j$jsonb_build_object('display_name', 'Profil 2')$j$, '88888888-0000-7000-8000-000000000095');
select pg_temp.sync_ops('lists', $j$jsonb_build_object('kind', 'tasks', 'name', 'Nowa')$j$, $j$jsonb_build_object('name', 'Inna')$j$, '88888888-0000-7000-8000-0000000000e1');
select pg_temp.sync_ops('tasks', $j$jsonb_build_object('list_id', '88888888-0000-7000-8000-0000000000e1', 'title', 'Nowe')$j$, $j$jsonb_build_object('title', 'Inne')$j$, '88888888-0000-7000-8000-0000000000d1');
select pg_temp.sync_ops('events', $j$jsonb_build_object('title', 'Nowe', 'start_date', '2026-10-09', 'start_time', '10:00', 'end_time', '11:00', 'audience', 'group')$j$, $j$jsonb_build_object('title', 'Inne')$j$, '88888888-0000-7000-8000-0000000000c1');
select pg_temp.sync_ops('event_participants', $j$jsonb_build_object('event_id', '88888888-0000-7000-8000-0000000000c1', 'member_id', '88888888-0000-7000-8000-000000000095')$j$, $j$jsonb_build_object('member_id', '88888888-0000-7000-8000-000000000095')$j$, '88888888-0000-7000-8000-0000000000c2');
select pg_temp.sync_ops('event_overrides', $j$jsonb_build_object('event_id', '88888888-0000-7000-8000-0000000000c1', 'occurrence_date', '2026-10-21', 'cancelled', true)$j$, $j$jsonb_build_object('title', 'Inny')$j$, '88888888-0000-7000-8000-0000000000c3');
-- Odpowiedź za siebie (member_id osoby): każdy odpowiada o swojej obecności.
select pg_temp.sync_ops('event_rsvps', $j$jsonb_build_object('event_id', '88888888-0000-7000-8000-0000000000c1', 'occurrence_date', '2026-10-14', 'member_id', '%2$s', 'answer', 'yes')$j$, $j$jsonb_build_object('answer', 'no')$j$, '88888888-0000-7000-8000-0000000000c4');
select pg_temp.sync_ops('event_task_series', $j$jsonb_build_object('event_id', '88888888-0000-7000-8000-0000000000c1', 'list_id', '88888888-0000-7000-8000-0000000000e1', 'title', 'Czepek')$j$, $j$jsonb_build_object('title', 'Klapki')$j$, '88888888-0000-7000-8000-0000000000c5');
-- Przekazanie swojego zadania „Do przekazania” (obcy: zadania ownera) adminowi (admin — ownerowi); zmiana: przyjęcie
-- przekazania od ownera do membera.
select pg_temp.sync_ops('handoffs', $j$jsonb_build_object('entity', 'tasks', 'entity_id', coalesce((select id::text from public.tasks where title = 'Do przekazania' and assignee_member_id = '%2$s'), '88888888-0000-7000-8000-0000000000d3'), 'to_member', case when '%2$s' = '88888888-0000-7000-8000-000000000091' then '88888888-0000-7000-8000-000000000090' else '88888888-0000-7000-8000-000000000091' end)$j$, $j$jsonb_build_object('status', 'accepted')$j$, '88888888-0000-7000-8000-0000000000c6');
-- Tabele poza synchronizacją: wprost w SQL.
create function pg_temp.dml(tbl text, ins text, upd text, del text) returns void language sql as $$
  insert into pg_temp.ops values
    (tbl, 'insert', format('with x as (%s returning 1) select case when count(*) > 0 then ''ok'' else ''0 rows'' end from x', ins)),
    (tbl, 'update', format('with x as (%s returning 1) select case when count(*) > 0 then ''ok'' else ''0 rows'' end from x', upd)),
    (tbl, 'delete', format('with x as (%s returning 1) select case when count(*) > 0 then ''ok'' else ''0 rows'' end from x', del))
$$;
select pg_temp.dml('object_members',
  $s$insert into public.object_members (scope_entity, scope_id, member_id, group_id) values ('lists', '88888888-0000-7000-8000-0000000000e2', '88888888-0000-7000-8000-000000000091', '88888888-0000-7000-8000-000000000001')$s$,
  $s$update public.object_members set deleted_at = now() where scope_id = '88888888-0000-7000-8000-0000000000e2'$s$,
  $s$delete from public.object_members where scope_id = '88888888-0000-7000-8000-0000000000e2'$s$);
select pg_temp.dml('activity',
  $s$insert into public.activity (group_id, verb, entity, entity_id, version) values ('88888888-0000-7000-8000-000000000001', 'create', 'tasks', gen_random_uuid(), 1)$s$,
  $s$update public.activity set verb = 'x' where group_id = '88888888-0000-7000-8000-000000000001'$s$,
  $s$delete from public.activity where group_id = '88888888-0000-7000-8000-000000000001'$s$);
select pg_temp.dml('invites',
  $s$insert into public.invites (group_id, token_hash, created_by, expires_at, max_uses) values ('88888888-0000-7000-8000-000000000001', '\x01', auth.uid(), now() + interval '1 day', 5)$s$,
  $s$update public.invites set max_uses = 99 where group_id = '88888888-0000-7000-8000-000000000001'$s$,
  $s$delete from public.invites where group_id = '88888888-0000-7000-8000-000000000001'$s$);
select pg_temp.dml('profiles',
  $s$insert into public.profiles (user_id, display_name) values (gen_random_uuid(), 'X')$s$,
  $s$update public.profiles set display_name = 'Inne' where user_id = '00000000-0000-7000-8000-0000000000b0'$s$,
  $s$delete from public.profiles where user_id = '00000000-0000-7000-8000-0000000000b0'$s$);
select pg_temp.dml('push_tokens',
  $s$insert into public.push_tokens (token, user_id, env) values (repeat('ab', 32), auth.uid(), 'production')$s$,
  $s$update public.push_tokens set env = 'sandbox' where user_id = '00000000-0000-7000-8000-0000000000b0'$s$,
  $s$delete from public.push_tokens where user_id = '00000000-0000-7000-8000-0000000000b0'$s$);
select pg_temp.dml('push_mutes',
  $s$insert into public.push_mutes (user_id, group_id) values (auth.uid(), '88888888-0000-7000-8000-000000000002')$s$,
  $s$update public.push_mutes set created_at = now() where group_id = '88888888-0000-7000-8000-000000000001'$s$,
  $s$delete from public.push_mutes where group_id = '88888888-0000-7000-8000-000000000001'$s$);
select pg_temp.dml('app_feedback',
  $s$insert into public.app_feedback (user_id, message) values (auth.uid(), 'x')$s$,
  $s$update public.app_feedback set message = 'y' where user_id = '00000000-0000-7000-8000-0000000000b0'$s$,
  $s$delete from public.app_feedback where user_id = '00000000-0000-7000-8000-0000000000b0'$s$);
select pg_temp.dml('client_errors',
  $s$insert into public.client_errors (user_id, kind, message) values (auth.uid(), 'error', 'x')$s$,
  $s$update public.client_errors set message = 'y' where user_id = '00000000-0000-7000-8000-0000000000b0'$s$,
  $s$delete from public.client_errors where user_id = '00000000-0000-7000-8000-0000000000b0'$s$);
-- Odczyt: wiersze związane z G (tabele osobiste — wiersze ownera G).
insert into pg_temp.ops select t, 'select', format('select case when count(*) > 0 then ''visible'' else ''hidden'' end from public.%I where %s', t, w)
from (values
  ('groups', $w$id = '88888888-0000-7000-8000-000000000001'$w$),
  ('group_members', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('lists', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('tasks', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('events', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('event_participants', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('event_overrides', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('event_rsvps', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('event_task_series', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('handoffs', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('object_members', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('activity', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('invites', $w$group_id = '88888888-0000-7000-8000-000000000001'$w$),
  ('profiles', $w$user_id = '00000000-0000-7000-8000-0000000000b0'$w$),
  ('push_tokens', $w$user_id = '00000000-0000-7000-8000-0000000000b0'$w$),
  ('push_mutes', $w$user_id = '00000000-0000-7000-8000-0000000000b0'$w$),
  ('app_feedback', $w$user_id = '00000000-0000-7000-8000-0000000000b0'$w$),
  ('client_errors', $w$user_id = '00000000-0000-7000-8000-0000000000b0'$w$)
) v(t, w);

-- Jedna komórka: jako osoba, w podtransakcji wycofanej po pomiarze (wyjątek-znacznik P0099 cofa też zmianę roli).
create function pg_temp.cell(r text, q text) returns text language plpgsql as $$
declare
  w pg_temp.who;
  res text;
begin
  select * into w from pg_temp.who where role = r;
  begin
    perform set_config('request.jwt.claim.sub', w.uid::text, true);
    perform set_config('role', 'authenticated', true);
    execute format(q, w.client, w.member) into res;
    raise exception using errcode = 'P0099', message = coalesce(res, 'null');
  exception
    when sqlstate 'P0099' then res := sqlerrm;
    when sqlstate 'P0001' then res := sqlerrm;
    when others then res := sqlstate;
  end;
  return res;
end $$;

create table pg_temp.got as
  select o.tbl, w.role, o.op, pg_temp.cell(w.role, o.q) as result from pg_temp.ops o cross join pg_temp.who w;

-- Oczekiwania (tabela × rola × operacja). Zasady: odczyt — członkowie G widzą dane grupy, obcy nie; tabele osobiste —
-- tylko właściciel wiersza (owner G czyta swoje); zapis encji przez sync_push — dorośli według ról (D34, D41, PW-14 B),
-- dziecko nie tworzy, nie zmienia i nie usuwa (wyjątki: swoje odhaczenie i obecność — child_account.test.sql), obcy
-- dostaje not_found / forbidden; tabele poza synchronizacją — brak uprawnień (42501) albo 0 wierszy przez RLS.
create table pg_temp.want (tbl text, role text, op text, result text, primary key (tbl, role, op));
insert into pg_temp.want values
  ('activity', 'owner', 'select', 'visible'), ('activity', 'admin', 'select', 'visible'), ('activity', 'member', 'select', 'visible'), ('activity', 'child', 'select', 'visible'), ('activity', 'stranger', 'select', 'hidden'),
  ('activity', 'owner', 'insert', '42501'), ('activity', 'admin', 'insert', '42501'), ('activity', 'member', 'insert', '42501'), ('activity', 'child', 'insert', '42501'), ('activity', 'stranger', 'insert', '42501'),
  ('activity', 'owner', 'update', '42501'), ('activity', 'admin', 'update', '42501'), ('activity', 'member', 'update', '42501'), ('activity', 'child', 'update', '42501'), ('activity', 'stranger', 'update', '42501'),
  ('activity', 'owner', 'delete', '42501'), ('activity', 'admin', 'delete', '42501'), ('activity', 'member', 'delete', '42501'), ('activity', 'child', 'delete', '42501'), ('activity', 'stranger', 'delete', '42501'),
  ('app_feedback', 'owner', 'select', '42501'), ('app_feedback', 'admin', 'select', '42501'), ('app_feedback', 'member', 'select', '42501'), ('app_feedback', 'child', 'select', '42501'), ('app_feedback', 'stranger', 'select', '42501'),
  ('app_feedback', 'owner', 'insert', '42501'), ('app_feedback', 'admin', 'insert', '42501'), ('app_feedback', 'member', 'insert', '42501'), ('app_feedback', 'child', 'insert', '42501'), ('app_feedback', 'stranger', 'insert', '42501'),
  ('app_feedback', 'owner', 'update', '42501'), ('app_feedback', 'admin', 'update', '42501'), ('app_feedback', 'member', 'update', '42501'), ('app_feedback', 'child', 'update', '42501'), ('app_feedback', 'stranger', 'update', '42501'),
  ('app_feedback', 'owner', 'delete', '42501'), ('app_feedback', 'admin', 'delete', '42501'), ('app_feedback', 'member', 'delete', '42501'), ('app_feedback', 'child', 'delete', '42501'), ('app_feedback', 'stranger', 'delete', '42501'),
  ('client_errors', 'owner', 'select', '42501'), ('client_errors', 'admin', 'select', '42501'), ('client_errors', 'member', 'select', '42501'), ('client_errors', 'child', 'select', '42501'), ('client_errors', 'stranger', 'select', '42501'),
  ('client_errors', 'owner', 'insert', '42501'), ('client_errors', 'admin', 'insert', '42501'), ('client_errors', 'member', 'insert', '42501'), ('client_errors', 'child', 'insert', '42501'), ('client_errors', 'stranger', 'insert', '42501'),
  ('client_errors', 'owner', 'update', '42501'), ('client_errors', 'admin', 'update', '42501'), ('client_errors', 'member', 'update', '42501'), ('client_errors', 'child', 'update', '42501'), ('client_errors', 'stranger', 'update', '42501'),
  ('client_errors', 'owner', 'delete', '42501'), ('client_errors', 'admin', 'delete', '42501'), ('client_errors', 'member', 'delete', '42501'), ('client_errors', 'child', 'delete', '42501'), ('client_errors', 'stranger', 'delete', '42501'),
  ('event_overrides', 'owner', 'select', 'visible'), ('event_overrides', 'admin', 'select', 'visible'), ('event_overrides', 'member', 'select', 'visible'), ('event_overrides', 'child', 'select', 'visible'), ('event_overrides', 'stranger', 'select', 'hidden'),
  ('event_overrides', 'owner', 'insert', 'ok'), ('event_overrides', 'admin', 'insert', 'ok'), ('event_overrides', 'member', 'insert', 'ok'), ('event_overrides', 'child', 'insert', 'forbidden:child'), ('event_overrides', 'stranger', 'insert', 'forbidden'),
  ('event_overrides', 'owner', 'update', 'ok'), ('event_overrides', 'admin', 'update', 'ok'), ('event_overrides', 'member', 'update', 'ok'), ('event_overrides', 'child', 'update', 'forbidden:child'), ('event_overrides', 'stranger', 'update', 'not_found'),
  ('event_overrides', 'owner', 'delete', 'ok'), ('event_overrides', 'admin', 'delete', 'ok'), ('event_overrides', 'member', 'delete', 'ok'), ('event_overrides', 'child', 'delete', 'forbidden:child'), ('event_overrides', 'stranger', 'delete', 'not_found'),
  ('event_participants', 'owner', 'select', 'visible'), ('event_participants', 'admin', 'select', 'visible'), ('event_participants', 'member', 'select', 'visible'), ('event_participants', 'child', 'select', 'visible'), ('event_participants', 'stranger', 'select', 'hidden'),
  ('event_participants', 'owner', 'insert', 'ok'), ('event_participants', 'admin', 'insert', 'ok'), ('event_participants', 'member', 'insert', 'ok'), ('event_participants', 'child', 'insert', 'forbidden:child'), ('event_participants', 'stranger', 'insert', 'forbidden'),
  ('event_participants', 'owner', 'update', 'invalid_field:member_id'), ('event_participants', 'admin', 'update', 'invalid_field:member_id'), ('event_participants', 'member', 'update', 'invalid_field:member_id'), ('event_participants', 'child', 'update', 'invalid_field:member_id'), ('event_participants', 'stranger', 'update', 'invalid_field:member_id'),
  ('event_participants', 'owner', 'delete', 'ok'), ('event_participants', 'admin', 'delete', 'ok'), ('event_participants', 'member', 'delete', 'ok'), ('event_participants', 'child', 'delete', 'forbidden:child'), ('event_participants', 'stranger', 'delete', 'not_found'),
  ('event_rsvps', 'owner', 'select', 'visible'), ('event_rsvps', 'admin', 'select', 'visible'), ('event_rsvps', 'member', 'select', 'visible'), ('event_rsvps', 'child', 'select', 'visible'), ('event_rsvps', 'stranger', 'select', 'hidden'),
  ('event_rsvps', 'owner', 'insert', 'ok'), ('event_rsvps', 'admin', 'insert', 'ok'), ('event_rsvps', 'member', 'insert', 'ok'), ('event_rsvps', 'child', 'insert', 'ok'), ('event_rsvps', 'stranger', 'insert', 'forbidden'),
  ('event_rsvps', 'owner', 'update', 'forbidden:not_self'), ('event_rsvps', 'admin', 'update', 'forbidden:not_self'), ('event_rsvps', 'member', 'update', 'ok'), ('event_rsvps', 'child', 'update', 'forbidden:not_self'), ('event_rsvps', 'stranger', 'update', 'not_found'),
  ('event_rsvps', 'owner', 'delete', 'forbidden:not_self'), ('event_rsvps', 'admin', 'delete', 'forbidden:not_self'), ('event_rsvps', 'member', 'delete', 'ok'), ('event_rsvps', 'child', 'delete', 'forbidden:not_self'), ('event_rsvps', 'stranger', 'delete', 'not_found'),
  ('event_task_series', 'owner', 'select', 'visible'), ('event_task_series', 'admin', 'select', 'visible'), ('event_task_series', 'member', 'select', 'visible'), ('event_task_series', 'child', 'select', 'visible'), ('event_task_series', 'stranger', 'select', 'hidden'),
  ('event_task_series', 'owner', 'insert', 'ok'), ('event_task_series', 'admin', 'insert', 'ok'), ('event_task_series', 'member', 'insert', 'ok'), ('event_task_series', 'child', 'insert', 'forbidden:child'), ('event_task_series', 'stranger', 'insert', 'forbidden'),
  ('event_task_series', 'owner', 'update', 'ok'), ('event_task_series', 'admin', 'update', 'ok'), ('event_task_series', 'member', 'update', 'ok'), ('event_task_series', 'child', 'update', 'forbidden:child'), ('event_task_series', 'stranger', 'update', 'not_found'),
  ('event_task_series', 'owner', 'delete', 'ok'), ('event_task_series', 'admin', 'delete', 'ok'), ('event_task_series', 'member', 'delete', 'ok'), ('event_task_series', 'child', 'delete', 'forbidden:child'), ('event_task_series', 'stranger', 'delete', 'not_found'),
  ('events', 'owner', 'select', 'visible'), ('events', 'admin', 'select', 'visible'), ('events', 'member', 'select', 'visible'), ('events', 'child', 'select', 'visible'), ('events', 'stranger', 'select', 'hidden'),
  ('events', 'owner', 'insert', 'ok'), ('events', 'admin', 'insert', 'ok'), ('events', 'member', 'insert', 'ok'), ('events', 'child', 'insert', 'forbidden:child'), ('events', 'stranger', 'insert', 'forbidden'),
  ('events', 'owner', 'update', 'ok'), ('events', 'admin', 'update', 'ok'), ('events', 'member', 'update', 'ok'), ('events', 'child', 'update', 'forbidden:child'), ('events', 'stranger', 'update', 'not_found'),
  ('events', 'owner', 'delete', 'ok'), ('events', 'admin', 'delete', 'ok'), ('events', 'member', 'delete', 'ok'), ('events', 'child', 'delete', 'forbidden:child'), ('events', 'stranger', 'delete', 'not_found'),
  ('group_members', 'owner', 'select', 'visible'), ('group_members', 'admin', 'select', 'visible'), ('group_members', 'member', 'select', 'visible'), ('group_members', 'child', 'select', 'visible'), ('group_members', 'stranger', 'select', 'hidden'),
  ('group_members', 'owner', 'insert', 'ok'), ('group_members', 'admin', 'insert', 'ok'), ('group_members', 'member', 'insert', 'forbidden'), ('group_members', 'child', 'insert', 'forbidden'), ('group_members', 'stranger', 'insert', 'forbidden'),
  ('group_members', 'owner', 'update', 'ok'), ('group_members', 'admin', 'update', 'ok'), ('group_members', 'member', 'update', 'forbidden'), ('group_members', 'child', 'update', 'forbidden'), ('group_members', 'stranger', 'update', 'not_found'),
  ('group_members', 'owner', 'delete', 'ok'), ('group_members', 'admin', 'delete', 'ok'), ('group_members', 'member', 'delete', 'forbidden:role'), ('group_members', 'child', 'delete', 'forbidden:role'), ('group_members', 'stranger', 'delete', 'not_found'),
  ('groups', 'owner', 'select', 'visible'), ('groups', 'admin', 'select', 'visible'), ('groups', 'member', 'select', 'visible'), ('groups', 'child', 'select', 'visible'), ('groups', 'stranger', 'select', 'hidden'),
  ('groups', 'owner', 'insert', 'invalid_field:id'), ('groups', 'admin', 'insert', 'invalid_field:id'), ('groups', 'member', 'insert', 'invalid_field:id'), ('groups', 'child', 'insert', 'invalid_field:id'), ('groups', 'stranger', 'insert', 'invalid_field:id'),
  ('groups', 'owner', 'update', 'ok'), ('groups', 'admin', 'update', 'ok'), ('groups', 'member', 'update', 'forbidden'), ('groups', 'child', 'update', 'forbidden'), ('groups', 'stranger', 'update', 'not_found'),
  ('groups', 'owner', 'delete', 'unsupported'), ('groups', 'admin', 'delete', 'unsupported'), ('groups', 'member', 'delete', 'unsupported'), ('groups', 'child', 'delete', 'unsupported'), ('groups', 'stranger', 'delete', 'unsupported'),
  ('handoffs', 'owner', 'select', 'visible'), ('handoffs', 'admin', 'select', 'hidden'), ('handoffs', 'member', 'select', 'visible'), ('handoffs', 'child', 'select', 'hidden'), ('handoffs', 'stranger', 'select', 'hidden'),
  ('handoffs', 'owner', 'insert', 'ok'), ('handoffs', 'admin', 'insert', 'ok'), ('handoffs', 'member', 'insert', 'ok'), ('handoffs', 'child', 'insert', 'forbidden:child'), ('handoffs', 'stranger', 'insert', 'forbidden'),
  ('handoffs', 'owner', 'update', 'forbidden'), ('handoffs', 'admin', 'update', 'not_found'), ('handoffs', 'member', 'update', 'ok'), ('handoffs', 'child', 'update', 'not_found'), ('handoffs', 'stranger', 'update', 'not_found'),
  ('handoffs', 'owner', 'delete', 'unsupported'), ('handoffs', 'admin', 'delete', 'unsupported'), ('handoffs', 'member', 'delete', 'unsupported'), ('handoffs', 'child', 'delete', 'unsupported'), ('handoffs', 'stranger', 'delete', 'unsupported'),
  ('invites', 'owner', 'select', 'visible'), ('invites', 'admin', 'select', 'visible'), ('invites', 'member', 'select', 'hidden'), ('invites', 'child', 'select', 'hidden'), ('invites', 'stranger', 'select', 'hidden'),
  ('invites', 'owner', 'insert', '42501'), ('invites', 'admin', 'insert', '42501'), ('invites', 'member', 'insert', '42501'), ('invites', 'child', 'insert', '42501'), ('invites', 'stranger', 'insert', '42501'),
  ('invites', 'owner', 'update', '42501'), ('invites', 'admin', 'update', '42501'), ('invites', 'member', 'update', '42501'), ('invites', 'child', 'update', '42501'), ('invites', 'stranger', 'update', '42501'),
  ('invites', 'owner', 'delete', '42501'), ('invites', 'admin', 'delete', '42501'), ('invites', 'member', 'delete', '42501'), ('invites', 'child', 'delete', '42501'), ('invites', 'stranger', 'delete', '42501'),
  ('lists', 'owner', 'select', 'visible'), ('lists', 'admin', 'select', 'visible'), ('lists', 'member', 'select', 'visible'), ('lists', 'child', 'select', 'visible'), ('lists', 'stranger', 'select', 'hidden'),
  ('lists', 'owner', 'insert', 'ok'), ('lists', 'admin', 'insert', 'ok'), ('lists', 'member', 'insert', 'ok'), ('lists', 'child', 'insert', 'forbidden:child'), ('lists', 'stranger', 'insert', 'forbidden'),
  ('lists', 'owner', 'update', 'ok'), ('lists', 'admin', 'update', 'ok'), ('lists', 'member', 'update', 'ok'), ('lists', 'child', 'update', 'forbidden:child'), ('lists', 'stranger', 'update', 'not_found'),
  ('lists', 'owner', 'delete', 'ok'), ('lists', 'admin', 'delete', 'ok'), ('lists', 'member', 'delete', 'ok'), ('lists', 'child', 'delete', 'forbidden:child'), ('lists', 'stranger', 'delete', 'not_found'),
  ('object_members', 'owner', 'select', 'visible'), ('object_members', 'admin', 'select', 'hidden'), ('object_members', 'member', 'select', 'visible'), ('object_members', 'child', 'select', 'hidden'), ('object_members', 'stranger', 'select', 'hidden'),
  ('object_members', 'owner', 'insert', 'ok'), ('object_members', 'admin', 'insert', 'forbidden:not_list_owner'), ('object_members', 'member', 'insert', 'forbidden:not_list_owner'), ('object_members', 'child', 'insert', 'forbidden:not_list_owner'), ('object_members', 'stranger', 'insert', 'forbidden:not_list_owner'),
  ('object_members', 'owner', 'update', 'ok'), ('object_members', 'admin', 'update', '0 rows'), ('object_members', 'member', 'update', 'forbidden:not_list_owner'), ('object_members', 'child', 'update', '0 rows'), ('object_members', 'stranger', 'update', '0 rows'),
  ('object_members', 'owner', 'delete', '42501'), ('object_members', 'admin', 'delete', '42501'), ('object_members', 'member', 'delete', '42501'), ('object_members', 'child', 'delete', '42501'), ('object_members', 'stranger', 'delete', '42501'),
  ('profiles', 'owner', 'select', 'visible'), ('profiles', 'admin', 'select', 'visible'), ('profiles', 'member', 'select', 'visible'), ('profiles', 'child', 'select', 'visible'), ('profiles', 'stranger', 'select', 'hidden'),
  ('profiles', 'owner', 'insert', '42501'), ('profiles', 'admin', 'insert', '42501'), ('profiles', 'member', 'insert', '42501'), ('profiles', 'child', 'insert', '42501'), ('profiles', 'stranger', 'insert', '42501'),
  ('profiles', 'owner', 'update', 'ok'), ('profiles', 'admin', 'update', '0 rows'), ('profiles', 'member', 'update', '0 rows'), ('profiles', 'child', 'update', '0 rows'), ('profiles', 'stranger', 'update', '0 rows'),
  ('profiles', 'owner', 'delete', '42501'), ('profiles', 'admin', 'delete', '42501'), ('profiles', 'member', 'delete', '42501'), ('profiles', 'child', 'delete', '42501'), ('profiles', 'stranger', 'delete', '42501'),
  ('push_mutes', 'owner', 'select', '42501'), ('push_mutes', 'admin', 'select', '42501'), ('push_mutes', 'member', 'select', '42501'), ('push_mutes', 'child', 'select', '42501'), ('push_mutes', 'stranger', 'select', '42501'),
  ('push_mutes', 'owner', 'insert', '42501'), ('push_mutes', 'admin', 'insert', '42501'), ('push_mutes', 'member', 'insert', '42501'), ('push_mutes', 'child', 'insert', '42501'), ('push_mutes', 'stranger', 'insert', '42501'),
  ('push_mutes', 'owner', 'update', '42501'), ('push_mutes', 'admin', 'update', '42501'), ('push_mutes', 'member', 'update', '42501'), ('push_mutes', 'child', 'update', '42501'), ('push_mutes', 'stranger', 'update', '42501'),
  ('push_mutes', 'owner', 'delete', '42501'), ('push_mutes', 'admin', 'delete', '42501'), ('push_mutes', 'member', 'delete', '42501'), ('push_mutes', 'child', 'delete', '42501'), ('push_mutes', 'stranger', 'delete', '42501'),
  ('push_tokens', 'owner', 'select', '42501'), ('push_tokens', 'admin', 'select', '42501'), ('push_tokens', 'member', 'select', '42501'), ('push_tokens', 'child', 'select', '42501'), ('push_tokens', 'stranger', 'select', '42501'),
  ('push_tokens', 'owner', 'insert', '42501'), ('push_tokens', 'admin', 'insert', '42501'), ('push_tokens', 'member', 'insert', '42501'), ('push_tokens', 'child', 'insert', '42501'), ('push_tokens', 'stranger', 'insert', '42501'),
  ('push_tokens', 'owner', 'update', '42501'), ('push_tokens', 'admin', 'update', '42501'), ('push_tokens', 'member', 'update', '42501'), ('push_tokens', 'child', 'update', '42501'), ('push_tokens', 'stranger', 'update', '42501'),
  ('push_tokens', 'owner', 'delete', '42501'), ('push_tokens', 'admin', 'delete', '42501'), ('push_tokens', 'member', 'delete', '42501'), ('push_tokens', 'child', 'delete', '42501'), ('push_tokens', 'stranger', 'delete', '42501'),
  ('tasks', 'owner', 'select', 'visible'), ('tasks', 'admin', 'select', 'visible'), ('tasks', 'member', 'select', 'visible'), ('tasks', 'child', 'select', 'visible'), ('tasks', 'stranger', 'select', 'hidden'),
  ('tasks', 'owner', 'insert', 'ok'), ('tasks', 'admin', 'insert', 'ok'), ('tasks', 'member', 'insert', 'ok'), ('tasks', 'child', 'insert', 'forbidden:child'), ('tasks', 'stranger', 'insert', 'forbidden'),
  ('tasks', 'owner', 'update', 'ok'), ('tasks', 'admin', 'update', 'ok'), ('tasks', 'member', 'update', 'ok'), ('tasks', 'child', 'update', 'forbidden:child'), ('tasks', 'stranger', 'update', 'not_found'),
  ('tasks', 'owner', 'delete', 'ok'), ('tasks', 'admin', 'delete', 'ok'), ('tasks', 'member', 'delete', 'ok'), ('tasks', 'child', 'delete', 'forbidden:child'), ('tasks', 'stranger', 'delete', 'not_found');

select is((select count(*)::int from pg_temp.got g join pg_temp.want w using (tbl, role, op) where g.result is distinct from w.result), 0,
  'każda komórka macierzy zgodna z oczekiwaniem');
select is_empty($$ select g.tbl || ' × ' || g.role || ' × ' || g.op || ': ' || g.result || ' (oczekiwane ' || coalesce(w.result, 'brak wiersza') || ')'
  from pg_temp.got g left join pg_temp.want w using (tbl, role, op) where g.result is distinct from w.result order by 1 $$,
  'rozbieżności macierzy (tabela × rola × operacja: wynik)');
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity),
  (select array_agg(t order by t) from (select tbl t from pg_temp.want group by tbl having count(*) = 20 and count(distinct role) = 5 and count(distinct op) = 4) x),
  'każda tabela public z RLS ma w macierzy 5 ról × 4 operacje');
select is((select count(*)::int from pg_temp.want w where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = w.tbl and c.relrowsecurity)), 0,
  'macierz nie zawiera tabel spoza bazy');

select * from finish();
rollback;
