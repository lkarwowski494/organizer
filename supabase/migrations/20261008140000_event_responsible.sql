-- Kto zawozi / odpowiada za wydarzenie (D66, decyzja właściciela z 7.10.2026, ADR 0011): dorosły z grupy. Ustawiony —
-- wydarzenie trafia do „Dotyczy mnie” tylko u niego (i dorosłych uczestników); pusty — jak dotąd (D58). Wyjątek
-- jednego wystąpienia może wskazać inną osobę („tylko to”). Pustą wartość w wyjątku telefon czyta jako „bez zmiany”.
alter table public.events add column responsible_member_id uuid references public.group_members (member_id);
alter table public.event_overrides add column responsible_member_id uuid references public.group_members (member_id);

grant insert (responsible_member_id), update (responsible_member_id) on public.events, public.event_overrides to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{responsible_member_id}', patch_cols = patch_cols || '{responsible_member_id}'
 where entity in ('events', 'event_overrides');

-- Osoba odpowiedzialna: aktywny dorosły tej samej grupy (dziecko nie zawozi).
create function private.event_responsible_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.responsible_member_id is null
     or new.responsible_member_id is not distinct from (case when tg_op = 'UPDATE' then old.responsible_member_id end) then
    return new;
  end if;
  if not exists (select 1 from public.group_members m where m.member_id = new.responsible_member_id and m.group_id = new.group_id
                 and m.deleted_at is null and m.role <> 'child') then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger events_a_guard_responsible before insert or update on public.events
  for each row execute function private.event_responsible_guard();
create trigger event_overrides_a_guard_responsible before insert or update on public.event_overrides
  for each row execute function private.event_responsible_guard();

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
