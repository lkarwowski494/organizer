-- „Przenieś do grupy” jednym poleceniem i znacznik przeniesienia (migracja 20261010060000_move_task_to_group, audyt 3:
-- N-12, N-131, N-36).
begin;
select plan(40);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000006d1', 'ala@example.com'),
  ('00000000-0000-7000-8000-0000000006d2', 'jan@example.com'),
  ('00000000-0000-7000-8000-0000000006d3', 'tymek@example.com'),
  ('00000000-0000-7000-8000-0000000006d4', 'obcy@example.com');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
-- Polecenie przeniesienia: kopie [id, źródło, rodzic kopii, lista, osoba].
create function pg_temp.mv(task text, grp text, list jsonb, tasks jsonb) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'cmd', 'cmd', 'move_task_to_group', 'args',
    jsonb_build_object('task_id', task, 'group_id', grp, 'list', list, 'tasks', tasks))
$$;
create function pg_temp.cp(id text, src text, parent text, list text, title text, assignee text default null) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'from', src, 'set', jsonb_build_object('list_id', list, 'parent_id', parent, 'title', title,
    'assignee_member_id', assignee))
$$;
create function pg_temp.unmv(task text, copy text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'cmd', 'cmd', 'unmove_task', 'args', jsonb_build_object('task_id', task, 'copy_id', copy, 'title', 'x'))
$$;
create function pg_temp.op(kind text, id text) returns jsonb language sql as $$
  select jsonb_build_object('kind', kind, 'entity', 'tasks', 'id', id)
$$;
create function pg_temp.task(id text) returns public.tasks language sql security definer set search_path = '' as $$
  select * from public.tasks where tasks.id = $1::uuid
$$;
create function pg_temp.act(entity_id text) returns uuid language sql security definer set search_path = '' as $$
  select id from public.activity where entity_id = act.entity_id::uuid and verb = 'create' order by version limit 1
$$;
grant execute on function pg_temp.as_user(text), pg_temp.push(text, int, jsonb), pg_temp.mv(text, text, jsonb, jsonb),
  pg_temp.cp(text, text, text, text, text, text), pg_temp.unmv(text, text), pg_temp.op(text, text), pg_temp.task(text) to authenticated;

-- Dom (G1): Ala (owner a1), Jan (member a2), Tymek (dziecko z kontem a3); lista L1, zadanie T z podzadaniem S (na Jana).
-- Klasa (G2): Ala (owner b1), Jan (member b2); lista ogólna L2, lista usunięta LX. Obcy (G3) — osobna grupa.
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select public.create_group('06060000-0000-7000-8000-000000000001', 'Dom', '06060000-0000-7000-8000-0000000000a1', 'Ala');
select public.create_group('06060000-0000-7000-8000-000000000002', 'Klasa', '06060000-0000-7000-8000-0000000000b1', 'Ala');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('06060000-0000-7000-8000-0000000000a2', '06060000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006d2', 'Jan', 'member'),
  ('06060000-0000-7000-8000-0000000000a3', '06060000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000006d3', 'Tymek', 'child'),
  ('06060000-0000-7000-8000-0000000000b2', '06060000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-0000000006d2', 'Jan', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 1, '{"kind":"create","entity":"lists","id":"06060000-0000-7000-8000-0000000000e1","group_id":"06060000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}}') = 'ok';
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 2, '{"kind":"create","entity":"lists","id":"06060000-0000-7000-8000-0000000000e2","group_id":"06060000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"Ogólne"}}') = 'ok';
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 3, '{"kind":"create","entity":"lists","id":"06060000-0000-7000-8000-0000000000e3","group_id":"06060000-0000-7000-8000-000000000002","set":{"kind":"tasks","name":"Stara"}}') = 'ok';
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 4, '{"kind":"delete","entity":"lists","id":"06060000-0000-7000-8000-0000000000e3"}') = 'ok';
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 5, '{"kind":"create","entity":"tasks","id":"06060000-0000-7000-8000-000000000101","group_id":"06060000-0000-7000-8000-000000000001","set":{"list_id":"06060000-0000-7000-8000-0000000000e1","title":"Zebranie","assignee_member_id":"06060000-0000-7000-8000-0000000000a2"}}') = 'ok';
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 6, '{"kind":"create","entity":"tasks","id":"06060000-0000-7000-8000-000000000102","group_id":"06060000-0000-7000-8000-000000000001","set":{"list_id":"06060000-0000-7000-8000-0000000000e1","title":"Zgoda","parent_id":"06060000-0000-7000-8000-000000000101"}}') = 'ok';
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d4');
set local role authenticated;
select public.create_group('06060000-0000-7000-8000-000000000003', 'Obcy', '06060000-0000-7000-8000-0000000000c1', 'O');

-- 1–8: odrzucenia przed jakimkolwiek zapisem.
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a4', 1, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000003', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'X')))),
  'not_found', '1: cudzego zadania nie przeniosę');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d3');
set local role authenticated;
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a3', 1, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'X')))),
  'forbidden:child', '2: dziecko nie przenosi (D34)');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 10, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000001', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e1', 'X')))),
  'invalid_value', '3: do tej samej grupy — nie');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 11, pg_temp.mv('06060000-0000-7000-8000-000000000102', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000102', null, '06060000-0000-7000-8000-0000000000e2', 'X')))),
  'invalid_value', '4: podzadanie przenosi się tylko ze swoim zadaniem');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 12, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null, '[]')),
  'invalid_value', '5: bez kopii — nie');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 13, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000102', null, '06060000-0000-7000-8000-0000000000e2', 'X')))),
  'invalid_value', '6: pierwsza kopia musi być kopią przenoszonego zadania');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 14, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'X'),
                    pg_temp.cp('06060000-0000-7000-8000-000000000902', '06060000-0000-7000-8000-0000000000e1', '06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-0000000000e2', 'Y')))),
  'invalid_value', '7: źródło kopii spoza przenoszonego zadania — nie');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 15, '{"kind":"cmd","cmd":"move_task_to_group","args":{"task_id":"06060000-0000-7000-8000-000000000101"}}'),
  'invalid_value', '8: bez grupy i kopii — nie');

-- 9–13 (N-12): odrzucona kopia cofa całość — oryginał zostaje, nowa lista i kopie nie powstają.
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 20, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e3', 'Zebranie')))),
  'deleted:list', '9: lista docelowa usunięta na innym telefonie — odrzucone');
select is((pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at, null, '10: oryginał nie poszedł do kosza');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 21, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002',
  '{"id":"06060000-0000-7000-8000-0000000000e4","set":{"kind":"tasks","name":"Ogólne"}}',
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e4', 'Zebranie'),
                    pg_temp.cp('06060000-0000-7000-8000-000000000902', '06060000-0000-7000-8000-000000000102', '06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-0000000000e4', 'Zgoda',
                               '06060000-0000-7000-8000-0000000000a2')))),
  'invalid_assignee', '11: podzadanie z osobą spoza nowej grupy — odrzucone');
select is((select count(*)::int from public.lists where id = '06060000-0000-7000-8000-0000000000e4'), 0, '12: lista założona w poleceniu wycofana');
select is((select count(*)::int from public.tasks where id = '06060000-0000-7000-8000-000000000901'), 0, '13: kopia zadania głównego wycofana');

-- 14–21: przeniesienie, znacznik, kosz i powiadomienia.
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 30, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'Zebranie',
                               '06060000-0000-7000-8000-0000000000b2'),
                    pg_temp.cp('06060000-0000-7000-8000-000000000902', '06060000-0000-7000-8000-000000000102', '06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-0000000000e2', 'Zgoda')))),
  'ok', '14: przeniesienie z podzadaniem');
select ok((pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at is not null
          and (pg_temp.task('06060000-0000-7000-8000-000000000101')).moved_to = '06060000-0000-7000-8000-000000000901',
          '15: oryginał w koszu ze znacznikiem przeniesienia (id kopii)');
select is((pg_temp.task('06060000-0000-7000-8000-000000000102')).deleted_at, (pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at,
          '16: podzadanie oryginału z nim (ten sam znacznik)');
select ok((pg_temp.task('06060000-0000-7000-8000-000000000902')).parent_id = '06060000-0000-7000-8000-000000000901'
          and (pg_temp.task('06060000-0000-7000-8000-000000000902')).group_id = '06060000-0000-7000-8000-000000000002', '17: kopie w nowej grupie, z tą samą strukturą');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 31, pg_temp.op('restore', '06060000-0000-7000-8000-000000000101')), 'moved',
          '18 (N-131): przywrócenie oryginału, którego kopia żyje — odrzucone (to samo zadanie w dwóch grupach)');
select throws_ok($$ update public.tasks set moved_to = null where id = '06060000-0000-7000-8000-000000000101' $$, '42501', null,
          '19: znacznika nie zmieni się z telefonu');
reset role;
select is(public.assignment_push_claim(pg_temp.act('06060000-0000-7000-8000-000000000901'), '00000000-0000-7000-8000-0000000006d1', 24), null,
          '20 (N-131): kopia przeniesiona z tą samą osobą — bez „przypisuje Ci zadanie”');
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 32, '{"kind":"create","entity":"tasks","id":"06060000-0000-7000-8000-000000000903","group_id":"06060000-0000-7000-8000-000000000002","set":{"list_id":"06060000-0000-7000-8000-0000000000e2","title":"Nowe","assignee_member_id":"06060000-0000-7000-8000-0000000000b2"}}') = 'ok';
reset role;
select isnt(public.assignment_push_claim(pg_temp.act('06060000-0000-7000-8000-000000000903'), '00000000-0000-7000-8000-0000000006d1', 24), null,
          '21: zwykłe przypisanie w nowej grupie — powiadomienie jak dotąd');

-- 22–29: „Cofnij” przeniesienia.
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 40, pg_temp.unmv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000999')),
          'invalid_value', '22: cofnięcie z inną kopią — nie');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 41, pg_temp.unmv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000901')), 'ok', '23: cofnięcie');
select ok((pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at is null and (pg_temp.task('06060000-0000-7000-8000-000000000101')).moved_to is null
          and (pg_temp.task('06060000-0000-7000-8000-000000000102')).deleted_at is null, '24: oryginał z podzadaniem wrócił, bez znacznika');
select ok((pg_temp.task('06060000-0000-7000-8000-000000000901')).deleted_at is not null
          and (pg_temp.task('06060000-0000-7000-8000-000000000901')).moved_to = '06060000-0000-7000-8000-000000000101'
          and (pg_temp.task('06060000-0000-7000-8000-000000000902')).deleted_at is not null, '25: kopia w koszu nowej grupy ze znacznikiem powrotu');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 42, pg_temp.op('restore', '06060000-0000-7000-8000-000000000901')), 'moved', '26: kopii po cofnięciu nie przywrócę z kosza');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 43, pg_temp.unmv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000901')), 'ok', '27: powtórzone cofnięcie — bez zmian');
select is((pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at, null, '28: oryginał dalej na miejscu');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 44, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000901', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'Zebranie')))),
  'invalid_value', '29: kopia o id istniejącego (usuniętego) zadania — nie');

-- 30–34: druga przeprowadzka; kopia usunięta zwykłym usunięciem — oryginał wraca z kosza (stary telefon); kopia, której już nie widzę.
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 50, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000911', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'Zebranie')))),
  'ok', '30: przeniesienie po cofnięciu');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 51, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000912', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'Zebranie')))),
  'deleted', '31: przeniesionego drugi raz nie przeniosę');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 52, pg_temp.op('delete', '06060000-0000-7000-8000-000000000911')), 'ok', '32: kopia usunięta zwykłym usunięciem');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 53, pg_temp.op('restore', '06060000-0000-7000-8000-000000000101')), 'ok', '33: wtedy oryginał wraca z kosza');
select is((pg_temp.task('06060000-0000-7000-8000-000000000101')).moved_to, null, '34: i traci znacznik');

select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 54, pg_temp.mv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000002', null,
  jsonb_build_array(pg_temp.cp('06060000-0000-7000-8000-000000000921', '06060000-0000-7000-8000-000000000101', null, '06060000-0000-7000-8000-0000000000e2', 'Zebranie')))),
  'ok', '35: trzecie przeniesienie');
reset role;
select pg_temp.as_user('');
-- Ala wychodzi z Klasy (właścicielem zostaje Jan): kopii już nie widzi.
update public.group_members set role = 'owner' where member_id = '06060000-0000-7000-8000-0000000000b2';
update public.group_members set deleted_at = now() where member_id = '06060000-0000-7000-8000-0000000000b1';
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d1');
set local role authenticated;
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 55, pg_temp.unmv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000921')), 'moved',
          '36: cofnięcie, gdy kopii już nie widzę, a żyje — odrzucone, nic się nie zmienia');
select ok((pg_temp.task('06060000-0000-7000-8000-000000000101')).deleted_at is not null and (pg_temp.task('06060000-0000-7000-8000-000000000921')).deleted_at is null,
          '37: oryginał w koszu, kopia żyje');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a1', 56, pg_temp.unmv('06060000-0000-7000-8000-000000000999', '06060000-0000-7000-8000-000000000921')), 'not_found',
          '38: cofnięcie nieznanego zadania');
reset role;
select pg_temp.as_user('00000000-0000-7000-8000-0000000006d3');
set local role authenticated;
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a3', 2, pg_temp.unmv('06060000-0000-7000-8000-000000000101', '06060000-0000-7000-8000-000000000921')), 'forbidden:child',
          '39: dziecko nie cofa przeniesienia');
select is(pg_temp.push('06060000-0000-7000-8000-00000000c0a3', 3, '{"kind":"cmd","cmd":"unmove_task","args":{}}'), 'invalid_value', '40: cofnięcie bez zadania');

select * from finish();
rollback;
