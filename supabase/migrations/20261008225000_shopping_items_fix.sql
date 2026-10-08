-- Naprawa (D87): pozycje list zakupów są zadaniami (tasks) na liście rodzaju „shopping”, ale strażnik zadań od
-- pierwszej migracji (20261006120100) przyjmował tylko listy rodzaju „tasks” — serwer odrzucał każdą pozycję zakupów
-- (invalid_list:kind), a telefon wycofywał ją przy pobraniu. Ta sama funkcja co w 20261007100000_move_task; warunek
-- rodzaju listy zostaje tylko dla przenosin (zadanie nie przechodzi na listę zakupów ani odwrotnie). Test: supabase/tests/shopping_extras.test.sql i tests/db/phones-vs-sql.test.ts.

create or replace function private.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_member_id(new.group_id);
  my_role text := private.my_role(new.group_id);
  l public.lists;
  p public.tasks;
begin
  if (select auth.uid()) is null then return new; end if;
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if tg_op = 'UPDATE' then
    -- Przeniesienie (rodzic, lista, głębokość) tylko przez private.move_task: ustawia flagę z id właśnie
    -- przenoszonego wiersza, po sprawdzeniu cykli i głębokości pod blokadą grupy.
    if current_setting('organizer.moving_task', true) is distinct from new.id::text then
      if new.list_id is distinct from old.list_id then raise exception 'immutable_column:list_id' using errcode = 'P0001'; end if;
      if new.parent_id is distinct from old.parent_id then raise exception 'immutable_column:parent_id' using errcode = 'P0001'; end if;
      new.depth := old.depth;
    end if;
    -- D34: rola child może tylko odhaczać.
    if my_role = 'child' and (to_jsonb(new) - array['completed_at', 'completed_by', 'version'])
                           is distinct from (to_jsonb(old) - array['completed_at', 'completed_by', 'version']) then
      raise exception 'forbidden:child' using errcode = 'P0001';
    end if;
  else
    if my_role = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
    new.created_by := me;
  end if;

  select * into l from public.lists where id = new.list_id;
  if l.id is null or l.group_id <> new.group_id then raise exception 'invalid_list' using errcode = 'P0001'; end if;
  -- Przenosiny tylko w obrębie rodzaju listy (zadanie ↔ pozycja zakupów to różne rzeczy).
  if tg_op = 'UPDATE' and new.list_id is distinct from old.list_id
     and l.kind is distinct from (select o.kind from public.lists o where o.id = old.list_id) then
    raise exception 'invalid_list:kind' using errcode = 'P0001';
  end if;
  if l.deleted_at is not null and new.deleted_at is null then raise exception 'deleted:list' using errcode = 'P0001'; end if;
  if not private.can_see_list(l.id) then raise exception 'forbidden' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    if new.parent_id is null then
      new.depth := 0;
    else
      select * into p from public.tasks where id = new.parent_id;
      if p.id is null or p.list_id <> new.list_id then raise exception 'invalid_parent' using errcode = 'P0001'; end if;
      if p.deleted_at is not null then raise exception 'deleted:parent' using errcode = 'P0001'; end if;
      new.depth := p.depth + 1;
      if new.depth > private.max_task_depth() then raise exception 'depth_exceeded' using errcode = 'P0001'; end if;
    end if;
  end if;

  if (new.assignee_member_id is distinct from (case when tg_op = 'UPDATE' then old.assignee_member_id end)
       or new.list_id is distinct from (case when tg_op = 'UPDATE' then old.list_id end))
     and new.assignee_member_id is not null
     and not private.member_can_see_list(new.assignee_member_id, new.list_id) then
    -- Przypisanie osoby, która nie widzi listy, ujawniłoby jej ukryte zadanie (np. w powiadomieniu).
    raise exception 'invalid_assignee' using errcode = 'P0001';
  end if;

  if new.completed_at is distinct from (case when tg_op = 'UPDATE' then old.completed_at end) then
    new.completed_by := case when new.completed_at is null then null else me end;
  elsif tg_op = 'UPDATE' then
    new.completed_by := old.completed_by;
  else
    new.completed_by := null;
  end if;
  return new;
end $$;
