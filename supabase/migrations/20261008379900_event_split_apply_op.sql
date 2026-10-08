-- Audyt 2 (M-3): polecenie split_event („to i następne” w jednej transakcji, private.split_event z
-- 20261008320000_event_split) w private.apply_op. Osobny plik, bo 20261008370000_staple_commands zastępuje apply_op
-- wersją bez tej gałęzi; ta wersja musi być po niej. Zastępuje: private.apply_op(jsonb) z
-- 20261008370000_staple_commands.sql (bez zmian poza gałęzią split_event).

create or replace function private.apply_op(op jsonb) returns uuid
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
        if op ->> 'cmd' = 'grant_scope' then
          insert into public.object_members (scope_entity, scope_id, member_id, group_id)
            values ('lists', (args ->> 'list_id')::uuid, (args ->> 'member_id')::uuid, gid)
            on conflict (scope_entity, scope_id, member_id) do update set deleted_at = null;
        else
          -- Cofnięcie tylko aktualizuje istniejący wpis. (Błąd znaleziony testem różnicowym: wcześniejsze
          -- „wstaw albo zaktualizuj” przy braku wpisu WSTAWIAŁO aktywny wpis, czyli dawało dostęp.)
          -- Uprawnienie (tylko właściciel listy) sprawdza wyzwalacz object_members_guard także przy UPDATE.
          update public.object_members set deleted_at = clock_timestamp()
            where scope_entity = 'lists' and scope_id = (args ->> 'list_id')::uuid
              and member_id = (args ->> 'member_id')::uuid and deleted_at is null;
          if not found and private.my_member_id(gid) is distinct from (select owner_member_id from public.lists where id = (args ->> 'list_id')::uuid) then
            raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
          end if;
        end if;
        return gid;
      when 'move_task' then
        return private.move_task((args ->> 'id')::uuid, nullif(args ->> 'parent_id', '')::uuid,
                                 nullif(args ->> 'list_id', '')::uuid, args ->> 'sort_key');
      when 'staple_add', 'staple_remove' then
        return private.staple_cmd(op ->> 'cmd', args);
      when 'split_event' then
        -- Audyt 2 (M-3): „to i następne” w jednej transakcji (20261008320000_event_split).
        return private.split_event(args);
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
    -- clock_timestamp(), nie now(): now() jest stałe w transakcji, więc dwa usunięcia w jednej paczce
    -- dostałyby ten sam znacznik i przywrócenie listy przywróciłoby zadanie usunięte wcześniej osobno.
    execute format('update public.%I set deleted_at = %s where %I = $1 and deleted_at is %s',
                   ent, case when kind = 'delete' then 'clock_timestamp()' else 'null' end, e.pk,
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

  -- Grupa nie ma kolumny group_id — jej identyfikatorem jest id (błąd wykryty testem groups_edit: zmiana nazwy
  -- grupy przez sync_push zawsze kończyła się odrzuceniem „error:42703”).
  execute format('select %s from public.%I where %I = $1', case when ent = 'groups' then 'id' else 'group_id' end, ent, e.pk)
    into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

revoke all on all functions in schema private from public, anon;
