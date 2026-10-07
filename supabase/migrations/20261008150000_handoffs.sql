-- Przekazanie odpowiedzialności z potwierdzeniem (D70, decyzja właściciela z 7.10.2026, ADR 0013): osoba, na której
-- jest zadanie (assignee) albo wydarzenie (osoba odpowiedzialna, D66 — cała seria albo jeden termin), proponuje
-- przekazanie dorosłemu z grupy. Do przyjęcia odpowiedzialność zostaje u niej; przyjęcie przenosi ją w tej samej
-- transakcji, odrzucenie wraca z informacją. Wiersz widzą tylko te dwie osoby.

create table public.handoffs (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  entity text not null check (entity in ('tasks', 'events')),
  entity_id uuid not null,
  -- Tylko dla wydarzeń: jeden termin (data wystąpienia według reguły); null = cała seria.
  occurrence_date date,
  from_member uuid not null references public.group_members (member_id),
  to_member uuid not null references public.group_members (member_id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  -- Nadawca zamknął informację o odrzuceniu (znika z jego „Dotyczy mnie”).
  closed boolean not null default false,
  decided_at timestamptz,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  -- Nieużywane (przekazań się nie usuwa); jest, bo apply_op czyta deleted_at, gdy zmiana nie przeszła.
  deleted_at timestamptz,
  constraint handoffs_occurrence_only_events check (occurrence_date is null or entity = 'events'),
  constraint handoffs_not_self check (from_member <> to_member)
);
create index handoffs_group_version_idx on public.handoffs (group_id, version);
-- Jedno oczekujące przekazanie na zadanie / serię / termin.
create unique index handoffs_one_pending on public.handoffs (entity, entity_id, coalesce(occurrence_date, '0001-01-01'::date))
  where status = 'pending';

create function private.handoffs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  t public.tasks;
  e public.events;
  current_responsible uuid;
  o_id uuid;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    new.from_member := me;
    new.status := 'pending';
    new.closed := false;
    new.decided_at := null;
    if new.to_member = me then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.group_members m where m.member_id = new.to_member and m.group_id = new.group_id
                   and m.deleted_at is null and m.role <> 'child' and m.user_id is not null) then
      raise exception 'invalid_member' using errcode = 'P0001';
    end if;
    if new.entity = 'tasks' then
      select * into t from public.tasks where id = new.entity_id;
      if t.id is null or t.group_id <> new.group_id or t.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      if t.assignee_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, t.list_id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    else
      select * into e from public.events where id = new.entity_id;
      if e.id is null or e.group_id <> new.group_id or e.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      current_responsible := e.responsible_member_id;
      if new.occurrence_date is not null then
        select coalesce(o.responsible_member_id, e.responsible_member_id) into current_responsible
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = new.occurrence_date and o.deleted_at is null;
        current_responsible := coalesce(current_responsible, e.responsible_member_id);
      end if;
      if current_responsible is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
    end if;
    return new;
  end if;

  -- Zmiany: tylko status (i zamknięcie informacji przez nadawcę), w dozwolonych kierunkach.
  if (to_jsonb(new) - array['status', 'closed', 'decided_at', 'version']) is distinct from (to_jsonb(old) - array['status', 'closed', 'decided_at', 'version']) then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  if new.closed is distinct from old.closed and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status is not distinct from old.status then return new; end if;
  if old.status <> 'pending' then raise exception 'invalid_value:status' using errcode = 'P0001'; end if;
  if new.status in ('accepted', 'declined') and me <> old.to_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status = 'cancelled' and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  new.decided_at := now();

  if new.status = 'accepted' then
    -- Przyjęcie przenosi odpowiedzialność od razu (w tej transakcji); strażnicy zadań i wydarzeń działają jak zwykle.
    if old.entity = 'tasks' then
      update public.tasks set assignee_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    elsif old.occurrence_date is null then
      update public.events set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    else
      select id into o_id from public.event_overrides where event_id = old.entity_id and occurrence_date = old.occurrence_date;
      if o_id is null then
        insert into public.event_overrides (id, event_id, group_id, occurrence_date, responsible_member_id)
          values (gen_random_uuid(), old.entity_id, old.group_id, old.occurrence_date, old.to_member);
      else
        update public.event_overrides set responsible_member_id = old.to_member, deleted_at = null where id = o_id;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger handoffs_a_guard before insert or update on public.handoffs
  for each row execute function private.handoffs_guard();
create trigger handoffs_b_stamp before insert or update on public.handoffs
  for each row execute function private.stamp_version();

alter table public.handoffs enable row level security;
-- Widzą tylko nadawca i odbiorca.
create policy handoffs_select on public.handoffs for select to authenticated
  using (private.my_member_id(group_id) in (from_member, to_member));
create policy handoffs_insert on public.handoffs for insert to authenticated
  with check (group_id in (select private.my_group_ids()));
create policy handoffs_update on public.handoffs for update to authenticated
  using (private.my_member_id(group_id) in (from_member, to_member))
  with check (private.my_member_id(group_id) in (from_member, to_member));
revoke all on public.handoffs from anon, authenticated;
grant select, insert (id, group_id, entity, entity_id, occurrence_date, to_member), update (status, closed) on public.handoffs to authenticated;

insert into private.sync_entities values
  ('handoffs', 'id', '{id,group_id,entity,entity_id,occurrence_date,to_member}', '{status,closed}', false);

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
    union all select 'handoffs', t.version, to_jsonb(t) from public.handoffs t where t.group_id = g and t.version > since
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

-- Twarde usunięcie grupy obejmuje przekazania (przed członkami, na których wskazują).
create or replace function private.hard_delete_group(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d int;
begin
  perform 1 from public.groups where id = g for update;
  delete from public.activity where group_id = g;
  delete from public.handoffs where group_id = g;
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
