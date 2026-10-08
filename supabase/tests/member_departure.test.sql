-- Wyjście z grupy i powrót (migracja 20261008361000_member_departure): przekazania anulowane (R-34), listy „Tylko ja”
-- do kosza i z powrotem (PW-43 A), zaproszenia usuniętej osoby (PW-6 A), przywrócenie usuniętej osoby (PW-35 A, D165).
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000c1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000000c2', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000c3', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000000c4', 'n@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('md.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('md.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(client text, op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(client, op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
grant execute on all functions in schema pg_temp to authenticated;
create function pg_temp.del(t text, rid text) returns timestamptz language plpgsql security definer as $$
declare v timestamptz; begin execute format('select deleted_at from public.%I where %s = $1', t, case when t = 'group_members' then 'member_id' else 'id' end) into v using rid::uuid; return v; end $$;
create function pg_temp.status(hid text) returns text language sql security definer as $$ select status from public.handoffs where id = hid::uuid $$;

-- G: C1 owner (g1), C2 admin (g2), C3 member (g3), C4 member (g4), profil dziecka (g9).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
set local role authenticated;
select public.create_group('d0d30000-0000-7000-8000-000000000001', 'G', 'd0d30000-0000-7000-8000-0000000000a1', 'Ola');
create temp table tok as select public.create_invite('d0d30000-0000-7000-8000-000000000001') ->> 'token' owner_tok;
grant select on tok to authenticated;
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('d0d30000-0000-7000-8000-0000000000a2', 'd0d30000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c2', 'Adam', 'admin'),
  ('d0d30000-0000-7000-8000-0000000000a3', 'd0d30000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c3', 'Marta', 'member'),
  ('d0d30000-0000-7000-8000-0000000000a4', 'd0d30000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c4', 'Nina', 'member'),
  ('d0d30000-0000-7000-8000-0000000000a9', 'd0d30000-0000-7000-8000-000000000001', null, 'Kuba', 'child');

-- C3: lista prywatna z zadaniem i podzadaniem, druga prywatna usunięta przez nią wcześniej; lista grupy; przekazania.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c3');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"lists","id":"d0d30000-0000-7000-8000-0000000001b1","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"private"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"tasks","id":"d0d30000-0000-7000-8000-0000000002d1","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"list_id":"d0d30000-0000-7000-8000-0000000001b1","title":"Rower"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"tasks","id":"d0d30000-0000-7000-8000-0000000002d2","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"list_id":"d0d30000-0000-7000-8000-0000000001b1","parent_id":"d0d30000-0000-7000-8000-0000000002d1","title":"Kask"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"lists","id":"d0d30000-0000-7000-8000-0000000001b2","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Stare","visibility":"private"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"delete","entity":"lists","id":"d0d30000-0000-7000-8000-0000000001b2"}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"lists","id":"d0d30000-0000-7000-8000-0000000001b3","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"tasks","id":"d0d30000-0000-7000-8000-0000000002d3","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"list_id":"d0d30000-0000-7000-8000-0000000001b3","title":"Pranie","assignee_member_id":"d0d30000-0000-7000-8000-0000000000a3"}}');
select pg_temp.m('c3000000-0000-7000-8000-000000000003', '{"kind":"create","entity":"handoffs","id":"d0d30000-0000-7000-8000-0000000003f1","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"d0d30000-0000-7000-8000-0000000002d3","to_member":"d0d30000-0000-7000-8000-0000000000a4"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c4');
select pg_temp.m('c4000000-0000-7000-8000-000000000004', '{"kind":"create","entity":"tasks","id":"d0d30000-0000-7000-8000-0000000002d4","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"list_id":"d0d30000-0000-7000-8000-0000000001b3","title":"Zakupy","assignee_member_id":"d0d30000-0000-7000-8000-0000000000a4"}}');
select pg_temp.m('c4000000-0000-7000-8000-000000000004', '{"kind":"create","entity":"handoffs","id":"d0d30000-0000-7000-8000-0000000003f2","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"d0d30000-0000-7000-8000-0000000002d4","to_member":"d0d30000-0000-7000-8000-0000000000a3"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"tasks","id":"d0d30000-0000-7000-8000-0000000002d5","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"list_id":"d0d30000-0000-7000-8000-0000000001b3","title":"Rachunki","assignee_member_id":"d0d30000-0000-7000-8000-0000000000a1"}}');
select pg_temp.m('c1000000-0000-7000-8000-000000000001', '{"kind":"create","entity":"handoffs","id":"d0d30000-0000-7000-8000-0000000003f3","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"entity":"tasks","entity_id":"d0d30000-0000-7000-8000-0000000002d5","to_member":"d0d30000-0000-7000-8000-0000000000a4"}}');

-- ───────── Samodzielne wyjście ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c3');
select is(pg_temp.p('c3000000-0000-7000-8000-000000000003', '{"kind":"delete","entity":"group_members","id":"d0d30000-0000-7000-8000-0000000000a3"}'), 'ok', '1: C3 wychodzi z grupy');
select is(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b1'), pg_temp.del('group_members', 'd0d30000-0000-7000-8000-0000000000a3'), '2: lista „Tylko ja” w koszu z datą wyjścia');
select ok(pg_temp.del('tasks', 'd0d30000-0000-7000-8000-0000000002d1') is not null and pg_temp.del('tasks', 'd0d30000-0000-7000-8000-0000000002d2') is not null, '3: razem z zadaniami i podzadaniami');
select is(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b3'), null, '4: lista całej grupy zostaje');
select is(pg_temp.status('d0d30000-0000-7000-8000-0000000003f1'), 'cancelled', '5: przekazanie od osoby, która wyszła — anulowane');
select is(pg_temp.status('d0d30000-0000-7000-8000-0000000003f2'), 'cancelled', '6: przekazanie do niej — też');
select is(pg_temp.status('d0d30000-0000-7000-8000-0000000003f3'), 'pending', '7: cudze przekazanie bez zmian');
select is((select removed_at from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a3'), null, '8: samodzielne wyjście nie zostawia śladu usunięcia');
select ok((select decided_at is not null from public.handoffs where id = 'd0d30000-0000-7000-8000-0000000003f1'), '9: anulowanie z datą');

-- Powrót (stare zaproszenie działa — wyjście, nie usunięcie): listy „Tylko ja” wracają, usunięta wcześniej — nie.
set local role authenticated;
select is(public.accept_invite((select owner_tok from tok)) ->> 'already_member', 'false', '10: C3 wraca starym linkiem');
reset role;
select is(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b1'), null, '11: lista „Tylko ja” wraca');
select ok(pg_temp.del('tasks', 'd0d30000-0000-7000-8000-0000000002d1') is null and pg_temp.del('tasks', 'd0d30000-0000-7000-8000-0000000002d2') is null, '12: z zadaniami');
select isnt(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b2'), null, '13: lista usunięta przed wyjściem zostaje w koszu');

-- ───────── Usunięcie przez ownera i „Cofnij” ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c2');
set local role authenticated;
create temp table adm as select public.create_invite('d0d30000-0000-7000-8000-000000000001') ->> 'token' tok, public.create_join_code('d0d30000-0000-7000-8000-000000000001') code;
grant select on adm to authenticated;
select pg_temp.m('c2000000-0000-7000-8000-000000000002', '{"kind":"create","entity":"lists","id":"d0d30000-0000-7000-8000-0000000001b4","group_id":"d0d30000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Moje","visibility":"private"}}');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000c1');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"d0d30000-0000-7000-8000-0000000000a2"}'), 'ok', '14: owner usuwa admina');
select is((select removed_at from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a2'), pg_temp.del('group_members', 'd0d30000-0000-7000-8000-0000000000a2'), '15: ślad usunięcia (removed_at)');
select is((select count(*)::int from public.invites where created_by = 'd0d30000-0000-7000-8000-0000000000a2' and revoked_at is null), 0, '16: zaproszenia usuniętej osoby przestają działać');
select isnt(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b4'), null, '17: jej lista „Tylko ja” w koszu (cudza lista prywatna — zapis serwera)');
select is((select count(*)::int from public.invites where created_by = 'd0d30000-0000-7000-8000-0000000000a1' and revoked_at is null), 1, '18: zaproszenia innych bez zmian');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"group_members","id":"d0d30000-0000-7000-8000-0000000000a2"}'), 'ok', '19: „Cofnij” (przywrócenie przez ownera)');
select is(pg_temp.del('group_members', 'd0d30000-0000-7000-8000-0000000000a2'), null, '20: admin z powrotem (ten sam member_id)');
select is((select role from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a2'), 'admin', '21: z tą samą rolą');
select is((select count(*)::int from public.invites where created_by = 'd0d30000-0000-7000-8000-0000000000a2' and revoked_at is null), 0, '22: unieważnione zaproszenia nie wracają (jeden aktywny kod na rolę, PW-41 A)');
select is(pg_temp.del('lists', 'd0d30000-0000-7000-8000-0000000001b4'), null, '23: lista „Tylko ja” wraca');
select is((select removed_at from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a2'), null, '24: ślad usunięcia znika po powrocie');

-- Profil dziecka: usunięcie bez śladu (bez konta nie wraca zaproszeniem), przywrócenie jak dotąd.
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"delete","entity":"group_members","id":"d0d30000-0000-7000-8000-0000000000a9"}'), 'ok', '25: owner usuwa profil dziecka');
select is((select removed_at from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a9'), null, '26: bez śladu usunięcia (bez konta nie wraca zaproszeniem)');
select is(pg_temp.p('c1000000-0000-7000-8000-000000000001', '{"kind":"restore","entity":"group_members","id":"d0d30000-0000-7000-8000-0000000000a9"}'), 'ok', '27: „Cofnij” przywraca profil dziecka');

-- Usunięcie konta: oczekujące przekazania tej osoby też są anulowane (sprzątanie serwera, bez śladu usunięcia).
select pg_temp.as_user('');
delete from auth.users where id = '00000000-0000-7000-8000-0000000000c4';
select is(pg_temp.status('d0d30000-0000-7000-8000-0000000003f3'), 'cancelled', '28: przekazanie do osoby, która usunęła konto — anulowane');
select is((select removed_at from public.group_members where member_id = 'd0d30000-0000-7000-8000-0000000000a4'), null, '29: usunięcie konta to nie usunięcie przez kogoś');
select is((select count(*)::int from public.handoffs where status = 'pending'), 0, '30: nic nie czeka na przyjęcie');

select * from finish();
rollback;
