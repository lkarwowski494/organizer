-- Etap 1, migracja 1: grupy, członkowie, profile, księgowość synchronizacji.
-- Architektura: „Organizer grup architektura MVP” (model danych, protokół synchronizacji), decyzje D2, D3,
-- D10/D34 (member_id z opcjonalnym user_id), D32 (wersja per grupa), D41 (jawne GRANT, RLS wszędzie).
--
-- Zasady bezpieczeństwa (https://supabase.com/docs/guides/database/postgres/row-level-security,
-- https://supabase.com/docs/guides/database/functions):
--  - RLS włączone na każdej tabeli w public; uprawnienia nadawane jawnie (D41),
--  - funkcje SECURITY DEFINER tylko w schemacie private (niewystawionym w API), z search_path = '',
--  - auth.uid() opakowane w (select auth.uid()), żeby liczyło się raz na zapytanie.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Jedno źródło prawdy: wartości z src/config/index.ts, pilnowane testem kontraktowym
-- (supabase/tests/contract_config.test.sql porównuje je z plikiem konfiguracji).
create function private.max_task_depth() returns int language sql immutable as $$ select 2 $$;
create function private.tombstone_days() returns int language sql immutable as $$ select 30 $$;

-- ───────────────────────── grupy ─────────────────────────
create table public.groups (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'shared' check (kind in ('personal', 'shared')),
  -- D32: licznik wersji grupy; każdy zapis w grupie go podbija pod blokadą wiersza.
  version bigint not null default 0,
  -- Wersja, do której trwale usunięto tombstones; klient ze starszym kursorem robi pełną resynchronizację.
  purged_version bigint not null default 0,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.group_members (
  member_id uuid primary key,
  group_id uuid not null references public.groups (id),
  -- NULL = profil dziecka bez konta (D10).
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'child')),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id) where deleted_at is null;
create index group_members_group_version_idx on public.group_members (group_id, version);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  version bigint not null default 0
);

-- ───────────────────────── księgowość synchronizacji (poza API) ─────────────────────────
create table private.sync_clients (
  client_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seq bigint not null default 0,
  last_seen_at timestamptz not null default now()
);

create table private.access_events (
  id bigserial primary key,
  user_id uuid not null,
  group_id uuid not null,
  kind text not null check (kind in ('group_granted', 'group_revoked', 'scope_granted', 'scope_revoked')),
  scope_entity text,
  scope_id uuid,
  created_at timestamptz not null default now()
);
create index access_events_user_idx on private.access_events (user_id, id);

-- ───────────────────────── funkcje pomocnicze RLS ─────────────────────────
create function private.my_group_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.group_id from public.group_members m
  where m.user_id = (select auth.uid()) and m.deleted_at is null
$$;

create function private.my_role(g uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.group_members m
  where m.group_id = g and m.user_id = (select auth.uid()) and m.deleted_at is null
$$;

create function private.my_member_id(g uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.member_id from public.group_members m
  where m.group_id = g and m.user_id = (select auth.uid()) and m.deleted_at is null
$$;

-- D32: podbija wersję grupy (blokada wiersza do końca transakcji) i zwraca nową wartość.
create function private.bump_group_version(g uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  update public.groups set version = version + 1 where id = g returning version into v;
  if v is null then raise exception 'group_not_found' using errcode = 'P0001'; end if;
  return v;
end $$;

-- ───────────────────────── wyzwalacze ─────────────────────────
-- Wspólne dla tabel domenowych: wersja z licznika grupy, niezmienne kolumny, brak twardego usuwania.
create function private.stamp_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.group_id is distinct from old.group_id then
      raise exception 'immutable_column:group_id' using errcode = 'P0001';
    end if;
  end if;
  new.version := private.bump_group_version(new.group_id);
  return new;
end $$;

create function private.groups_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Zmiana samej grupy też jest zmianą w grupie: wersja rośnie, żeby inni ją pobrali.
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  if new.kind is distinct from old.kind then raise exception 'immutable_column:kind' using errcode = 'P0001'; end if;
  return new;
end $$;

create trigger groups_stamp before update on public.groups
  for each row execute function private.groups_stamp();

-- Członkostwa: kto może co zmienić (RLS decyduje KTO pisze, ten wyzwalacz — CO może zmienić).
create function private.group_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_role text := private.my_role(new.group_id);
  is_self boolean := tg_op = 'UPDATE' and old.user_id is not null and old.user_id = (select auth.uid());
begin
  -- Kontekst serwerowy (wyzwalacz rejestracji, service_role): brak użytkownika w żądaniu.
  -- Rola authenticated zawsze ma auth.uid(), a anon nie ma uprawnień do tej tabeli.
  if (select auth.uid()) is null then return new; end if;

  if tg_op = 'INSERT' then
    -- Pierwszy członek nowej grupy: właściciel = ja. Grupy tworzy wyłącznie create_group_with_owner
    -- (authenticated nie ma INSERT na groups), więc pusta grupa istnieje tylko wewnątrz tej funkcji.
    if new.role = 'owner' and new.user_id = (select auth.uid())
       and not exists (select 1 from public.group_members m where m.group_id = new.group_id) then
      return new;
    end if;
    if actor_role not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
    -- Konto dołącza tylko przez zaproszenie (Etap 1, funkcja accept_invite); ręcznie tworzy się profile dzieci.
    if new.user_id is not null then raise exception 'forbidden:user_requires_invite' using errcode = 'P0001'; end if;
    if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'immutable_column:user_id' using errcode = 'P0001'; end if;
  if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;

  if new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at then
    -- Rolę i usunięcie zmienia owner; admin — tylko dla member/child i nie na owner/admin.
    if actor_role = 'owner' then
      if old.role = 'owner' and old.user_id = (select auth.uid()) then
        raise exception 'forbidden:owner_cannot_demote_self' using errcode = 'P0001';
      end if;
    elsif actor_role = 'admin' then
      if old.role in ('owner', 'admin') or new.role in ('owner', 'admin') then
        raise exception 'forbidden:role' using errcode = 'P0001';
      end if;
    elsif is_self and new.deleted_at is not null and new.role = old.role and old.role <> 'owner' then
      null; -- każdy (poza ownerem) może sam wyjść z grupy
    else
      raise exception 'forbidden:role' using errcode = 'P0001';
    end if;
  end if;

  if (new.display_name, new.color) is distinct from (old.display_name, old.color)
     and actor_role not in ('owner', 'admin') and not is_self then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger group_members_guard before insert or update on public.group_members
  for each row execute function private.group_members_guard();
create trigger group_members_stamp before insert or update on public.group_members
  for each row execute function private.stamp_version();

-- Zdarzenia dostępu: źródło natychmiastowego sygnału „straciłeś/dostałeś dostęp” (poke na kanał user:<id>).
create function private.group_members_access_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then return null; end if;
  if tg_op = 'INSERT' or (old.deleted_at is not null and new.deleted_at is null) then
    insert into private.access_events (user_id, group_id, kind) values (new.user_id, new.group_id, 'group_granted');
  elsif old.deleted_at is null and new.deleted_at is not null then
    insert into private.access_events (user_id, group_id, kind) values (new.user_id, new.group_id, 'group_revoked');
  else
    return null;
  end if;
  perform realtime.send(jsonb_build_object('access', true), 'poke', 'user:' || new.user_id, true);
  return null;
end $$;

create trigger group_members_access_event after insert or update on public.group_members
  for each row execute function private.group_members_access_event();

-- ───────────────────────── tworzenie grup ─────────────────────────
create function private.create_group_with_owner(gid uuid, gname text, gkind text, owner_member uuid, owner_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  insert into public.groups (id, name, kind) values (gid, gname, gkind);
  insert into public.group_members (member_id, group_id, user_id, display_name, role)
    values (owner_member, gid, uid, owner_name, 'owner');
end $$;

-- Przy rejestracji: profil i grupa osobista (przestrzeń osobista = grupa jednoosobowa, D3).
create function private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Ja');
begin
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  -- Grupa osobista ma id = user_id: deterministyczne, więc dwa telefony nie utworzą dwóch.
  insert into public.groups (id, name, kind) values (new.id, 'Osobiste', 'personal');
  insert into public.group_members (member_id, group_id, user_id, display_name, role)
    values (new.id, new.id, new.id, v_name, 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

-- ───────────────────────── RLS i uprawnienia ─────────────────────────
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.profiles enable row level security;

create policy groups_select on public.groups for select to authenticated
  using (id in (select private.my_group_ids()));
create policy groups_update on public.groups for update to authenticated
  using (private.my_role(id) in ('owner', 'admin'))
  with check (private.my_role(id) in ('owner', 'admin'));

create policy members_select on public.group_members for select to authenticated
  using (group_id in (select private.my_group_ids()));
create policy members_insert on public.group_members for insert to authenticated
  with check (private.my_role(group_id) in ('owner', 'admin'));
create policy members_update on public.group_members for update to authenticated
  using (group_id in (select private.my_group_ids()))
  with check (group_id in (select private.my_group_ids()) or user_id = (select auth.uid()));

-- Profil: widzę swój i osób z moich grup (imię przy przypisaniach).
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or user_id in (
    select m.user_id from public.group_members m
    where m.group_id in (select private.my_group_ids()) and m.deleted_at is null));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- D41: jawne uprawnienia. Brak DELETE — usuwanie jest miękkie (deleted_at). Grupy powstają przez funkcję.
grant select, update (name) on public.groups to authenticated;
grant select, insert (member_id, group_id, display_name, color, role),
  update (display_name, color, role, deleted_at) on public.group_members to authenticated;
grant select, update (display_name) on public.profiles to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.my_group_ids(), private.my_role(uuid), private.my_member_id(uuid),
  private.max_task_depth(), private.tombstone_days() to authenticated;

-- Publiczne wejście do tworzenia grupy (RPC). SECURITY INVOKER; uprawnienia sprawdza funkcja w private.
create function public.create_group(group_id uuid, name text, owner_member_id uuid, owner_display_name text)
returns void language sql security invoker set search_path = '' as $$
  select private.create_group_with_owner(group_id, name, 'shared', owner_member_id, owner_display_name)
$$;
revoke all on function public.create_group(uuid, text, uuid, text) from public, anon;
grant execute on function public.create_group(uuid, text, uuid, text), private.create_group_with_owner(uuid, text, text, uuid, text) to authenticated;
