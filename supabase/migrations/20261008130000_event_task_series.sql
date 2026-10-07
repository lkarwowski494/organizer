-- Stałe zadania serii (D65, decyzja właściciela z 7.10.2026, ADR 0010): „spakować strój” przed każdymi tańcami.
-- Definicja (tytuł, lista, seria) w event_task_series; telefon dokłada prawdziwe zadania na najbliższe tygodnie
-- (config.SERIES_TASK_WEEKS) z identyfikatorem wyliczonym z definicji i daty wystąpienia (UUIDv5, RFC 9562), więc
-- dwa telefony tworzą to samo zadanie — serwer traktuje powtórne utworzenie jako powtórzenie (apply_op).
-- Poprawka: czyszczenie kosza nie usuwa serii, na którą wskazuje zadanie (klucz obcy tasks.event_id z migracji
-- task_occurrence — wcześniej purge przerwałby się błędem).

create table public.event_task_series (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  event_id uuid not null references public.events (id),
  list_id uuid not null references public.lists (id),
  title text not null check (char_length(title) between 1 and 500),
  created_by uuid references public.group_members (member_id),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index event_task_series_group_version_idx on public.event_task_series (group_id, version);

alter table public.tasks add column series_id uuid references public.event_task_series (id);
grant insert (series_id) on public.tasks to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{series_id}' where entity = 'tasks';

create function private.event_task_series_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.lists;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if new.group_id is distinct from old.group_id then raise exception 'immutable_column:group_id' using errcode = 'P0001'; end if;
    if new.list_id is distinct from old.list_id then raise exception 'immutable_column:list_id' using errcode = 'P0001'; end if;
    new.created_by := old.created_by;
  else
    new.created_by := me;
  end if;
  -- Seria może przejść do nowej serii („to i następne” tworzy nową) — byle z tej samej grupy.
  if not exists (select 1 from public.events e where e.id = new.event_id and e.group_id = new.group_id) then
    raise exception 'invalid_event' using errcode = 'P0001';
  end if;
  select * into l from public.lists where id = new.list_id;
  if l.id is null or l.group_id <> new.group_id then raise exception 'invalid_list' using errcode = 'P0001'; end if;
  if l.kind <> 'tasks' then raise exception 'invalid_list:kind' using errcode = 'P0001'; end if;
  return new;
end $$;

create trigger event_task_series_a_guard before insert or update on public.event_task_series
  for each row execute function private.event_task_series_guard();
create trigger event_task_series_b_stamp before insert or update on public.event_task_series
  for each row execute function private.stamp_version();
create trigger event_task_series_d_activity after insert or update on public.event_task_series
  for each row execute function private.log_activity();
alter table public.event_task_series enable row level security;
-- Widoczność jak zadania tej listy (lista ukryta: definicję widzą tylko osoby, które widzą listę).
create policy event_task_series_select on public.event_task_series for select to authenticated using (private.can_see_list(list_id));
create policy event_task_series_insert on public.event_task_series for insert to authenticated with check (private.can_see_list(list_id));
create policy event_task_series_update on public.event_task_series for update to authenticated
  using (private.can_see_list(list_id)) with check (private.can_see_list(list_id));
revoke all on public.event_task_series from anon, authenticated;
grant select, insert (id, group_id, event_id, list_id, title), update (event_id, title, deleted_at) on public.event_task_series to authenticated;

insert into private.sync_entities values
  ('event_task_series', 'id', '{id,group_id,event_id,list_id,title}', '{event_id,title}', true);

-- Kopia zadania wskazuje definicję z tej samej grupy.
create or replace function private.tasks_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  if new.series_id is not null and new.series_id is distinct from (case when tg_op = 'UPDATE' then old.series_id end)
     and not exists (select 1 from public.event_task_series s where s.id = new.series_id and s.group_id = new.group_id) then
    raise exception 'invalid_series' using errcode = 'P0001';
  end if;
  if new.event_id is null or new.event_id is not distinct from (case when tg_op = 'UPDATE' then old.event_id end) then return new; end if;
  select * into e from public.events where id = new.event_id;
  if e.id is null or e.group_id <> new.group_id then raise exception 'invalid_event' using errcode = 'P0001'; end if;
  if e.deleted_at is not null then raise exception 'deleted:event' using errcode = 'P0001'; end if;
  return new;
end $$;

-- Wpis aktywności o definicji ma zakres jej listy (jak zadania), żeby lista ukryta nie przeciekała przez historię.
create or replace function private.log_activity() returns trigger
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
    when 'event_task_series' then (n ->> 'list_id')::uuid
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

-- Pobranie zawartości listy po uzyskaniu dostępu obejmuje też definicje stałych zadań.
create or replace function public.sync_fetch_scope(list_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v), '[]'::jsonb))
  from (
    select 'lists' e, t.version v, to_jsonb(t) r from public.lists t where t.id = sync_fetch_scope.list_id
    union all select 'object_members', t.version, to_jsonb(t) from public.object_members t where t.scope_id = sync_fetch_scope.list_id
    union all select 'tasks', t.version, to_jsonb(t) from public.tasks t where t.list_id = sync_fetch_scope.list_id
    union all select 'event_task_series', t.version, to_jsonb(t) from public.event_task_series t where t.list_id = sync_fetch_scope.list_id
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.scope_id = sync_fetch_scope.list_id
  ) x
$$;

create or replace function private.group_rows_since(g uuid, since bigint, lim int) returns table (e text, v bigint, r jsonb)
language sql stable security invoker set search_path = '' as $$
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
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

create or replace function private.purge_tombstones() returns int
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
    -- Definicje stałych zadań: usunięte i bez kopii (kopia wskazuje definicję kluczem obcym).
    delete from public.event_task_series s where s.group_id = g and s.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.series_id = s.id);
    get diagnostics k = row_count; n := n + k;
    delete from public.lists l where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id)
      and not exists (select 1 from public.event_task_series s where s.list_id = l.id);
    get diagnostics k = row_count; n := n + k;
    delete from public.event_overrides o where o.group_id = g
      and (o.deleted_at < horizon or exists (select 1 from public.events e where e.id = o.event_id and e.deleted_at < horizon));
    get diagnostics k = row_count; n := n + k;
    delete from public.event_participants p where p.group_id = g
      and (p.deleted_at < horizon or exists (select 1 from public.events e where e.id = p.event_id and e.deleted_at < horizon));
    get diagnostics k = row_count; n := n + k;
    delete from public.activity a using public.events e
      where a.entity = 'events' and a.entity_id = e.id and e.group_id = g and e.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.event_id = e.id)
      and not exists (select 1 from public.event_task_series s where s.event_id = e.id);
    -- Seria zostaje, dopóki wskazuje na nią zadanie albo definicja (klucze obce); zniknie, gdy one znikną.
    delete from public.events e where e.group_id = g and e.deleted_at < horizon
      and not exists (select 1 from public.event_overrides o where o.event_id = e.id)
      and not exists (select 1 from public.event_participants p where p.event_id = e.id)
      and not exists (select 1 from public.tasks t where t.event_id = e.id)
      and not exists (select 1 from public.event_task_series s where s.event_id = e.id);
    get diagnostics k = row_count; n := n + k;
    if n > 0 then update public.groups set purged_version = version where id = g; end if;
    total := total + n;
  end loop;
  return total;
end $$;

create or replace function private.hard_delete_group(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d int;
begin
  perform 1 from public.groups where id = g for update;
  delete from public.activity where group_id = g;
  -- Od najgłębszych, bo podzadanie wskazuje rodzica kluczem obcym.
  for d in select generate_series(private.max_task_depth(), 0, -1) loop
    delete from public.tasks where group_id = g and depth = d;
  end loop;
  delete from public.object_members where group_id = g;
  delete from public.event_task_series where group_id = g;
  delete from public.event_overrides where group_id = g;
  delete from public.event_participants where group_id = g;
  delete from public.events where group_id = g;
  delete from public.invites where group_id = g;
  delete from public.lists where group_id = g;
  delete from public.group_members where group_id = g;
  delete from public.groups where id = g;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
