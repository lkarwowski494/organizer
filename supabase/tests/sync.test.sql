-- Protokół synchronizacji (migracja 20261006120200_sync): sync_push, sync_pull, sync_fetch_scope, purge.
begin;
select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-00000000000a', 'a@x.test'), ('00000000-0000-7000-8000-00000000000b', 'b@x.test');

-- Klient A (instalacja telefonu A).
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;

create temp table r (n int, res jsonb) on commit drop;
grant all on r to authenticated;
-- G = grupa, L = lista, T1/T2 = zadania.
insert into r values (1, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":1,"op_id":"0192aaaa-0000-7000-8000-000000000001","kind":"cmd","cmd":"create_group","args":{"id":"55555555-0000-7000-8000-000000000001","name":"Rodzina","owner_member_id":"55555555-0000-7000-8000-0000000000a1","owner_display_name":"Ala"}}
]'));
select is((select res -> 'results' -> 0 ->> 'status' from r where n = 1), 'ok', '1: komenda create_group');
select is((select (res ->> 'last_seq')::int from r where n = 1), 1, '2: last_seq po pierwszej paczce');

-- Ta sama paczka drugi raz (odpowiedź zginęła w sieci): nic się nie dubluje.
insert into r values (2, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":1,"kind":"cmd","cmd":"create_group","args":{"id":"55555555-0000-7000-8000-000000000001","name":"Rodzina","owner_member_id":"55555555-0000-7000-8000-0000000000a1","owner_display_name":"Ala"}}
]'));
select is((select res -> 'results' -> 0 ->> 'status' from r where n = 2), 'duplicate', '3: powtórzona operacja = duplicate');
select is((select count(*)::int from public.group_members where group_id = '55555555-0000-7000-8000-000000000001'), 1, '4: bez podwójnego członkostwa');

-- Paczka z lista + zadaniami + błędnymi operacjami w środku: błędne odrzucone, reszta wykonana.
insert into r values (3, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":2,"kind":"create","entity":"lists","id":"66666666-0000-7000-8000-000000000001","group_id":"55555555-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Dom"}},
  {"seq":3,"op_id":"0192aaaa-0000-7000-8000-000000000003","kind":"create","entity":"tasks","id":"77777777-0000-7000-8000-000000000001","group_id":"55555555-0000-7000-8000-000000000001","set":{"list_id":"66666666-0000-7000-8000-000000000001","title":"Mleko","due_date":"2026-10-07"}},
  {"seq":4,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000001","set":{"depth":5}},
  {"seq":5,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000001","set":{"due_date":"jutro"}},
  {"seq":6,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000001","set":{"due_date":null,"due_time":"10:00"}},
  {"seq":7,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-0000000000ff","set":{"title":"X"}},
  {"seq":8,"kind":"create","entity":"tasks","id":"77777777-0000-7000-8000-000000000002","group_id":"55555555-0000-7000-8000-000000000001","set":{"list_id":"66666666-0000-7000-8000-000000000001","title":"Sub","parent_id":"77777777-0000-7000-8000-000000000001"}},
  {"seq":9,"kind":"create","entity":"tasks","id":"77777777-0000-7000-8000-000000000003","group_id":"55555555-0000-7000-8000-000000000001","set":{"list_id":"66666666-0000-7000-8000-000000000001","title":"SubSub","parent_id":"77777777-0000-7000-8000-000000000002"}},
  {"seq":10,"kind":"create","entity":"tasks","id":"77777777-0000-7000-8000-000000000004","group_id":"55555555-0000-7000-8000-000000000001","set":{"list_id":"66666666-0000-7000-8000-000000000001","title":"Za głęboko","parent_id":"77777777-0000-7000-8000-000000000003"}},
  {"seq":11,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000001","set":{"title":"Mleko 2l"}},
  {"seq":12,"kind":"teleport","entity":"tasks","id":"77777777-0000-7000-8000-000000000001"},
  {"seq":13,"kind":"create","entity":"secrets","id":"77777777-0000-7000-8000-000000000009"},
  {"seq":14,"kind":"cmd","cmd":"hack"}
]'));
select is((select jsonb_agg(x ->> 'status' order by (x ->> 'seq')::int) from r, jsonb_array_elements(res -> 'results') x where n = 3),
  '["ok","ok","rejected","rejected","rejected","rejected","ok","ok","rejected","ok","rejected","rejected","rejected"]'::jsonb,
  '5: odrzucenia nie blokują reszty paczki');
select is((select jsonb_agg(x ->> 'code' order by (x ->> 'seq')::int) from r, jsonb_array_elements(res -> 'results') x where n = 3 and x ->> 'status' = 'rejected'),
  '["invalid_field:depth","invalid_value","invalid:23514","not_found","depth_exceeded","unknown_kind","unknown_entity","unknown_cmd"]'::jsonb,
  '6: kody odrzuceń');
select is((select title from public.tasks where id = '77777777-0000-7000-8000-000000000001'), 'Mleko 2l', '7: późniejsza poprawna zmiana weszła');
select is((select due_date from public.tasks where id = '77777777-0000-7000-8000-000000000001'), '2026-10-07'::date, '8: odrzucona zmiana nic nie zapisała');
select is((select (res ->> 'last_seq')::int from r where n = 3), 14, '9: last_seq przesuwa się także przy odrzuceniach');
select is((select op_id from public.activity where entity_id = '77777777-0000-7000-8000-000000000001' and verb = 'create'),
  '0192aaaa-0000-7000-8000-000000000003'::uuid, '10: aktywność zna op_id operacji');
reset role;
select is((select count(*)::int from realtime.messages where topic = 'group:55555555-0000-7000-8000-000000000001'), 2, '11: jeden poke na grupę na paczkę');
select is((select max((payload ->> 'v')::bigint) from realtime.messages where topic = 'group:55555555-0000-7000-8000-000000000001'),
  (select version from public.groups where id = '55555555-0000-7000-8000-000000000001'), '12: poke niesie tylko wersję grupy');
-- Prawdziwy realtime.send dokłada własny identyfikator wiadomości „id” (sprawdzone w CI na Supabase CLI 2.119.0).
select ok((select bool_and(payload - 'v' - 'id' = '{}'::jsonb) from realtime.messages where topic like 'group:%'), '13: każdy poke bez danych (poza wersją i id wiadomości)');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;

-- Usunięcie wygrywa z edycją; usuwanie i przywracanie są idempotentne.
insert into r values (4, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":15,"kind":"delete","entity":"tasks","id":"77777777-0000-7000-8000-000000000003"},
  {"seq":16,"kind":"delete","entity":"tasks","id":"77777777-0000-7000-8000-000000000003"},
  {"seq":17,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000003","set":{"title":"po usunięciu"}},
  {"seq":18,"kind":"restore","entity":"tasks","id":"77777777-0000-7000-8000-000000000003"},
  {"seq":19,"kind":"restore","entity":"tasks","id":"77777777-0000-7000-8000-000000000003"},
  {"seq":20,"kind":"delete","entity":"tasks","id":"77777777-0000-7000-8000-0000000000ff"},
  {"seq":21,"kind":"delete","entity":"groups","id":"55555555-0000-7000-8000-000000000001"}
]'));
select is((select jsonb_agg(coalesce(x ->> 'code', x ->> 'status') order by (x ->> 'seq')::int) from r, jsonb_array_elements(res -> 'results') x where n = 4),
  '["ok","ok","deleted","ok","ok","not_found","unsupported"]'::jsonb, '14: delete/restore idempotentne, edycja usuniętego odrzucona');
select is((select deleted_at from public.tasks where id = '77777777-0000-7000-8000-000000000003'), null, '15: przywrócone');

-- Walidacja paczki.
select throws_ok($$ select public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 0, '[]') $$, 'P0001', 'upgrade_required', '16: stara wersja schematu klienta');
select throws_ok($$ select public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, (select jsonb_agg(jsonb_build_object('seq', 100 + i, 'kind', 'patch', 'entity', 'tasks', 'id', '77777777-0000-7000-8000-000000000001', 'set', '{"note":"x"}'::jsonb)) from generate_series(1, 101) i)) $$,
  'P0001', 'batch_too_large', '17: paczka ponad limit (PUSH_BATCH_MAX = 100)');
select throws_ok($$ select public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '{"seq":1}') $$, 'P0001', 'invalid_batch', '18: paczka musi być tablicą');
select throws_ok($$ select public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[{"kind":"patch"}]') $$, 'P0001', 'invalid_batch:seq', '19: operacja bez seq');

-- Pull od zera: wszystko, kursor = wersja grupy, bez has_more.
insert into r values (5, public.sync_pull('{}'));
select is((select (g ->> 'cursor')::bigint from r, jsonb_array_elements(res -> 'groups') g where n = 5 and g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'),
  (select version from public.groups where id = '55555555-0000-7000-8000-000000000001'), '20: kursor = wersja grupy');
select is((select (g ->> 'has_more')::boolean from r, jsonb_array_elements(res -> 'groups') g where n = 5 and g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'), false, '21: bez has_more');
select is((select jsonb_array_length(res -> 'groups') from r where n = 5), 2, '22: grupa osobista + wspólna');
select ok((select bool_and((x -> 'v')::bigint > 0) from r, jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x where n = 5), '23: każdy wiersz ma wersję');
select is((select count(*)::int from r, jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x where n = 5 and x ->> 'e' = 'tasks' and g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'), 3, '24: 3 zadania');

-- Pull z kursorem: nic nowego.
insert into r values (6, public.sync_pull((select jsonb_object_agg(g ->> 'group_id', g -> 'cursor') from r, jsonb_array_elements(res -> 'groups') g where n = 5)));
select is((select sum(jsonb_array_length(g -> 'rows'))::int from r, jsonb_array_elements(res -> 'groups') g where n = 6), 0, '25: z aktualnym kursorem pusto');

-- Pull porcjami po 3: kolejne porcje sumują się do pełnego wyniku, bez powtórzeń i dziur.
create temp table chunks (k int, cursor bigint, more boolean, rows jsonb) on commit drop;
grant all on chunks to authenticated;
do $$
declare c bigint := 0; k int := 0; res jsonb; g jsonb;
begin
  loop
    k := k + 1;
    res := public.sync_pull(jsonb_build_object('55555555-0000-7000-8000-000000000001', c), 3);
    select x into g from jsonb_array_elements(res -> 'groups') x where x ->> 'group_id' = '55555555-0000-7000-8000-000000000001';
    insert into chunks values (k, (g ->> 'cursor')::bigint, (g ->> 'has_more')::boolean, g -> 'rows');
    c := (g ->> 'cursor')::bigint;
    exit when not (g ->> 'has_more')::boolean or k > 50;
  end loop;
end $$;
select ok((select count(*) from chunks) > 2, '26: wynik podzielony na porcje');
select is((select count(*)::int from chunks, jsonb_array_elements(rows) x),
  (select count(*)::int from r, jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x where n = 5 and g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'),
  '27: porcje = pełny wynik (bez dziur i powtórzeń)');
select ok((select bool_and(more) from chunks where k < (select max(k) from chunks)) and not (select more from chunks order by k desc limit 1), '28: has_more do ostatniej porcji');

-- Ukryta lista: B nie widzi jej wierszy, ale jego kursor i tak dochodzi do wersji grupy.
insert into r values (7, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":22,"kind":"create","entity":"lists","id":"66666666-0000-7000-8000-000000000002","group_id":"55555555-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"Prezenty","visibility":"restricted"}},
  {"seq":23,"kind":"create","entity":"tasks","id":"77777777-0000-7000-8000-000000000010","group_id":"55555555-0000-7000-8000-000000000001","set":{"list_id":"66666666-0000-7000-8000-000000000002","title":"Rower dla Bartka"}}
]'));
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into public.group_members (member_id, group_id, user_id, display_name) values
  ('55555555-0000-7000-8000-0000000000b1', '55555555-0000-7000-8000-000000000001', '00000000-0000-7000-8000-00000000000b', 'Bartek');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
set local role authenticated;
insert into r values (8, public.sync_pull('{}'));
select ok(not exists (select 1 from r, jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x where n = 8 and x::text like '%Rower dla Bartka%'), '29: ukryte zadanie nie wycieka w pull');
select ok(not exists (select 1 from r, jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x where n = 8 and x::text like '%66666666-0000-7000-8000-000000000002%'), '30: ani lista, ani jej aktywność');
select is((select (g ->> 'cursor')::bigint from r, jsonb_array_elements(res -> 'groups') g where n = 8 and g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'),
  (select version from public.groups where id = '55555555-0000-7000-8000-000000000001'), '31: kursor B dochodzi do wersji grupy mimo ukrytych wierszy');
select is((select res -> 'scopes' from r where n = 8), '[]'::jsonb, '32: B nie ma ukrytych zakresów');
select is((select jsonb_array_length(public.sync_fetch_scope('66666666-0000-7000-8000-000000000002') -> 'rows')), 0, '33: fetch_scope bez dostępu = pusto');
insert into r values (9, public.sync_push('bbbbbbbb-0000-7000-8000-000000000001', 1, '[
  {"seq":1,"kind":"patch","entity":"tasks","id":"77777777-0000-7000-8000-000000000010","set":{"title":"hack"}},
  {"seq":2,"kind":"patch","entity":"groups","id":"55555555-0000-7000-8000-000000000001","set":{"name":"hack"}}
]'));
select is((select jsonb_agg(x ->> 'code' order by (x ->> 'seq')::int) from r, jsonb_array_elements(res -> 'results') x where n = 9),
  '["not_found","forbidden"]'::jsonb, '34: B nie zmienia ukrytego zadania ani nazwy grupy');
select throws_ok($$ select public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[]') $$, 'P0001', 'client_mismatch', '35: cudza instalacja odrzucona');

-- A udostępnia listę B (komenda grant_scope) → B widzi zakres i pobiera go fetch_scope.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
insert into r values (10, public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[
  {"seq":24,"kind":"cmd","cmd":"grant_scope","args":{"list_id":"66666666-0000-7000-8000-000000000002","member_id":"55555555-0000-7000-8000-0000000000b1"}}
]'));
select is((select res -> 'results' -> 0 ->> 'status' from r where n = 10), 'ok', '36: grant_scope');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
select is((public.sync_pull('{}') -> 'scopes'), '["66666666-0000-7000-8000-000000000002"]'::jsonb, '37: zakres pojawia się w pull');
select ok((select count(*) from jsonb_array_elements(public.sync_fetch_scope('66666666-0000-7000-8000-000000000002') -> 'rows') x where x ->> 'e' = 'tasks') = 1, '38: fetch_scope zwraca zadania listy');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
select is((public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[{"seq":25,"kind":"cmd","cmd":"revoke_scope","args":{"list_id":"66666666-0000-7000-8000-000000000002","member_id":"55555555-0000-7000-8000-0000000000b1"}}]') -> 'results' -> 0 ->> 'status'), 'ok', '39: revoke_scope');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000b', true);
select is((public.sync_pull('{}') -> 'scopes'), '[]'::jsonb, '40: po cofnięciu zakres znika');

-- B wychodzi z grupy → grupa znika z pull (klient usuwa jej dane lokalnie).
select is((public.sync_push('bbbbbbbb-0000-7000-8000-000000000001', 1, '[{"seq":3,"kind":"delete","entity":"group_members","id":"55555555-0000-7000-8000-0000000000b1"}]') -> 'results' -> 0 ->> 'status'), 'ok', '41: B wychodzi');
select ok(not exists (select 1 from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g where g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'), '42: grupa znika z pull B');

-- Czyszczenie tombstones: stary kursor → resync.
reset role;
select set_config('request.jwt.claim.sub', '', true);
update public.tasks set deleted_at = now() - interval '31 days' where id = '77777777-0000-7000-8000-000000000003';
select is(private.purge_tombstones(), 1, '43: purge usuwa tombstone starszy niż 30 dni');
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.sync_pull('{"55555555-0000-7000-8000-000000000001": 1}') -> 'groups') g, jsonb_array_elements(g -> 'rows') x
  where g ->> 'group_id' = '55555555-0000-7000-8000-000000000001' and x ->> 'e' = 'tasks' and x -> 'row' ->> 'id' <> '77777777-0000-7000-8000-000000000003'), 3, '44: resync oddaje pełny stan (3 zadania), wyczyszczonego brak');
select is((select (g ->> 'resync')::boolean from jsonb_array_elements(public.sync_pull('{"55555555-0000-7000-8000-000000000001": 1}') -> 'groups') g where g ->> 'group_id' = '55555555-0000-7000-8000-000000000001'),
  true, '45: kursor sprzed czyszczenia → resync');
select ok(not exists (select 1 from jsonb_array_elements(public.sync_pull('{}') -> 'groups') g, jsonb_array_elements(g -> 'rows') x
  where x -> 'row' ->> 'id' = '77777777-0000-7000-8000-000000000003'), '46: wyczyszczone zadanie nie wraca');

-- Regresja (test różnicowy): „cofnij dostęp” osobie bez dostępu NIE może jej go dać.
select set_config('request.jwt.claim.sub', '00000000-0000-7000-8000-00000000000a', true);
select is((public.sync_push('aaaaaaaa-0000-7000-8000-000000000001', 1, '[{"seq":26,"kind":"cmd","cmd":"revoke_scope","args":{"list_id":"66666666-0000-7000-8000-000000000002","member_id":"55555555-0000-7000-8000-0000000000a1"}}]') -> 'results' -> 0 ->> 'status'), 'ok', '47: cofnięcie bez wpisu — bez błędu');
reset role;
select is((select count(*)::int from public.object_members where scope_id = '66666666-0000-7000-8000-000000000002' and member_id = '55555555-0000-7000-8000-0000000000a1'), 0, '48: cofnięcie bez wpisu niczego nie wstawia');

select * from finish();
rollback;
