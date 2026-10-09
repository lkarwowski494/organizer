-- Audyt 3, PK-10, decyzja Q1 B (koordynator, 9.10.2026, zasada właściciela: lepsza opcja): usunięcie konta traktuje
-- zaproszenia jak odejście z grupy (Q7 A, migracja 20261010100000). Przestają działać zaproszenia osobiste usuniętej osoby
-- (kody profili dzieci, które wystawiła, i dawne linki z tokenem), a kod roli grupy — wspólny, często rozesłany przez kogoś
-- innego — działa dalej. Wcześniej usunięcie konta admina unieważniało kod, który właściciel wysłał np. babci.
-- Dane osobowe: invites.created_by to członkostwo (NOT NULL, klucz obcy do group_members). Członkostwo usuniętej osoby
-- zostaje tylko jako podpis „Usunięty użytkownik” bez konta (delete_account_data), ale i tak przepisujemy wystawiającego
-- wszystkich zaproszeń tej osoby w grupie (także unieważnionych) na bieżącego właściciela grupy — po usunięciu nic nie
-- łączy zaproszeń z jej członkostwem. Wartości null kolumna nie przyjmuje, a właściciel i tak widzi i odnawia kody roli.
-- Grupa bez następcy (sam usuwający i profile dzieci) idzie do kosza: jej zaproszenia są unieważniane i znikają razem
-- z grupą po tombstone_days() (hard_delete_group); wystawiającym zostaje podpis „Usunięty użytkownik”.
-- Zastępuje: private.delete_account_data (20261007110000_account_deletion), private.delete_account_trash
-- (20261010000000_account_trash_invites). Nowa: private.account_invites_handover. Testy:
-- supabase/tests/account_deletion_invites.test.sql.

create function private.account_invites_handover(gid uuid, mid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare heir uuid;
begin
  update public.invites set revoked_at = now()
    where group_id = gid and created_by = mid and revoked_at is null and (member_id is not null or kind <> 'code');
  -- Właściciel po przekazaniu grupy (wołający ustawił już następcę); sam usuwający się nie liczy.
  select member_id into heir from public.group_members
    where group_id = gid and role = 'owner' and deleted_at is null and member_id <> mid limit 1;
  if heir is null then
    update public.invites set revoked_at = now() where group_id = gid and created_by = mid and revoked_at is null;
  else
    update public.invites set created_by = heir where group_id = gid and created_by = mid;
  end if;
end $$;

create or replace function private.delete_account_data(uid uuid) returns void
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
    -- Zaproszenia (Q1 B): osobiste przestają działać, kod roli grupy zostaje u właściciela (private.account_invites_handover).
    perform private.account_invites_handover(m.group_id, m.member_id);
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

create or replace function private.delete_account_trash(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m record; heir uuid;
begin
  perform set_config('organizer.trash_ok', 'on', true);
  for m in
    select gm.member_id, gm.group_id, gm.role from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and gm.deleted_at is null and g.deleted_at is not null and g.kind = 'shared'
    order by gm.group_id
  loop
    perform 1 from public.groups where id = m.group_id for update;
    if m.role = 'owner' then
      select gm.member_id into heir from public.group_members gm
      where gm.group_id = m.group_id and gm.deleted_at is null and gm.user_id is not null
        and gm.user_id <> uid and gm.role in ('admin', 'member')
      order by (gm.role = 'admin') desc, gm.created_at, gm.member_id
      limit 1;
      if heir is not null then update public.group_members set role = 'owner' where member_id = heir; end if;
    end if;
    -- Zaproszenia: to samo co w delete_account_data (Q1 B).
    perform private.account_invites_handover(m.group_id, m.member_id);
    update public.group_members set deleted_at = now(), role = case when role = 'owner' then 'member' else role end
      where member_id = m.member_id;
  end loop;
  delete from private.join_attempts where user_id = uid;
end $$;

revoke all on function private.account_invites_handover(uuid, uuid) from public, anon, authenticated;
