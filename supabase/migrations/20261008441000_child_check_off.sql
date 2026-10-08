-- Audyt 2 (8.10.2026): dziecko z kontem odhacza tylko swoje sprawy. Testy: supabase/tests/child_account.test.sql.
-- Decyzja koordynatora z 8.10.2026 (zasada właściciela — lepszy wariant, choć więcej pracy; PW-14 B): dziecko widzi
-- w Moich sprawach i Kalendarzu tylko swoje sprawy (src/domain/views/child.ts), więc i odhacza (albo cofa odhaczenie)
-- tylko je — także na ekranie listy, gdzie widzi całą listę grupy. „Swoje” — ta sama reguła co w child.ts:
--  * zadanie albo pozycja przypisane do dziecka;
--  * bez osoby (albo osoba usunięta z grupy, D132): podzadanie jego sprawy, zadanie przy wystąpieniu wydarzenia, które go
--    dotyczy (cała grupa bez innej osoby odpowiedzialnej, jest uczestnikiem, odpowiada za ten termin — D58, D66, M-94),
--    albo pozycja listy zakupów, za której zakupy odpowiada dziecko (dziś osoba zakupów to zawsze dorosły, D73 — więc
--    pozycje zakupów dziecko odhacza tylko te przypisane do niego).
-- Odmowa: 'forbidden:not_own'. Inne zmiany dziecka — 'forbidden:child' jak dotąd (D34).

-- Czy zadanie jest sprawą członka `me` (dziecka). Ograniczenie kroków po rodzicach jak w telefonie (8, effectiveDue).
create function private.child_owns_task(tid uuid, me uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  cur public.tasks;
  who uuid;
  e public.events;
  o public.event_overrides;
  resp uuid;
begin
  select * into cur from public.tasks where id = tid;
  for step in 1 .. 8 loop
    exit when cur.id is null;
    select m.member_id into who from public.group_members m where m.member_id = cur.assignee_member_id and m.deleted_at is null;
    if who is not null then return who = me; end if;
    if cur.event_id is not null then
      select * into e from public.events where id = cur.event_id and deleted_at is null;
      if e.id is null then return false; end if;
      select * into o from public.event_overrides where event_id = e.id and occurrence_date = cur.occurrence_date and deleted_at is null;
      resp := coalesce(o.responsible_member_id, case when coalesce(o.responsible_cleared, false) then null else e.responsible_member_id end);
      if resp is not null and not exists (select 1 from public.group_members m where m.member_id = resp and m.deleted_at is null) then resp := null; end if;
      if resp is null then
        return e.audience = 'group' or exists (select 1 from public.event_participants p where p.event_id = e.id and p.member_id = me and p.deleted_at is null);
      end if;
      return resp = me or (e.audience = 'members' and exists (select 1 from public.event_participants p where p.event_id = e.id and p.member_id = me and p.deleted_at is null));
    end if;
    if cur.parent_id is null then
      return exists (select 1 from public.lists l where l.id = cur.list_id and l.kind = 'shopping' and l.responsible_member_id = me);
    end if;
    select * into cur from public.tasks where id = cur.parent_id;
  end loop;
  return false;
end $$;

-- Zastępuje wersję z 20261008361000_member_departure.sql. Jedyna zmiana: odhaczenie przez dziecko tylko swoich spraw (wyżej).
create or replace function private.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_member_id(new.group_id);
  my_role text := private.my_role(new.group_id);
  l public.lists;
  p public.tasks;
begin
  if (select auth.uid()) is null then return new; end if;
  -- Sprzątanie po osobie, która wyszła albo wróciła (private.group_members_departure, migracja 20261008361000).
  if current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
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
    -- PW-14 B (decyzja koordynatora z 8.10.2026): dziecko odhacza tylko swoje sprawy (private.child_owns_task).
    if my_role = 'child' and new.completed_at is distinct from old.completed_at and not private.child_owns_task(old.id, me) then
      raise exception 'forbidden:not_own' using errcode = 'P0001';
    end if;
    -- Audyt 8.10.2026 (#1): nie przywracamy podzadania pod usuniętym rodzicem (najpierw rodzic — wraca razem z dziećmi).
    if old.deleted_at is not null and new.deleted_at is null and new.parent_id is not null
       and exists (select 1 from public.tasks x where x.id = new.parent_id and x.deleted_at is not null) then
      raise exception 'deleted:parent' using errcode = 'P0001';
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

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
