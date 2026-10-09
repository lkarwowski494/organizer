-- Zakres Moich spraw na koncie i historia zakupów (migracja 20261008570000_my_scopes_trips): zapis przez synchronizację,
-- widoczność tylko dla siebie (zakres) i dla widzących listę (zakupy), strażnicy, sprzątanie po wyjściu z grupy,
-- retencja 90 dni, pobieranie (nowe encje tylko dla telefonów, które je znają).
begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000057e1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000057e2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000057e3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000057e4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.scope_id(member uuid) returns uuid language sql security definer as $$
  select private.uuid_v5('2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9'::uuid, member::text)
$$;
create function pg_temp.scope_of(member uuid) returns text language sql security definer as $$
  select coalesce((select scope from public.my_day_scopes where member_id = member), '-')
$$;
create function pg_temp.trip(id uuid) returns text language sql security definer as $$
  select coalesce((select coalesce(planned_date::text, '-') || ' ' || done_by::text || ' ' || (deleted_at is not null)::text from public.shopping_trips where shopping_trips.id = trip.id), 'brak')
$$;
create function pg_temp.pulled(ents jsonb, ver int) returns jsonb language sql as $$
  select coalesce((select jsonb_agg(x ->> 'e' order by x ->> 'e') from jsonb_array_elements(public.sync_pull('{}'::jsonb, 1000, ver, ents) -> 'groups') g, jsonb_array_elements(g -> 'rows') x
                   where g ->> 'group_id' = '57570000-0000-7000-8000-000000000001' and x ->> 'e' in ('my_day_scopes', 'shopping_trips')), '[]'::jsonb)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: O owner (f1), M członek (f2), C dziecko z kontem (f3). X spoza grupy. Lista zakupów a1, lista zadań a2.
select pg_temp.as_user('00000000-0000-7000-8000-0000000057e1');
set local role authenticated;
select public.create_group('57570000-0000-7000-8000-000000000001', 'G', '57570000-0000-7000-8000-0000000000f1', 'O');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('57570000-0000-7000-8000-0000000000f2', '57570000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000057e2', 'M', 'member'),
  ('57570000-0000-7000-8000-0000000000f3', '57570000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000057e3', 'C', 'child');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('57570000-0000-7000-8000-0000000000a1', '57570000-0000-7000-8000-000000000001', 'shopping', 'Zakupy', '57570000-0000-7000-8000-0000000000f1'),
  ('57570000-0000-7000-8000-0000000000a2', '57570000-0000-7000-8000-000000000001', 'tasks', 'Dom', '57570000-0000-7000-8000-0000000000f1');

select has_table('public', 'my_day_scopes', '1: tabela zakresów');
select has_table('public', 'shopping_trips', '2: tabela zakupów');
select ok((select '{id,group_id,member_id,scope}'::text[] <@ insert_cols and patch_cols = '{scope}' from private.sync_entities where entity = 'my_day_scopes'), '3: zakres w synchronizacji');
select ok((select patch_cols = '{}' and soft_delete from private.sync_entities where entity = 'shopping_trips'), '4: zakupy — tylko tworzenie i usunięcie');

-- Zakres: M ustawia swój.
select pg_temp.as_user('00000000-0000-7000-8000-0000000057e2');
set local role authenticated;
select is(pg_temp.push('57570000-0000-7000-8000-00000000c002', 1, jsonb_build_object('kind', 'create', 'entity', 'my_day_scopes', 'id', pg_temp.scope_id('57570000-0000-7000-8000-0000000000f2'),
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('member_id', '57570000-0000-7000-8000-0000000000f2', 'scope', 'mine'))), 'ok', '5: własny zakres');
select is(pg_temp.scope_of('57570000-0000-7000-8000-0000000000f2'), 'mine', '6: zapisany');
select is(pg_temp.push('57570000-0000-7000-8000-00000000c002', 2, jsonb_build_object('kind', 'patch', 'entity', 'my_day_scopes', 'id', pg_temp.scope_id('57570000-0000-7000-8000-0000000000f2'),
  'set', jsonb_build_object('scope', 'mineAndEvents'))), 'ok', '7: zmiana zakresu');
select is(pg_temp.scope_of('57570000-0000-7000-8000-0000000000f2'), 'mineAndEvents', '8: zmieniony');
select is(pg_temp.push('57570000-0000-7000-8000-00000000c002', 3, jsonb_build_object('kind', 'create', 'entity', 'my_day_scopes', 'id', pg_temp.scope_id('57570000-0000-7000-8000-0000000000f1'),
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('member_id', '57570000-0000-7000-8000-0000000000f1', 'scope', 'mine'))), 'forbidden:not_self', '9: cudzy zakres — nie');
select throws_ok($$ insert into public.my_day_scopes (id, group_id, member_id, scope) values (gen_random_uuid(), '57570000-0000-7000-8000-000000000001', '57570000-0000-7000-8000-0000000000f2', 'mine') $$,
  'P0001', 'invalid_id', '10: id nie z member_id — nie');
select throws_ok($$ update public.my_day_scopes set scope = 'wszystko' $$, '23514', null, '11: nieznany zakres — nie');
select is(pg_temp.pulled('["my_day_scopes","shopping_trips"]', 2), '["my_day_scopes"]'::jsonb, '12: pobranie z nową encją — mój zakres');
select is(pg_temp.pulled(null, 2), '[]'::jsonb, '13: build 21 (bez listy encji) — bez nowych encji');
reset role;

select pg_temp.as_user('00000000-0000-7000-8000-0000000057e1');
set local role authenticated;
select is((select count(*)::int from public.my_day_scopes), 0, '14: inni członkowie nie widzą cudzego zakresu');
select is(pg_temp.pulled('["my_day_scopes","shopping_trips"]', 2), '[]'::jsonb, '15: ani w pobieraniu');

-- Zakupy: O kończy zakupy.
select is(pg_temp.push('57570000-0000-7000-8000-00000000c001', 1, jsonb_build_object('kind', 'create', 'entity', 'shopping_trips', 'id', '57570000-0000-7000-8000-0000000000b1',
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', '57570000-0000-7000-8000-0000000000a1', 'planned_date', '2026-10-09', 'done_at', '2026-10-09T08:00:00Z'))), 'ok', '16: zakupy zrobione');
select is(pg_temp.trip('57570000-0000-7000-8000-0000000000b1'), '2026-10-09 57570000-0000-7000-8000-0000000000f1 false', '17: plan i kto (serwer)');
select is(pg_temp.push('57570000-0000-7000-8000-00000000c001', 2, jsonb_build_object('kind', 'create', 'entity', 'shopping_trips', 'id', '57570000-0000-7000-8000-0000000000b2',
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', '57570000-0000-7000-8000-0000000000a2', 'done_at', '2026-10-09T08:00:00Z'))), 'invalid_list', '18: lista zadań — nie');
select is(pg_temp.push('57570000-0000-7000-8000-00000000c001', 3, jsonb_build_object('kind', 'delete', 'entity', 'shopping_trips', 'id', '57570000-0000-7000-8000-0000000000b1')), 'ok', '19: „Cofnij” usuwa');
select is(pg_temp.trip('57570000-0000-7000-8000-0000000000b1'), '2026-10-09 57570000-0000-7000-8000-0000000000f1 true', '20: w koszu');
select is(pg_temp.push('57570000-0000-7000-8000-00000000c001', 4, jsonb_build_object('kind', 'create', 'entity', 'shopping_trips', 'id', '57570000-0000-7000-8000-0000000000b6',
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', '57570000-0000-7000-8000-0000000000a1', 'done_at', (now() + interval '3 days')::text))), 'ok', '27a: chwila z przyszłości');
select ok((select done_at <= now() from public.shopping_trips where id = '57570000-0000-7000-8000-0000000000b6'), '27b: przycięta do teraz');
select throws_ok($$ update public.shopping_trips set done_at = now() where id = '57570000-0000-7000-8000-0000000000b1' $$, '42501', null, '21: chwila zakupów stała (bez prawa zmiany kolumny)');
reset role;

select pg_temp.as_user('00000000-0000-7000-8000-0000000057e3');
set local role authenticated;
select is(pg_temp.push('57570000-0000-7000-8000-00000000c003', 1, jsonb_build_object('kind', 'create', 'entity', 'shopping_trips', 'id', '57570000-0000-7000-8000-0000000000b3',
  'group_id', '57570000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', '57570000-0000-7000-8000-0000000000a1', 'done_at', '2026-10-09T08:00:00Z'))), 'forbidden:child', '22: dziecko z kontem nie kończy zakupów (PW-14 B)');
reset role;

select pg_temp.as_user('00000000-0000-7000-8000-0000000057e4');
set local role authenticated;
select is((select count(*)::int from public.shopping_trips), 0, '23: obcy nie widzi zakupów');
reset role;

-- Wyjście z grupy: zakres tej osoby znika.
select pg_temp.as_user('');
update public.group_members set deleted_at = now() where member_id = '57570000-0000-7000-8000-0000000000f2';
select is(pg_temp.scope_of('57570000-0000-7000-8000-0000000000f2'), '-', '24: po wyjściu bez zakresu');

-- Retencja: zakupy starsze niż trip_days() sprzątane, nowsze zostają.
insert into public.shopping_trips (id, group_id, list_id, done_at) values
  ('57570000-0000-7000-8000-0000000000b4', '57570000-0000-7000-8000-000000000001', '57570000-0000-7000-8000-0000000000a1', now() - make_interval(days => private.trip_days() + 1)),
  ('57570000-0000-7000-8000-0000000000b5', '57570000-0000-7000-8000-000000000001', '57570000-0000-7000-8000-0000000000a1', now() - interval '1 day');
select ok('57570000-0000-7000-8000-000000000001'::uuid in (select private.purge_candidates()), '25: grupa do sprzątania');
select private.purge_group('57570000-0000-7000-8000-000000000001');
select is((select array_agg(id::text order by id) from public.shopping_trips), array['57570000-0000-7000-8000-0000000000b1', '57570000-0000-7000-8000-0000000000b5', '57570000-0000-7000-8000-0000000000b6'], '26: stare usunięte, nowe i świeżo cofnięte zostają');

select * from finish();
rollback;
