-- Etap 1, migracja 3: protokół synchronizacji (sync_push, sync_pull, sync_fetch_scope, czyszczenie).
-- Architektura: „Protokół synchronizacji” — paczka operacji z licznikiem klienta (wzór Replicache:
-- https://doc.replicache.dev/reference/server-push), odrzucenia biznesowe w treści odpowiedzi zamiast
-- błędu HTTP (PowerSync: https://docs.powersync.com/installation/app-backend-setup/writing-client-changes),
-- kursor = wersja per grupa (D32), tombstones z horyzontem czyszczenia (resync jak must-refetch w Electric).
--
-- Funkcje publiczne są SECURITY INVOKER: każdy zapis przechodzi przez RLS i wyzwalacze tabel, więc istnieje
-- jedna ścieżka uprawnień. W private są tylko licznik klienta i wysyłka sygnałów (poke).

-- Jedno źródło prawdy: wartości z src/config (test kontraktowy w supabase/tests/contract_config.test.sql).
create function private.push_batch_max() returns int language sql immutable as $$ select 100 $$;
create function private.pull_limit_max() returns int language sql immutable as $$ select 1000 $$;
create function private.schema_version() returns int language sql immutable as $$ select 1 $$;

-- Które kolumny klient może ustawić przy tworzeniu i zmieniać — zgodne z GRANT w migracjach tabel.
create table private.sync_entities (
  entity text primary key,
  pk text not null,
  insert_cols text[] not null,
  patch_cols text[] not null,
  soft_delete boolean not null
);
insert into private.sync_entities values
  ('groups', 'id', '{}', '{name}', false),
  ('group_members', 'member_id', '{member_id,group_id,display_name,color,role}', '{display_name,color,role}', true),
  ('lists', 'id', '{id,group_id,kind,name,visibility,sort_key}', '{name,visibility,sort_key}', true),
  ('tasks', 'id', '{id,group_id,list_id,parent_id,title,note,sort_key,assignee_member_id,deadline_mode,due_date,due_time,start_date,completed_at}',
   '{title,note,sort_key,assignee_member_id,deadline_mode,due_date,due_time,start_date,completed_at}', true);

-- Licznik klienta: jeden wiersz na instalację, zablokowany do końca transakcji (kolejne pushe tej
-- instalacji idą po kolei). Instalacja należy do jednego konta.
create function private.claim_client(cid uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r private.sync_clients;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  insert into private.sync_clients (client_id, user_id) values (cid, (select auth.uid())) on conflict do nothing;
  select * into r from private.sync_clients where client_id = cid for update;
  if r.user_id <> (select auth.uid()) then raise exception 'client_mismatch' using errcode = 'P0001'; end if;
  return r.last_seq;
end $$;

create function private.set_client_seq(cid uuid, seq bigint) returns void
language sql security definer set search_path = '' as $$
  update private.sync_clients set last_seq = greatest(last_seq, seq), last_seen_at = now()
  where client_id = cid and user_id = (select auth.uid())
$$;

-- Sygnał „pobierz zmiany” bez danych (poke). Wywoływana tylko z sync_push z grupami, w których operacja
-- właśnie się udała pod RLS (schemat private nie jest wystawiony w API).
create function private.poke_groups(gids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  for g in select distinct unnest(gids) loop
    perform realtime.send(jsonb_build_object('v', (select version from public.groups where id = g)),
                          'poke', 'group:' || g, true);
  end loop;
end $$;

-- Wykonanie jednej operacji. Zwraca group_id zmienionego obiektu. Błąd = odrzucenie (obsługa w sync_push).
create function private.apply_op(op jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  kind text := op ->> 'kind';
  ent text := op ->> 'entity';
  e private.sync_entities;
  vals jsonb := coalesce(op -> 'set', '{}'::jsonb);
  cols text[];
  bad text;
  n int;
  gid uuid;
  args jsonb := coalesce(op -> 'args', '{}'::jsonb);
begin
  if kind = 'cmd' then
    case op ->> 'cmd'
      when 'create_group' then
        if exists (select 1 from public.groups where id = (args ->> 'id')::uuid) then
          return (args ->> 'id')::uuid; -- powtórzona komenda: grupa już jest i ją widzę
        end if;
        perform private.create_group_with_owner((args ->> 'id')::uuid, args ->> 'name', 'shared',
                (args ->> 'owner_member_id')::uuid, args ->> 'owner_display_name');
        return (args ->> 'id')::uuid;
      when 'grant_scope', 'revoke_scope' then
        select l.group_id into gid from public.lists l where l.id = (args ->> 'list_id')::uuid;
        if gid is null then raise exception 'not_found' using errcode = 'P0001'; end if;
        insert into public.object_members (scope_entity, scope_id, member_id, group_id)
          values ('lists', (args ->> 'list_id')::uuid, (args ->> 'member_id')::uuid, gid)
          on conflict (scope_entity, scope_id, member_id) do update
          set deleted_at = case when op ->> 'cmd' = 'grant_scope' then null else now() end;
        return gid;
      else
        raise exception 'unknown_cmd' using errcode = 'P0001';
    end case;
  end if;

  select * into e from private.sync_entities where entity = ent;
  if e.entity is null then raise exception 'unknown_entity' using errcode = 'P0001'; end if;
  if op ->> 'id' is null then raise exception 'invalid_value:id' using errcode = 'P0001'; end if;

  if kind = 'create' then
    vals := vals || jsonb_build_object(e.pk, op ->> 'id');
    if op ? 'group_id' then vals := vals || jsonb_build_object('group_id', op ->> 'group_id'); end if;
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.insert_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    -- Identyfikatory nadaje klient (UUIDv7), więc istniejący obiekt to powtórzenie tej samej operacji.
    -- (Bez ON CONFLICT: przy nim Postgres sprawdza politykę SELECT na wierszu, którego jeszcze nie ma.)
    execute format('select group_id from public.%I where %I = $1', ent, e.pk) into gid using (op ->> 'id')::uuid;
    if gid is not null then return gid; end if;
    -- Wartości rzutowane na typy kolumn przez jsonb_populate_record; nazwy kolumn z białej listy.
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                   ent, (select string_agg(format('%I', c), ',') from unnest(cols) c),
                   (select string_agg(format('%I', c), ',') from unnest(cols) c), ent)
      using vals;
  elsif kind = 'patch' then
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.patch_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    if vals = '{}'::jsonb then return null; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) v where t.%I = $2 %s',
                   ent, (select string_agg(format('%I = v.%I', c, c), ',') from unnest(cols) c), ent, e.pk,
                   case when e.soft_delete then 'and t.deleted_at is null' else '' end)
      using vals, (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      -- Widzę wiersz, ale go nie zmieniłem: usunięty (usunięcie wygrywa z edycją) albo brak prawa zapisu.
      execute format('select case when deleted_at is not null then ''deleted'' else ''forbidden'' end from public.%I where %I = $1', ent, e.pk)
        into bad using (op ->> 'id')::uuid;
      raise exception '%', coalesce(bad, 'not_found') using errcode = 'P0001';
    end if;
  elsif kind in ('delete', 'restore') then
    if not e.soft_delete then raise exception 'unsupported' using errcode = 'P0001'; end if;
    execute format('update public.%I set deleted_at = %s where %I = $1 and deleted_at is %s',
                   ent, case when kind = 'delete' then 'now()' else 'null' end, e.pk,
                   case when kind = 'delete' then 'null' else 'not null' end)
      using (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      execute format('select 1 from public.%I where %I = $1', ent, e.pk) into n using (op ->> 'id')::uuid;
      if n is null then raise exception 'not_found' using errcode = 'P0001'; end if;
      -- Już usunięte / już przywrócone: operacja idempotentna.
    end if;
  else
    raise exception 'unknown_kind' using errcode = 'P0001';
  end if;

  execute format('select group_id from public.%I where %I = $1', ent, e.pk) into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

create function public.sync_push(client_id uuid, schema_version int, ops jsonb) returns jsonb
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

  for op in select value from jsonb_array_elements(ops) loop
    seq := (op ->> 'seq')::bigint;
    if seq is null then raise exception 'invalid_batch:seq' using errcode = 'P0001'; end if;
    if seq <= last then
      -- Już przetworzona (np. odpowiedź zginęła w sieci i klient ponawia): nic nie robimy drugi raz.
      results := results || jsonb_build_object('seq', seq, 'status', 'duplicate');
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
    end;
  end loop;
  perform set_config('organizer.op_id', '', true);
  perform private.set_client_seq(client_id, last);
  perform private.poke_groups(touched);
  return jsonb_build_object('last_seq', last, 'results', results);
end $$;

-- Wiersze jednej grupy o wersji > kursor, w JEDNYM zapytaniu (jedna migawka). Wiersz grupy też się zalicza
-- (jego version = bieżąca wersja), więc najwyższa wersja w wyniku jest poprawnym nowym kursorem: zapisy
-- w grupie zatwierdzają się w kolejności wersji (blokada wiersza grupy), więc nic starszego nie „doszło później”.
create function private.group_rows_since(g uuid, since bigint, lim int) returns table (e text, v bigint, r jsonb)
language sql stable security invoker set search_path = '' as $$
  with all_rows as (
    select 'groups'::text e, t.version v, to_jsonb(t) - 'plan' r from public.groups t where t.id = g and t.version > since
    union all select 'group_members', t.version, to_jsonb(t) from public.group_members t where t.group_id = g and t.version > since
    union all select 'lists', t.version, to_jsonb(t) from public.lists t where t.group_id = g and t.version > since
    union all select 'object_members', t.version, to_jsonb(t) from public.object_members t where t.group_id = g and t.version > since
    union all select 'tasks', t.version, to_jsonb(t) from public.tasks t where t.group_id = g and t.version > since
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

create function public.sync_pull(cursors jsonb, lim int default 1000) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  m record;
  since bigint;
  resync boolean;
  rows jsonb;
  top bigint;
  got_group boolean;
  out_groups jsonb := '[]'::jsonb;
  l int := least(greatest(coalesce(lim, 1000), 1), private.pull_limit_max());
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  for m in
    select gm.group_id, gm.member_id, gm.role, gr.version, gr.purged_version
    from public.group_members gm join public.groups gr on gr.id = gm.group_id
    where gm.user_id = me and gm.deleted_at is null
  loop
    since := coalesce((cursors ->> m.group_id::text)::bigint, 0);
    resync := since > 0 and since < m.purged_version;
    if resync then since := 0; end if;
    select coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v), '[]'::jsonb),
           max(x.v), bool_or(x.e = 'groups')
      into rows, top, got_group from private.group_rows_since(m.group_id, since, l) x;
    -- Wiersz grupy ma najwyższą wersję; jeśli go nie ma, a wiersze są, wynik został ucięty limitem.
    out_groups := out_groups || jsonb_build_object(
      'group_id', m.group_id, 'member_id', m.member_id, 'role', m.role,
      'cursor', coalesce(top, since), 'has_more', top is not null and not got_group,
      'resync', resync, 'rows', rows);
  end loop;
  -- Pełna lista grup i ukrytych list, które widzę: klient usuwa lokalnie wszystko spoza niej
  -- (utrata dostępu), a nowe zakresy pobiera przez sync_fetch_scope (wiersze mogą mieć stare wersje).
  return jsonb_build_object(
    'groups', out_groups,
    'scopes', coalesce((select jsonb_agg(l.id order by l.id) from public.lists l
                        where l.visibility <> 'group' and l.deleted_at is null), '[]'::jsonb));
end $$;

-- Pełna zawartość ukrytej listy, do której właśnie dostałem dostęp (bez względu na wersje).
create function public.sync_fetch_scope(list_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v), '[]'::jsonb))
  from (
    select 'lists' e, t.version v, to_jsonb(t) r from public.lists t where t.id = sync_fetch_scope.list_id
    union all select 'object_members', t.version, to_jsonb(t) from public.object_members t where t.scope_id = sync_fetch_scope.list_id
    union all select 'tasks', t.version, to_jsonb(t) from public.tasks t where t.list_id = sync_fetch_scope.list_id
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.scope_id = sync_fetch_scope.list_id
  ) x
$$;

-- Czyszczenie tombstones starszych niż tombstone_days() (zadanie okresowe, tylko service_role).
-- Podbija purged_version: klient z kursorem sprzed czyszczenia dostaje resync i pobiera grupę od nowa.
create function private.purge_tombstones() returns int
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  total int := 0;
  n int;
  k int;
  d int;
  g uuid;
begin
  for g in select id from public.groups order by id loop
    perform 1 from public.groups where id = g for update;
    n := 0;
    delete from public.activity a using public.tasks t
      where a.entity = 'tasks' and a.entity_id = t.id and t.group_id = g and t.deleted_at < horizon;
    -- Od najgłębszych, bo podzadanie wskazuje rodzica kluczem obcym.
    for d in select generate_series(private.max_task_depth(), 0, -1) loop
      delete from public.tasks where group_id = g and deleted_at < horizon and depth = d;
      get diagnostics k = row_count; n := n + k;
    end loop;
    delete from public.object_members where group_id = g and deleted_at < horizon;
    get diagnostics k = row_count; n := n + k;
    delete from public.lists l where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id);
    get diagnostics k = row_count; n := n + k;
    if n > 0 then update public.groups set purged_version = version where id = g; end if;
    total := total + n;
  end loop;
  return total;
end $$;

revoke all on function private.purge_tombstones() from public, authenticated;
grant execute on function private.purge_tombstones() to service_role;
revoke all on function public.sync_push(uuid, int, jsonb), public.sync_pull(jsonb, int), public.sync_fetch_scope(uuid) from public, anon;
grant execute on function public.sync_push(uuid, int, jsonb), public.sync_pull(jsonb, int), public.sync_fetch_scope(uuid) to authenticated;
grant execute on function private.claim_client(uuid), private.set_client_seq(uuid, bigint), private.poke_groups(uuid[]),
  private.apply_op(jsonb), private.group_rows_since(uuid, bigint, int), private.push_batch_max(),
  private.pull_limit_max(), private.schema_version() to authenticated;
grant select on private.sync_entities to authenticated;
