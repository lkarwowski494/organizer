-- Audyt 2, paczka P13 (decyzje koordynatora 9.10.2026 wg zasady właściciela — wariant lepszy, choć droższy):
--  1. Zakres Moich spraw w grupie (PW-2 A, M-35, D149) na koncie, nie na telefonie: public.my_day_scopes — jeden wiersz na
--     członkostwo (id = UUIDv5 z member_id, src/domain/views/my-scope.ts), widzi i zmienia go tylko to konto (RLS po
--     my_member_id). Drugie urządzenie tego samego konta dostaje ustawienie przy pobieraniu grupy.
--  2. Historia zakupów (PWD-11 A, M-280): public.shopping_trips — jeden wiersz na zrobione zakupy listy zakupów (kiedy,
--     na kiedy były zaplanowane, kto). Kalendarz pokazuje każde przekreślone w ich dniu. Retencja jak historia zmian
--     (P16): private.trip_days() = 90 dni (config.retention.TRIP_DAYS), cofnięte (usunięte) — po terminie kosza.
-- Zgodność z buildem 21: nowych encji nie ma w private.legacy_entities() ani w jego `entities`, więc ich nie dostaje;
-- jego zapisy ich nie dotyczą. Telefon nowej wersji pobiera wszystko od zera raz (nowe encje, ClientState.entities).
-- Nowe obiekty: tabele public.my_day_scopes i public.shopping_trips (RLS, GRANT, indeksy), private.trip_days(),
-- private.my_day_scopes_guard() + wyzwalacze my_day_scopes_a_guard / _b_stamp, private.shopping_trips_guard() +
-- wyzwalacze shopping_trips_a_guard / _b_stamp, private.member_scope_cleanup() + wyzwalacz group_members_z_scope_cleanup,
-- wpisy w private.sync_entities. Zastępuje: private.group_rows_since (20261008484000_sync_perf — dopisane dwie encje),
-- private.purge_group i private.purge_candidates (20261008480000_retention — dopisana retencja zakupów).
-- Testy: supabase/tests/my_scopes_trips.test.sql.

create function private.trip_days() returns int language sql immutable as $$ select 90 $$;

-- ───────────────────────── Zakres Moich spraw ─────────────────────────
create table public.my_day_scopes (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  member_id uuid not null unique references public.group_members (member_id) on delete cascade,
  scope text not null check (scope in ('all', 'mineAndEvents', 'mine')),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index my_day_scopes_group_version_idx on public.my_day_scopes (group_id, version);

-- Tylko własne członkostwo (dziecko z kontem też — to jego widok). id wynika z member_id jak na telefonie, więc nikt nie
-- zajmie cudzego wiersza z wyprzedzeniem (jak derived_ids, M-72).
create function private.my_day_scopes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then
    raise exception 'immutable_column:member_id' using errcode = 'P0001';
  end if;
  if new.member_id is distinct from private.my_member_id(new.group_id) then raise exception 'forbidden:not_self' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and new.id <> private.uuid_v5('2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9'::uuid, new.member_id::text) then
    raise exception 'invalid_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger my_day_scopes_a_guard before insert or update on public.my_day_scopes
  for each row execute function private.my_day_scopes_guard();
create trigger my_day_scopes_b_stamp before insert or update on public.my_day_scopes
  for each row execute function private.stamp_version();
alter table public.my_day_scopes enable row level security;
create policy my_day_scopes_select on public.my_day_scopes for select to authenticated using (member_id = private.my_member_id(group_id));
create policy my_day_scopes_insert on public.my_day_scopes for insert to authenticated with check (member_id = private.my_member_id(group_id));
create policy my_day_scopes_update on public.my_day_scopes for update to authenticated
  using (member_id = private.my_member_id(group_id)) with check (member_id = private.my_member_id(group_id));
revoke all on public.my_day_scopes from anon, authenticated;
grant select, insert (id, group_id, member_id, scope), update (scope, deleted_at) on public.my_day_scopes to authenticated;

-- Wyjście z grupy i usunięcie osoby: zakres tej osoby przestaje mieć sens (wraca od „Wszystko”).
create function private.member_scope_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.my_day_scopes where member_id = new.member_id;
  return null;
end $$;
create trigger group_members_z_scope_cleanup after update of deleted_at, user_id on public.group_members
  for each row when (new.deleted_at is not null or new.user_id is distinct from old.user_id) execute function private.member_scope_cleanup();

-- ───────────────────────── Zrobione zakupy ─────────────────────────
create table public.shopping_trips (
  id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  planned_date date,
  done_at timestamptz not null,
  -- Kto zrobił — ustawia serwer.
  done_by uuid references public.group_members (member_id) on delete set null,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index shopping_trips_group_version_idx on public.shopping_trips (group_id, version);
create index shopping_trips_list_idx on public.shopping_trips (list_id);
create index shopping_trips_done_idx on public.shopping_trips (done_at);
create index shopping_trips_trash_idx on public.shopping_trips (deleted_at) where deleted_at is not null;

-- Lista zakupów tej grupy, którą widzę; dziecko z kontem zakupów nie kończy (PW-14 B, jak lists_guard). Chwila z telefonu
-- (zakupy zrobione bez sieci), ale nie z przyszłości.
create function private.shopping_trips_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  -- Zmienić można tylko deleted_at (GRANT) — „Cofnij” i przywrócenie.
  if tg_op = 'UPDATE' then return new; end if;
  if not exists (select 1 from public.lists l where l.id = new.list_id and l.group_id = new.group_id and l.kind = 'shopping' and l.deleted_at is null) then
    raise exception 'invalid_list' using errcode = 'P0001';
  end if;
  if new.done_at > now() + interval '1 day' then new.done_at := now(); end if;
  new.done_by := me;
  return new;
end $$;
create trigger shopping_trips_a_guard before insert or update on public.shopping_trips
  for each row execute function private.shopping_trips_guard();
create trigger shopping_trips_b_stamp before insert or update on public.shopping_trips
  for each row execute function private.stamp_version();
alter table public.shopping_trips enable row level security;
create policy shopping_trips_select on public.shopping_trips for select to authenticated using (private.can_see_list(list_id));
create policy shopping_trips_insert on public.shopping_trips for insert to authenticated with check (private.can_see_list(list_id));
create policy shopping_trips_update on public.shopping_trips for update to authenticated
  using (private.can_see_list(list_id)) with check (private.can_see_list(list_id));
revoke all on public.shopping_trips from anon, authenticated;
grant select, insert (id, group_id, list_id, planned_date, done_at), update (deleted_at) on public.shopping_trips to authenticated;

insert into private.sync_entities values
  ('my_day_scopes', 'id', '{id,group_id,member_id,scope}', '{scope}', true),
  ('shopping_trips', 'id', '{id,group_id,list_id,planned_date,done_at}', '{}', true);

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
      union all (select t.version from public.my_day_scopes t where t.group_id = g and t.version > since order by t.version limit lim)
      union all (select t.version from public.shopping_trips t where t.group_id = g and t.version > since order by t.version limit lim)
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
    union all select 'my_day_scopes', t.version, to_jsonb(t) from public.my_day_scopes t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'shopping_trips', t.version, to_jsonb(t) from public.shopping_trips t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'handoffs', t.version, to_jsonb(t) from public.handoffs t where t.group_id = g and t.version > since and t.version <= cut
    union all select 'activity', t.version, to_jsonb(t) from public.activity t where t.group_id = g and t.version > since and t.version <= cut
  ) q (e, v, r) order by q.v;
end $$;

create or replace function private.purge_group(g uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  act_horizon timestamptz := now() - make_interval(days => private.activity_days());
  handoff_horizon timestamptz := now() - make_interval(days => private.handoff_days());
  trip_horizon timestamptz := now() - make_interval(days => private.trip_days());
  n int := 0;
  k int;
  v bigint;
  top bigint := 0;
  acts int := 0;
  handoffs int := 0;
  unpinned int := 0;
  ev uuid[];
  ser uuid[];
  ids uuid[];
  lst uuid[];
begin
  perform 1 from public.groups where id = g for update;
  perform set_config('organizer.trash_ok', 'on', true);

  -- M-62: historia starsza niż activity_days().
  with d as (delete from public.activity a where a.group_id = g and a.created_at < act_horizon returning a.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  acts := acts + k; top := greatest(top, v);
  -- M-68: rozstrzygnięte przekazania po handoff_days() od decyzji.
  with d as (delete from public.handoffs h where h.group_id = g and h.status <> 'pending' and h.decided_at < handoff_horizon
             returning h.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  handoffs := k; top := greatest(top, v);
  -- PWD-11 A: zrobione zakupy starsze niż trip_days() i cofnięte (usunięte) po terminie w koszu.
  with d as (delete from public.shopping_trips s where s.group_id = g and (s.done_at < trip_horizon or s.deleted_at < horizon)
             returning s.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  n := n + k; top := greatest(top, v);

  -- Wydarzenia po terminie w koszu (D182). Przypięte zadania (żywe i w koszu) zostają: odpinamy je, a zadanie z terminem
  -- „jak spotkanie” dostaje datę tego terminu (przeniesionego wyjątkiem — datę po przeniesieniu) jako własny termin.
  select coalesce(array_agg(e.id), '{}') into ev from public.events e where e.group_id = g and e.deleted_at < horizon;
  if cardinality(ev) > 0 then
    update public.tasks t set
      deadline_mode = case when t.deadline_mode = 'event' then 'own' else t.deadline_mode end,
      due_date = case when t.deadline_mode = 'event'
                      then coalesce((select o.start_date from public.event_overrides o
                                     where o.event_id = t.event_id and o.occurrence_date = t.occurrence_date
                                       and o.deleted_at is null and not o.cancelled), t.occurrence_date)
                      else t.due_date end,
      event_id = null, occurrence_date = null
    where t.group_id = g and t.event_id = any (ev);
    get diagnostics unpinned = row_count;
  end if;

  -- Definicje stałych zadań do usunięcia: po terminie w koszu, na wydarzeniu albo liście po terminie w koszu. Kopie
  -- (zwykłe zadania) zostają — tracą tylko wskazanie definicji, której już nie ma.
  select coalesce(array_agg(s.id), '{}') into ser from public.event_task_series s
    where s.group_id = g and (s.deleted_at < horizon or s.event_id = any (ev)
      or exists (select 1 from public.lists l where l.id = s.list_id and l.deleted_at < horizon));
  if cardinality(ser) > 0 then
    update public.tasks set series_id = null where group_id = g and series_id = any (ser);
  end if;

  -- Zadania: tylko takie, pod którymi nie ma wiersza, który zostaje (klucz obcy parent_id zawsze przejdzie).
  with recursive keep as (
    select t.id, t.parent_id from public.tasks t
    where t.group_id = g and (t.deleted_at is null or t.deleted_at >= horizon)
    union
    select x.id, x.parent_id from public.tasks x join keep on x.id = keep.parent_id
  )
  select coalesce(array_agg(t.id), '{}') into ids from public.tasks t
  where t.group_id = g and t.deleted_at < horizon and t.id not in (select keep.id from keep);
  if cardinality(ids) > 0 then
    with d as (delete from public.activity a where a.entity = 'tasks' and a.entity_id = any (ids) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.tasks where id = any (ids) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wpisy dostępu do list (historia wpisu: entity_id = osoba, zakres = lista).
  with d as (delete from public.object_members o where o.group_id = g and o.deleted_at < horizon returning o.scope_id, o.member_id, o.version),
       h as (delete from public.activity a using d where a.entity = 'object_members' and a.entity_id = d.member_id and a.scope_id = d.scope_id
             returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ser) > 0 then
    with d as (delete from public.activity a where a.entity = 'event_task_series' and a.entity_id = any (ser) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.event_task_series where id = any (ser) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Listy: po terminie w koszu i bez zadań (zadania listy trafiają do kosza razem z nią, lists_cascade).
  select coalesce(array_agg(l.id), '{}') into lst from public.lists l
    where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id)
      and not exists (select 1 from public.event_task_series s where s.list_id = l.id);
  if cardinality(lst) > 0 then
    with d as (delete from public.activity a where (a.entity = 'lists' and a.entity_id = any (lst)) or a.scope_id = any (lst)
               returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.lists where id = any (lst) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wyjątki terminów, odpowiedzi (D124) i uczestnicy: usunięte albo przy wydarzeniu po terminie w koszu.
  with d as (delete from public.event_overrides o where o.group_id = g and (o.deleted_at < horizon or o.event_id = any (ev))
             returning o.id, o.version),
       h as (delete from public.activity a using d where a.entity = 'event_overrides' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_rsvps r where r.group_id = g and (r.deleted_at < horizon or r.event_id = any (ev))
             returning r.id, r.version),
       h as (delete from public.activity a using d where a.entity = 'event_rsvps' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_participants p where p.group_id = g and (p.deleted_at < horizon or p.event_id = any (ev))
             returning p.id, p.version),
       h as (delete from public.activity a using d where a.entity = 'event_participants' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ev) > 0 then
    with d as (delete from public.activity a where a.entity = 'events' and a.entity_id = any (ev) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    -- Seria podzielona „to i następne” wskazuje źródło (split_from, ON DELETE SET NULL) — zostaje bez wskazania.
    with d as (delete from public.events where id = any (ev) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  if top > 0 then update public.groups set purged_version = greatest(purged_version, top) where id = g; end if;
  perform set_config('organizer.trash_ok', '', true);
  return jsonb_build_object('tombstones', n, 'activity', acts, 'handoffs', handoffs, 'unpinned', unpinned);
end $$;

create or replace function private.purge_candidates() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with h as (select now() - make_interval(days => private.tombstone_days()) as t,
                    now() - make_interval(days => private.activity_days()) as a,
                    now() - make_interval(days => private.handoff_days()) as d,
                    now() - make_interval(days => private.trip_days()) as s)
  select x.group_id from (
    select group_id from public.tasks, h where deleted_at < h.t
    union select group_id from public.lists, h where deleted_at < h.t
    union select group_id from public.object_members, h where deleted_at < h.t
    union select group_id from public.event_task_series, h where deleted_at < h.t
    union select group_id from public.events, h where deleted_at < h.t
    union select group_id from public.event_overrides, h where deleted_at < h.t
    union select group_id from public.event_rsvps, h where deleted_at < h.t
    union select group_id from public.event_participants, h where deleted_at < h.t
    union select group_id from public.activity, h where created_at < h.a
    union select group_id from public.handoffs, h where status <> 'pending' and decided_at < h.d
    union select group_id from public.shopping_trips, h where done_at < h.s or deleted_at < h.t
  ) x order by x.group_id
$$;

revoke all on function private.purge_group(uuid), private.purge_candidates() from public, anon, authenticated;
revoke all on all functions in schema private from public, anon;
