-- Poprawki z audytu serwera (audyt 8.10.2026, migracja 20261008280000_audit_fixes). Każda luka: najpierw zachowanie
-- po poprawce, potem regresja zwykłej drogi.
begin;
select plan(52);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000f1', 'u1@x.test'),
  ('00000000-0000-7000-8000-0000000000f2', 'u2@x.test'),
  ('00000000-0000-7000-8000-0000000000f3', 'u3@x.test'),
  ('00000000-0000-7000-8000-0000000000f4', 'u4@x.test'),
  ('00000000-0000-7000-8000-0000000000f5', 'u5@x.test'),
  ('00000000-0000-7000-8000-0000000000e1', 'x1@x.test'),
  ('00000000-0000-7000-8000-0000000000e9', 'legit@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
-- Jedna operacja przez sync_push z kolejnym numerem dla danego klienta; zwraca kod ('ok' albo odrzucenie).
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('audit.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('audit.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
-- To samo, ale przygotowanie: odrzucenie przerywa test.
create function pg_temp.m(client text, op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(client, op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.p(text, jsonb), pg_temp.m(text, jsonb) to authenticated;

-- Grupa G: U1 owner (a1), U2 member (a2), U3 admin (a3), U4 dziecko z kontem (a4), U5 member (a5), Kid bez konta (a6).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('a0d10000-0000-7000-8000-000000000001', 'G', 'a0d10000-0000-7000-8000-0000000000a1', 'U1');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('a0d10000-0000-7000-8000-0000000000a2', 'a0d10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f2', 'U2', 'member'),
  ('a0d10000-0000-7000-8000-0000000000a3', 'a0d10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f3', 'U3', 'admin'),
  ('a0d10000-0000-7000-8000-0000000000a4', 'a0d10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f4', 'U4', 'child'),
  ('a0d10000-0000-7000-8000-0000000000a5', 'a0d10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f5', 'U5', 'member'),
  ('a0d10000-0000-7000-8000-0000000000a6', 'a0d10000-0000-7000-8000-000000000001', null, 'Kid', 'child');
select public.register_push_token(repeat('ab', 32), 'production') from (select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2')) x;

-- ───────── #1: przywrócenie podzadania usuniętego rodzica ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000001c1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","title":"Rodzic"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d2","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","parent_id":"a0d10000-0000-7000-8000-0000000002d1","title":"Dziecko"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d1"}');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d2"}'), 'deleted:parent', '1: podzadania pod usuniętym rodzicem nie przywracamy');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d1"}'), 'ok', '2: przywrócenie rodzica');
select is((select deleted_at from public.tasks where id = 'a0d10000-0000-7000-8000-0000000002d2'), null, '3: rodzic wraca razem z dzieckiem (kaskada działa)');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d2"}');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000002d2"}'), 'ok', '4: regresja: przywrócenie dziecka przy żywym rodzicu');

-- Dane sprzed poprawki (żywe dziecko usuniętego rodzica) i grupa, której czyszczenie pada: pozostałe grupy dalej się czyszczą.
reset role;
select pg_temp.as_user('');
update public.tasks set deleted_at = now() - interval '40 days' where id = 'a0d10000-0000-7000-8000-0000000002d1';
update public.tasks set deleted_at = null where id = 'a0d10000-0000-7000-8000-0000000002d2';
insert into public.lists (id, group_id, kind, name, owner_member_id, deleted_at) values
  ('a0d10000-0000-7000-8000-0000000001cf', 'a0d10000-0000-7000-8000-000000000001', 'tasks', 'Zła', 'a0d10000-0000-7000-8000-0000000000a1', now() - interval '40 days');
create function pg_temp.fail_delete() returns trigger language plpgsql as $$ begin raise exception 'symulowana awaria'; end $$;
create trigger audit_fail before delete on public.lists for each row when (old.id = 'a0d10000-0000-7000-8000-0000000001cf') execute function pg_temp.fail_delete();
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('a0d10000-0000-7000-8000-0000000001c5', '00000000-0000-7000-8000-0000000000f5', 'tasks', 'Moje', '00000000-0000-7000-8000-0000000000f5');
insert into public.tasks (id, group_id, list_id, title, deleted_at) values
  ('a0d10000-0000-7000-8000-0000000005d1', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', 'Stare', now() - interval '40 days');
set local client_min_messages = error; -- ostrzeżenie o pominiętej grupie jest oczekiwane
select lives_ok('select private.purge_tombstones()', '5: czyszczenie nie przerywa się na grupie z błędem');
select is((select count(*)::int from public.tasks where id = 'a0d10000-0000-7000-8000-0000000005d1'), 0, '6: inna grupa wyczyszczona');
select is((select count(*)::int from public.lists where id = 'a0d10000-0000-7000-8000-0000000001cf'), 1, '7: grupa z błędem pominięta w całości (podtransakcja)');
reset client_min_messages;
drop trigger audit_fail on public.lists;
select lives_ok('select private.purge_tombstones()', '8: stare dane: rodzic z żywym dzieckiem nie blokuje czyszczenia');
select is((select count(*)::int from public.tasks where id = 'a0d10000-0000-7000-8000-0000000002d1'), 1, '9: rodzic z żywym dzieckiem zostaje (klucz obcy)');
select lives_ok('select private.daily_maintenance()', '10: codzienne sprzątanie przechodzi');

-- ───────── #2: głębokość zadań ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000a000","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","title":"A"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000b000","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","parent_id":"a0d10000-0000-7000-8000-00000000a000","title":"B"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000c000","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","parent_id":"a0d10000-0000-7000-8000-00000000b000","title":"C"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000f000","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","title":"X"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000f001","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000001c1","parent_id":"a0d10000-0000-7000-8000-00000000f000","title":"Y"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"tasks","id":"a0d10000-0000-7000-8000-00000000b000"}');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"move_task","args":{"id":"a0d10000-0000-7000-8000-00000000a000","parent_id":"a0d10000-0000-7000-8000-00000000f001"}}'), 'depth_exceeded', '11: usunięci potomkowie liczą się do głębokości');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"move_task","args":{"id":"a0d10000-0000-7000-8000-00000000f001","parent_id":"a0d10000-0000-7000-8000-00000000a000"}}'), 'ok', '12: regresja: zwykłe przeniesienie (Y pod A)');
select is((select depth from public.tasks where id = 'a0d10000-0000-7000-8000-00000000f001'), 1, '13: głębokość przeliczona');
reset role;
select pg_temp.as_user('');
select throws_ok($$insert into public.tasks (id, group_id, list_id, parent_id, title, depth) values ('a0d10000-0000-7000-8000-00000000e003', 'a0d10000-0000-7000-8000-000000000001', 'a0d10000-0000-7000-8000-0000000001c1', 'a0d10000-0000-7000-8000-00000000c000', 'za głęboko', 3)$$,
  '23514', null, '14: tabela nie przyjmie głębokości > MAX_TASK_DEPTH (także z serwera)');
-- Naprawa danych sprzed poprawki (bez ograniczenia, jak w produkcji przed migracją): P3, P4 pod przodka z poziomu 1.
alter table public.tasks drop constraint tasks_depth_range;
insert into public.tasks (id, group_id, list_id, parent_id, title, depth) values
  ('a0d10000-0000-7000-8000-00000000e000', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', null, 'P0', 0),
  ('a0d10000-0000-7000-8000-00000000e001', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', 'a0d10000-0000-7000-8000-00000000e000', 'P1', 1),
  ('a0d10000-0000-7000-8000-00000000e002', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', 'a0d10000-0000-7000-8000-00000000e001', 'P2', 2),
  ('a0d10000-0000-7000-8000-00000000e003', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', 'a0d10000-0000-7000-8000-00000000e002', 'P3', 3),
  ('a0d10000-0000-7000-8000-00000000e004', '00000000-0000-7000-8000-0000000000f5', 'a0d10000-0000-7000-8000-0000000001c5', 'a0d10000-0000-7000-8000-00000000e003', 'P4', 4);
select is(private.repair_task_depth(), 2, '15: naprawa poprawia dwa wiersze');
select is((select string_agg(title || '>' || parent_id::text || '@' || depth, ',' order by title) from public.tasks where title in ('P3', 'P4')),
  'P3>a0d10000-0000-7000-8000-00000000e001@2,P4>a0d10000-0000-7000-8000-00000000e001@2', '16: pod przodkiem z poziomu 1, głębokość 2');
alter table public.tasks add constraint tasks_depth_range check (depth >= 0 and depth <= private.max_task_depth());
-- hard_delete_group bez pętli po głębokości: grupa w koszu z drzewem 3 poziomów znika.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('a0d10000-0000-7000-8000-000000000002', 'Do usunięcia', 'a0d10000-0000-7000-8000-0000000000b1', 'U1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000002c1","group_id":"a0d10000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"L"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000022d1","group_id":"a0d10000-0000-7000-8000-000000000002","set":{"list_id":"a0d10000-0000-7000-8000-0000000002c1","title":"1"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000022d2","group_id":"a0d10000-0000-7000-8000-000000000002","set":{"list_id":"a0d10000-0000-7000-8000-0000000002c1","parent_id":"a0d10000-0000-7000-8000-0000000022d1","title":"2"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000022d3","group_id":"a0d10000-0000-7000-8000-000000000002","set":{"list_id":"a0d10000-0000-7000-8000-0000000002c1","parent_id":"a0d10000-0000-7000-8000-0000000022d2","title":"3"}}');
select lives_ok($$select public.delete_group('a0d10000-0000-7000-8000-000000000002')$$, '17: regresja: usunięcie grupy (kosz)');
reset role;
select pg_temp.as_user('');
update public.groups set deleted_at = now() - interval '31 days' where id = 'a0d10000-0000-7000-8000-000000000002';
select is(private.purge_deleted_groups(), 1, '18: grupa z kosza usunięta z całym drzewem zadań');
select is((select count(*)::int from public.tasks where group_id = 'a0d10000-0000-7000-8000-000000000002'), 0, '19: bez zadań');

-- ───────── #3: osoba odpowiedzialna za zakupy widzi listę ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Prezent dla U2","visibility":"private","responsible_member_id":"a0d10000-0000-7000-8000-0000000000a2"}}'), 'invalid_member', '20: lista prywatna z osobą, która jej nie widzi — odrzucona');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c2","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Biedronka"}}');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c2","set":{"visibility":"private","responsible_member_id":"a0d10000-0000-7000-8000-0000000000a2"}}'), 'invalid_member', '21: prywatna + osoba w jednym patchu — odrzucone (nowy stan)');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c2","set":{"responsible_member_id":"a0d10000-0000-7000-8000-0000000000a2"}}'), 'ok', '22: regresja: lista grupy, osoba U2');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c2","set":{"visibility":"private"}}'), 'invalid_member', '23: ukrycie listy przed osobą odpowiedzialną — odrzucone');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c3","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Moje","visibility":"private","responsible_member_id":"a0d10000-0000-7000-8000-0000000000a1"}}'), 'ok', '24: regresja: lista prywatna, odpowiadam ja');
-- Powiadomienia: zadanie przypisane U2 i przekazanie do U2, potem lista ukryta przed U2.
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c4","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Wkrótce prywatna"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000033d1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000003c4","title":"Tajne","assignee_member_id":"a0d10000-0000-7000-8000-0000000000a2"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000033d2","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000003c4","title":"Tajne 2","assignee_member_id":"a0d10000-0000-7000-8000-0000000000a1"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000033f1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"a0d10000-0000-7000-8000-0000000033d2","to_member":"a0d10000-0000-7000-8000-0000000000a2"}}');
reset role;
select pg_temp.as_user('');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"a0d10000-0000-7000-8000-0000000003c4","set":{"visibility":"private"}}');
reset role;
select pg_temp.as_user('');
select is(public.assignment_push_claim((select id from public.activity where entity_id = 'a0d10000-0000-7000-8000-0000000033d1' and verb = 'create'), '00000000-0000-7000-8000-0000000000f1', 24), null, '25: przypisanie: lista już ukryta przed U2 — bez powiadomienia');
select is(public.handoff_push_claim('a0d10000-0000-7000-8000-0000000033f1', '00000000-0000-7000-8000-0000000000f1', 24), null, '26: przekazanie: lista już ukryta przed U2 — bez powiadomienia');
select is(public.assignment_push_claim((select id from public.activity where entity = 'lists' and entity_id = 'a0d10000-0000-7000-8000-0000000003c2' and changes ? 'responsible_member_id'), '00000000-0000-7000-8000-0000000000f1', 24) ->> 'body',
  'Zakupy: Biedronka', '27: regresja: powiadomienie o zakupach na widocznej liście');

-- ───────── #5: konto wraca do grupy tylko przez zaproszenie ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
create temp table tok as select public.create_invite('a0d10000-0000-7000-8000-000000000001') ->> 'token' t;
grant select on tok to authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select pg_temp.m('c2000000-0000-7000-8000-000000000002', '{"kind":"delete","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a2"}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is(pg_temp.p('c3000000-0000-7000-8000-000000000003', '{"kind":"restore","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a2"}'), 'forbidden:user_requires_invite', '28: admin nie przywraca konta, które wyszło');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a2"}'), 'forbidden:user_requires_invite', '29: owner też nie');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a6"}'), 'ok', '30: regresja: usunięcie profilu dziecka');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is(pg_temp.p('c3000000-0000-7000-8000-000000000003', '{"kind":"restore","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a6"}'), 'ok', '31: regresja: profil dziecka bez konta admin przywraca');

-- ───────── #10: sprzątanie po byłym członku ─────────
-- U5: dostęp do listy ograniczonej i udział w wydarzeniu, potem wyjście U5 z grupy.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000004c1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"restricted"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"a0d10000-0000-7000-8000-0000000004c1","member_id":"a0d10000-0000-7000-8000-0000000000a5"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"events","id":"a0d10000-0000-7000-8000-0000000004e1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"title":"Kino","start_date":"2026-10-20","audience":"members"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"event_participants","id":"a0d10000-0000-7000-8000-0000000004a1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"event_id":"a0d10000-0000-7000-8000-0000000004e1","member_id":"a0d10000-0000-7000-8000-0000000000a5"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f5');
select is(pg_temp.p('c5000000-0000-7000-8000-000000000005', '{"kind":"delete","entity":"group_members","id":"a0d10000-0000-7000-8000-0000000000a5"}'), 'ok', '32: U5 wychodzi z grupy');
select isnt((select deleted_at from public.object_members where scope_id = 'a0d10000-0000-7000-8000-0000000004c1' and member_id = 'a0d10000-0000-7000-8000-0000000000a5'), null, '33: wyjście odbiera dostęp do listy ograniczonej')
  from (select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1')) x;
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"revoke_scope","args":{"list_id":"a0d10000-0000-7000-8000-0000000004c1","member_id":"a0d10000-0000-7000-8000-0000000000a5"}}'), 'ok', '34: cofnięcie dostępu byłemu członkowi przechodzi (idempotentne)');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"a0d10000-0000-7000-8000-0000000004c1","member_id":"a0d10000-0000-7000-8000-0000000000a5"}}'), 'invalid_member', '35: przywrócenie dostępu byłemu członkowi — odrzucone');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"event_participants","id":"a0d10000-0000-7000-8000-0000000004a1"}'), 'ok', '36: byłego członka da się zdjąć z uczestników');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f5');
select is(public.accept_invite((select t from tok)) ->> 'already_member', 'false', '37: regresja: powrót linkiem');
select is((select count(*)::int from public.lists where id = 'a0d10000-0000-7000-8000-0000000004c1'), 0, '38: po powrocie lista ograniczona dalej ukryta');

-- ───────── #7: znacznik usunięcia ustawia serwer ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"a0d10000-0000-7000-8000-0000000007c1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom U1"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000007d1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000007c1","title":"Ważne"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
update public.lists set deleted_at = '2000-01-01T00:00:00Z' where id = 'a0d10000-0000-7000-8000-0000000007c1';
select ok((select deleted_at > now() - interval '1 minute' from public.lists where id = 'a0d10000-0000-7000-8000-0000000007c1'), '39: data z żądania zignorowana — teraz');
select is((select t.deleted_at = l.deleted_at from public.tasks t, public.lists l where t.id = 'a0d10000-0000-7000-8000-0000000007d1' and l.id = t.list_id), true, '40: kaskada przenosi ten sam znacznik');
select throws_ok($$update public.lists set deleted_at = '2000-01-01T00:00:00Z' where id = 'a0d10000-0000-7000-8000-0000000007c1'$$, 'P0001', 'immutable_column:deleted_at', '41: daty już usuniętego nie da się cofnąć');
select is(pg_temp.p('c3000000-0000-7000-8000-000000000003', '{"kind":"restore","entity":"lists","id":"a0d10000-0000-7000-8000-0000000007c1"}'), 'ok', '42: regresja: przywrócenie listy');
select is((select deleted_at from public.tasks where id = 'a0d10000-0000-7000-8000-0000000007d1'), null, '43: wraca z zadaniem');

-- ───────── #8: przyjęcie nieaktualnego przekazania ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000008d1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"list_id":"a0d10000-0000-7000-8000-0000000007c1","title":"Paczka","assignee_member_id":"a0d10000-0000-7000-8000-0000000000a1"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000008f1","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"a0d10000-0000-7000-8000-0000000008d1","to_member":"a0d10000-0000-7000-8000-0000000000a5"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"patch","entity":"tasks","id":"a0d10000-0000-7000-8000-0000000008d1","set":{"assignee_member_id":"a0d10000-0000-7000-8000-0000000000a3"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f5');
select is(pg_temp.p('c5000000-0000-7000-8000-000000000005', '{"kind":"patch","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000008f1","set":{"status":"accepted"}}'), 'stale', '44: przyjęcie nieaktualnego przekazania — odrzucone');
select is((select assignee_member_id::text from public.tasks where id = 'a0d10000-0000-7000-8000-0000000008d1'), 'a0d10000-0000-7000-8000-0000000000a3', '45: przypisanie U3 zostaje');
select is(pg_temp.p('c5000000-0000-7000-8000-000000000005', '{"kind":"patch","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000008f1","set":{"status":"declined"}}'), 'ok', '46: odbiorca może je odrzucić');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000008f2","group_id":"a0d10000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"a0d10000-0000-7000-8000-0000000008d1","to_member":"a0d10000-0000-7000-8000-0000000000a5"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f5');
select is(pg_temp.p('c5000000-0000-7000-8000-000000000005', '{"kind":"patch","entity":"handoffs","id":"a0d10000-0000-7000-8000-0000000008f2","set":{"status":"accepted"}}'), 'ok', '47: regresja: zwykłe przyjęcie');
select is((select assignee_member_id::text from public.tasks where id = 'a0d10000-0000-7000-8000-0000000008d1'), 'a0d10000-0000-7000-8000-0000000000a5', '48: zadanie przechodzi');

-- ───────── #12: dołączanie kodem ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
create temp table jc as select public.create_join_code('a0d10000-0000-7000-8000-000000000001') j;
grant select on jc to authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e9');
select is(public.join_group((select j ->> 'join_id' from jc), (select j ->> 'code' from jc)) ->> 'already_member', 'false', '49: regresja: dołączenie poprawnym kodem');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
select public.join_group((select j ->> 'join_id' from jc), case when (select j ->> 'code' from jc) = '00000' || b then '99999' || b else '00000' || b end) is not null
  from generate_series(0, 4) b;
select is(public.join_group((select j ->> 'join_id' from jc), (select j ->> 'code' from jc)) ->> 'error', 'rate_limited', '50: regresja: limit prób osoby działa');
reset role;
select ok(pg_get_functiondef('private.join_group(text, text, text)'::regprocedure) ~ 'pg_advisory_xact_lock\(hashtext\(''organizer.join_user''\)', '51: liczenie prób pod blokadą doradczą (równoległości pgTAP nie odtworzy)');

-- ───────── #2 + regresja: usunięcie konta z drzewem zadań w grupie osobistej ─────────
select pg_temp.as_user('');
select lives_ok($$delete from auth.users where id = '00000000-0000-7000-8000-0000000000f5'$$, '52: regresja: usunięcie konta (grupa osobista z drzewem zadań)');

select * from finish();
rollback;
