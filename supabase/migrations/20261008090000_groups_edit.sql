-- Etap 1, migracja 8: edycja grup (decyzje właściciela z 7.10.2026, D54–D56).
--  * kolor linii grupy wybiera właściciel; wszyscy widzą ten sam (D56; klucz z palety src/config/theme.ts);
--  * usunięcie grupy przez właściciela = kosz na private.tombstone_days() dni z przywróceniem (D54); w koszu
--    grupa nie przyjmuje zmian, a po terminie znika z całą zawartością (private.purge_deleted_groups, ADR 0004);
--  * przekazanie własności innemu dorosłemu (D55); role, usuwanie członków i imiona dzieci szły już przez
--    strażnika członkostw (owner/admin), więc tu tylko droga przekazania.

-- Klucze palety linii — jedno źródło prawdy: src/config/theme.ts (test kontraktowy).
create function private.group_colors() returns text[] language sql immutable as $$
  select array['blue','orange','green','violet','teal','pink','cyan','red']
$$;

alter table public.groups add column color text;
alter table public.groups add constraint groups_color_check check (color is null or color = any (private.group_colors()));
grant update (color) on public.groups to authenticated;
update private.sync_entities set patch_cols = '{name,color}' where entity = 'groups';

-- Zmiany grupy: kolor tylko owner; w koszu nic poza przywróceniem (deleted_at zmienia tylko private.set_group_trash).
create or replace function private.groups_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  if new.kind is distinct from old.kind then raise exception 'immutable_column:kind' using errcode = 'P0001'; end if;
  if (select auth.uid()) is not null then
    if new.deleted_at is distinct from old.deleted_at and current_setting('organizer.group_trash', true) is distinct from new.id::text then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    if old.deleted_at is not null and new.deleted_at is not null then
      raise exception 'deleted:group' using errcode = 'P0001';
    end if;
    if new.color is distinct from old.color and coalesce(private.my_role(new.id), '') <> 'owner' then
      raise exception 'forbidden:role' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- Grupa w koszu nie przyjmuje zmian (każdy zapis w grupie podbija jej wersję tutaj). Wyjątek: sprzątanie
-- serwerowe (usunięcie konta), które zaznacza to ustawieniem organizer.trash_ok.
create or replace function private.bump_group_version(g uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint; trashed boolean;
begin
  update public.groups set version = version + 1 where id = g returning version, deleted_at is not null into v, trashed;
  if v is null then raise exception 'group_not_found' using errcode = 'P0001'; end if;
  if trashed and coalesce(current_setting('organizer.trash_ok', true), '') <> 'on' then
    raise exception 'deleted:group' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- Usunięcie konta sprząta także grupy w koszu — przepuszczamy je przez blokadę zapisów. Przepustka trwa do końca
-- transakcji, bo po tym wyzwalaczu baza jeszcze zeruje user_id w członkostwach (ON DELETE SET NULL), co też
-- podbija wersję grupy (wykrył to test account_deletion). Transakcja usunięcia konta nie robi nic innego.
create or replace function private.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('organizer.trash_ok', 'on', true);
  perform private.delete_account_data(old.id);
  return old;
end $$;

create function private.set_group_trash(gid uuid, trash boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.groups;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into g from public.groups where id = gid for update;
  if g.id is null or coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if g.kind = 'personal' then raise exception 'forbidden:personal_group' using errcode = 'P0001'; end if;
  if not trash and g.deleted_at is not null and g.deleted_at < now() - make_interval(days => private.tombstone_days()) then
    raise exception 'deleted:expired' using errcode = 'P0001';
  end if;
  perform set_config('organizer.group_trash', gid::text, true);
  update public.groups set deleted_at = case when trash then coalesce(deleted_at, now()) else null end where id = gid;
  perform set_config('organizer.group_trash', '', true);
  perform realtime.send(jsonb_build_object('v', (select version from public.groups where id = gid)), 'poke', 'group:' || gid, true);
end $$;

create function private.transfer_ownership(gid uuid, to_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_member_id(gid); t public.group_members;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform 1 from public.groups where id = gid and deleted_at is null for update;
  if not found or coalesce(private.my_role(gid), '') <> 'owner' then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select * into t from public.group_members where member_id = to_member and group_id = gid and deleted_at is null;
  -- Nowy właściciel: dorosły z kontem (jak przy przejęciu grupy po usunięciu konta, D49).
  if t.member_id is null or t.user_id is null or t.role not in ('admin', 'member') then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  perform set_config('organizer.ownership_transfer', gid::text, true);
  update public.group_members set role = 'owner' where member_id = to_member;
  update public.group_members set role = 'admin' where member_id = me;
  perform set_config('organizer.ownership_transfer', '', true);
end $$;

-- ───────────────────────── wykonanie operacji (zastępuje wersję z migracji move_task) ─────────────────────────
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

  -- Grupa nie ma kolumny group_id — jej identyfikatorem jest id (błąd wykryty testem groups_edit: zmiana nazwy
  -- grupy przez sync_push zawsze kończyła się odrzuceniem „error:42703”).
  execute format('select %s from public.%I where %I = $1', case when ent = 'groups' then 'id' else 'group_id' end, ent, e.pk)
    into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

-- ───────────────────────── strażnik członkostw (zastępuje wersję z migracji invites) ─────────────────────────
-- Zmiana: przekazanie własności przez private.transfer_ownership.
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
  -- Przekazanie własności (private.transfer_ownership): jedyna droga nadania roli owner.
  if current_setting('organizer.ownership_transfer', true) = new.group_id::text then return new; end if;

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

create function public.delete_group(group_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.set_group_trash(group_id, true) $$;
create function public.restore_group(group_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.set_group_trash(group_id, false) $$;
create function public.transfer_ownership(group_id uuid, member_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.transfer_ownership(group_id, member_id) $$;

revoke all on all functions in schema private from public, anon;
revoke all on function public.delete_group(uuid), public.restore_group(uuid), public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.delete_group(uuid), public.restore_group(uuid), public.transfer_ownership(uuid, uuid),
  private.set_group_trash(uuid, boolean), private.transfer_ownership(uuid, uuid), private.group_colors() to authenticated;
