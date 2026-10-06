-- Etap 1, migracja 2: listy, zadania z podzadaniami, listy dozwolonych osób, kanał aktywności.
-- Decyzje: D3 (widoczność group/restricted/private), D4 (MAX_TASK_DEPTH = 2), D15/D16 (terminy),
-- D34 (rola child: tylko odhaczanie). Architektura: tabela modelu danych i zasada „aktywność dziedziczy
-- widoczność obiektu” (bez tego ukryta lista prezentów wycieka przez kanał aktywności).

-- ───────────────────────── listy ─────────────────────────
create table public.lists (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  kind text not null check (kind in ('tasks', 'shopping')),
  name text not null check (char_length(name) between 1 and 200),
  visibility text not null default 'group' check (visibility in ('group', 'restricted', 'private')),
  -- Twórca listy; ustawiany przez serwer. Tylko on zmienia widoczność i listę dozwolonych osób.
  owner_member_id uuid not null references public.group_members (member_id),
  sort_key text not null default 'a0',
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index lists_group_version_idx on public.lists (group_id, version);

-- Lista dozwolonych osób dla obiektów „restricted” (dziś: listy). Zawsze podzbiór członków grupy.
create table public.object_members (
  scope_entity text not null check (scope_entity in ('lists')),
  scope_id uuid not null,
  member_id uuid not null references public.group_members (member_id),
  group_id uuid not null references public.groups (id),
  version bigint not null default 0,
  deleted_at timestamptz,
  primary key (scope_entity, scope_id, member_id)
);
create index object_members_group_version_idx on public.object_members (group_id, version);
create index object_members_member_idx on public.object_members (member_id) where deleted_at is null;

-- Czy bieżący użytkownik widzi listę. Jedno miejsce reguły widoczności dla list, zadań i aktywności.
create function private.can_see_list(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.lists l
    join public.group_members me
      on me.group_id = l.group_id and me.user_id = (select auth.uid()) and me.deleted_at is null
    where l.id = lid
      and (l.visibility = 'group'
           or l.owner_member_id = me.member_id
           or (l.visibility = 'restricted' and exists (
                 select 1 from public.object_members om
                 where om.scope_entity = 'lists' and om.scope_id = l.id
                   and om.member_id = me.member_id and om.deleted_at is null))))
$$;

-- Czy członek (np. osoba przypisana) widzi listę — ta sama reguła, ale dla wskazanego członka.
create function private.member_can_see_list(mid uuid, lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.lists l
    join public.group_members m on m.member_id = mid and m.group_id = l.group_id and m.deleted_at is null
    where l.id = lid
      and (l.visibility = 'group' or l.owner_member_id = mid
           or (l.visibility = 'restricted' and exists (
                 select 1 from public.object_members om
                 where om.scope_entity = 'lists' and om.scope_id = l.id
                   and om.member_id = mid and om.deleted_at is null))))
$$;

create function private.lists_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_member_id(new.group_id);
begin
  if (select auth.uid()) is null then return new; end if;
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    new.owner_member_id := me;
  else
    if new.kind is distinct from old.kind then raise exception 'immutable_column:kind' using errcode = 'P0001'; end if;
    if new.owner_member_id is distinct from old.owner_member_id then
      raise exception 'immutable_column:owner_member_id' using errcode = 'P0001';
    end if;
    if new.visibility is distinct from old.visibility and old.owner_member_id <> me then
      raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger lists_a_guard before insert or update on public.lists
  for each row execute function private.lists_guard();
create trigger lists_b_stamp before insert or update on public.lists
  for each row execute function private.stamp_version();

create function private.object_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.lists;
begin
  select * into l from public.lists where id = new.scope_id;
  if l.id is null or l.group_id <> new.group_id then raise exception 'invalid_scope' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.group_members m where m.member_id = new.member_id
                 and m.group_id = new.group_id and m.deleted_at is null) then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null and l.owner_member_id is distinct from private.my_member_id(l.group_id) then
    raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.scope_id, new.member_id, new.scope_entity) is distinct from (old.scope_id, old.member_id, old.scope_entity) then
    raise exception 'immutable_column:scope' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger object_members_a_guard before insert or update on public.object_members
  for each row execute function private.object_members_guard();
create trigger object_members_b_stamp before insert or update on public.object_members
  for each row execute function private.stamp_version();

create function private.object_members_access_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select user_id into uid from public.group_members where member_id = new.member_id;
  if uid is null then return null; end if;
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    insert into private.access_events (user_id, group_id, kind, scope_entity, scope_id)
      values (uid, new.group_id, 'scope_granted', new.scope_entity, new.scope_id);
  elsif old.deleted_at is null and new.deleted_at is not null then
    insert into private.access_events (user_id, group_id, kind, scope_entity, scope_id)
      values (uid, new.group_id, 'scope_revoked', new.scope_entity, new.scope_id);
  else
    return null;
  end if;
  perform realtime.send(jsonb_build_object('access', true), 'poke', 'user:' || uid, true);
  return null;
end $$;

create trigger object_members_c_access after insert or update on public.object_members
  for each row execute function private.object_members_access_event();

-- ───────────────────────── zadania ─────────────────────────
create table public.tasks (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  list_id uuid not null references public.lists (id),
  parent_id uuid references public.tasks (id),
  -- 0 = zadanie, 1 = podzadanie, 2 = pod-podzadanie; liczone przez serwer (D4).
  depth int not null default 0,
  title text not null check (char_length(title) between 1 and 500),
  note text check (char_length(note) <= 10000),
  sort_key text not null default 'a0',
  assignee_member_id uuid references public.group_members (member_id),
  -- none = bez terminu (przypięte na górze, D16), own = własny termin; inherit (z wydarzenia/rodzica) od Etapu 2/4.
  deadline_mode text not null default 'none' check (deadline_mode in ('none', 'own', 'inherit')),
  due_date date,
  -- Czas lokalny Europe/Warsaw (config.TIME_ZONE); NULL = termin całodniowy (D45).
  due_time time,
  -- „Przypnij za X dni”: zadanie ukryte do tego dnia (osobne od terminu).
  start_date date,
  completed_at timestamptz,
  completed_by uuid references public.group_members (member_id),
  created_by uuid references public.group_members (member_id),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tasks_time_needs_date check (due_time is null or due_date is not null),
  constraint tasks_own_needs_date check (deadline_mode <> 'own' or due_date is not null)
);
create index tasks_group_version_idx on public.tasks (group_id, version);
create index tasks_list_idx on public.tasks (list_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_assignee_due_idx on public.tasks (assignee_member_id, due_date);

create function private.tasks_guard() returns trigger
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
    -- Przeniesienie zadania (zmiana rodzica/listy) to osobna komenda move_task (Etap 2), z blokadą grupy.
    if new.list_id is distinct from old.list_id then raise exception 'immutable_column:list_id' using errcode = 'P0001'; end if;
    if new.parent_id is distinct from old.parent_id then raise exception 'immutable_column:parent_id' using errcode = 'P0001'; end if;
    new.depth := old.depth;
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

  if new.assignee_member_id is distinct from (case when tg_op = 'UPDATE' then old.assignee_member_id end)
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

create trigger tasks_a_guard before insert or update on public.tasks
  for each row execute function private.tasks_guard();
create trigger tasks_b_stamp before insert or update on public.tasks
  for each row execute function private.stamp_version();

-- Usunięcie zadania usuwa jego podzadania; przywrócenie przywraca te, które usunięto razem z nim.
-- Usunięcie listy usuwa jej zadania główne (a te — swoje podzadania).
create function private.tasks_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.tasks set deleted_at = new.deleted_at where parent_id = new.id and deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.tasks set deleted_at = null where parent_id = new.id and deleted_at = old.deleted_at;
  end if;
  return null;
end $$;

create trigger tasks_c_cascade after update of deleted_at on public.tasks
  for each row execute function private.tasks_cascade();

create function private.lists_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.tasks set deleted_at = new.deleted_at
      where list_id = new.id and parent_id is null and deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.tasks set deleted_at = null
      where list_id = new.id and parent_id is null and deleted_at = old.deleted_at;
  end if;
  return null;
end $$;

create trigger lists_c_cascade after update of deleted_at on public.lists
  for each row execute function private.lists_cascade();

-- ───────────────────────── aktywność ─────────────────────────
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  -- Zakres widoczności: wpis o zadaniu ukrytej listy widzą tylko osoby, które widzą tę listę.
  scope_entity text check (scope_entity in ('lists')),
  scope_id uuid,
  actor_member_id uuid,
  actor_name text,
  verb text not null check (verb in ('create', 'update', 'delete', 'restore')),
  entity text not null,
  entity_id uuid not null,
  -- {kolumna: [stara, nowa]} — nic nie ginie, każdą zmianę da się odczytać i cofnąć.
  changes jsonb not null default '{}'::jsonb,
  op_id uuid,
  version bigint not null,
  created_at timestamptz not null default now()
);
create index activity_group_version_idx on public.activity (group_id, version);

create function private.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  diff jsonb := '{}'::jsonb;
  k text;
  v_verb text;
  v_scope uuid;
  v_actor uuid := private.my_member_id(new.group_id);
  skip text[] := array['version', 'created_at'];
begin
  for k in select jsonb_object_keys(n) loop
    -- Brak klucza (wstawienie) i JSON null to to samo „puste”, więc puste kolumny nowego wiersza nie są zmianą.
    if k <> all (skip) and coalesce(n -> k, 'null') is distinct from coalesce(o -> k, 'null') then
      diff := diff || jsonb_build_object(k, jsonb_build_array(coalesce(o -> k, 'null'), n -> k));
    end if;
  end loop;
  if diff = '{}'::jsonb then return null; end if;
  v_verb := case
    when tg_op = 'INSERT' then 'create'
    when (o ->> 'deleted_at') is null and (n ->> 'deleted_at') is not null then 'delete'
    when (o ->> 'deleted_at') is not null and (n ->> 'deleted_at') is null then 'restore'
    else 'update' end;
  v_scope := case tg_table_name
    when 'lists' then (n ->> 'id')::uuid
    when 'tasks' then (n ->> 'list_id')::uuid
    when 'object_members' then (n ->> 'scope_id')::uuid
    else null end;
  insert into public.activity (group_id, scope_entity, scope_id, actor_member_id, actor_name, verb, entity,
                               entity_id, changes, op_id, version)
  values (new.group_id, case when v_scope is null then null else 'lists' end, v_scope, v_actor,
          (select display_name from public.group_members where member_id = v_actor),
          v_verb, tg_table_name,
          coalesce((n ->> 'id')::uuid, (n ->> 'member_id')::uuid, (n ->> 'scope_id')::uuid),
          diff, nullif(current_setting('organizer.op_id', true), '')::uuid, (n ->> 'version')::bigint);
  return null;
end $$;

create trigger lists_d_activity after insert or update on public.lists
  for each row execute function private.log_activity();
create trigger tasks_d_activity after insert or update on public.tasks
  for each row execute function private.log_activity();
create trigger object_members_d_activity after insert or update on public.object_members
  for each row execute function private.log_activity();
create trigger group_members_z_activity after insert or update on public.group_members
  for each row execute function private.log_activity();

-- ───────────────────────── RLS i uprawnienia ─────────────────────────
alter table public.lists enable row level security;
alter table public.object_members enable row level security;
alter table public.tasks enable row level security;
alter table public.activity enable row level security;

create policy lists_select on public.lists for select to authenticated using (private.can_see_list(id));
create policy lists_insert on public.lists for insert to authenticated
  with check (group_id in (select private.my_group_ids()));
create policy lists_update on public.lists for update to authenticated
  using (private.can_see_list(id)) with check (group_id in (select private.my_group_ids()));

create policy object_members_select on public.object_members for select to authenticated
  using (private.can_see_list(scope_id));
create policy object_members_insert on public.object_members for insert to authenticated
  with check (group_id in (select private.my_group_ids()));
create policy object_members_update on public.object_members for update to authenticated
  using (private.can_see_list(scope_id)) with check (group_id in (select private.my_group_ids()));

create policy tasks_select on public.tasks for select to authenticated using (private.can_see_list(list_id));
create policy tasks_insert on public.tasks for insert to authenticated with check (private.can_see_list(list_id));
create policy tasks_update on public.tasks for update to authenticated
  using (private.can_see_list(list_id)) with check (private.can_see_list(list_id));

create policy activity_select on public.activity for select to authenticated
  using (group_id in (select private.my_group_ids())
         and (scope_id is null or private.can_see_list(scope_id)));

grant select, insert (id, group_id, kind, name, visibility, sort_key),
  update (name, visibility, sort_key, deleted_at) on public.lists to authenticated;
grant select, insert (scope_entity, scope_id, member_id, group_id), update (deleted_at)
  on public.object_members to authenticated;
grant select, insert (id, group_id, list_id, parent_id, title, note, sort_key, assignee_member_id,
                      deadline_mode, due_date, due_time, start_date, completed_at),
  update (title, note, sort_key, assignee_member_id, deadline_mode, due_date, due_time, start_date,
          completed_at, deleted_at) on public.tasks to authenticated;
grant select on public.activity to authenticated;
grant execute on function private.can_see_list(uuid) to authenticated;
