-- Usunięcie konta (migracja 20261007110000_account_deletion, decyzja D49).
begin;
select plan(30);

-- A = Ala (usuwana), B = Bartek, C = Celina, D = Dorota, E = Edek, F = Franek, H = Hania, J = Julek (dziecko z kontem).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-7000-8000-0000000000a1', 'a@x.test', '{"display_name":"Ala"}'),
  ('00000000-0000-7000-8000-0000000000b1', 'b@x.test', '{"display_name":"Bartek"}'),
  ('00000000-0000-7000-8000-0000000000c1', 'c@x.test', '{"display_name":"Celina"}'),
  ('00000000-0000-7000-8000-0000000000d1', 'd@x.test', '{"display_name":"Dorota"}'),
  ('00000000-0000-7000-8000-0000000000e1', 'e@x.test', '{"display_name":"Edek"}'),
  ('00000000-0000-7000-8000-0000000000f1', 'f@x.test', '{"display_name":"Franek"}'),
  ('00000000-0000-7000-8000-0000000000f2', 'h@x.test', '{"display_name":"Hania"}'),
  ('00000000-0000-7000-8000-0000000000f3', 'j@x.test', '{"display_name":"Julek"}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated;

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true)
$$;
-- Przygotowanie danych: każda operacja musi przejść (inaczej test przerywa się błędem, nie po cichu).
create function pg_temp.push(client text, seq int, op jsonb) returns void language plpgsql as $$
declare r jsonb := public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0;
begin
  if r ->> 'status' <> 'ok' then raise exception 'push nie przeszedł: %', r; end if;
end $$;
create function pg_temp.role_of(mid text) returns text language sql as $$
  select role from public.group_members where member_id = mid::uuid
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb) to authenticated;

-- ── G1 „Rodzina”: owner A; C (member, starszy staż), B (admin, krótszy staż), K (dziecko bez konta, najdłużej).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000001', 'Rodzina', '77770000-0000-7000-8000-0000000001a1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role, created_at) values
  ('77770000-0000-7000-8000-0000000001c1', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000c1', 'Celina', 'member', now() - interval '20 days'),
  ('77770000-0000-7000-8000-0000000001b1', '77770000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000b1', 'Bartek', 'admin', now() - interval '10 days'),
  ('77770000-0000-7000-8000-0000000001e9', '77770000-0000-7000-8000-000000000001', null, 'Tymek', 'child', now() - interval '30 days');

-- Zawartość od A: lista wspólna z zadaniem, lista prywatna, zmiana własnej nazwy, zaproszenie; B też wystawia zaproszenie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000a1');
set local role authenticated;
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 1, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000011aa","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 2, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-0000000012aa","group_id":"77770000-0000-7000-8000-000000000001","set":{"list_id":"77770000-0000-7000-8000-0000000011aa","title":"Wynieść śmieci"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 3, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000011bb","group_id":"77770000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"private"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 4, '{"kind":"patch","entity":"group_members","id":"77770000-0000-7000-8000-0000000001a1","set":{"display_name":"Ala K."}}');
-- Grupa osobista A (id = user_id) z listą i zadaniem.
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 5, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000013aa","group_id":"00000000-0000-7000-8000-0000000000a1","set":{"kind":"tasks","name":"Moje"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000cca1', 6, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-0000000013bb","group_id":"00000000-0000-7000-8000-0000000000a1","set":{"list_id":"77770000-0000-7000-8000-0000000013aa","title":"Lekarz"}}');
insert into t values ('invA', public.create_invite('77770000-0000-7000-8000-000000000001'));
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
insert into t values ('invB', public.create_invite('77770000-0000-7000-8000-000000000001'));

-- ── G3: owner B, A zwykłym członkiem.
select public.create_group('77770000-0000-7000-8000-000000000003', 'Znajomi', '77770000-0000-7000-8000-0000000003b1', 'Bartek');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77770000-0000-7000-8000-0000000003a1', '77770000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-0000000000a1', 'Ala', 'member');

-- ── G2: owner D, poza nią tylko dzieci (bez konta i z kontem) → po usunięciu D kosz.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000d1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000002', 'Dzieci', '77770000-0000-7000-8000-0000000002d1', 'Dorota');
select pg_temp.push('77770000-0000-7000-8000-00000000ccd1', 1, '{"kind":"create","entity":"lists","id":"77770000-0000-7000-8000-0000000021aa","group_id":"77770000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"Szkoła"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000ccd1', 2, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-0000000022aa","group_id":"77770000-0000-7000-8000-000000000002","set":{"list_id":"77770000-0000-7000-8000-0000000021aa","title":"Plecak"}}');
select pg_temp.push('77770000-0000-7000-8000-00000000ccd1', 3, '{"kind":"create","entity":"tasks","id":"77770000-0000-7000-8000-0000000022bb","group_id":"77770000-0000-7000-8000-000000000002","set":{"list_id":"77770000-0000-7000-8000-0000000021aa","title":"Zeszyt","parent_id":"77770000-0000-7000-8000-0000000022aa"}}');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('77770000-0000-7000-8000-0000000002e9', '77770000-0000-7000-8000-000000000002', null, 'Tymek', 'child'),
  ('77770000-0000-7000-8000-0000000002f3', '77770000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000000f3', 'Julek', 'child');

-- ── G4: owner E, sami memberzy: F (dłuższy staż), H (krótszy).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('77770000-0000-7000-8000-000000000004', 'Praca', '77770000-0000-7000-8000-0000000004e1', 'Edek');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role, created_at) values
  ('77770000-0000-7000-8000-0000000004f2', '77770000-0000-7000-8000-000000000004', '00000000-0000-7000-8000-0000000000f2', 'Hania', 'member', now() - interval '1 day'),
  ('77770000-0000-7000-8000-0000000004f1', '77770000-0000-7000-8000-000000000004', '00000000-0000-7000-8000-0000000000f1', 'Franek', 'member', now() - interval '5 days');

-- 1–2: uprawnienia — nikt z aplikacji nie wywoła tego bezpośrednio.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
set local role authenticated;
select throws_ok($$ select private.delete_account_data('00000000-0000-7000-8000-0000000000a1') $$, '42501', null, '1: authenticated nie wywoła delete_account_data');
select throws_ok($$ select private.purge_deleted_groups() $$, '42501', null, '2: authenticated nie wywoła purge_deleted_groups');
reset role;
select pg_temp.as_user('');

insert into t select 'g1v', to_jsonb(version) from public.groups where id = '77770000-0000-7000-8000-000000000001';

-- ── Usunięcie konta A (tak jak robi to auth.admin.deleteUser).
delete from auth.users where id = '00000000-0000-7000-8000-0000000000a1';

-- 3–9: przekazanie G1.
select is(pg_temp.role_of('77770000-0000-7000-8000-0000000001b1'), 'owner', '3: G1 przejmuje admin, choć member ma dłuższy staż');
select is(pg_temp.role_of('77770000-0000-7000-8000-0000000001c1'), 'member', '4: member bez zmian');
select is((select count(*)::int from public.group_members where group_id = '77770000-0000-7000-8000-000000000001' and role = 'owner'), 1, '5: w G1 jest dokładnie jeden owner');
select ok((select deleted_at is not null and role = 'member' and user_id is null and color is null from public.group_members where member_id = '77770000-0000-7000-8000-0000000001a1'), '6: członkostwo A usunięte, bez roli ownera i bez konta');
select is((select display_name from public.group_members where member_id = '77770000-0000-7000-8000-0000000001a1'), 'Usunięty użytkownik', '7: nazwa członka zastąpiona podpisem');
select ok((select deleted_at is null from public.groups where id = '77770000-0000-7000-8000-000000000001'), '8: G1 nie trafia do kosza');
select ok((select version > (select (v)::text::bigint from t where k = 'g1v') from public.group_members where member_id = '77770000-0000-7000-8000-0000000001a1'), '9: zmiana członkostwa ma nową wersję (inni ją pobiorą)');

-- 10–12: zawartość G1.
select ok((select deleted_at is null from public.lists where id = '77770000-0000-7000-8000-0000000011aa'), '10: lista wspólna zostaje');
select ok((select deleted_at is null from public.tasks where id = '77770000-0000-7000-8000-0000000012aa'), '11: zadanie na liście wspólnej zostaje');
select ok((select deleted_at is not null from public.lists where id = '77770000-0000-7000-8000-0000000011bb'), '12: lista prywatna A usunięta');

-- 13–14: zaproszenia.
select ok((select revoked_at is not null from public.invites where id = (select (v ->> 'invite_id')::uuid from t where k = 'invA')), '13: zaproszenie wystawione przez A odwołane');
select ok((select revoked_at is null from public.invites where id = (select (v ->> 'invite_id')::uuid from t where k = 'invB')), '14: zaproszenie B działa dalej');

-- 15–18: historia.
select ok((select count(*) > 0 from public.activity where actor_member_id = '77770000-0000-7000-8000-0000000001a1'), '15: wpisy historii A zostają');
select is((select count(*)::int from public.activity where actor_member_id = '77770000-0000-7000-8000-0000000001a1' and actor_name is distinct from 'Usunięty użytkownik'), 0, '16: każdy wpis A podpisany „Usunięty użytkownik”');
select is((select count(*)::int from public.activity where activity::text ~ 'Ala'), 0, '17: imię A nie zostaje nigdzie w historii (także w zmianach nazwy)');
select is((select count(*)::int from public.activity where actor_member_id = '77770000-0000-7000-8000-0000000001a1' and version <= (select (v)::text::bigint from t where k = 'g1v')), 0, '18: poprawione wpisy historii mają nowe wersje');

-- 19–21: G3, grupa osobista, dane konta.
select ok((select deleted_at is not null and display_name = 'Usunięty użytkownik' from public.group_members where member_id = '77770000-0000-7000-8000-0000000003a1'), '19: członkostwo A w cudzej grupie usunięte i podpisane');
select ok(not exists (select 1 from public.groups where id = '00000000-0000-7000-8000-0000000000a1')
          and not exists (select 1 from public.lists where id = '77770000-0000-7000-8000-0000000013aa')
          and not exists (select 1 from public.tasks where id = '77770000-0000-7000-8000-0000000013bb'), '20: grupa osobista A usunięta z zawartością');
select ok(not exists (select 1 from public.profiles where user_id = '00000000-0000-7000-8000-0000000000a1')
          and not exists (select 1 from private.access_events where user_id = '00000000-0000-7000-8000-0000000000a1')
          and not exists (select 1 from private.sync_clients where user_id = '00000000-0000-7000-8000-0000000000a1'), '21: profil, zdarzenia dostępu i liczniki klienta usunięte');

-- 22: nowy owner G1 działa jak owner (pełna ścieżka przez RLS i strażnika).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000b1');
set local role authenticated;
select lives_ok($$ select public.create_invite('77770000-0000-7000-8000-000000000001', 'admin') $$, '22: nowy owner zaprasza admina');
reset role;
select pg_temp.as_user('');

-- 23–24: G4 — sami memberzy: wygrywa dłuższy staż.
delete from auth.users where id = '00000000-0000-7000-8000-0000000000e1';
select is(pg_temp.role_of('77770000-0000-7000-8000-0000000004f1'), 'owner', '23: bez admina przejmuje member z najdłuższym stażem');
select is(pg_temp.role_of('77770000-0000-7000-8000-0000000004f2'), 'member', '24: drugi member bez zmian');

-- 25–26: G2 — same dzieci (też dziecko z kontem): kosz.
delete from auth.users where id = '00000000-0000-7000-8000-0000000000d1';
select ok((select deleted_at is not null from public.groups where id = '77770000-0000-7000-8000-000000000002'), '25: grupa bez dorosłego trafia do kosza');
select is((select count(*)::int from public.group_members where group_id = '77770000-0000-7000-8000-000000000002' and role = 'owner'), 0, '26: dziecko (także z kontem) nie przejmuje grupy');

-- 27–30: kosz — przed terminem nic, po terminie grupa znika z całą zawartością; inne grupy nietknięte.
select is(private.purge_deleted_groups(), 0, '27: przed upływem terminu kosz niczego nie usuwa');
update public.groups set deleted_at = now() - make_interval(days => private.tombstone_days() + 1) where id = '77770000-0000-7000-8000-000000000002';
select is(private.purge_deleted_groups(), 1, '28: po terminie usunięta jedna grupa');
select ok(not exists (select 1 from public.groups where id = '77770000-0000-7000-8000-000000000002')
          and not exists (select 1 from public.tasks where group_id = '77770000-0000-7000-8000-000000000002')
          and not exists (select 1 from public.lists where group_id = '77770000-0000-7000-8000-000000000002')
          and not exists (select 1 from public.group_members where group_id = '77770000-0000-7000-8000-000000000002')
          and not exists (select 1 from public.activity where group_id = '77770000-0000-7000-8000-000000000002'), '29: grupa z koszem usunięta razem z zadaniami, listami, członkami i historią');
select is((select count(*)::int from public.groups where id in ('77770000-0000-7000-8000-000000000001', '77770000-0000-7000-8000-000000000003', '77770000-0000-7000-8000-000000000004')), 3, '30: pozostałe grupy nietknięte');

select * from finish();
rollback;
