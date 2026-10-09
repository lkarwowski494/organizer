-- sync_push zwraca wersje zmienionych grup (audyt 3, N-100; migracja 20261010030000_sync_push_versions): telefon
-- rozpoznaje własny sygnał Realtime. Powtórka paczki i odrzucenie nie zmieniają grupy — bez wersji.
begin;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-7000-8000-0000000030a1', 'a30@example.com'), ('00000000-0000-7000-8000-0000000030b1', 'b30@example.com');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000030a1', true);
set local role authenticated;
select public.create_group('30300000-0000-7000-8000-000000000001', 'Rodzina', '30300000-0000-7000-8000-0000000000a1', 'Ala');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000030b1', true);
set local role authenticated;
select public.create_group('30300000-0000-7000-8000-000000000002', 'Jan', '30300000-0000-7000-8000-0000000000b1', 'Jan');
reset role;

create temp table r (n int, res jsonb);
grant all on r to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000030a1', true);
set local role authenticated;
insert into r select 1, public.sync_push('30300000-0000-7000-8000-00000000c001', 2, '[
  {"seq": 1, "op_id": "30300000-0000-7000-8000-00000000d001", "kind": "create", "entity": "lists", "id": "30300000-0000-7000-8000-000000000101",
   "group_id": "30300000-0000-7000-8000-000000000001", "set": {"kind": "tasks", "name": "Dom"}},
  {"seq": 2, "op_id": "30300000-0000-7000-8000-00000000d002", "kind": "create", "entity": "tasks", "id": "30300000-0000-7000-8000-000000000201",
   "group_id": "30300000-0000-7000-8000-000000000001", "set": {"list_id": "30300000-0000-7000-8000-000000000101", "title": "Mleko"}}
]'::jsonb);
reset role;

select is((select res -> 'results' from r where n = 1), '[{"seq": 1, "status": "ok"}, {"seq": 2, "status": "ok"}]'::jsonb, '1: zapis przeszedł');
select is((select res -> 'versions' from r where n = 1),
          jsonb_build_object('30300000-0000-7000-8000-000000000001', (select version from public.groups where id = '30300000-0000-7000-8000-000000000001')),
          '2: wersja grupy po zapisie (ta sama, którą niesie sygnał Realtime)');
select ok((select (res -> 'versions' ->> '30300000-0000-7000-8000-000000000001')::bigint
           >= (select max(version) from public.tasks where group_id = '30300000-0000-7000-8000-000000000001') from r where n = 1),
          '3: wersja obejmuje zapisane wiersze');

select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-0000000030a1', true);
set local role authenticated;
-- Powtórka paczki (zgubiona odpowiedź) i operacja w cudzej grupie (odrzucona).
insert into r select 2, public.sync_push('30300000-0000-7000-8000-00000000c001', 2, '[
  {"seq": 2, "op_id": "30300000-0000-7000-8000-00000000d002", "kind": "create", "entity": "tasks", "id": "30300000-0000-7000-8000-000000000201",
   "group_id": "30300000-0000-7000-8000-000000000001", "set": {"list_id": "30300000-0000-7000-8000-000000000101", "title": "Mleko"}},
  {"seq": 3, "op_id": "30300000-0000-7000-8000-00000000d003", "kind": "create", "entity": "lists", "id": "30300000-0000-7000-8000-000000000102",
   "group_id": "30300000-0000-7000-8000-000000000002", "set": {"kind": "tasks", "name": "Cudza"}}
]'::jsonb);
reset role;
select is((select jsonb_path_query_array(res -> 'results', '$[*].status') from r where n = 2), '["duplicate", "rejected"]'::jsonb, '4: powtórka i odrzucenie');
select is((select res -> 'versions' from r where n = 2), '{}'::jsonb, '5: bez zmienionych grup — puste wersje');
select is((select res ->> 'last_seq' from r where n = 2), '3', '6: last_seq jak dotąd');

select * from finish();
rollback;
