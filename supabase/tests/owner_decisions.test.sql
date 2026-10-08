-- Decyzje właściciela po audycie (migracja 20261008300000_owner_decisions; ADR 0035): D138, D139, D136, events.kind.
begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000d1', 'u1@x.test'),
  ('00000000-0000-7000-8000-0000000000d2', 'u2@x.test'),
  ('00000000-0000-7000-8000-0000000000d3', 'u3@x.test'),
  ('00000000-0000-7000-8000-0000000000d4', 'u4@x.test'),
  ('00000000-0000-7000-8000-0000000000d5', 'u5@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('od.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('od.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(client text, op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(client, op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
-- Grupa G z sync_pull bieżącej osoby: kursor albo wiersze.
create function pg_temp.g_of(res jsonb) returns jsonb language sql as $$
  select g from jsonb_array_elements(res -> 'groups') g where g ->> 'group_id' = 'b0d20000-0000-7000-8000-000000000001'
$$;
create function pg_temp.cursor_now() returns bigint language sql as $$ select (pg_temp.g_of(public.sync_pull('{}'::jsonb)) ->> 'cursor')::bigint $$;
create function pg_temp.rows_since(c bigint) returns jsonb language sql as $$
  select pg_temp.g_of(public.sync_pull(jsonb_build_object('b0d20000-0000-7000-8000-000000000001', c))) -> 'rows'
$$;
create function pg_temp.has_row(rs jsonb, ent text, rid text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(rs) x where x ->> 'e' = ent and coalesce(x -> 'row' ->> 'id', x -> 'row' ->> 'member_id') = rid)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: U1 owner (b1), U2 member (b2), U3 member (b3), U4 dziecko z kontem (b4), U5 member (b5).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('b0d20000-0000-7000-8000-000000000001', 'G', 'b0d20000-0000-7000-8000-0000000000b1', 'U1');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('b0d20000-0000-7000-8000-0000000000b2', 'b0d20000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d2', 'U2', 'member'),
  ('b0d20000-0000-7000-8000-0000000000b3', 'b0d20000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d3', 'U3', 'member'),
  ('b0d20000-0000-7000-8000-0000000000b4', 'b0d20000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d4', 'U4', 'child'),
  ('b0d20000-0000-7000-8000-0000000000b5', 'b0d20000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000d5', 'U5', 'member');

-- ───────── D138: dziecko wraca jako dziecko ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
create temp table inv as select public.create_invite('b0d20000-0000-7000-8000-000000000001') ->> 'token' member_tok,
  public.create_invite('b0d20000-0000-7000-8000-000000000001', 'admin') ->> 'token' admin_tok,
  public.create_join_code('b0d20000-0000-7000-8000-000000000001') code;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d4');
select pg_temp.m('c4000000-0000-7000-8000-000000000004', '{"kind":"delete","entity":"group_members","id":"b0d20000-0000-7000-8000-0000000000b4"}');
select is(public.accept_invite((select member_tok from inv)) ->> 'member_id', 'b0d20000-0000-7000-8000-0000000000b4', '1: dziecko wraca linkiem (ten sam wiersz)');
select is(private.my_role('b0d20000-0000-7000-8000-000000000001'), 'child', '2: link: rola child zostaje');
select pg_temp.m('c4000000-0000-7000-8000-000000000004', '{"kind":"delete","entity":"group_members","id":"b0d20000-0000-7000-8000-0000000000b4"}');
select is(public.join_group((select code ->> 'join_id' from inv), (select code ->> 'code' from inv)) ->> 'already_member', 'false', '3: dziecko wraca ID i kodem');
select is(private.my_role('b0d20000-0000-7000-8000-000000000001'), 'child', '4: kod: rola child zostaje');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d5');
select pg_temp.m('c5000000-0000-7000-8000-000000000005', '{"kind":"delete","entity":"group_members","id":"b0d20000-0000-7000-8000-0000000000b5"}');
select is(public.accept_invite((select admin_tok from inv)) ->> 'already_member', 'false', '5: dorosły wraca linkiem admina');
select is(private.my_role('b0d20000-0000-7000-8000-000000000001'), 'admin', '6: dorosły: rola z zaproszenia, jak dotąd');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d3');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"delete","entity":"group_members","id":"b0d20000-0000-7000-8000-0000000000b3"}');
select is(public.join_group((select code ->> 'join_id' from inv), (select code ->> 'code' from inv)) ->> 'already_member', 'false', '7: dorosły wraca kodem');
select is(private.my_role('b0d20000-0000-7000-8000-000000000001'), 'member', '8: kod: rola z zaproszenia');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d5');
select is(pg_temp.p('c5000000-0000-7000-8000-000000000005', '{"kind":"patch","entity":"group_members","id":"b0d20000-0000-7000-8000-0000000000b4","set":{"role":"member"}}'), 'ok', '9: rolę dziecka zmienia admin');

-- ───────── D139: lista poszerzona do „cała grupa” ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"b0d20000-0000-7000-8000-0000000001c1","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Wyjazd","visibility":"private"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"b0d20000-0000-7000-8000-0000000002d1","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"list_id":"b0d20000-0000-7000-8000-0000000001c1","title":"Namiot"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"b0d20000-0000-7000-8000-0000000002d2","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"list_id":"b0d20000-0000-7000-8000-0000000001c1","parent_id":"b0d20000-0000-7000-8000-0000000002d1","title":"Śledzie"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"lists","id":"b0d20000-0000-7000-8000-0000000001c2","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"restricted"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"b0d20000-0000-7000-8000-0000000001c2","member_id":"b0d20000-0000-7000-8000-0000000000b3"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"b0d20000-0000-7000-8000-0000000002d3","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"list_id":"b0d20000-0000-7000-8000-0000000001c2","title":"Rower"}}');
create temp table cur as select pg_temp.cursor_now() owner_c,
  (select pg_temp.cursor_now() from (select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2')) x) member_c;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
select is(pg_temp.has_row(pg_temp.rows_since(0), 'tasks', 'b0d20000-0000-7000-8000-0000000002d1'), false, '10: przed poszerzeniem U2 nie dostaje zadań listy prywatnej');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"b0d20000-0000-7000-8000-0000000001c1","set":{"visibility":"group"}}'), 'ok', '11: prywatna → cała grupa');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"lists","id":"b0d20000-0000-7000-8000-0000000001c2","set":{"visibility":"group"}}'), 'ok', '12: ograniczona → cała grupa');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
create temp table pulled as select pg_temp.rows_since((select member_c from cur)) rs;
select ok(pg_temp.has_row((select rs from pulled), 'tasks', 'b0d20000-0000-7000-8000-0000000002d1')
      and pg_temp.has_row((select rs from pulled), 'tasks', 'b0d20000-0000-7000-8000-0000000002d2'), '13: U2 ze starym kursorem dostaje zadania i podzadania listy');
select ok(pg_temp.has_row((select rs from pulled), 'tasks', 'b0d20000-0000-7000-8000-0000000002d3'), '14: także z listy ograniczonej');
select ok(pg_temp.has_row((select rs from pulled), 'object_members', 'b0d20000-0000-7000-8000-0000000000b3'), '15: wpis dostępu listy ograniczonej');
select ok((select count(*) from jsonb_array_elements((select rs from pulled)) x where x ->> 'e' = 'activity'
           and x -> 'row' ->> 'entity_id' = 'b0d20000-0000-7000-8000-0000000002d1' and x -> 'row' ->> 'verb' = 'create') = 1, '16: i historię zadania');
select is((select public.sync_pull('{}'::jsonb) -> 'scopes'), '[]'::jsonb, '17: bez sync_fetch_scope (scopes puste)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select ok(pg_temp.has_row(pg_temp.rows_since((select owner_c from cur)), 'tasks', 'b0d20000-0000-7000-8000-0000000002d1'), '18: właściciel też dostaje zadania z powrotem (telefon czyści utracony zakres)');
reset role;
select is((select count(*)::int from public.activity where entity = 'tasks' and verb = 'update'
           and entity_id in ('b0d20000-0000-7000-8000-0000000002d1', 'b0d20000-0000-7000-8000-0000000002d2', 'b0d20000-0000-7000-8000-0000000002d3')), 0, '19: podbicie wersji nie dodaje wpisów aktywności');
set local role authenticated;

-- ───────── D136: całodniowy pojedynczy termin ─────────
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"events","id":"b0d20000-0000-7000-8000-0000000003e1","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"title":"Basen","start_date":"2026-10-05","start_time":"17:00","end_time":"18:00","rrule":"FREQ=WEEKLY;BYDAY=MO"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
update cur set member_c = pg_temp.cursor_now();
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"event_overrides","id":"b0d20000-0000-7000-8000-0000000003a1","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"event_id":"b0d20000-0000-7000-8000-0000000003e1","occurrence_date":"2026-10-12","all_day":true,"start_time":"17:00","end_time":"18:00"}}'), 'ok', '20: wyjątek całodniowy (godziny zostają w wierszu)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d2');
select is((select x -> 'row' ->> 'all_day' from jsonb_array_elements(pg_temp.rows_since((select member_c from cur))) x where x ->> 'e' = 'event_overrides'), 'true', '21: all_day dociera do innych telefonów');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"event_overrides","id":"b0d20000-0000-7000-8000-0000000003a1","set":{"all_day":false}}'), 'ok', '22: zdjęcie znacznika');
-- PW-33 (wariant A, migracja 20261008320000): godziny równe godzinom serii zapisują się jako „jak w serii” (null).
select is((select o.all_day::text || ' ' || coalesce(o.start_time, e.start_time)::text from public.event_overrides o join public.events e on e.id = o.event_id
            where o.id = 'b0d20000-0000-7000-8000-0000000003a1'), 'false 17:00:00', '23: godziny wracają (własne albo serii)');

-- ───────── events.kind ─────────
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"events","id":"b0d20000-0000-7000-8000-0000000004e1","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"title":"Matematyka","start_date":"2026-10-05","start_time":"08:00","end_time":"08:45","rrule":"FREQ=WEEKLY;BYDAY=MO","kind":"lesson"}}'), 'ok', '24: lekcja planu');
select is((select x -> 'row' ->> 'kind' from jsonb_array_elements(pg_temp.rows_since(0)) x where x ->> 'e' = 'events' and x -> 'row' ->> 'id' = 'b0d20000-0000-7000-8000-0000000004e1')
  || '/' || (select kind from public.events where id = 'b0d20000-0000-7000-8000-0000000003e1'), 'lesson/event', '25: rodzaj w pobraniu; domyślnie event');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"events","id":"b0d20000-0000-7000-8000-0000000004e2","group_id":"b0d20000-0000-7000-8000-000000000001","set":{"title":"X","start_date":"2026-10-05","kind":"party"}}'), 'invalid:23514', '26: nieznany rodzaj odrzucony');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"patch","entity":"events","id":"b0d20000-0000-7000-8000-0000000004e1","set":{"kind":"routine"}}'), 'invalid_field:kind', '27: rodzaju nie zmienia się przez sync_push');
select throws_ok($$update public.events set kind = 'routine' where id = 'b0d20000-0000-7000-8000-0000000004e1'$$, '42501', null, '28: ani wprost (brak GRANT update)');

select * from finish();
rollback;
