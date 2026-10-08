-- Audyt 2, paczka P16: wydajność i kolejność blokad synchronizacji. Testy: supabase/tests/sync_perf.test.sql,
-- tests/db/concurrency.test.ts (zakleszczenie), dotychczasowe testy protokołu (sync, sync_protocol_v2, tests/db).
--  M-181 group_rows_since bez kwadratowego kosztu;
--  M-73  „scopes” w sync_pull tylko z moich grup (indeksy: migracja 20261008480000_retention);
--  M-192 sync_push blokuje grupy paczki na początku, posortowane po id.
-- Zastępuje: private.group_rows_since (20261008270000), public.sync_pull i public.sync_push (20261008310000 — poza zmianami
-- opisanymi przy nich bez zmian).

-- M-181 (S-20): porcja liczona per tabela. Dotąd każda porcja serializowała (to_jsonb) wszystkie wiersze od kursora
-- i numerowała je razem, więc pierwsze pobranie dużej grupy rosło kwadratowo. Teraz: z każdej tabeli najwyżej lim
-- najniższych wersji (indeksy (group_id, version)), z nich granica porcji = lim-ta najniższa wersja (albo najwyższa, gdy
-- wierszy jest mniej), i dopiero wiersze do granicy idą do to_jsonb. Wynik jak dotąd: wszystkie wiersze z wersją ≤ granicy
-- (także kilka z tą samą wersją ponad lim), po kolei wersji. Zastępuje wersję z 20261008270000_event_rsvps.sql.
create or replace function private.group_rows_since(g uuid, since bigint, lim int) returns table (e text, v bigint, r jsonb)
language plpgsql stable security invoker set search_path = '' as $$
declare cut bigint;
begin
  select max(y.v) into cut from (
    select x.v from (
      (select t.version v from public.groups t where t.id = g and t.version > since)
      union all (select t.version from public.group_members t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.lists t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.object_members t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.tasks t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.events t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.event_participants t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.event_overrides t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.event_task_series t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.event_rsvps t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.handoffs t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.activity t where t.group_id = g and t.version > since order by t.version limit lim)
    ) x order by x.v limit lim
  ) y;
  if cut is null then return; end if;
  return query select q.e, q.v, q.r from (
    select 'groups'::text, t.version, to_jsonb(t) - 'plan' from public.groups t where t.id = g and t.version > since and t.version <= cut
    union all select 'group_members', t.version, to_jsonb(t) from public.group_members t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'lists', t.version, to_jsonb(t) from public.lists t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'object_members', t.version, to_jsonb(t) from public.object_members t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'tasks', t.version, to_jsonb(t) from public.tasks t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'events', t.version, to_jsonb(t) from public.events t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'event_participants', t.version, to_jsonb(t) from public.event_participants t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'event_overrides', t.version, to_jsonb(t) from public.event_overrides t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'event_task_series', t.version, to_jsonb(t) from public.event_task_series t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'event_rsvps', t.version, to_jsonb(t) from public.event_rsvps t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'handoffs', t.version, to_jsonb(t) from public.handoffs t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since and t.version <= cut
  ) q (e, v, r) order by q.v;
end $$;

-- Grupa, której dotyczy operacja (null: polecenie, nieznana encja albo błędne id — apply_op i tak ją odrzuci).
-- SECURITY DEFINER, bo wiersz może być niewidoczny (np. ukryta lista); wynik służy tylko do blokady, nie wychodzi na zewnątrz.
create function private.op_group(op jsonb) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare e private.sync_entities; g uuid;
begin
  if op ->> 'kind' = 'create' then return (op ->> 'group_id')::uuid; end if;
  if op ->> 'kind' not in ('patch', 'delete', 'restore') then return null; end if;
  select * into e from private.sync_entities where entity = op ->> 'entity';
  if e.entity is null then return null; end if;
  if e.entity = 'groups' then return (op ->> 'id')::uuid; end if;
  execute format('select group_id from public.%I where %I = $1', e.entity, e.pk) into g using (op ->> 'id')::uuid;
  return g;
exception when others then
  return null;
end $$;

-- Blokuje wiersze grup (tylko moich) w kolejności id. Wiersze blokuje węzeł nad sortowaniem, więc po kolei; PERFORM
-- wykonuje zapytanie do końca (funkcja SQL zwracająca void mogłaby zatrzymać się na pierwszym wierszu).
create function private.lock_groups(ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups g where g.id = any (ids) and g.id in (select private.my_group_ids()) order by g.id for update;
end $$;

create or replace function public.sync_pull(cursors jsonb, lim int default 1000, schema_version int default 1, entities jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  ver int := coalesce(schema_version, 1);
  ents text[];
  m record;
  c jsonb;
  since bigint;
  known_p bigint;
  resync boolean;
  whole boolean;
  rows jsonb;
  top bigint;
  got_group boolean;
  one jsonb;
  out_groups jsonb := '[]'::jsonb;
  l int := least(greatest(coalesce(lim, 1000), 1), private.pull_limit_max());
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if ver < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if ver >= 2 and entities is not null then
    if jsonb_typeof(entities) <> 'array' then raise exception 'invalid_entities' using errcode = 'P0001'; end if;
    ents := array(select jsonb_array_elements_text(entities));
  else
    ents := private.legacy_entities();
  end if;
  for m in
    select gm.group_id, gm.member_id, gm.role, gr.version, gr.purged_version
    from public.group_members gm join public.groups gr on gr.id = gm.group_id
    where gm.user_id = me and gm.deleted_at is null
    order by gm.group_id
  loop
    -- Kursor protokołu 2: {v, p} — wersja i epoka (purged_version z ostatniej odpowiedzi); protokołu 1: sama wersja.
    c := cursors -> m.group_id::text;
    if jsonb_typeof(c) = 'object' then
      since := coalesce((c ->> 'v')::bigint, 0);
      known_p := (c ->> 'p')::bigint;
    else
      since := coalesce((c #>> '{}')::bigint, 0);
      known_p := null;
    end if;
    -- Resync: kursor sprzed czyszczenia — telefon mógł nie dostać nagrobka wiersza, którego już nie ma. Telefon z epoką
    -- równą bieżącej pobiera dalej porcjami to samo pobranie (od jego początku nic nie wyczyszczono), więc dalsze porcje
    -- nie cofają się do zera (M-1). Bez epoki (protokół 1) — jak dotąd.
    resync := since > 0 and since < m.purged_version and (ver < 2 or known_p is distinct from m.purged_version);
    if resync then since := 0; end if;
    -- Zgodność z buildem 21: pobranie od zera w grupie po czyszczeniu dostaje całą grupę w jednej porcji. W porcjach
    -- następna miałaby kursor < purged_version, czyli znowu resync — pętla bez końca (M-1).
    whole := ver < 2 and since = 0 and m.purged_version > 0;
    select coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v) filter (where x.e = any (ents)), '[]'::jsonb),
           max(x.v), coalesce(bool_or(x.e = 'groups'), false)
      into rows, top, got_group
      from private.group_rows_since(m.group_id, since, case when whole then 2147483647 else l end) x;
    -- Wiersz grupy ma najwyższą wersję; jeśli go nie ma, a wiersze są, wynik został ucięty limitem. Kursor przechodzi też
    -- nad wierszami encji, których telefon nie zna (M-58).
    one := jsonb_build_object(
      'group_id', m.group_id, 'member_id', m.member_id, 'role', m.role,
      'cursor', coalesce(top, since), 'has_more', top is not null and not got_group,
      'resync', resync, 'rows', rows);
    if ver >= 2 then
      one := one || jsonb_build_object(
        -- Epoka do odesłania w następnym kursorze (M-1).
        'purged', m.purged_version,
        -- Wszystkie listy grupy, które widzę (także z kosza): telefon usuwa listy spoza zbioru z ich zawartością (M-54).
        'lists', (select coalesce(jsonb_agg(li.id order by li.id), '[]'::jsonb) from public.lists li where li.group_id = m.group_id),
        -- Zadania przeniesione do listy, której nie widzę. Przy pobraniu od zera zbędne: telefon czyści grupę.
        'gone', case when since > 0 and top is not null
                     then coalesce((select jsonb_agg(x order by x) from private.tasks_moved_out(m.group_id, since, top) x), '[]'::jsonb)
                     else '[]'::jsonb end);
    end if;
    out_groups := out_groups || one;
  end loop;
  -- Pełna lista grup i ukrytych list, które widzę: klient usuwa lokalnie wszystko spoza niej
  -- (utrata dostępu), a nowe zakresy pobiera przez sync_fetch_scope (wiersze mogą mieć stare wersje).
  return jsonb_build_object(
    'groups', out_groups,
    -- M-73: tylko listy moich grup — dotąd zapytanie przeglądało ukryte listy całej bazy (can_see_list na każdym wierszu).
    'scopes', coalesce((select jsonb_agg(li.id order by li.id) from public.lists li
                        where li.group_id in (select private.my_group_ids())
                          and li.visibility <> 'group' and li.deleted_at is null), '[]'::jsonb));
end $$;

create or replace function public.sync_push(client_id uuid, schema_version int, ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  last bigint;
  op jsonb;
  seq bigint;
  results jsonb := '[]'::jsonb;
  touched uuid[] := '{}';
  g uuid;
  code text;
  st text;
begin
  if schema_version < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(ops) <> 'array' then raise exception 'invalid_batch' using errcode = 'P0001'; end if;
  if jsonb_array_length(ops) > private.push_batch_max() then raise exception 'batch_too_large' using errcode = 'P0001'; end if;
  last := private.claim_client(client_id);
  perform private.forget_rejections(client_id, (select min((x ->> 'seq')::bigint) from jsonb_array_elements(ops) x));
  -- M-192: blokady grup z paczki od razu, w stałej kolejności (po id) — dwie paczki dotykające tych samych grup
  -- w odwrotnej kolejności nie zakleszczą się. Polecenia (cmd) blokują swoje grupy same, w trakcie.
  perform private.lock_groups(array(select private.op_group(x) from jsonb_array_elements(ops) x));

  for op in select value from jsonb_array_elements(ops) loop
    seq := (op ->> 'seq')::bigint;
    if seq is null then raise exception 'invalid_batch:seq' using errcode = 'P0001'; end if;
    if seq <= last then
      -- Już przetworzona (np. odpowiedź zginęła w sieci i klient ponawia): nic nie robimy drugi raz. Odrzucenie
      -- zwracamy jeszcze raz (M-56) — inaczej zmiana znikała z telefonu bez wpisu w „Odrzuconych zmianach”.
      code := private.recall_rejection(client_id, seq, op ->> 'op_id');
      results := results || case when code is null then jsonb_build_object('seq', seq, 'status', 'duplicate')
                                 else jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code) end;
      continue;
    end if;
    last := seq;
    perform set_config('organizer.op_id', coalesce(op ->> 'op_id', ''), true);
    begin
      g := private.apply_op(op);
      if g is not null then touched := touched || g; end if;
      results := results || jsonb_build_object('seq', seq, 'status', 'ok');
    exception
      -- Błędy przejściowe przerywają całe wywołanie — klient ponowi z opóźnieniem, nic nie zostało zapisane.
      when serialization_failure or deadlock_detected or lock_not_available or query_canceled
           or admin_shutdown or crash_shutdown or cannot_connect_now or too_many_connections then
        raise;
      when others then
        get stacked diagnostics st = returned_sqlstate;
        code := case
          when st = 'P0001' then sqlerrm
          when st = '42501' then 'forbidden'
          when st like '23%' then 'invalid:' || st
          when st like '22%' then 'invalid_value'
          else 'error:' || st end;
        results := results || jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code);
        perform private.remember_rejection(client_id, seq, op ->> 'op_id', code);
    end;
  end loop;
  perform set_config('organizer.op_id', '', true);
  perform private.set_client_seq(client_id, last);
  perform private.poke_groups(touched);
  return jsonb_build_object('last_seq', last, 'results', results);
end $$;

revoke all on function private.op_group(jsonb), private.lock_groups(uuid[]) from public, anon;
grant execute on function private.op_group(jsonb), private.lock_groups(uuid[]) to authenticated;
revoke all on function public.sync_pull(jsonb, int, int, jsonb), public.sync_push(uuid, int, jsonb) from public, anon;
grant execute on function public.sync_pull(jsonb, int, int, jsonb), public.sync_push(uuid, int, jsonb) to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
