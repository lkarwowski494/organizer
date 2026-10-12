-- Pobieranie (audyt 3, PK-02; migracja 20261012010000_pull_budget): zakupy zależne od listy (N-88), grupy bez zmian
-- bez przeglądania (N-102), budżet wierszy na odpowiedź przy 50 grupach (N-101), limit częstości (N-96).
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-7000-8000-0000000002a1', 'a02@x.test'),
  ('00000000-0000-7000-8000-0000000002a2', 'b02@x.test'),
  ('00000000-0000-7000-8000-0000000002a3', 'c02@x.test'),
  ('00000000-0000-7000-8000-0000000002a4', 'd02@x.test');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;
create function pg_temp.p(client text, op jsonb) returns text language plpgsql as $$
declare s int := coalesce(nullif(current_setting('pb.seq_' || replace(client, '-', ''), true), ''), '0')::int + 1;
begin
  perform set_config('pb.seq_' || replace(client, '-', ''), s::text, true);
  return coalesce(public.sync_push(client::uuid, 2, jsonb_build_array(op || jsonb_build_object('seq', s))) -> 'results' -> 0 ->> 'code', 'ok');
end $$;
create function pg_temp.m(client text, op jsonb) returns void language plpgsql as $$
declare r text := pg_temp.p(client, op);
begin if r <> 'ok' then raise exception 'setup op failed: % -> %', op, r; end if; end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlerrm; end $$;
-- Encje telefonu (src/domain/sync-engine/client.ts, ENTITIES); bez listy serwer wysyła zestaw protokołu 1.
create function pg_temp.ents() returns jsonb language sql as $$
  select '["groups","group_members","lists","object_members","tasks","activity","events","event_participants","event_overrides","event_task_series","handoffs","event_rsvps","my_day_scopes","shopping_trips"]'::jsonb
$$;
create function pg_temp.g_of(res jsonb, g text) returns jsonb language sql as $$
  select x from jsonb_array_elements(res -> 'groups') x where x ->> 'group_id' = g
$$;
create function pg_temp.has_row(rs jsonb, ent text, rid text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(rs) x where x ->> 'e' = ent and x -> 'row' ->> 'id' = rid)
$$;
-- Kursory protokołu 2 z odpowiedzi (jak telefon: epoka z odpowiedzi albo dotychczasowa).
create function pg_temp.next_cursors(prev jsonb, res jsonb) returns jsonb language sql as $$
  select coalesce(prev, '{}'::jsonb) || coalesce(jsonb_object_agg(g ->> 'group_id',
           jsonb_build_object('v', (g ->> 'cursor')::bigint, 'p', coalesce((g ->> 'purged')::bigint, (prev -> (g ->> 'group_id') ->> 'p')::bigint, 0))), '{}'::jsonb)
  from jsonb_array_elements(res -> 'groups') g
$$;
-- Pobranie do końca (has_more): liczba obrotów, wszystkie wiersze, największa odpowiedź (wiersze, bajty), kursory.
create function pg_temp.pull_all(ver int, lim int, start jsonb) returns jsonb language plpgsql as $$
declare res jsonb; cur jsonb := start; rounds int := 0; got jsonb := '[]'; max_rows int := 0; max_bytes int := 0; k int;
begin
  loop
    rounds := rounds + 1;
    if rounds > 50 then raise exception 'pobieranie się nie kończy'; end if;
    res := public.sync_pull(cur, lim, ver, case when ver >= 2 then pg_temp.ents() end);
    select count(*) into k from jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows');
    max_rows := greatest(max_rows, k);
    max_bytes := greatest(max_bytes, octet_length(res::text));
    got := got || coalesce((select jsonb_agg(x) from jsonb_array_elements(res -> 'groups') g, jsonb_array_elements(g -> 'rows') x), '[]');
    if ver >= 2 then cur := pg_temp.next_cursors(cur, res);
    else cur := coalesce(cur, '{}') || (select jsonb_object_agg(g ->> 'group_id', (g ->> 'cursor')::bigint) from jsonb_array_elements(res -> 'groups') g);
    end if;
    exit when not exists (select 1 from jsonb_array_elements(res -> 'groups') g where (g ->> 'has_more')::boolean);
  end loop;
  return jsonb_build_object('rounds', rounds, 'rows', got, 'max_rows', max_rows, 'max_bytes', max_bytes, 'cursors', cur);
end $$;
create function pg_temp.calls(f text) returns bigint language sql security definer as $$
  select coalesce((select calls from pg_stat_xact_user_functions where schemaname = 'private' and funcname = f), 0)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ───────── N-88: zakupy zależne od listy ─────────
-- G: A (owner, a1), B (member, b1). A ma listę zakupów prywatną P i ograniczoną R, w każdej zrobione zakupy.
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a1');
set local role authenticated;
select public.create_group('02020000-0000-7000-8000-000000000001', 'G', '02020000-0000-7000-8000-0000000000a1', 'A');
reset role;
select pg_temp.as_user('');
insert into public.group_members (member_id, group_id, user_id, display_name, role) values
  ('02020000-0000-7000-8000-0000000000b1', '02020000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-0000000002a2', 'B', 'member');
set local role authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a1');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"create","entity":"lists","id":"02020000-0000-7000-8000-0000000001a1","group_id":"02020000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Prywatne","visibility":"private"}}');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"create","entity":"shopping_trips","id":"02020000-0000-7000-8000-0000000003a1","group_id":"02020000-0000-7000-8000-000000000001","set":{"list_id":"02020000-0000-7000-8000-0000000001a1","done_at":"2026-10-09T08:00:00Z"}}');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"create","entity":"lists","id":"02020000-0000-7000-8000-0000000001a2","group_id":"02020000-0000-7000-8000-000000000001","set":{"kind":"shopping","name":"Ograniczone","visibility":"restricted"}}');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"create","entity":"tasks","id":"02020000-0000-7000-8000-0000000002a2","group_id":"02020000-0000-7000-8000-000000000001","set":{"list_id":"02020000-0000-7000-8000-0000000001a2","title":"Mleko"}}');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"create","entity":"shopping_trips","id":"02020000-0000-7000-8000-0000000003a2","group_id":"02020000-0000-7000-8000-000000000001","set":{"list_id":"02020000-0000-7000-8000-0000000001a2","done_at":"2026-10-09T09:00:00Z"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a2');
create temp table b_cur as select pg_temp.pull_all(2, 1000, '{}') -> 'cursors' c;
grant all on b_cur to authenticated;
select is(public.sync_fetch_scope('02020000-0000-7000-8000-0000000001a2') -> 'rows', '[]'::jsonb, '1: lista, której nie widzę — pusty wynik');

select pg_temp.as_user('00000000-0000-7000-8000-0000000002a1');
select is(pg_temp.p('02020000-0000-7000-8000-00000000c0a1', '{"kind":"patch","entity":"lists","id":"02020000-0000-7000-8000-0000000001a1","set":{"visibility":"group"}}'), 'ok', '2: prywatna → cała grupa');
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a2');
select ok(pg_temp.has_row(pg_temp.g_of(public.sync_pull((select c from b_cur), 1000, 2, pg_temp.ents()), '02020000-0000-7000-8000-000000000001') -> 'rows',
                          'shopping_trips', '02020000-0000-7000-8000-0000000003a1'),
          '3: B ze starym kursorem dostaje wcześniejsze zakupy poszerzonej listy');

select pg_temp.as_user('00000000-0000-7000-8000-0000000002a1');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"cmd","cmd":"grant_scope","args":{"list_id":"02020000-0000-7000-8000-0000000001a2","member_id":"02020000-0000-7000-8000-0000000000b1"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a2');
create temp table scope as select public.sync_fetch_scope('02020000-0000-7000-8000-0000000001a2') -> 'rows' rs;
select ok(pg_temp.has_row((select rs from scope), 'shopping_trips', '02020000-0000-7000-8000-0000000003a2'), '4: dostęp do listy ograniczonej — sync_fetch_scope zwraca zakupy');
select is((select array_agg(distinct x ->> 'e' order by x ->> 'e') from jsonb_array_elements((select rs from scope)) x),
          array['activity', 'lists', 'object_members', 'shopping_trips', 'tasks'], '5: i jak dotąd listę, wpisy dostępu, zadania i historię');
select ok((select bool_and(a.v <= b.v) from (select (x ->> 'v')::bigint v, o from jsonb_array_elements((select rs from scope)) with ordinality t (x, o)) a
           join (select (x ->> 'v')::bigint v, o from jsonb_array_elements((select rs from scope)) with ordinality t (x, o)) b on b.o = a.o + 1),
          '6: wiersze po kolei wersji');
reset role;
select set_eq($$ select table_name::text from information_schema.columns where table_schema = 'public' and column_name = 'list_id' $$,
              $$ select unnest(private.list_scoped_entities()) $$, '7: każda tabela z list_id jest na liście tabel zależnych od listy');
select set_eq($$ select table_name::text from information_schema.columns where table_schema = 'public' and column_name = 'scope_id' $$,
              array['activity', 'object_members'], '8: zakres przez scope_id mają tylko wpisy dostępu i historia (obsługiwane osobno)');

-- ───────── N-102: grupa bez zmian nie jest przeglądana ─────────
set local track_functions = 'all';
set local role authenticated;
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a2');
update b_cur set c = pg_temp.pull_all(2, 1000, c) -> 'cursors';
create temp table calls0 as select pg_temp.calls('group_rows_since') n;
grant all on calls0 to authenticated;
create temp table quiet as select public.sync_pull((select c from b_cur), 1000, 2, pg_temp.ents()) r;
grant all on quiet to authenticated;
select is(pg_temp.calls('group_rows_since') - (select n from calls0), 0::bigint, '9: pobranie bez zmian nie przegląda wierszy grupy');
select is(pg_temp.g_of((select r from quiet), '02020000-0000-7000-8000-000000000001') - 'member_id' - 'role',
          jsonb_build_object('group_id', '02020000-0000-7000-8000-000000000001', 'cursor', (select c -> '02020000-0000-7000-8000-000000000001' -> 'v' from b_cur),
                             'has_more', false, 'resync', false, 'rows', '[]'::jsonb, 'purged', 0, 'gone', '[]'::jsonb),
          '10: grupa bez zmian — kursor bez zmian, bez wierszy i bez listy list');
select is(pg_temp.g_of(public.sync_pull((select c from b_cur), 1000, 1, null), '02020000-0000-7000-8000-000000000001') - 'member_id' - 'role',
          jsonb_build_object('group_id', '02020000-0000-7000-8000-000000000001', 'cursor', (select c -> '02020000-0000-7000-8000-000000000001' -> 'v' from b_cur),
                             'has_more', false, 'resync', false, 'rows', '[]'::jsonb),
          '11: protokół 1 — te same pola co dotąd');
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a1');
select pg_temp.m('02020000-0000-7000-8000-00000000c0a1', '{"kind":"patch","entity":"tasks","id":"02020000-0000-7000-8000-0000000002a2","set":{"title":"Mleko 2%"}}');
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a2');
update calls0 set n = pg_temp.calls('group_rows_since');
update quiet set r = public.sync_pull((select c from b_cur), 1000, 2, pg_temp.ents());
select is(pg_temp.calls('group_rows_since') - (select n from calls0), 1::bigint, '12: po zmianie grupa jest przeglądana');
select ok(pg_temp.has_row(pg_temp.g_of((select r from quiet), '02020000-0000-7000-8000-000000000001') -> 'rows', 'tasks', '02020000-0000-7000-8000-0000000002a2')
          and pg_temp.g_of((select r from quiet), '02020000-0000-7000-8000-000000000001') ? 'lists', '13: i wraca ze zmianą i listą list');

-- ───────── N-101: 50 grup, budżet wierszy na odpowiedź ─────────
-- C: 50 grup wspólnych, w każdej lista i 20 zadań (z historią ok. 45 wierszy na grupę, razem ok. 2 250).
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a3');
select count(public.create_group(('0202cccc-0000-7000-8000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, 'C' || i,
                                 ('0202cccc-0000-7000-8000-0000000001' || lpad(to_hex(i), 2, '0'))::uuid, 'C')) from generate_series(1, 50) i;
select count(public.sync_push('0202cccc-0000-7000-8000-00000000c0c1', 2, (
  select jsonb_agg(op order by s) from (
    select 0 s, jsonb_build_object('seq', i * 100, 'kind', 'create', 'entity', 'lists', 'id', '0202cccc-0000-7000-8000-0000000002' || lpad(to_hex(i), 2, '0'),
      'group_id', '0202cccc-0000-7000-8000-0000000000' || lpad(to_hex(i), 2, '0'), 'set', '{"kind":"tasks","name":"L"}'::jsonb) op
    union all
    select j, jsonb_build_object('seq', i * 100 + j, 'kind', 'create', 'entity', 'tasks', 'id', '0202cccc-' || lpad(to_hex(i), 4, '0') || '-7000-8000-0000000003' || lpad(to_hex(j), 2, '0'),
      'group_id', '0202cccc-0000-7000-8000-0000000000' || lpad(to_hex(i), 2, '0'),
      'set', jsonb_build_object('list_id', '0202cccc-0000-7000-8000-0000000002' || lpad(to_hex(i), 2, '0'), 'title', 'Zadanie ' || j))
    from generate_series(1, 20) j) x))) from generate_series(1, 50) i;
create temp table total as select sum((select count(*) from private.group_rows_since(gm.group_id, 0, 1000000)))::int n
  from public.group_members gm where gm.user_id = '00000000-0000-7000-8000-0000000002a3';
grant all on total to authenticated;
select ok((select n from total) > 2000, '14: dane: 50 grup, ponad 2 000 wierszy');

create temp table first as select public.sync_pull('{}'::jsonb, 1000, 2, pg_temp.ents()) r;
grant all on first to authenticated;
select ok((select count(*) from jsonb_array_elements((select r -> 'groups' from first)) g, jsonb_array_elements(g -> 'rows')) <= 1000 + 1,
          '15: pierwsza odpowiedź mieści się w budżecie (najwyżej wiersz z tą samą wersją co ostatni)');
select ok(octet_length((select r from first)::text) < 1024 * 1024, '16: i ma mniej niż 1 MB (dotąd wszystkie grupy naraz: ok. 2 250 wierszy)');
select is((select count(*)::int from jsonb_array_elements((select r -> 'groups' from first)) g), 51, '17: wszystkie grupy (50 wspólnych i osobista) są w odpowiedzi (telefon nie usuwa odłożonych)');
select is((select array_agg(distinct g - 'group_id' - 'member_id' - 'role') from jsonb_array_elements((select r -> 'groups' from first)) g where g -> 'rows' = '[]'),
          array[jsonb_build_object('cursor', 0, 'has_more', true, 'resync', false, 'rows', '[]'::jsonb, 'gone', '[]'::jsonb)],
          '18: odłożone grupy — kursor z zapytania, has_more, bez epoki i listy list');
select ok((select count(*) from jsonb_array_elements((select r -> 'groups' from first)) g where g -> 'rows' = '[]') >= 25, '19: większość grup odłożona');

create temp table all2 as select pg_temp.pull_all(2, 1000, '{}') r;
grant all on all2 to authenticated;
select ok((select (r ->> 'max_rows')::int <= 1001 and (r ->> 'rounds')::int between 3 and 5 from all2), '20: protokół 2 — porcje w budżecie, kilka obrotów');
select is((select jsonb_array_length(r -> 'rows') from all2), (select n from total), '21: pobrane wszystkie wiersze, każdy raz');
select is((select count(distinct (x ->> 'e', coalesce(x -> 'row' ->> 'id', x -> 'row' ->> 'member_id')))::int from jsonb_array_elements((select r -> 'rows' from all2)) x),
          (select n from total), '22: bez powtórzeń');

-- Protokół 1 (build 21) po czyszczeniu: każda grupa w całości w jednej porcji, grupy ponad budżet odłożone.
reset role;
update public.groups set purged_version = 1 where id in (select group_id from public.group_members where user_id = '00000000-0000-7000-8000-0000000002a3');
set local role authenticated;
create temp table all1 as select pg_temp.pull_all(1, 1000, '{}') r;
grant all on all1 to authenticated;
select is((select jsonb_array_length(r -> 'rows') from all1), (select n from total), '23: protokół 1 — wszystkie wiersze, każdy raz');
select ok((select (r ->> 'rounds')::int between 3 and 5 and (r ->> 'max_rows')::int < 1100 from all1), '24: grupy w całości, ale odpowiedź w okolicy budżetu');

-- ───────── N-96: limit częstości ─────────
select pg_temp.as_user('00000000-0000-7000-8000-0000000002a4');
select is((select count(*)::int from generate_series(1, 120) i where public.sync_pull('{}'::jsonb, 10, 2, pg_temp.ents()) is not null), 120, '25: 120 pobrań na minutę przechodzi');
select is(pg_temp.err($$ select public.sync_pull('{}'::jsonb, 10, 2, pg_temp.ents()) $$), 'rate_limited', '26: 121. — rate_limited (telefon ponawia z opóźnieniem)');
select is((select count(*)::int from generate_series(1, 120) i where public.sync_fetch_scope('02020000-0000-7000-8000-0000000001a2') is not null), 120,
          '27: sync_fetch_scope ma osobny licznik');
select is(pg_temp.err($$ select public.sync_fetch_scope('02020000-0000-7000-8000-0000000001a2') $$), 'rate_limited', '28: i ten sam limit');
reset role;
update private.rate_counters set window_start = now() - interval '61 seconds' where user_id = '00000000-0000-7000-8000-0000000002a4';
set local role authenticated;
select ok(public.sync_pull('{}'::jsonb, 10, 2, pg_temp.ents()) ? 'groups', '29: po minucie znowu przechodzi');
select is(pg_temp.err($$ select private.sync_rate_check('sync_push') $$), 'invalid_value', '30: licznik tylko pobierania');

select * from finish();
rollback;
