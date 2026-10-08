-- Kotwica tygodnia A przy osobie (migracja 20261008430000_member_week_a, D171, audyt 2 M-15): zapis przez synchronizację,
-- tylko poniedziałek, dorosły z grupy tak, dziecko i obcy nie; wersja wiersza rośnie (telefony dostają zmianę).
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000043e1', 'o@x.test'),
  ('00000000-0000-7000-8000-0000000043e2', 'm@x.test'),
  ('00000000-0000-7000-8000-0000000043e3', 'c@x.test'),
  ('00000000-0000-7000-8000-0000000043e4', 'x@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.push(client text, seq int, op jsonb) returns text language sql as $$
  select coalesce(public.sync_push(client::uuid, 1, jsonb_build_array(op || jsonb_build_object('seq', seq, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok')
$$;
create function pg_temp.week_a(kid uuid, d text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'patch', 'entity', 'group_members', 'id', kid, 'set', jsonb_build_object('week_a', d))
$$;
create function pg_temp.anchor() returns date language sql security definer as $$
  select week_a from public.group_members where member_id = '43430000-0000-7000-8000-0000000000f9'
$$;
create function pg_temp.ver() returns bigint language sql security definer as $$
  select version from public.group_members where member_id = '43430000-0000-7000-8000-0000000000f9'
$$;
grant execute on all functions in schema pg_temp to authenticated;

select has_column('public', 'group_members', 'week_a', '1: kolumna week_a');
select ok((select 'week_a' = any (patch_cols) and not ('week_a' = any (insert_cols)) from private.sync_entities where entity = 'group_members'), '2: tylko zmiana przez synchronizację');
select ok(has_column_privilege('authenticated', 'public.group_members', 'week_a', 'UPDATE'), '3: authenticated może zmieniać week_a');

-- G: O owner (f1), M członek (f2), C dziecko z kontem (f3), profil dziecka Kuba (f9). X spoza grupy.
select pg_temp.as_user('00000000-0000-7000-8000-0000000043e1');
set local role authenticated;
select public.create_group('43430000-0000-7000-8000-000000000001', 'G', '43430000-0000-7000-8000-0000000000f1', 'O');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('43430000-0000-7000-8000-0000000000f2', '43430000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000043e2', 'M', 'member'),
  ('43430000-0000-7000-8000-0000000000f3', '43430000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000043e3', 'C', 'child'),
  ('43430000-0000-7000-8000-0000000000f9', '43430000-0000-7000-8000-000000000001', null, 'Kuba', 'child');

select pg_temp.as_user('00000000-0000-7000-8000-0000000043e2');
set local role authenticated;
select is(pg_temp.push('43430000-0000-7000-8000-00000000c002', 1, pg_temp.week_a('43430000-0000-7000-8000-0000000000f9', '2026-09-28')), 'ok', '4: członek ustawia kotwicę dziecka');
select is(pg_temp.anchor(), '2026-09-28'::date, '5: zapisana');
select is(pg_temp.push('43430000-0000-7000-8000-00000000c002', 2, pg_temp.week_a('43430000-0000-7000-8000-0000000000f9', '2026-09-30')), 'invalid:23514', '6: nie poniedziałek — odrzucone (ograniczenie)');
select is(pg_temp.anchor(), '2026-09-28'::date, '7: bez zmiany');
select is(pg_temp.push('43430000-0000-7000-8000-00000000c002', 3, pg_temp.week_a('43430000-0000-7000-8000-0000000000f9', null)), 'ok', '8: cofnięcie do pustej');
select is(pg_temp.anchor(), null, '9: pusta');
select is(pg_temp.push('43430000-0000-7000-8000-00000000c002', 4, jsonb_build_object('kind', 'patch', 'entity', 'group_members', 'id', '43430000-0000-7000-8000-0000000000f9', 'set', '{"week_a": "2026-10-05"}'::jsonb)) , 'ok', '10: kolejna zmiana');
reset role;
select ok(pg_temp.ver() > 0, '11: wersja wiersza ustawiona (zmiana trafia do pobierania)');

select pg_temp.as_user('00000000-0000-7000-8000-0000000043e3');
set local role authenticated;
select is(pg_temp.push('43430000-0000-7000-8000-00000000c003', 1, pg_temp.week_a('43430000-0000-7000-8000-0000000000f9', '2026-09-28')), 'forbidden', '12: dziecko z kontem — nie');
reset role;

select pg_temp.as_user('00000000-0000-7000-8000-0000000043e4');
set local role authenticated;
select is(pg_temp.push('43430000-0000-7000-8000-00000000c004', 1, pg_temp.week_a('43430000-0000-7000-8000-0000000000f9', '2026-09-28')), 'not_found', '13: obcy nie widzi osoby');
reset role;
select is(pg_temp.anchor(), '2026-10-05'::date, '14: po odrzuceniach bez zmian');

select * from finish();
rollback;
