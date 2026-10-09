-- Audyt 3 (PK-07, migracje 20261010070000_task_repeat_chain i 20261010120500_child_repeat_copy): pierwotny dzień
-- terminu (N-25) i następny termin zadania powtarzanego dziecka z kontem (Q16 A, N-123).
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000007c1', 'o@trc.test'),
  ('00000000-0000-7000-8000-0000000007c4', 'tymek@trc.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
-- Identyfikatory następnych terminów (jak nextId na telefonie), policzone przed przejściem na rolę authenticated.
create table pg_temp.ids (k text primary key, id uuid);
grant all on pg_temp.ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from pg_temp.ids where ids.k = id.k $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: owner Ala (a1), dziecko z kontem Tymek (b1); lista „Dom”. Zadania: S — codziennie, Tymka, z podzadaniem SS;
-- O — codziennie, Ali; T — codziennie, Tymka (do odrzuceń).
select pg_temp.as_user('00000000-0000-7000-8000-0000000007c1');
set local role authenticated;
select public.create_group('07c00000-0000-7000-8000-000000000001', 'Rodzina', '07c00000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('07c00000-0000-7000-8000-0000000000b1', '07c00000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000007c4', 'Tymek', 'child');
insert into public.lists (id, group_id, kind, name, owner_member_id) values
  ('07c00000-0000-7000-8000-0000000000e1', '07c00000-0000-7000-8000-000000000001', 'tasks', 'Dom', '07c00000-0000-7000-8000-0000000000a1');
insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat) values
  ('07c00000-0000-7000-8000-0000000000d1', '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Łóżko', '07c00000-0000-7000-8000-0000000000b1', 'own', '2026-10-12', 'FREQ=DAILY'),
  ('07c00000-0000-7000-8000-0000000000d3', '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Rachunki', '07c00000-0000-7000-8000-0000000000a1', 'own', '2026-10-12', 'FREQ=DAILY'),
  ('07c00000-0000-7000-8000-0000000000d4', '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Biurko', '07c00000-0000-7000-8000-0000000000b1', 'own', '2026-10-12', 'FREQ=DAILY');
insert into public.tasks (id, group_id, list_id, parent_id, title, deadline_mode) values
  ('07c00000-0000-7000-8000-0000000000d2', '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', '07c00000-0000-7000-8000-0000000000d1', 'Pościel', 'inherit');
insert into pg_temp.ids values
  ('c', private.next_task_id('07c00000-0000-7000-8000-0000000000d1')),
  ('cs', private.next_task_id('07c00000-0000-7000-8000-0000000000d2')),
  ('co', private.next_task_id('07c00000-0000-7000-8000-0000000000d3')),
  ('ct', private.next_task_id('07c00000-0000-7000-8000-0000000000d4'));

-- ───────── 1–3: pierwotny dzień terminu (N-25) ─────────
select ok((select 'cycle_date' = any (insert_cols) and 'cycle_date' = any (patch_cols) from private.sync_entities where entity = 'tasks'), '1: cycle_date w białej liście synchronizacji');
select pg_temp.as_user('00000000-0000-7000-8000-0000000007c1');
set local role authenticated;
select is(pg_temp.push('07c00000-0000-7000-8000-0000000000f1', 1, '{"kind":"patch","entity":"tasks","id":"07c00000-0000-7000-8000-0000000000d3","set":{"due_date":"2026-10-09","cycle_date":"2026-10-12"}}'),
  'ok', '2: dorosły zapisuje pierwotny dzień razem z przeniesieniem');
select is((select cycle_date from public.tasks where id = '07c00000-0000-7000-8000-0000000000d3'), '2026-10-12'::date, '3: zapisany');
reset role;

-- ───────── 4–19: dziecko i następny termin swojego zadania (Q16 A) ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000007c4');
set local role authenticated;
select lives_ok($$ update public.tasks set completed_at = now() where id = '07c00000-0000-7000-8000-0000000000d1' $$, '4: dziecko odhacza swoje zadanie');
select is(pg_temp.push('07c00000-0000-7000-8000-0000000000f4', 1, jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', pg_temp.id('c'), 'group_id', '07c00000-0000-7000-8000-000000000001',
  'set', jsonb_build_object('list_id', '07c00000-0000-7000-8000-0000000000e1', 'parent_id', null, 'title', 'Łóżko', 'note', null, 'sort_key', 'a0', 'assignee_member_id', '07c00000-0000-7000-8000-0000000000b1',
                            'deadline_mode', 'own', 'due_date', '2026-10-13', 'due_time', null, 'rollover', true, 'repeat', 'FREQ=DAILY'))),
  'ok', '5: i zakłada jego następny termin (operacja z telefonu)');
select lives_ok(format($$ insert into public.tasks (id, group_id, list_id, parent_id, title, deadline_mode) values (%L, '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', %L, 'Pościel', 'inherit') $$, pg_temp.id('cs'), pg_temp.id('c')),
  '6: i kopię podzadania pod nim');
select is((select created_by from public.tasks where id = pg_temp.id('c')), '07c00000-0000-7000-8000-0000000000b1'::uuid, '7: twórcą jest dziecko');
select throws_ok(format($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat) values (%L, '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Rachunki', '07c00000-0000-7000-8000-0000000000a1', 'own', '2026-10-13', 'FREQ=DAILY') $$, pg_temp.id('co')),
  'P0001', 'forbidden:child', '8: następnego cudzego zadania — nie');
select throws_ok($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat) values ('07c00000-0000-7000-8000-0000000000d9', '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Biurko', '07c00000-0000-7000-8000-0000000000b1', 'own', '2026-10-13', 'FREQ=DAILY') $$,
  'P0001', 'forbidden:child', '9: zadania z innym id (nie następny termin) — nie');
select throws_ok(format($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat) values (%L, '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Wolne', '07c00000-0000-7000-8000-0000000000b1', 'own', '2026-10-13', 'FREQ=DAILY') $$, pg_temp.id('ct')),
  'P0001', 'forbidden:child', '10: następny z inną nazwą — nie');
select throws_ok(format($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat, note) values (%L, '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Biurko', '07c00000-0000-7000-8000-0000000000b1', 'own', '2026-10-13', 'FREQ=DAILY', 'x') $$, pg_temp.id('ct')),
  'P0001', 'forbidden:child', '11: z inną notatką — nie');
select throws_ok(format($$ insert into public.tasks (id, group_id, list_id, title, assignee_member_id, deadline_mode, due_date, repeat) values (%L, '07c00000-0000-7000-8000-000000000001', '07c00000-0000-7000-8000-0000000000e1', 'Biurko', '07c00000-0000-7000-8000-0000000000a1', 'own', '2026-10-13', 'FREQ=DAILY') $$, pg_temp.id('ct')),
  'P0001', 'forbidden:child', '12: z inną osobą — nie');
select throws_ok(format($$ update public.tasks set title = 'Łóżko!' where id = %L $$, pg_temp.id('c')), 'P0001', 'forbidden:child', '13: następnego nie zmienia poza terminem');
-- Cofnięcie odhaczenia: telefon odznacza i zdejmuje nietknięte następne (z podzadaniami — kaskada).
select lives_ok($$ update public.tasks set completed_at = null where id = '07c00000-0000-7000-8000-0000000000d1' $$, '14: cofa odhaczenie');
select is(pg_temp.push('07c00000-0000-7000-8000-0000000000f4', 2, jsonb_build_object('kind', 'delete', 'entity', 'tasks', 'id', pg_temp.id('c'))), 'ok', '15: i zdejmuje następne');
select isnt((select deleted_at from public.tasks where id = pg_temp.id('cs')), null, '16: razem z kopią podzadania');
-- Ponowne odhaczenie: następne wraca z kosza z terminem (T-1).
select is(pg_temp.push('07c00000-0000-7000-8000-0000000000f4', 3, jsonb_build_object('kind', 'restore', 'entity', 'tasks', 'id', pg_temp.id('c'))), 'ok', '17: przywraca następne');
select is(pg_temp.push('07c00000-0000-7000-8000-0000000000f4', 4, jsonb_build_object('kind', 'patch', 'entity', 'tasks', 'id', pg_temp.id('c'), 'set', '{"due_date":"2026-10-14","due_time":null}'::jsonb)), 'ok', '18: z nowym terminem');
select throws_ok($$ update public.tasks set deleted_at = now() where id = '07c00000-0000-7000-8000-0000000000d1' $$, 'P0001', 'forbidden:child', '19: samego zadania (nie następnego) nie usuwa');
select lives_ok(format($$ update public.tasks set completed_at = now() where id = %L $$, pg_temp.id('c')), '20: odhacza następne');
select throws_ok(format($$ update public.tasks set deleted_at = now() where id = %L $$, pg_temp.id('c')), 'P0001', 'forbidden:child', '21: odhaczonego następnego nie zdejmuje');
reset role;

-- ───────── 22–24: strażnik ma obie zasady dziecka (PK-12 i PK-07) ─────────
-- Kolejna migracja, która zdefiniuje private.tasks_guard od nowa bez którejś z nich, obleje ten test.
select ok(pg_get_functiondef('private.tasks_guard()'::regprocedure) like '%child_repeat_insert_ok(new, me)%'
      and pg_get_functiondef('private.tasks_guard()'::regprocedure) like '%child_repeat_update_ok(new, old, me)%', '22: wyjątek Q16 A (następny termin) w tasks_guard');
select ok(pg_get_functiondef('private.tasks_guard()'::regprocedure) like '%l.kind is not distinct from ''shopping''%', '23: wyjątek Q6d A (zakupy dziecka, PK-12) w tasks_guard');
select ok(pg_get_functiondef('private.tasks_guard()'::regprocedure) like '%forbidden:not_own%', '24: dziecko odhacza tylko swoje (PW-14 B) w tasks_guard');

select * from finish();
rollback;
