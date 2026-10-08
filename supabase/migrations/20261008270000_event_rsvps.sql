-- Potwierdzanie obecności (D124, decyzja właściciela z 8.10.2026, ADR 0033): przy terminie wydarzenia każdy członek
-- grupy odpowiada „będę / nie będę / może”. Dorosły odpowiada też za dziecko bez konta (profil D10/D34); dziecko
-- z kontem odpowiada samo. Jedna odpowiedź na osobę i termin (data wystąpienia według reguły, jak event_overrides).
-- Identyfikator wylicza telefon (UUIDv5 z wydarzenia, daty i osoby), więc dwa telefony piszą ten sam wiersz.
-- Bez wpisów aktywności (odpowiedzi to nie zmiany wydarzenia).

create table public.event_rsvps (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  event_id uuid not null references public.events (id),
  occurrence_date date not null,
  member_id uuid not null references public.group_members (member_id),
  answer text not null check (answer in ('yes', 'no', 'maybe')),
  -- Kto odpowiedział (ja albo dorosły za dziecko) — ustawia serwer.
  answered_by uuid references public.group_members (member_id),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (event_id, occurrence_date, member_id)
);
create index event_rsvps_group_version_idx on public.event_rsvps (group_id, version);

create function private.event_rsvps_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid; target public.group_members;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if new.group_id is distinct from old.group_id then raise exception 'immutable_column:group_id' using errcode = 'P0001'; end if;
    if new.event_id is distinct from old.event_id then raise exception 'immutable_column:event_id' using errcode = 'P0001'; end if;
    if new.occurrence_date is distinct from old.occurrence_date then raise exception 'immutable_column:occurrence_date' using errcode = 'P0001'; end if;
    if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
  end if;
  if not exists (select 1 from public.events e where e.id = new.event_id and e.group_id = new.group_id and e.deleted_at is null) then
    raise exception 'invalid_event' using errcode = 'P0001';
  end if;
  select * into target from public.group_members m where m.member_id = new.member_id and m.group_id = new.group_id and m.deleted_at is null;
  if target.member_id is null then raise exception 'invalid_member' using errcode = 'P0001'; end if;
  -- Za siebie; za dziecko bez konta — tylko dorosły.
  if target.member_id <> me and not (target.user_id is null and target.role = 'child' and coalesce(private.my_role(new.group_id), 'child') <> 'child') then
    raise exception 'forbidden:not_self' using errcode = 'P0001';
  end if;
  new.answered_by := me;
  return new;
end $$;

create trigger event_rsvps_a_guard before insert or update on public.event_rsvps
  for each row execute function private.event_rsvps_guard();
create trigger event_rsvps_b_stamp before insert or update on public.event_rsvps
  for each row execute function private.stamp_version();
alter table public.event_rsvps enable row level security;
-- Odpowiedzi widzi cała grupa (jak wydarzenia).
create policy event_rsvps_select on public.event_rsvps for select to authenticated using (group_id in (select private.my_group_ids()));
create policy event_rsvps_insert on public.event_rsvps for insert to authenticated with check (group_id in (select private.my_group_ids()));
create policy event_rsvps_update on public.event_rsvps for update to authenticated
  using (group_id in (select private.my_group_ids())) with check (group_id in (select private.my_group_ids()));
revoke all on public.event_rsvps from anon, authenticated;
grant select, insert (id, group_id, event_id, occurrence_date, member_id, answer), update (answer, deleted_at) on public.event_rsvps to authenticated;

insert into private.sync_entities values
  ('event_rsvps', 'id', '{id,group_id,event_id,occurrence_date,member_id,answer}', '{answer}', true);

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
    union all select 'event_rsvps', t.version, to_jsonb(t) from public.event_rsvps t where t.group_id = g and t.version > since
    union all select 'handoffs', t.version, to_jsonb(t) from public.handoffs t where t.group_id = g and t.version > since
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since
  ), ranked as (
    select *, row_number() over (order by v) rn from all_rows
  ), cut as (
    select coalesce((select v from ranked where rn = lim), (select max(v) from ranked)) as v
  )
  select x.e, x.v, x.r from ranked x, cut where x.v <= cut.v order by x.v
$$;

-- Czyszczenie kosza i twarde usunięcie grupy obejmują odpowiedzi (przed wydarzeniami i członkami, na których wskazują).
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
    -- Odpowiedzi (D124): usunięte albo przy wydarzeniu z kosza.
    delete from public.event_rsvps r where r.group_id = g
      and (r.deleted_at < horizon or exists (select 1 from public.events e where e.id = r.event_id and e.deleted_at < horizon));
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
      and not exists (select 1 from public.event_rsvps r where r.event_id = e.id)
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
  delete from public.handoffs where group_id = g;
  for d in select generate_series(private.max_task_depth(), 0, -1) loop
    delete from public.tasks where group_id = g and depth = d;
  end loop;
  delete from public.object_members where group_id = g;
  delete from public.event_task_series where group_id = g;
  delete from public.event_rsvps where group_id = g;
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
