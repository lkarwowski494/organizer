-- Audyt 3 (PK-07, Q16 A, N-123): dziecko z kontem tworzy następny termin swojego zadania powtarzanego (i kopie jego
-- podzadań), a przy cofnięciu odhaczenia zdejmuje go i przy ponownym przywraca — łańcuch nie zależy już od tego, czy
-- dorosły otworzy aplikację (dotąd kopię dokładał telefon dorosłego, missingRepeatOps, tylko przez 7 dni), a cofnięcie
-- nie zostawia dwóch otwartych terminów. Reszta zasad dziecka bez zmian (D34, PW-14 B, Q6d A).
-- Funkcje pomocnicze: 20261010070000_task_repeat_chain.sql. Testy: supabase/tests/task_repeat_chain.test.sql.
-- Plik po 20261010120000 (PK-12), bo ta migracja też definiuje strażnika; zgoda koordynatora z 9.10.2026.
-- Zastępuje: private.tasks_guard (20261010120000_child_role_shopping.sql) — dwie zmiany w gałęziach dziecka.

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
    -- D34: rola child może tylko odhaczać — z wyjątkiem Q16 A (audyt 3, N-123): następny termin swojego zadania
    -- powtarzanego dziecko zdejmuje przy cofnięciu odhaczenia i przywraca przy ponownym (private.child_repeat_update_ok).
    if my_role = 'child' and (to_jsonb(new) - array['completed_at', 'completed_by', 'version'])
                           is distinct from (to_jsonb(old) - array['completed_at', 'completed_by', 'version'])
       and not private.child_repeat_update_ok(new, old, me) then
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
    new.created_by := me;
  end if;

  select * into l from public.lists where id = new.list_id;
  -- D34 z wyjątkiem Q6d A (audyt 3): dziecko dopisuje tylko produkt — pozycję główną listy zakupów, bez osoby, terminu,
  -- wydarzenia, serii, powtarzania, notatki i odhaczenia. Ten sam kod co dotąd przy każdym innym dodaniu.
  if tg_op = 'INSERT' and my_role = 'child'
     and not (l.kind is not distinct from 'shopping' and new.parent_id is null and new.assignee_member_id is null
              and new.deadline_mode = 'none' and new.due_date is null and new.due_time is null and new.start_date is null
              and new.completed_at is null and new.event_id is null and new.occurrence_date is null and new.series_id is null
              and new.repeat is null and new.note is null)
     -- Q16 A (audyt 3, N-123): następny termin swojego zadania powtarzanego i kopie jego podzadań — jak robi je telefon.
     and not private.child_repeat_insert_ok(new, me) then
    raise exception 'forbidden:child' using errcode = 'P0001';
  end if;
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
