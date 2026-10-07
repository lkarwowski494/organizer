-- Etap 2, migracja 1: przenoszenie zadań (zmiana rodzica i/lub listy) jako komenda serwera.
-- Architektura: „Przeniesienie zadania (cmd move_task) działa pod blokadą grupy. Pod nią rekurencyjne CTE
-- sprawdza, czy nowy rodzic nie jest potomkiem i czy depth(rodzic) + 1 + wysokość poddrzewa ≤ MAX_TASK_DEPTH.
-- Blokada jest konieczna, bo bez niej dwa równoczesne przeniesienia („A pod B” i „B pod A”) przejdą
-- sprawdzenie i utworzą cykl” (Kleppmann i in., https://martin.kleppmann.com/papers/move-op.pdf).
-- Zakres: w obrębie jednej grupy (między grupami — poza MVP, odrzucane).

create function private.move_task(tid uuid, new_parent uuid, new_list uuid, new_sort text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  p public.tasks;
  target_list uuid;
  height int;
  new_depth int;
  r record;
begin
  select * into t from public.tasks where id = tid;
  if t.id is null or not private.can_see_list(t.list_id) then raise exception 'not_found' using errcode = 'P0001'; end if;
  -- Blokada wiersza grupy (ta sama co przy podbijaniu wersji, D32): przeniesienia w grupie idą po kolei.
  perform 1 from public.groups where id = t.group_id for update;
  select * into t from public.tasks where id = tid; -- stan po uzyskaniu blokady
  if coalesce(private.my_role(t.group_id), '') not in ('owner', 'admin', 'member') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if t.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;

  if new_parent is not null then
    select * into p from public.tasks where id = new_parent;
    if p.id is null or p.group_id <> t.group_id or not private.can_see_list(p.list_id) then
      raise exception 'invalid_parent' using errcode = 'P0001';
    end if;
    if p.deleted_at is not null then raise exception 'deleted:parent' using errcode = 'P0001'; end if;
    if new_list is not null and new_list <> p.list_id then raise exception 'invalid_parent' using errcode = 'P0001'; end if;
    target_list := p.list_id;
    -- Cykl: nowy rodzic nie może być tym zadaniem ani jego potomkiem.
    if exists (
      with recursive anc as (
        select id, parent_id from public.tasks where id = new_parent
        union all select x.id, x.parent_id from public.tasks x join anc on x.id = anc.parent_id
      ) select 1 from anc where id = tid
    ) then raise exception 'cycle' using errcode = 'P0001'; end if;
    new_depth := p.depth + 1;
  else
    target_list := coalesce(new_list, t.list_id);
    new_depth := 0;
  end if;

  -- Wysokość poddrzewa (0 = bez dzieci), liczona po aktywnych potomkach.
  with recursive sub as (
    select id, 0 as h from public.tasks where id = tid
    union all select x.id, sub.h + 1 from public.tasks x join sub on x.parent_id = sub.id where x.deleted_at is null
  ) select max(h) into height from sub;
  if new_depth + height > private.max_task_depth() then raise exception 'depth_exceeded' using errcode = 'P0001'; end if;

  -- Korzeń: rodzic, lista, głębokość (i opcjonalnie kolejność); potem potomkowie: lista i głębokość.
  perform set_config('organizer.moving_task', tid::text, true);
  update public.tasks set parent_id = new_parent, list_id = target_list, depth = new_depth,
                          sort_key = coalesce(new_sort, sort_key)
    where id = tid;
  for r in
    with recursive sub as (
      select x.id, new_depth + 1 as d from public.tasks x where x.parent_id = tid
      union all select x.id, sub.d + 1 from public.tasks x join sub on x.parent_id = sub.id
    ) select id, d from sub order by d
  loop
    perform set_config('organizer.moving_task', r.id::text, true);
    update public.tasks set list_id = target_list, depth = r.d where id = r.id;
  end loop;
  perform set_config('organizer.moving_task', '', true);
  return t.group_id;
end $$;

create or replace function private.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_member_id(new.group_id);
  my_role text := private.my_role(new.group_id);
  l public.lists;
  p public.tasks;
begin
  if (select auth.uid()) is null then return new; end if;
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if tg_op = 'UPDATE' then
    -- Przeniesienie (rodzic, lista, głębokość) tylko przez private.move_task: ustawia flagę z id właśnie
    -- przenoszonego wiersza, po sprawdzeniu cykli i głębokości pod blokadą grupy.
    if current_setting('organizer.moving_task', true) is distinct from new.id::text then
      if new.list_id is distinct from old.list_id then raise exception 'immutable_column:list_id' using errcode = 'P0001'; end if;
      if new.parent_id is distinct from old.parent_id then raise exception 'immutable_column:parent_id' using errcode = 'P0001'; end if;
      new.depth := old.depth;
    end if;
    -- D34: rola child może tylko odhaczać.
    if my_role = 'child' and (to_jsonb(new) - array['completed_at', 'completed_by', 'version'])
                           is distinct from (to_jsonb(old) - array['completed_at', 'completed_by', 'version']) then
      raise exception 'forbidden:child' using errcode = 'P0001';
    end if;
  else
    if my_role = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
    new.created_by := me;
  end if;

  select * into l from public.lists where id = new.list_id;
  if l.id is null or l.group_id <> new.group_id then raise exception 'invalid_list' using errcode = 'P0001'; end if;
  if l.kind <> 'tasks' then raise exception 'invalid_list:kind' using errcode = 'P0001'; end if;
  if l.deleted_at is not null and new.deleted_at is null then raise exception 'deleted:list' using errcode = 'P0001'; end if;
  if not private.can_see_list(l.id) then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    if new.parent_id is null then
      new.depth := 0;
    else
      select * into p from public.tasks where id = new.parent_id;
      if p.id is null or p.list_id <> new.list_id then raise exception 'invalid_parent' using errcode = 'P0001'; end if;
      if p.deleted_at is not null then raise exception 'deleted:parent' using errcode = 'P0001'; end if;
      new.depth := p.depth + 1;
      if new.depth > private.max_task_depth() then raise exception 'depth_exceeded' using errcode = 'P0001'; end if;
    end if;
  end if;

  if (new.assignee_member_id is distinct from (case when tg_op = 'UPDATE' then old.assignee_member_id end)
       or new.list_id is distinct from (case when tg_op = 'UPDATE' then old.list_id end))
     and new.assignee_member_id is not null
     and not private.member_can_see_list(new.assignee_member_id, new.list_id) then
    -- Przypisanie osoby, która nie widzi listy, ujawniłoby jej ukryte zadanie (np. w powiadomieniu).
    raise exception 'invalid_assignee' using errcode = 'P0001';
  end if;

  if new.completed_at is distinct from (case when tg_op = 'UPDATE' then old.completed_at end) then
    new.completed_by := case when new.completed_at is null then null else me end;
  elsif tg_op = 'UPDATE' then
    new.completed_by := old.completed_by;
  else
    new.completed_by := null;
  end if;
  return new;
end $$;

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

  execute format('select group_id from public.%I where %I = $1', ent, e.pk) into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.move_task(uuid, uuid, uuid, text), private.apply_op(jsonb) to authenticated;
