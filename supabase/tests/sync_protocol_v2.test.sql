-- Protokół synchronizacji v2 (migracja 20261008310000_sync_protocol_v2; audyt 2, paczka P1):
-- pętla resync po czyszczeniu kosza (M-1) dla buildu 21 i nowego protokołu, zakres purged_version (M-4),
-- zawężenie widoczności i przeniesienie do ukrytej listy (M-54), odrzucenie po zgubionej odpowiedzi (M-56),
-- upgrade_required w pobieraniu (M-57), filtr encji znanych telefonowi (M-58).
begin;
select plan(55);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000000f1', 'a@x.test'),
  ('00000000-0000-7000-8000-0000000000f2', 'b@x.test'),
  ('00000000-0000-7000-8000-0000000000f3', 'c@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
-- Jedna operacja z kolejnym numerem klienta; zwraca kod odrzucenia albo 'ok'.
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('v2.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('v2.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', s, 'op_id', gen_random_uuid()))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(client text, op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(client, op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
create function pg_temp.g_of(res jsonb) returns jsonb language sql as $$
  select g from jsonb_array_elements(res -> 'groups') g where g ->> 'group_id' = 'f1f10000-0000-7000-8000-000000000001'
$$;
create function pg_temp.task(n int) returns text language sql as $$ select 'f1f10000-0000-7000-8000-0000000000c' || n $$;
-- Pobieranie grupy porcjami aż do końca (najwyżej 60 porcji), jak telefon: protokół 1 odsyła kursor-liczbę, protokół 2
-- kursor z epoką {v, p}. Wynik: liczba porcji, resync w pierwszej i w dalszych porcjach, liczba wierszy, ostatnia porcja.
create function pg_temp.page_all(start jsonb, lim int, ver int, grp text default 'f1f10000-0000-7000-8000-000000000001') returns jsonb language plpgsql as $$
declare
  cur jsonb := start;
  res jsonb;
  g jsonb;
  k int := 0;
  first_resync boolean;
  later_resync boolean := false;
  n int := 0;
begin
  loop
    k := k + 1;
    res := public.sync_pull(case when cur is null then '{}'::jsonb else jsonb_build_object(grp, cur) end, lim, ver);
    select x into g from jsonb_array_elements(res -> 'groups') x where x ->> 'group_id' = grp;
    if k = 1 then first_resync := (g ->> 'resync')::boolean; elsif (g ->> 'resync')::boolean then later_resync := true; end if;
    n := n + jsonb_array_length(g -> 'rows');
    cur := case when ver >= 2 then jsonb_build_object('v', g -> 'cursor', 'p', g -> 'purged') else g -> 'cursor' end;
    exit when not (g ->> 'has_more')::boolean or k >= 60;
  end loop;
  return jsonb_build_object('pages', k, 'first_resync', first_resync, 'later_resync', later_resync, 'rows', n,
                            'cursor', g -> 'cursor', 'has_more', g -> 'has_more');
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- G: A (owner), B, C (członkowie). Lista L (cała grupa) z zadaniami T1–T8 i podzadaniem T9 pod T2; lista H ukryta
-- (restricted) A, udostępniona B.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select public.create_group('f1f10000-0000-7000-8000-000000000001', 'G', 'f1f10000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('f1f10000-0000-7000-8000-0000000000a2', 'f1f10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f2', 'B', 'member'),
  ('f1f10000-0000-7000-8000-0000000000a3', 'f1f10000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000000f3', 'C', 'member');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', '{"kind":"create","entity":"lists","id":"f1f10000-0000-7000-8000-0000000000b1","group_id":"f1f10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"L"}}');
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', '{"kind":"create","entity":"lists","id":"f1f10000-0000-7000-8000-0000000000b2","group_id":"f1f10000-0000-7000-8000-000000000001","set":{"kind":"tasks","name":"H","visibility":"restricted"}}');
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', '{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"f1f10000-0000-7000-8000-0000000000b2","member_id":"f1f10000-0000-7000-8000-0000000000a2"}}');
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', pg_temp.task(i),
  'group_id', 'f1f10000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', 'f1f10000-0000-7000-8000-0000000000b1', 'title', 'T' || i)))
  from generate_series(1, 8) i;
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', pg_temp.task(9),
  'group_id', 'f1f10000-0000-7000-8000-000000000001', 'set', jsonb_build_object('list_id', 'f1f10000-0000-7000-8000-0000000000b1', 'title', 'T9', 'parent_id', pg_temp.task(2))));
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'delete', 'entity', 'tasks', 'id', pg_temp.task(1)));

-- T1 w koszu od 40 dni, potem dalsze zmiany w grupie (wersja grupy idzie dalej), potem nocne sprzątanie.
reset role;
select pg_temp.as_user('');
update public.tasks set deleted_at = now() - interval '40 days' where id = pg_temp.task(1)::uuid;
create temp table t1v as select version from public.tasks where id = pg_temp.task(1)::uuid;
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'patch', 'entity', 'tasks', 'id', pg_temp.task(i), 'set', jsonb_build_object('note', 'n')))
  from generate_series(3, 5) i;
reset role;
select pg_temp.as_user('');
create temp table before_purge as select version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001';
select is(private.purge_tombstones(), 1, '1: czyszczenie usuwa T1');
-- M-4: purged_version = najwyższa wersja usuniętych wierszy, nie bieżąca wersja grupy.
select is((select purged_version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001'), (select version from t1v), '2: purged_version = wersja usuniętego T1');
select ok((select purged_version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001') < (select version from before_purge), '3: i jest mniejsza niż wersja grupy przed czyszczeniem');
grant select on t1v, before_purge to authenticated;

select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
set local role authenticated;
create temp table full_rows as select (pg_temp.page_all(null, 1000, 2) ->> 'rows')::int n;
-- M-4: telefon, który widział nagrobek (kursor ≥ wersja T1), nie dostaje resync — ani w protokole 1, ani 2.
select is((pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', (select version from t1v)))) ->> 'resync')::boolean,
  false, '4: kursor = purged_version (protokół 1): bez resync');
select is((pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', jsonb_build_object('v', (select version from t1v), 'p', 0)), 2, 2)) ->> 'resync')::boolean,
  false, '5: kursor = purged_version (protokół 2, stara epoka): bez resync');

-- ───────── M-1, build 21 (kursor-liczba): pobieranie po czyszczeniu kończy się ─────────
create temp table v1_fresh as select pg_temp.page_all(null, 2, 1) r;
select is((select (r ->> 'pages')::int from v1_fresh), 1, '6: od zera: cała grupa w jednej porcji (dalej nie ma czego cofać)');
select is((select (r ->> 'rows')::int from v1_fresh), (select n from full_rows), '7: od zera: wszystkie wiersze');
select is((select (r ->> 'cursor')::bigint from v1_fresh), (select version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001'), '8: kursor = wersja grupy');
create temp table v1_stale as select pg_temp.page_all('1'::jsonb, 2, 1) r;
select is((select (r ->> 'first_resync')::boolean from v1_stale), true, '9: kursor sprzed czyszczenia: resync');
select is((select (r ->> 'pages')::int from v1_stale), 1, '10: resync: cała grupa w jednej porcji');
select is((select (r ->> 'rows')::int from v1_stale), (select n from full_rows), '11: resync: pełny stan');
select is((pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', (select (r ->> 'cursor')::bigint from v1_stale)), 2)) ->> 'resync')::boolean,
  false, '12: po resync zwykłe pobieranie (bez kolejnego resync)');
select ok(not (pg_temp.g_of(public.sync_pull('{}'::jsonb)) ?| array['purged', 'lists', 'gone']), '13: odpowiedź protokołu 1 bez nowych pól');
-- Grupa bez czyszczenia (osobista B, purged_version = 0): build 21 dostaje porcje jak dotąd.
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d2', jsonb_build_object('kind', 'create', 'entity', 'lists', 'id', 'f1f10000-0000-7000-8000-0000000000b' || (i + 4),
  'group_id', '00000000-0000-7000-8000-0000000000f2', 'set', jsonb_build_object('kind', 'tasks', 'name', 'P' || i))) from generate_series(1, 3) i;
select ok((select (pg_temp.page_all(null, 1, 1, '00000000-0000-7000-8000-0000000000f2') ->> 'pages')::int) > 3, '14: bez czyszczenia: porcje jak dotąd');

-- ───────── M-1, protokół 2 (kursor z epoką): porcje bez pętli ─────────
create temp table v2_fresh as select pg_temp.page_all(null, 2, 2) r;
select ok((select (r ->> 'pages')::int from v2_fresh) between 3 and (select ceil(n / 2.0)::int + 3 from full_rows), '15: od zera: kilka porcji, ale skończona liczba');
select is((select (r ->> 'later_resync')::boolean from v2_fresh), false, '16: od zera: żadna dalsza porcja nie ma resync');
select is((select (r ->> 'rows')::int from v2_fresh), (select n from full_rows), '17: od zera: porcje = pełny stan');
select is((select (r ->> 'has_more')::boolean from v2_fresh), false, '18: ostatnia porcja bez has_more');
create temp table v2_stale as select pg_temp.page_all('{"v":1,"p":0}'::jsonb, 2, 2) r;
select is((select (r ->> 'first_resync')::boolean from v2_stale), true, '19: kursor sprzed czyszczenia (stara epoka): resync');
select is((select (r ->> 'later_resync')::boolean from v2_stale), false, '20: resync porcjami: dalsze porcje bez resync');
select ok((select (r ->> 'pages')::int from v2_stale) between 3 and (select ceil(n / 2.0)::int + 3 from full_rows), '21: resync porcjami kończy się');
select is((select (r ->> 'rows')::int from v2_stale), (select n from full_rows), '22: resync: pełny stan');
select is((pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001',
    jsonb_build_object('v', 1, 'p', (select purged_version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001'))), 2, 2)) ->> 'resync')::boolean,
  false, '23: ta sama epoka (bez nowego czyszczenia od ostatniej porcji): bez resync');
select is((pg_temp.g_of(public.sync_pull('{}'::jsonb, 2, 2)) ->> 'purged')::bigint,
  (select purged_version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001'), '24: odpowiedź podaje epokę grupy');

-- ───────── M-58: tylko encje znane telefonowi ─────────
create temp table only_lists as select pg_temp.g_of(public.sync_pull('{}'::jsonb, 1000, 2, '["groups","lists"]')) g;
select is((select array_agg(distinct x ->> 'e' order by x ->> 'e') from only_lists, jsonb_array_elements(g -> 'rows') x), array['groups', 'lists'], '25: same groups i lists');
select is((select (g ->> 'cursor')::bigint from only_lists), (select version from public.groups where id = 'f1f10000-0000-7000-8000-000000000001'), '26: kursor i tak przechodzi nad pominiętymi wierszami');
select ok(exists (select 1 from jsonb_array_elements(pg_temp.g_of(public.sync_pull('{}'::jsonb)) -> 'rows') x where x ->> 'e' = 'tasks'), '27: protokół 1 (bez listy encji): dotychczasowy zestaw');
select throws_ok($$ select public.sync_pull('{}'::jsonb, 10, 2, '{"tasks":1}') $$, 'P0001', 'invalid_entities', '28: lista encji musi być tablicą');

-- ───────── M-57: zbyt stary protokół także przy pobieraniu ─────────
select throws_ok($$ select public.sync_pull('{}'::jsonb, 10, 0) $$, 'P0001', 'upgrade_required', '29: protokół starszy niż minimum: upgrade_required');

-- ───────── M-54: listy, które widzę ─────────
select is((select pg_temp.g_of(public.sync_pull('{}'::jsonb, 10, 2)) -> 'lists'),
  '["f1f10000-0000-7000-8000-0000000000b1", "f1f10000-0000-7000-8000-0000000000b2"]'::jsonb, '30: B widzi L i udostępnioną H');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is((select pg_temp.g_of(public.sync_pull('{}'::jsonb, 10, 2)) -> 'lists'), '["f1f10000-0000-7000-8000-0000000000b1"]'::jsonb, '31: C widzi tylko L');
create temp table c_before as select (pg_temp.g_of(public.sync_pull('{}'::jsonb, 1000, 2)) ->> 'cursor')::bigint c;
grant select on c_before to authenticated;

-- Przeniesienie T2 (z podzadaniem T9) z L do ukrytej H: C, który widzi L, a nie widzi H, dostaje „gone”.
-- Wcześniej zmiana widoczna dla C, żeby pierwsza porcja po kursorze C kończyła się przed przeniesieniem.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'patch', 'entity', 'tasks', 'id', pg_temp.task(6), 'set', jsonb_build_object('note', 'przed')));
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', jsonb_build_object('kind', 'cmd', 'cmd', 'move_task', 'args',
  jsonb_build_object('id', pg_temp.task(2), 'parent_id', null, 'list_id', 'f1f10000-0000-7000-8000-0000000000b2')));
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
create temp table c_after as select pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', jsonb_build_object('v', (select c from c_before), 'p', 0)), 1000, 2)) g;
select is((select g -> 'gone' from c_after), jsonb_build_array(pg_temp.task(2), pg_temp.task(9)) , '32: C: T2 i T9 przeszły do listy, której nie widzi');
select ok(not exists (select 1 from c_after, jsonb_array_elements(g -> 'rows') x where x::text like '%' || pg_temp.task(2) || '%'), '33: C nie dostaje treści T2');
select ok(exists (select 1 from c_after, jsonb_array_elements(g -> 'rows') x where x ->> 'e' = 'groups'), '34: ta sama porcja kończy pobieranie (wiersz grupy)');
select is((pg_temp.g_of(public.sync_pull('{}'::jsonb, 1000, 2)) -> 'gone'), '[]'::jsonb, '35: pobranie od zera: bez „gone” (telefon i tak czyści grupę)');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
create temp table b_after as select pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', jsonb_build_object('v', (select c from c_before), 'p', 0)), 1000, 2)) g;
select is((select g -> 'gone' from b_after), '[]'::jsonb, '36: B widzi obie listy: bez „gone”');
select is((select x -> 'row' ->> 'list_id' from b_after, jsonb_array_elements(g -> 'rows') x where x ->> 'e' = 'tasks' and x -> 'row' ->> 'id' = pg_temp.task(2)),
  'f1f10000-0000-7000-8000-0000000000b2', '37: B dostaje T2 w nowej liście');
-- Porcje: „gone” tylko w porcji, której zakres obejmuje przeniesienie.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is((pg_temp.g_of(public.sync_pull(jsonb_build_object('f1f10000-0000-7000-8000-000000000001', jsonb_build_object('v', (select c from c_before), 'p', 0)), 1, 2)) -> 'gone'),
  '[]'::jsonb, '38: porcja przed przeniesieniem: bez „gone”');

-- Zawężenie: A ukrywa L („Tylko ja”) — L znika z list B i C.
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select pg_temp.m('f1f10000-0000-7000-8000-0000000000d1', '{"kind":"patch","entity":"lists","id":"f1f10000-0000-7000-8000-0000000000b1","set":{"visibility":"private"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f3');
select is((select pg_temp.g_of(public.sync_pull('{}'::jsonb, 10, 2)) -> 'lists'), '[]'::jsonb, '39: C po zawężeniu: żadnej listy');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select is((select pg_temp.g_of(public.sync_pull('{}'::jsonb, 10, 2)) -> 'lists'), '["f1f10000-0000-7000-8000-0000000000b2"]'::jsonb, '40: B po zawężeniu: tylko H');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
select is((select jsonb_array_length(pg_temp.g_of(public.sync_pull('{}'::jsonb, 10, 2)) -> 'lists')), 2, '41: właściciel nadal widzi obie');

-- ───────── M-56: odrzucenie po zgubionej odpowiedzi ─────────
create temp table pushes (n int, res jsonb);
grant all on pushes to authenticated;
insert into pushes values (1, public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[
  {"seq":1,"op_id":"f1f10000-0000-7000-8000-0000000000e1","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000ff","set":{"title":"x"}},
  {"seq":2,"op_id":"f1f10000-0000-7000-8000-0000000000e2","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000c3","set":{"title":"ok"}}
]'));
select is((select res -> 'results' from pushes where n = 1), '[{"seq": 1, "code": "not_found", "status": "rejected"}, {"seq": 2, "status": "ok"}]'::jsonb, '42: pierwsza wysyłka: odrzucenie i sukces');
-- Odpowiedź zginęła: ta sama paczka jeszcze raz.
insert into pushes values (2, public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[
  {"seq":1,"op_id":"f1f10000-0000-7000-8000-0000000000e1","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000ff","set":{"title":"x"}},
  {"seq":2,"op_id":"f1f10000-0000-7000-8000-0000000000e2","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000c3","set":{"title":"ok"}}
]'));
select is((select res -> 'results' from pushes where n = 2), '[{"seq": 1, "code": "not_found", "status": "rejected"}, {"seq": 2, "status": "duplicate"}]'::jsonb, '43: powtórka: odrzucenie z tym samym kodem, sukces jako duplikat');
-- Inna operacja pod tym samym numerem (np. telefon z kopii zapasowej) nie dziedziczy cudzego odrzucenia.
select is((public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[{"seq":1,"op_id":"f1f10000-0000-7000-8000-0000000000e9","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000ff","set":{"title":"x"}}]') -> 'results' -> 0 ->> 'status'),
  'duplicate', '44: inny op_id pod tym samym numerem: duplikat');
-- Telefon potwierdził odbiór (wysyła od numeru 3): zapamiętane odrzucenie znika.
select is((public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[{"seq":3,"op_id":"f1f10000-0000-7000-8000-0000000000e3","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000c4","set":{"title":"y"}}]') -> 'results' -> 0 ->> 'status'),
  'ok', '45: kolejna paczka');
reset role;
select is((select count(*)::int from private.sync_rejections where client_id = 'f1f10000-0000-7000-8000-0000000000e1'), 0, '46: odrzucenia poniżej potwierdzonego numeru usunięte');
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f1');
set local role authenticated;
select is((public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[{"seq":1,"op_id":"f1f10000-0000-7000-8000-0000000000e1","kind":"patch","entity":"tasks","id":"f1f10000-0000-7000-8000-0000000000ff","set":{"title":"x"}}]') -> 'results' -> 0 ->> 'status'),
  'duplicate', '47: po potwierdzeniu: zwykły duplikat');
-- Cudza instalacja nie odczyta odrzuceń (client_mismatch przed czymkolwiek).
select pg_temp.as_user('00000000-0000-7000-8000-0000000000f2');
select throws_ok($$ select public.sync_push('f1f10000-0000-7000-8000-0000000000e1', 2, '[]') $$, 'P0001', 'client_mismatch', '48: cudzy client_id odrzucony');
select is(private.recall_rejection('f1f10000-0000-7000-8000-0000000000e1', 1, null), null, '49: odczyt odrzucenia tylko dla właściciela instalacji');

-- Uprawnienia: nowa sygnatura sync_pull dla zalogowanych, tabela odrzuceń niedostępna z aplikacji.
reset role;
select ok(has_function_privilege('authenticated', 'public.sync_pull(jsonb, int, int, jsonb)', 'execute'), '50: sync_pull dla authenticated');
select ok(not has_function_privilege('anon', 'public.sync_pull(jsonb, int, int, jsonb)', 'execute'), '51: sync_pull nie dla anon');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'sync_pull'), 1, '52: jedna sync_pull (bez przeciążeń — PostgREST)');
select ok(not has_table_privilege('authenticated', 'private.sync_rejections', 'select'), '53: odrzucenia poza zasięgiem aplikacji');
select pg_temp.as_user('');
select is((select count(*)::int from private.tasks_moved_out('f1f10000-0000-7000-8000-000000000001', 0, 1000000)), 0, '54: „gone” tylko dla osoby, która widzi starą listę');
select is(private.legacy_entities(), array['groups', 'group_members', 'lists', 'object_members', 'tasks', 'activity', 'events', 'event_participants', 'event_overrides', 'event_task_series', 'handoffs', 'event_rsvps'], '55: zestaw encji protokołu 1');

select * from finish();
rollback;
