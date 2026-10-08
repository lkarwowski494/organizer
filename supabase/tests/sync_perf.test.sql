-- Wydajność synchronizacji bez zmiany wyników (audyt 2, M-181, M-73, M-192; migracja 20261008484000_sync_perf).
begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000021a1', 'a21@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Wzorzec: dotychczasowa definicja (20261008270000_event_rsvps.sql) — wszystkie wiersze od kursora, numerowane razem.
create function pg_temp.old_rows(g uuid, since bigint, lim int) returns table (e text, v bigint, r jsonb)
language sql stable as $$
  with all_rows as (
    select 'groups'::text e, t.version v, to_jsonb(t) - 'plan' r from public.groups t where t.id = g and t.version > since
    union all select 'group_members', t.version, to_jsonb(t) from public.group_members t where t.group_id = g and t.version > since
    union all select 'lists', t.version, to_jsonb(t) from public.lists t where t.group_id = g and t.version > since
    union all select 'object_members', t.version, to_jsonb(t) from public.object_members t where t.group_id = g and t.version > since
    union all select 'tasks', t.version, to_jsonb(t) from public.tasks t where t.group_id = g and t.version > since
    union all select 'events', t.version, to_jsonb(t) from public.events t where t.group_id = g and t.version > since
    union all select 'event_participants', t.version, to_jsonb(t) from public.event_participants t where t.group_id = g and t.version > since
    union all select 'event_overrides', t.version, to_jsonb(t) from public.event_overrides t where t.group_id = g and t.version > since
    union all select 'event_task_series', t.version, to_jsonb(t) from public.event_task_series t where t.group_id = g and t.version > since
    union all select 'event_rsvps', t.version, to_jsonb(t) from public.event_rsvps t where t.group_id = g and t.version > since
    union all select 'handoffs', t.version, to_jsonb(t) from public.handoffs t where t.group_id = g and t.version > since
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

select pg_temp.as_user('00000000-0000-7000-8000-0000000021a1');
set local role authenticated;
select public.create_group('21210000-0000-7000-8000-000000000001', 'G', '21210000-0000-7000-8000-0000000000a1', 'A');
select public.sync_push('21210000-0000-7000-8000-00000000c0d1', 2, (
  select jsonb_agg(op order by seq) from (
    select 1 seq, jsonb_build_object('seq', 1, 'kind', 'create', 'entity', 'lists', 'id', '21210000-0000-7000-8000-0000000000b1', 'group_id', '21210000-0000-7000-8000-000000000001', 'set', '{"kind":"tasks","name":"L"}'::jsonb) op
    union all
    select 1 + i, jsonb_build_object('seq', 1 + i, 'kind', 'create', 'entity', 'tasks', 'id', ('21210000-0000-7000-8000-0000000004' || lpad(i::text, 2, '0'))::text,
      'group_id', '21210000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', '21210000-0000-7000-8000-0000000000b1', 'title', 'T' || i))
    from generate_series(1, 30) i
    union all
    select 40, jsonb_build_object('seq', 40, 'kind', 'create', 'entity', 'events', 'id', '21210000-0000-7000-8000-0000000001e1', 'group_id', '21210000-0000-7000-8000-000000000001', 'set', '{"title":"E","start_date":"2026-10-05"}'::jsonb)
    union all
    select 41, jsonb_build_object('seq', 41, 'kind', 'delete', 'entity', 'lists', 'id', '21210000-0000-7000-8000-0000000000b1')
  ) x)) is not null;

-- 1: każda kombinacja kursora i porcji daje dokładnie to, co dotychczasowa definicja.
select is((select count(*)::int from generate_series(0, 120, 7) s, unnest(array[1, 2, 5, 13, 1000]) l
  where (select coalesce(jsonb_agg(jsonb_build_array(x.e, x.v, x.r) order by x.v, x.e, x.r::text), '[]') from private.group_rows_since('21210000-0000-7000-8000-000000000001', s, l) x)
     is distinct from (select coalesce(jsonb_agg(jsonb_build_array(x.e, x.v, x.r) order by x.v, x.e, x.r::text), '[]') from pg_temp.old_rows('21210000-0000-7000-8000-000000000001', s, l) x)),
  0, '1: wynik group_rows_since jak dotychczas (kursory 0–120, porcje 1–1000)');
select ok((select count(*) from private.group_rows_since('21210000-0000-7000-8000-000000000001', 0, 1000)) > 60, '2: dane testu obejmują wiele tabel i wersji');

-- 3–5: grupa operacji do blokady.
select is(private.op_group('{"kind":"patch","entity":"tasks","id":"21210000-0000-7000-8000-000000000401","set":{}}'), '21210000-0000-7000-8000-000000000001'::uuid, '3: grupa zmienianego wiersza');
select is(private.op_group('{"kind":"patch","entity":"tasks","id":"nie-uuid","set":{}}'), null, '4: błędne id — bez blokady (apply_op odrzuci)');
select is(private.op_group('{"kind":"cmd","cmd":"move_task","args":{}}'), null, '5: polecenie blokuje samo');
select is((public.sync_pull('{}'::jsonb, 1000, 2, null) -> 'scopes'), '[]'::jsonb, '6: scopes tylko z moich grup');

select * from finish();
rollback;
