-- Listy, zadania, listy dozwolonych osób i aktywność (migracja 20261006120100_lists_tasks).
-- Najważniejsze: ukryta lista (restricted) nie wycieka przez listy, zadania, listę dozwolonych ani aktywność.
begin;
select plan(47);

-- Osoby: A owner, B member, K konto z rolą child, E obcy. Grupa G.
insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-00000000000a', 'a@x.test'), ('00000000-0000-7000-8000-00000000000b', 'b@x.test'),
  ('00000000-0000-7000-8000-00000000000d', 'k@x.test'), ('00000000-0000-7000-8000-00000000000e', 'e@x.test');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;
select public.create_group('22222222-0000-7000-8000-000000000001', 'Rodzina', '22222222-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('22222222-0000-7000-8000-0000000000b1', '22222222-0000-7000-8000-000000000001', '00000000-0000-7000-8000-00000000000b', 'Bartek', 'member'),
  ('22222222-0000-7000-8000-0000000000d1', '22222222-0000-7000-8000-000000000001', '00000000-0000-7000-8000-00000000000d', 'Kuba', 'child');

-- ── A: listy ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;
insert into public.lists (id, group_id, kind, name) values
  ('33333333-0000-7000-8000-000000000001', '22222222-0000-7000-8000-000000000001', 'tasks', 'Dom'),
  ('33333333-0000-7000-8000-000000000003', '22222222-0000-7000-8000-000000000001', 'shopping', 'Zakupy');
insert into public.lists (id, group_id, kind, name, visibility) values
  ('33333333-0000-7000-8000-000000000002', '22222222-0000-7000-8000-000000000001', 'tasks', 'Prezenty', 'restricted');
select is((select owner_member_id from public.lists where id = '33333333-0000-7000-8000-000000000001'),
  '22222222-0000-7000-8000-0000000000a1'::uuid, '1: właściciel listy ustawiany przez serwer');
select throws_ok($$ insert into public.lists (id, group_id, kind, name, owner_member_id) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', 'tasks', 'X', '22222222-0000-7000-8000-0000000000b1') $$,
  '42501', null, '2: klient nie podaje właściciela listy');

-- Zadania na 3 poziomach (D4).
insert into public.tasks (id, group_id, list_id, title) values ('44444444-0000-7000-8000-000000000001', '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', 'Remont');
insert into public.tasks (id, group_id, list_id, parent_id, title) values ('44444444-0000-7000-8000-000000000002', '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', '44444444-0000-7000-8000-000000000001', 'Łazienka');
insert into public.tasks (id, group_id, list_id, parent_id, title) values ('44444444-0000-7000-8000-000000000003', '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', '44444444-0000-7000-8000-000000000002', 'Płytki');
select is((select array_agg(depth order by depth) from public.tasks where list_id = '33333333-0000-7000-8000-000000000001'), array[0, 1, 2], '3: głębokość liczona przez serwer');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, parent_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', '44444444-0000-7000-8000-000000000003', 'Fuga') $$,
  'P0001', 'depth_exceeded', '4: czwarty poziom odrzucony (MAX_TASK_DEPTH = 2)');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, parent_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000002', '44444444-0000-7000-8000-000000000001', 'X') $$,
  'P0001', 'invalid_parent', '5: rodzic z innej listy');
select throws_ok($$ update public.tasks set parent_id = null where id = '44444444-0000-7000-8000-000000000003' $$,
  '42501', null, '6: rodzica nie zmienia się zwykłą edycją');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000003', 'X') $$,
  'P0001', 'invalid_list:kind', '7: zadanie nie trafia na listę zakupów');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, due_time) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', 'X', '10:00') $$,
  '23514', null, '8: godzina wymaga daty');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, deadline_mode) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', 'X', 'own') $$,
  '23514', null, '9: własny termin wymaga daty');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', '') $$,
  '23514', null, '10: pusty tytuł odrzucony');

-- Ukryta lista: zadanie w niej i próba przypisania osoby, która jej nie widzi.
insert into public.tasks (id, group_id, list_id, title) values ('44444444-0000-7000-8000-000000000010', '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000002', 'Rower dla Bartka');
select throws_ok($$ update public.tasks set assignee_member_id = '22222222-0000-7000-8000-0000000000b1' where id = '44444444-0000-7000-8000-000000000010' $$,
  'P0001', 'invalid_assignee', '11: nie przypisuje się osoby, która nie widzi listy');
select lives_ok($$ update public.tasks set assignee_member_id = '22222222-0000-7000-8000-0000000000b1' where id = '44444444-0000-7000-8000-000000000001' $$,
  '12: przypisanie członka na liście grupowej');

-- ── B (member) ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
select is((select count(*)::int from public.lists), 2, '13: B widzi 2 listy grupowe, nie widzi ukrytej');
select is((select count(*)::int from public.tasks where list_id = '33333333-0000-7000-8000-000000000002'), 0, '14: B nie widzi zadań ukrytej listy');
select is((select count(*)::int from public.activity where scope_id = '33333333-0000-7000-8000-000000000002'), 0, '15: B nie widzi aktywności ukrytej listy');
select is((select count(*)::int from public.activity where entity_id = '44444444-0000-7000-8000-000000000010'), 0, '16: ani wpisów o jej zadaniach');
select ok((select count(*) from public.activity where scope_id = '33333333-0000-7000-8000-000000000001') > 0, '17: B widzi aktywność listy grupowej');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000002', 'X') $$,
  'P0001', 'forbidden', '18: B nie dopisuje do ukrytej listy');
select is_empty($$ update public.tasks set title = 'hack' where id = '44444444-0000-7000-8000-000000000010' returning id $$, '19: B nie zmienia zadania ukrytej listy');
select throws_ok($$ update public.lists set visibility = 'private' where id = '33333333-0000-7000-8000-000000000001' $$,
  'P0001', 'forbidden:not_list_owner', '20: widoczność zmienia tylko twórca listy');
select throws_ok($$ insert into public.object_members (scope_entity, scope_id, member_id, group_id) values ('lists', '33333333-0000-7000-8000-000000000002', '22222222-0000-7000-8000-0000000000b1', '22222222-0000-7000-8000-000000000001') $$,
  'P0001', 'forbidden:not_list_owner', '21: B nie dopisuje się do ukrytej listy');
select lives_ok($$ update public.tasks set completed_at = now() where id = '44444444-0000-7000-8000-000000000002' $$, '22: B odhacza podzadanie');
select is((select completed_by from public.tasks where id = '44444444-0000-7000-8000-000000000002'), '22222222-0000-7000-8000-0000000000b1'::uuid, '23: „wykonał” ustawia serwer');
select throws_ok($$ update public.tasks set completed_by = '22222222-0000-7000-8000-0000000000a1' where id = '44444444-0000-7000-8000-000000000002' $$,
  '42501', null, '24: „wykonał” nie do podrobienia');
select lives_ok($$ update public.tasks set completed_at = null where id = '44444444-0000-7000-8000-000000000002' $$, '25: B cofa odhaczenie');
select is((select completed_by from public.tasks where id = '44444444-0000-7000-8000-000000000002'), null, '26: cofnięcie czyści „wykonał”');

-- ── K (child) ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000d', true);
select lives_ok($$ update public.tasks set completed_at = now() where id = '44444444-0000-7000-8000-000000000003' $$, '27: dziecko odhacza');
select throws_ok($$ update public.tasks set title = 'x' where id = '44444444-0000-7000-8000-000000000003' $$, 'P0001', 'forbidden:child', '28: dziecko nie zmienia tytułu');
select throws_ok($$ update public.tasks set deleted_at = now() where id = '44444444-0000-7000-8000-000000000003' $$, 'P0001', 'forbidden:child', '29: dziecko nie usuwa');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', 'X') $$,
  'P0001', 'forbidden:child', '30: dziecko nie dodaje zadań');
select throws_ok($$ insert into public.lists (id, group_id, kind, name) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', 'tasks', 'X') $$,
  'P0001', 'forbidden:child', '31: dziecko nie dodaje list');

-- ── E (obcy) ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000e', true);
select is((select count(*)::int from public.tasks), 0, '32: obcy nie widzi zadań');
select is((select count(*)::int from public.activity where group_id = '22222222-0000-7000-8000-000000000001'), 0, '33: obcy nie widzi aktywności cudzej grupy');
select throws_ok($$ insert into public.lists (id, group_id, kind, name) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', 'tasks', 'X') $$,
  'P0001', 'forbidden', '34: obcy nie dodaje list do cudzej grupy');

-- ── A: udostępnienie ukrytej listy B i cofnięcie ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
select lives_ok($$ insert into public.object_members (scope_entity, scope_id, member_id, group_id) values ('lists', '33333333-0000-7000-8000-000000000002', '22222222-0000-7000-8000-0000000000b1', '22222222-0000-7000-8000-000000000001') $$,
  '35: A udostępnia ukrytą listę B');
reset role;
select is((select count(*)::int from private.access_events where kind = 'scope_granted' and scope_id = '33333333-0000-7000-8000-000000000002'), 1, '36: zdarzenie scope_granted');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
set local role authenticated;
select is((select count(*)::int from public.tasks where list_id = '33333333-0000-7000-8000-000000000002'), 1, '37: B widzi zadania udostępnionej listy');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
update public.object_members set deleted_at = now() where scope_id = '33333333-0000-7000-8000-000000000002';
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
select is((select count(*)::int from public.lists where id = '33333333-0000-7000-8000-000000000002'), 0, '38: po cofnięciu B nie widzi listy');

-- ── A: kaskada usuwania i przywracania ──
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
update public.tasks set deleted_at = now() where id = '44444444-0000-7000-8000-000000000001';
select is((select count(*)::int from public.tasks where list_id = '33333333-0000-7000-8000-000000000001' and deleted_at is not null), 3, '39: usunięcie zadania usuwa podzadania');
update public.tasks set deleted_at = null where id = '44444444-0000-7000-8000-000000000001';
select is((select count(*)::int from public.tasks where list_id = '33333333-0000-7000-8000-000000000001' and deleted_at is null), 3, '40: przywrócenie przywraca podzadania');
update public.lists set deleted_at = now() where id = '33333333-0000-7000-8000-000000000001';
select is((select count(*)::int from public.tasks where list_id = '33333333-0000-7000-8000-000000000001' and deleted_at is null), 0, '41: usunięcie listy usuwa jej zadania');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title) values (gen_random_uuid(), '22222222-0000-7000-8000-000000000001', '33333333-0000-7000-8000-000000000001', 'X') $$,
  'P0001', 'deleted:list', '42: brak dopisywania do usuniętej listy');

-- ── Aktywność i wersje ──
select is((select changes -> 'title' from public.activity where entity_id = '44444444-0000-7000-8000-000000000001' and verb = 'create'),
  '[null, "Remont"]'::jsonb, '43: aktywność zapisuje [stara, nowa]');
select is((select actor_name from public.activity where entity_id = '44444444-0000-7000-8000-000000000002' and changes ? 'completed_at' limit 1),
  'Bartek', '44: aktywność zna wykonawcę');
select ok(not exists (select 1 from public.activity where changes ? 'version'), '45: wersja nie jest „zmianą”');
select ok(not exists (select 1 from public.activity where verb = 'create' and changes ? 'completed_at'), '45b: puste pola nowego wiersza nie są „zmianą”');
reset role;
select is((select count(distinct version) = count(*) from (
  select version from public.tasks where group_id = '22222222-0000-7000-8000-000000000001'
  union all select version from public.lists where group_id = '22222222-0000-7000-8000-000000000001') v), true,
  '46: każdy zapis ma unikalną wersję grupy');

select * from finish();
rollback;
