-- Audyt 2 (8.10.2026): wyjście z grupy i powrót. Testy: supabase/tests/member_departure.test.sql.
-- Gdy osoba wychodzi z grupy albo ktoś ją usuwa (deleted_at członkostwa), w tej samej transakcji:
--  * jej oczekujące przekazania (od niej i do niej) są anulowane (M-232, R-34) — nikt by ich nie przyjął;
--  * jej listy „Tylko ja” w tej grupie idą do kosza z datą wyjścia (decyzja właściciela z 8.10.2026, PW-43 A) —
--    po private.tombstone_days() dniach usuwa je zwykłe czyszczenie kosza (purge_tombstones), a gdy osoba wróci w tym
--    czasie (zaproszeniem albo przywrócona przez owner/admin, D165), wracają razem z nią;
--  * gdy usunął ją ktoś inny (group_members.removed_at, migracja 20261008360000), zaproszenia wystawione przez nią przestają
--    działać (decyzja właściciela z 8.10.2026, PW-6 A). Samodzielne wyjście — jak dotąd.
-- Przy powrocie nie przywracamy przekazań, unieważnionych zaproszeń ani dostępu do list „wybrane osoby”.
-- Zmiany cudzych wierszy (lista prywatna osoby, która wyszła, jej przekazania) wykonuje serwer: strażnicy list, zadań
-- i przekazań przepuszczają zapis z flagą organizer.member_cleanup = ta grupa (ustawia ją tylko ten wyzwalacz).

create function private.group_members_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    update public.handoffs set status = 'cancelled', decided_at = now()
      where group_id = new.group_id and status = 'pending' and (from_member = new.member_id or to_member = new.member_id);
    update public.lists set deleted_at = new.deleted_at
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at is null;
    perform set_config('organizer.member_cleanup', '', true);
    if new.removed_at is not null then
      update public.invites set revoked_at = now() where created_by = new.member_id and revoked_at is null;
    end if;
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    -- Listy prywatne zmienia tylko ich właściciel, a po wyjściu nikt ich nie widzi: wszystko, co trafiło do kosza od chwili
    -- wyjścia, trafiło tam z powodu wyjścia (wcześniej usunięte przez tę osobę zostają w koszu).
    update public.lists set deleted_at = null
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at >= old.deleted_at;
    perform set_config('organizer.member_cleanup', '', true);
  end if;
  return null;
end $$;

create trigger group_members_y_departure after update of deleted_at on public.group_members
  for each row execute function private.group_members_departure();

-- ───────────────────────── Strażnicy: zapis serwera przy wyjściu i powrocie ─────────────────────────
-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Jedyna zmiana: flaga organizer.member_cleanup (wyżej).
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
  -- Sprzątanie po osobie, która wyszła albo wróciła (private.group_members_departure, migracja 20261008361000).
  if current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
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
    -- Audyt 8.10.2026 (#8): odpowiedzialność nadal u nadawcy? (ta sama reguła co przy tworzeniu)
    if old.entity = 'tasks' then
      select assignee_member_id into current_responsible from public.tasks where id = old.entity_id;
    elsif old.entity = 'lists' then
      select responsible_member_id into current_responsible from public.lists where id = old.entity_id;
    else
      select * into e from public.events where id = old.entity_id;
      current_responsible := e.responsible_member_id;
      if old.occurrence_date is not null then
        select coalesce(o.responsible_member_id, e.responsible_member_id) into current_responsible
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = old.occurrence_date and o.deleted_at is null;
        current_responsible := coalesce(current_responsible, e.responsible_member_id);
      end if;
    end if;
    if current_responsible is distinct from old.from_member then raise exception 'stale' using errcode = 'P0001'; end if;

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


-- Zastępuje wersję z 20261006120100_lists_tasks.sql. Jedyna zmiana: flaga organizer.member_cleanup (wyżej).
create or replace function private.lists_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.my_member_id(new.group_id);
begin
  if (select auth.uid()) is null then return new; end if;
  -- Sprzątanie po osobie, która wyszła albo wróciła (private.group_members_departure, migracja 20261008361000).
  if current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    new.owner_member_id := me;
  else
    if new.kind is distinct from old.kind then raise exception 'immutable_column:kind' using errcode = 'P0001'; end if;
    if new.owner_member_id is distinct from old.owner_member_id then
      raise exception 'immutable_column:owner_member_id' using errcode = 'P0001';
    end if;
    if new.visibility is distinct from old.visibility and old.owner_member_id <> me then
      raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;


-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Jedyna zmiana: flaga organizer.member_cleanup (wyżej).
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


-- ───────────────────────── Dane sprzed migracji ─────────────────────────
-- Osoby, które już wyszły albo zostały usunięte: ich oczekujące przekazania — anulowane; ich listy „Tylko ja” — do kosza
-- od dziś (nie od dnia wyjścia: inaczej najbliższe czyszczenie usunęłoby od razu listy osób, które wyszły ponad
-- tombstone_days() dni temu, bez szansy powrotu). Powrót zwraca je, bo trafiły do kosza po wyjściu (warunek wyżej).
do $$
begin
  perform set_config('organizer.trash_ok', 'on', true);
  update public.handoffs h set status = 'cancelled', decided_at = now()
    where h.status = 'pending' and exists (select 1 from public.group_members m
      where m.member_id in (h.from_member, h.to_member) and m.deleted_at is not null);
  update public.lists l set deleted_at = now()
    where l.visibility = 'private' and l.deleted_at is null and exists (select 1 from public.group_members m
      where m.member_id = l.owner_member_id and m.deleted_at is not null);
  perform set_config('organizer.trash_ok', '', true);
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
