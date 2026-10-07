-- Etap 1, migracja 6: usunięcie konta (wymóg App Store) i kosz grup.
-- Decyzja właściciela D49 (7.10.2026):
--  * grupa, której właścicielem był usuwany użytkownik, przechodzi na dorosłego członka z najdłuższym
--    stażem w grupie, najpierw admina; dorosły = konto (user_id) z rolą admin/member (dziecko, także z kontem,
--    nie przejmuje grupy — D34);
--  * gdy takiej osoby nie ma, grupa trafia do kosza na private.tombstone_days() dni, potem jest usuwana
--    (ten sam kosz co dla list i zadań — jedna stała, config.sync.TOMBSTONE_DAYS);
--  * historia zmian zostaje, ale podpis i nazwa członka zmieniają się na private.deleted_user_label().
-- Grupa osobista i listy prywatne usuwanego (nikt poza nim ich nie widzi) są usuwane od razu / jak tombstones.
-- Uruchamia to wyzwalacz przed usunięciem wiersza auth.users, więc każda droga usunięcia konta
-- (funkcja serwerowa z auth.admin.deleteUser, panel Supabase) sprząta dane tak samo.

-- Jedno źródło prawdy dla podpisu: src/i18n/strings.pl.ts ('member.deleted'); pilnuje tego test kontraktowy.
create function private.deleted_user_label() returns text language sql immutable as $$ select 'Usunięty użytkownik'::text $$;

-- Twarde usunięcie całej grupy z zawartością (grupa osobista usuwanego konta, grupa po terminie w koszu).
create function private.hard_delete_group(g uuid) returns void
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
  delete from public.invites where group_id = g;
  delete from public.lists where group_id = g;
  delete from public.group_members where group_id = g;
  delete from public.groups where id = g;
end $$;

create function private.delete_account_data(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  label text := private.deleted_user_label();
  m record;
  heir uuid;
  members uuid[];
begin
  select coalesce(array_agg(member_id), '{}') into members from public.group_members where user_id = uid;

  -- Blokady grup w stałej kolejności (jak w sync_push), żeby równoległe zapisy nie dały zakleszczenia.
  for m in
    select gm.member_id, gm.group_id, gm.role, g.kind
    from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and gm.deleted_at is null and g.deleted_at is null
    order by gm.group_id
  loop
    if m.kind = 'personal' then
      perform private.hard_delete_group(m.group_id);
      continue;
    end if;
    perform 1 from public.groups where id = m.group_id for update;

    if m.role = 'owner' then
      select gm.member_id into heir from public.group_members gm
      where gm.group_id = m.group_id and gm.deleted_at is null and gm.user_id is not null
        and gm.user_id <> uid and gm.role in ('admin', 'member')
      order by (gm.role = 'admin') desc, gm.created_at, gm.member_id
      limit 1;
      if heir is null then
        update public.groups set deleted_at = now() where id = m.group_id;
      else
        update public.group_members set role = 'owner' where member_id = heir;
      end if;
    end if;

    -- Listy prywatne widział tylko on: idą do usuniętych (tombstone, potem purge_tombstones).
    update public.lists set deleted_at = now()
    where group_id = m.group_id and owner_member_id = m.member_id and visibility = 'private' and deleted_at is null;
    -- Linki zaproszeń, które wystawił, przestają działać.
    update public.invites set revoked_at = now()
    where group_id = m.group_id and created_by = m.member_id and revoked_at is null;
    update public.group_members
    set deleted_at = now(), role = case when role = 'owner' then 'member' else role end
    where member_id = m.member_id;
  end loop;

  -- Nazwa znika z członkostw (także dawnych, wcześniej opuszczonych grup) i z całej historii.
  -- Nowa wersja z licznika grupy, żeby telefony innych członków pobrały poprawione wiersze.
  update public.group_members set display_name = label, color = null
  where member_id = any (members) and (display_name, color) is distinct from (label, null);
  update public.activity a
  set actor_name = case when a.actor_member_id = any (members) then label else a.actor_name end,
      changes = case when a.entity = 'group_members' and a.entity_id = any (members) and a.changes ? 'display_name'
                     then jsonb_set(a.changes, '{display_name}', to_jsonb(array[label, label]))
                     else a.changes end,
      version = private.bump_group_version(a.group_id)
  where a.actor_member_id = any (members)
     or (a.entity = 'group_members' and a.entity_id = any (members) and a.changes ? 'display_name');

  delete from private.access_events where user_id = uid;
end $$;

create function private.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.delete_account_data(old.id);
  return old;
end $$;

create trigger on_auth_user_deleted before delete on auth.users
  for each row execute function private.on_auth_user_deleted();

-- Kosz: grupy usunięte dawniej niż tombstone_days() znikają razem z zawartością (zadanie cykliczne).
create function private.purge_deleted_groups() returns int
language plpgsql security definer set search_path = '' as $$
declare g uuid; n int := 0;
begin
  for g in
    select id from public.groups
    where deleted_at < now() - make_interval(days => private.tombstone_days())
    order by id
  loop
    perform private.hard_delete_group(g);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function private.deleted_user_label(), private.hard_delete_group(uuid),
  private.delete_account_data(uuid), private.on_auth_user_deleted(), private.purge_deleted_groups() from public, anon, authenticated;
grant execute on function private.purge_deleted_groups(), private.delete_account_data(uuid) to service_role;
