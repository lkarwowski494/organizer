-- Udostępnienie listy z kosza odrzucone (8.10.2026). Znalazł to test różnicowy sync-sim: osoba, której udostępniono
-- usuniętą listę ograniczoną, widziała ją przez RLS, ale telefon nigdy jej nie pobierał (sync_pull wysyła zakresy tylko
-- żywych list), więc widok telefonu i serwera się rozjeżdżały. Zastępuje wersję z 20261008280000_audit_fixes.sql.
create or replace function private.object_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.lists;
  revoking boolean := case when tg_op = 'UPDATE' then old.deleted_at is null and new.deleted_at is not null else false end;
begin
  select * into l from public.lists where id = new.scope_id;
  if l.id is null or l.group_id <> new.group_id then raise exception 'invalid_scope' using errcode = 'P0001'; end if;
  if not revoking and not exists (select 1 from public.group_members m where m.member_id = new.member_id
                 and m.group_id = new.group_id and m.deleted_at is null) then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  -- Nowe: nie udostępniamy listy z kosza (telefon i tak by jej nie pobrał — sync_pull pomija usunięte listy w zakresach).
  if not revoking and l.deleted_at is not null and (select auth.uid()) is not null then
    raise exception 'deleted:list' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null and pg_trigger_depth() = 1
     and l.owner_member_id is distinct from private.my_member_id(l.group_id) then
    raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.scope_id, new.member_id, new.scope_entity) is distinct from (old.scope_id, old.member_id, old.scope_entity) then
    raise exception 'immutable_column:scope' using errcode = 'P0001';
  end if;
  return new;
end $$;
