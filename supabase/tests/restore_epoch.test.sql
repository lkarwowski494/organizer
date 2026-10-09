-- Nowa epoka po odtworzeniu bazy z kopii (migracja 20261008581000_restore_epoch, audyt 2 M-180).
begin;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000000e1', 'e@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.g_of(res jsonb) returns jsonb language sql as $$
  select g from jsonb_array_elements(res -> 'groups') g where g ->> 'group_id' = 'eeee0000-0000-7000-8000-000000000001'
$$;
grant execute on function pg_temp.g_of(jsonb) to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
select public.create_group('eeee0000-0000-7000-8000-000000000001', 'Dom', 'eeee0000-0000-7000-8000-0000000000b1', 'Ewa');
reset role;
select pg_temp.as_user('');
create temp table before as select version, purged_version from public.groups where id = 'eeee0000-0000-7000-8000-000000000001';
grant select on before to authenticated;

select ok(not has_function_privilege('authenticated', 'private.new_epoch_after_restore(bigint)', 'execute'), '1: aplikacja nie wywołuje procedury');
select throws_ok($$ select private.new_epoch_after_restore(0) $$, 'P0001', 'bad_gap', '2: przesunięcie musi być dodatnie');
select cmp_ok(private.new_epoch_after_restore(), '>=', 1, '3: procedura obejmuje grupy');
select is((select version - (select version from before) from public.groups where id = 'eeee0000-0000-7000-8000-000000000001'), 1000000000::bigint,
  '4: wersja grupy przesunięta o przerwę');
select is((select purged_version = version from public.groups where id = 'eeee0000-0000-7000-8000-000000000001'), true, '5: nowa epoka = nowa wersja');

-- Telefon z kursorem dalej niż wersja z kopii (widział zmiany, których kopia nie ma): po procedurze pobiera grupę od nowa.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000e1');
set local role authenticated;
create temp table pulled as select pg_temp.g_of(public.sync_pull(jsonb_build_object('eeee0000-0000-7000-8000-000000000001',
  jsonb_build_object('v', (select version + 40 from before), 'p', (select purged_version from before))), 1000, 2)) as g;
reset role;
select is((select (g ->> 'resync')::boolean from pulled), true, '6: kursor sprzed epoki → resync');
select ok((select jsonb_array_length(g -> 'rows') > 0 from pulled), '7: telefon dostaje grupę od nowa');

select * from finish();
rollback;
