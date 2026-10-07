-- Etap 1, migracja 4: zaproszenia linkiem i poprawki strażnika członkostw.
-- Wzorzec: link z tokenem, terminem ważności i limitem użyć, przyjmowany jawnie (jak stan „invited”
-- w Todoist i oneTimeURL w CloudKit — raport „Aplikacja organizer grup research”, sekcja o zaproszeniach).
-- W bazie leży tylko skrót SHA-256 tokenu, więc wyciek tabeli nie daje działających linków.
-- Losowość: gen_random_uuid() z rdzenia Postgresa (pg_strong_random), 2 × 122 bity losowe na token
-- (https://www.postgresql.org/docs/current/functions-uuid.html).

-- Limity z src/config (test kontraktowy). Wartości tymczasowe do decyzji właściciela (D48).
create function private.invite_default_ttl_hours() returns int language sql immutable as $$ select 168 $$;
create function private.invite_max_ttl_hours() returns int language sql immutable as $$ select 720 $$;
create function private.invite_default_max_uses() returns int language sql immutable as $$ select 10 $$;
create function private.invite_max_uses_limit() returns int language sql immutable as $$ select 50 $$;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  token_hash bytea not null unique,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_by uuid not null references public.group_members (member_id),
  expires_at timestamptz not null,
  max_uses int not null check (max_uses >= 1),
  uses int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_group_idx on public.invites (group_id);

alter table public.invites enable row level security;
-- Zaproszenia widzą tylko owner i admin grupy (lista aktywnych linków do odwołania). Zapis wyłącznie przez funkcje.
create policy invites_select on public.invites for select to authenticated
  using (private.my_role(group_id) in ('owner', 'admin'));
revoke all on public.invites from anon, authenticated;
grant select (id, group_id, role, created_by, expires_at, max_uses, uses, revoked_at, created_at) on public.invites to authenticated;

create function private.token_hash(token text) returns bytea
language sql immutable set search_path = '' as $$ select pg_catalog.sha256(convert_to(token, 'UTF8')) $$;

-- Ważne zaproszenie dla skrótu tokenu (albo NULL).
create function private.valid_invite(h bytea) returns public.invites
language sql stable security definer set search_path = '' as $$
  select i.* from public.invites i join public.groups g on g.id = i.group_id
  where i.token_hash = h and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
    and g.deleted_at is null and g.kind = 'shared'
$$;

-- ───────────────────────── strażnik członkostw (zastępuje wersję z migracji core) ─────────────────────────
-- Zmiany: (1) dołączenie konta przez ważne zaproszenie; (2) każdy poza ownerem może sam wyjść z grupy —
-- wcześniej admin nie mógł (gałąź roli admina odrzucała zmianę własnego wiersza; błąd z przeglądu macierzy ról).
create or replace function private.group_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- coalesce: brak roli (osoba spoza grupy) to '' — „NULL not in (…)” daje NULL i przepuszczałby warunek odmowy.
  actor_role text := coalesce(private.my_role(new.group_id), '');
  me uuid := (select auth.uid());
  is_self boolean := tg_op = 'UPDATE' and old.user_id is not null and old.user_id = me;
  inv public.invites;
begin
  if me is null then return new; end if;

  -- Dołączenie przez zaproszenie: flagę ustawia wyłącznie private.accept_invite; nawet ustawiona ręcznie
  -- nic nie daje bez ważnego tokenu (sprawdzanego tu ponownie) dla tej grupy i tej roli.
  if nullif(current_setting('organizer.invite_hash', true), '') is not null then
    inv := private.valid_invite(decode(current_setting('organizer.invite_hash', true), 'hex'));
    if inv.id is not null and new.group_id = inv.group_id and new.user_id = me and new.role = inv.role
       and new.deleted_at is null and (tg_op = 'INSERT' or old.user_id = me) then
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and new.user_id = me
       and not exists (select 1 from public.group_members m where m.group_id = new.group_id) then
      return new;
    end if;
    if actor_role not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
    if new.user_id is not null then raise exception 'forbidden:user_requires_invite' using errcode = 'P0001'; end if;
    if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'immutable_column:user_id' using errcode = 'P0001'; end if;
  if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;

  if new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at then
    if is_self and old.deleted_at is null and new.deleted_at is not null and new.role = old.role and old.role <> 'owner' then
      null; -- wyjście z grupy (każdy poza ownerem; owner najpierw przekazuje grupę — Etap 1, usuwanie konta)
    elsif actor_role = 'owner' then
      if old.role = 'owner' and old.user_id = me then
        raise exception 'forbidden:owner_cannot_demote_self' using errcode = 'P0001';
      end if;
      if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    elsif actor_role = 'admin' then
      if old.role in ('owner', 'admin') or new.role in ('owner', 'admin') then
        raise exception 'forbidden:role' using errcode = 'P0001';
      end if;
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

-- ───────────────────────── funkcje ─────────────────────────
-- Tworzy zaproszenie i zwraca token JEDEN raz (nigdzie nie jest zapisany w jawnej postaci).
create function private.create_invite(gid uuid, inv_role text, ttl_hours int, uses int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  me uuid := private.my_member_id(gid);
  r public.invites;
begin
  if coalesce(private.my_role(gid), '') not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if (select kind from public.groups where id = gid) <> 'shared' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  if coalesce(inv_role, 'member') not in ('admin', 'member') then raise exception 'invalid_value:role' using errcode = 'P0001'; end if;
  -- Admina może zaprosić tylko owner (spójnie z tym, kto może nadawać rolę admin).
  if inv_role = 'admin' and coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
  if ttl_hours is not null and (ttl_hours < 1 or ttl_hours > private.invite_max_ttl_hours()) then
    raise exception 'invalid_value:ttl' using errcode = 'P0001';
  end if;
  if uses is not null and (uses < 1 or uses > private.invite_max_uses_limit()) then
    raise exception 'invalid_value:max_uses' using errcode = 'P0001';
  end if;
  insert into public.invites (group_id, token_hash, role, created_by, expires_at, max_uses)
  values (gid, private.token_hash(token), coalesce(inv_role, 'member'), me,
          now() + make_interval(hours => coalesce(ttl_hours, private.invite_default_ttl_hours())),
          coalesce(uses, private.invite_default_max_uses()))
  returning * into r;
  return jsonb_build_object('invite_id', r.id, 'token', token, 'expires_at', r.expires_at, 'max_uses', r.max_uses);
end $$;

create function private.accept_invite(token text, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  h bytea := private.token_hash(token);
  inv public.invites;
  m public.group_members;
  name text := coalesce(nullif(btrim(display_name), ''), (select p.display_name from public.profiles p where p.user_id = me), 'Ja');
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  -- Blokada wiersza zaproszenia: równoczesne przyjęcia nie przekroczą limitu użyć.
  select * into inv from public.invites where token_hash = h for update;
  if inv.id is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  if inv.revoked_at is not null then raise exception 'invite_revoked' using errcode = 'P0001'; end if;
  if inv.expires_at <= now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  select * into m from public.group_members where group_id = inv.group_id and user_id = me;
  -- Już jestem aktywnym członkiem: przyjęcie jest bezskutkowe (nie zużywa użycia, nie zmienia roli).
  if m.member_id is not null and m.deleted_at is null then
    return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', true);
  end if;
  if inv.uses >= inv.max_uses then raise exception 'invite_used_up' using errcode = 'P0001'; end if;
  if private.valid_invite(h) is null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;

  perform set_config('organizer.invite_hash', encode(h, 'hex'), true);
  if m.member_id is null then
    insert into public.group_members (member_id, group_id, user_id, display_name, role)
      values (gen_random_uuid(), inv.group_id, me, left(name, 100), inv.role)
      returning * into m;
  else
    -- Powrót po wyjściu z grupy: ten sam member_id, więc stare przypisania i historia wracają do tej osoby.
    update public.group_members set deleted_at = null, role = inv.role where member_id = m.member_id returning * into m;
  end if;
  perform set_config('organizer.invite_hash', '', true);
  update public.invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('group_id', inv.group_id, 'member_id', m.member_id, 'already_member', false);
end $$;

create function private.revoke_invite(iid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  select group_id into g from public.invites where id = iid;
  if g is null or coalesce(private.my_role(g), '') not in ('owner', 'admin') then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.invites set revoked_at = coalesce(revoked_at, now()) where id = iid;
end $$;

-- Publiczne wejścia (RPC), SECURITY INVOKER.
create function public.create_invite(group_id uuid, role text default 'member', ttl_hours int default null, max_uses int default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_invite(group_id, role, ttl_hours, max_uses)
$$;
create function public.accept_invite(token text, display_name text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.accept_invite(token, display_name)
$$;
create function public.revoke_invite(invite_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.revoke_invite(invite_id)
$$;

revoke all on all functions in schema private from public, anon;
revoke all on function public.create_invite(uuid, text, int, int), public.accept_invite(text, text), public.revoke_invite(uuid) from public, anon;
grant execute on function public.create_invite(uuid, text, int, int), public.accept_invite(text, text), public.revoke_invite(uuid),
  private.create_invite(uuid, text, int, int), private.accept_invite(text, text), private.revoke_invite(uuid) to authenticated;
