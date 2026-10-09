-- Audyt 3, N-14: usunięcie konta, gdy grupa jest w koszu, unieważnia zaproszenia wystawione przez to konto — tak samo
-- jak private.delete_account_data (20261007110000) dla grup poza koszem i jak obiecuje polityka prywatności. Wcześniej
-- po przywróceniu grupy przez następcę obca osoba dołączała kodem usuniętej osoby.
-- Reszta funkcji bez zmian względem 20261008480000_retention.sql (create or replace zachowuje uprawnienia: tylko serwer).
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
    -- Zaproszenia, które wystawił, przestają działać (to samo co w delete_account_data).
    update public.invites set revoked_at = now()
    where group_id = m.group_id and created_by = m.member_id and revoked_at is null;
    update public.group_members set deleted_at = now(), role = case when role = 'owner' then 'member' else role end
      where member_id = m.member_id;
  end loop;
  delete from private.join_attempts where user_id = uid;
end $$;
