-- Audyt 3 (PK-12): dziecko z kontem — kto może dostać rolę „Dziecko” i dopisywanie zakupów przez dziecko.
-- Testy: supabase/tests/child_role_shopping.test.sql; model telefonu: src/domain/server-rules.ts (tests/db/rules-vs-sql).
--
-- 1. Decyzja Q6b A (N-42): rolę „Dziecko” dostaje tylko konto połączone kodem profilu dziecka (PW-14 B). Dotąd owner
--    mógł zmienić dowolnego dorosłego z kontem na dziecko — ta osoba nie mogła już sama wyjść z grupy (forbidden:child),
--    a jej listy „Tylko ja” stawały się tylko do odczytu. Teraz konto, którego nigdy nie łączono z profilem dziecka,
--    dostaje 'forbidden:role'. Połączone dziecko, które owner zmienił w członka („dorosło”), może wrócić do roli dziecka
--    (także paskiem „Cofnij” na telefonie).
--    Nowa kolumna group_members.child_linked_at: chwila połączenia profilu dziecka z kontem. Ustawia ją wyłącznie wyzwalacz
--    niżej (klient nie ma uprawnień do kolumny), telefon dostaje ją z wierszem i chowa wybór „Dziecko” przy pozostałych.
-- 2. Decyzja Q6d A (N-44): dziecko z kontem dopisuje produkty do list zakupów, które widzi (nastolatek dopisze „szampon”).
--    Tylko pozycja główna bez osoby, terminu, wydarzenia, powtarzania, notatki i odhaczenia — reszta zasad dziecka bez
--    zmian (D34: zadań nie dodaje, pozycji nie zmienia ani nie usuwa; odhacza tylko swoje sprawy).
--
-- Obiekty: kolumna public.group_members.child_linked_at; funkcja private.group_members_child_link i wyzwalacz
-- group_members_t_child_link (BEFORE INSERT OR UPDATE — po group_members_guard w kolejności nazw); private.tasks_guard
-- (zastępuje wersję z 20261008441000_child_check_off.sql). Stare telefony (build 21) nie wysyłają nowych pól — bez zmian
-- protokołu; nowa kolumna to dodatkowe pole wiersza w pobraniu.

alter table public.group_members add column child_linked_at timestamptz;

-- Profile już połączone z kontem (kod profilu wykorzystany — invites.member_id, migracja 20261008440000). Chwili
-- połączenia nie zapisywaliśmy; liczy się sam fakt.
update public.group_members m set child_linked_at = now()
  where m.user_id is not null
    and exists (select 1 from public.invites i where i.member_id = m.member_id and i.uses > 0);

create function private.group_members_child_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Połączenie profilu z kontem (jedyna droga zmiany user_id z NULL na konto — group_members_guard, kod profilu).
  if tg_op = 'UPDATE' and old.user_id is null and new.user_id is not null then
    new.child_linked_at := now();
  elsif (select auth.uid()) is not null then
    new.child_linked_at := case when tg_op = 'UPDATE' then old.child_linked_at end;
  end if;
  -- Q6b A: na dziecko zmienia się tylko konto, które kiedyś połączono z profilem dziecka. Bez auth.uid() (serwer,
  -- usunięcie konta, migracje) — bez zmian.
  if (select auth.uid()) is not null and tg_op = 'UPDATE' and new.role = 'child' and old.role <> 'child'
     and new.user_id is not null and old.child_linked_at is null then
    raise exception 'forbidden:role' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger group_members_t_child_link before insert or update on public.group_members
  for each row execute function private.group_members_child_link();

-- Zastępuje wersję z 20261008441000_child_check_off.sql. Jedyna zmiana: przy dodaniu dziecko (rola child) może dopisać
-- pozycję główną do listy zakupów (Q6d A) — warunek w gałęzi INSERT, po wczytaniu listy.
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
    new.created_by := me;
  end if;

  select * into l from public.lists where id = new.list_id;
  -- D34 z wyjątkiem Q6d A (audyt 3): dziecko dopisuje tylko produkt — pozycję główną listy zakupów, bez osoby, terminu,
  -- wydarzenia, serii, powtarzania, notatki i odhaczenia. Ten sam kod co dotąd przy każdym innym dodaniu.
  if tg_op = 'INSERT' and my_role = 'child'
     and not (l.kind is not distinct from 'shopping' and new.parent_id is null and new.assignee_member_id is null
              and new.deadline_mode = 'none' and new.due_date is null and new.due_time is null and new.start_date is null
              and new.completed_at is null and new.event_id is null and new.occurrence_date is null and new.series_id is null
              and new.repeat is null and new.note is null) then
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

revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
