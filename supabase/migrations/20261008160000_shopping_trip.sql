-- „Zakupy” na liście zakupów (D73, decyzja właściciela z 7.10.2026, ADR 0014): lista zakupów sama ma termin i osobę
-- odpowiedzialną i trafia do „Dotyczy mnie” jako „Zakupy: <nazwa>”. Odhaczenie zakupów czyści termin i osobę (robi to
-- telefon jednym patchem). We wspólnej grupie telefon wymaga osoby albo terminu (jak D68 dla zadań; strażnik w bazie
-- odrzucony z tego samego powodu: starsze buildy tworzą listy bez tych pól). Przekazanie (D70) obejmuje też listy.

alter table public.lists add column due_date date;
alter table public.lists add column due_time time;
alter table public.lists add column responsible_member_id uuid references public.group_members (member_id);
alter table public.lists add constraint lists_trip_only_shopping
  check (kind = 'shopping' or (due_date is null and due_time is null and responsible_member_id is null));
alter table public.lists add constraint lists_time_needs_date check (due_time is null or due_date is not null);

grant insert (due_date, due_time, responsible_member_id), update (due_date, due_time, responsible_member_id) on public.lists to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{due_date,due_time,responsible_member_id}',
       patch_cols = patch_cols || '{due_date,due_time,responsible_member_id}'
 where entity = 'lists';

-- Osoba odpowiedzialna za zakupy: aktywny dorosły tej grupy, który widzi listę.
create function private.list_responsible_guard() returns trigger
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
  -- Przy wstawianiu lista jeszcze nie istnieje; twórca-właściciel widzi ją zawsze, inni tylko przy widoczności „group”
  -- albo z listy dozwolonych osób (dodawanej później) — dlatego sprawdzenie widoczności tylko przy zmianie.
  if tg_op = 'UPDATE' and not private.member_can_see_list(new.responsible_member_id, new.id) then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger lists_a_guard_responsible before insert or update on public.lists
  for each row execute function private.list_responsible_guard();

-- Przekazanie zakupów (D70 rozszerzone o listy).
alter table public.handoffs drop constraint handoffs_entity_check;
alter table public.handoffs add constraint handoffs_entity_check check (entity in ('tasks', 'events', 'lists'));

create or replace function private.handoffs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  t public.tasks;
  e public.events;
  l public.lists;
  current_responsible uuid;
  o_id uuid;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    new.from_member := me;
    new.status := 'pending';
    new.closed := false;
    new.decided_at := null;
    if new.to_member = me then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.group_members m where m.member_id = new.to_member and m.group_id = new.group_id
                   and m.deleted_at is null and m.role <> 'child' and m.user_id is not null) then
      raise exception 'invalid_member' using errcode = 'P0001';
    end if;
    if new.entity = 'tasks' then
      select * into t from public.tasks where id = new.entity_id;
      if t.id is null or t.group_id <> new.group_id or t.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      if t.assignee_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, t.list_id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    elsif new.entity = 'lists' then
      select * into l from public.lists where id = new.entity_id;
      if l.id is null or l.group_id <> new.group_id or l.deleted_at is not null or l.kind <> 'shopping' then
        raise exception 'invalid_entity' using errcode = 'P0001';
      end if;
      if l.responsible_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, l.id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    else
      select * into e from public.events where id = new.entity_id;
      if e.id is null or e.group_id <> new.group_id or e.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      current_responsible := e.responsible_member_id;
      if new.occurrence_date is not null then
        select coalesce(o.responsible_member_id, e.responsible_member_id) into current_responsible
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = new.occurrence_date and o.deleted_at is null;
        current_responsible := coalesce(current_responsible, e.responsible_member_id);
      end if;
      if current_responsible is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array['status', 'closed', 'decided_at', 'version']) is distinct from (to_jsonb(old) - array['status', 'closed', 'decided_at', 'version']) then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  if new.closed is distinct from old.closed and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status is not distinct from old.status then return new; end if;
  if old.status <> 'pending' then raise exception 'invalid_value:status' using errcode = 'P0001'; end if;
  if new.status in ('accepted', 'declined') and me <> old.to_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status = 'cancelled' and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  new.decided_at := now();

  if new.status = 'accepted' then
    if old.entity = 'tasks' then
      update public.tasks set assignee_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    elsif old.entity = 'lists' then
      update public.lists set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    elsif old.occurrence_date is null then
      update public.events set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    else
      select id into o_id from public.event_overrides where event_id = old.entity_id and occurrence_date = old.occurrence_date;
      if o_id is null then
        insert into public.event_overrides (id, event_id, group_id, occurrence_date, responsible_member_id)
          values (gen_random_uuid(), old.entity_id, old.group_id, old.occurrence_date, old.to_member);
      else
        update public.event_overrides set responsible_member_id = old.to_member, deleted_at = null where id = o_id;
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
