-- Etap 4, migracja 1: wydarzenia, także cykliczne (decyzje właściciela z 7.10.2026: D57 edycja „to / to i następne /
-- wszystkie”, D58 uczestnicy: cała grupa albo wybrane osoby).
-- Model: seria = wiersz events z regułą RRULE (RFC 5545, podzbiór jak src/domain/rrule.ts) i datą pierwszego
-- wystąpienia; zmiana jednego wystąpienia = wiersz event_overrides (data pierwotna + nowe wartości albo odwołanie);
-- „to i następne” telefon zapisuje jako zakończenie serii (UNTIL) i nową serię od tego dnia.
-- Godziny to czas lokalny Europe/Warsaw (R2) — zmiana czasu nie przesuwa zajęć.
-- Kto: każdy członek grupy widzi; tworzy i zmienia każdy poza dzieckiem (D34: dziecko tylko odhacza zadania).

-- Ten sam wzorzec co parser na telefonie (src/domain/rrule.ts) — dokładniejszą kontrolę robi telefon.
create function private.rrule_ok(r text) returns boolean language sql immutable as $$
  select r is null or (char_length(r) <= 200 and r ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;(INTERVAL|BYDAY|BYMONTHDAY|COUNT|UNTIL|WKST)=[A-Z0-9,+-]+)*$')
$$;

create table public.events (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  title text not null check (char_length(title) between 1 and 200),
  note text check (char_length(note) <= 10000),
  -- Pierwsze wystąpienie (RFC 5545: DTSTART zawsze jest pierwszym wystąpieniem).
  start_date date not null,
  -- NULL = wydarzenie całodniowe.
  start_time time,
  end_time time,
  rrule text check (private.rrule_ok(rrule)),
  audience text not null default 'group' check (audience in ('group', 'members')),
  created_by uuid references public.group_members (member_id),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_end_after_start check (end_time is null or (start_time is not null and end_time > start_time))
);
create index events_group_version_idx on public.events (group_id, version);

create table public.event_participants (
  id uuid primary key,
  event_id uuid not null references public.events (id),
  member_id uuid not null references public.group_members (member_id),
  group_id uuid not null references public.groups (id),
  version bigint not null default 0,
  deleted_at timestamptz,
  unique (event_id, member_id)
);
create index event_participants_group_version_idx on public.event_participants (group_id, version);

create table public.event_overrides (
  id uuid primary key,
  event_id uuid not null references public.events (id),
  group_id uuid not null references public.groups (id),
  -- Data wystąpienia według reguły (klucz wystąpienia, także gdy przeniesione na inny dzień).
  occurrence_date date not null,
  cancelled boolean not null default false,
  start_date date,
  start_time time,
  end_time time,
  title text check (char_length(title) between 1 and 200),
  version bigint not null default 0,
  deleted_at timestamptz,
  unique (event_id, occurrence_date),
  constraint event_overrides_end_after_start check (end_time is null or (start_time is not null and end_time > start_time))
);
create index event_overrides_group_version_idx on public.event_overrides (group_id, version);

create function private.events_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid; my_role text;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  my_role := coalesce(private.my_role(new.group_id), '');
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if my_role = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then raise exception 'immutable_column:group_id' using errcode = 'P0001'; end if;
  if tg_table_name = 'events' then
    if tg_op = 'INSERT' then new.created_by := me; else new.created_by := old.created_by; end if;
  else
    if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then raise exception 'immutable_column:event_id' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.events e where e.id = new.event_id and e.group_id = new.group_id) then
      raise exception 'invalid_event' using errcode = 'P0001';
    end if;
    if tg_table_name = 'event_participants' then
      if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
      if not exists (select 1 from public.group_members m where m.member_id = new.member_id and m.group_id = new.group_id and m.deleted_at is null) then
        raise exception 'invalid_member' using errcode = 'P0001';
      end if;
    elsif tg_op = 'UPDATE' and new.occurrence_date is distinct from old.occurrence_date then
      raise exception 'immutable_column:occurrence_date' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['events', 'event_participants', 'event_overrides'] loop
    execute format('create trigger %1$s_a_guard before insert or update on public.%1$s for each row execute function private.events_guard()', t);
    execute format('create trigger %1$s_b_stamp before insert or update on public.%1$s for each row execute function private.stamp_version()', t);
    execute format('create trigger %1$s_d_activity after insert or update on public.%1$s for each row execute function private.log_activity()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (group_id in (select private.my_group_ids()))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (group_id in (select private.my_group_ids()))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (group_id in (select private.my_group_ids())) with check (group_id in (select private.my_group_ids()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select, insert (id, group_id, title, note, start_date, start_time, end_time, rrule, audience),
  update (title, note, start_date, start_time, end_time, rrule, audience, deleted_at) on public.events to authenticated;
grant select, insert (id, event_id, member_id, group_id), update (deleted_at) on public.event_participants to authenticated;
grant select, insert (id, event_id, group_id, occurrence_date, cancelled, start_date, start_time, end_time, title),
  update (cancelled, start_date, start_time, end_time, title, deleted_at) on public.event_overrides to authenticated;

insert into private.sync_entities values
  ('events', 'id', '{id,group_id,title,note,start_date,start_time,end_time,rrule,audience}', '{title,note,start_date,start_time,end_time,rrule,audience}', true),
  ('event_participants', 'id', '{id,event_id,member_id,group_id}', '{}', true),
  ('event_overrides', 'id', '{id,event_id,group_id,occurrence_date,cancelled,start_date,start_time,end_time,title}', '{cancelled,start_date,start_time,end_time,title}', true);

-- Pobieranie zmian: także wydarzenia (zastępuje wersję z migracji sync).
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
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

-- Czyszczenie kosza i twarde usunięcie grupy obejmują wydarzenia (zastępują wersje z migracji sync i account_deletion).
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
    delete from public.lists l where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id);
    get diagnostics k = row_count; n := n + k;
    -- Wydarzenia (migracja events): najpierw zależne wiersze, potem serie bez żywych zależności.
    delete from public.event_overrides o where o.group_id = g
      and (o.deleted_at < horizon or exists (select 1 from public.events e where e.id = o.event_id and e.deleted_at < horizon));
    get diagnostics k = row_count; n := n + k;
    delete from public.event_participants p where p.group_id = g
      and (p.deleted_at < horizon or exists (select 1 from public.events e where e.id = p.event_id and e.deleted_at < horizon));
    get diagnostics k = row_count; n := n + k;
    delete from public.activity a using public.events e
      where a.entity = 'events' and a.entity_id = e.id and e.group_id = g and e.deleted_at < horizon;
    delete from public.events e where e.group_id = g and e.deleted_at < horizon
      and not exists (select 1 from public.event_overrides o where o.event_id = e.id)
      and not exists (select 1 from public.event_participants p where p.event_id = e.id);
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
