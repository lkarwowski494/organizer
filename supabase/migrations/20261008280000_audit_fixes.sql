-- Poprawki z audytu serwera (audyt 8.10.2026). Każdą lukę odtwarza test supabase/tests/audit_fixes.test.sql.
-- Funkcje poniżej zastępują swoje najnowsze wersje (źródło wskazane przy każdej).
--  #1  przywrócenie podzadania usuniętego rodzica (purge padał na kluczu obcym dla wszystkich grup);
--  #2  move_task dawał głębokość > MAX_TASK_DEPTH (usunięci potomkowie), purge / hard_delete_group / usunięcie konta padały;
--  #3  osoba odpowiedzialna za zakupy bez dostępu do listy, nazwa ukrytej listy w powiadomieniu;
--  #5  admin/owner przywracał konto, które wyszło z grupy, bez zaproszenia;
--  #7  deleted_at z telefonu (cofnięta data omijała 30-dniowy kosz);
--  #8  przyjęcie nieaktualnego przekazania nadpisywało późniejsze przypisanie;
--  #10 byłego członka nie dało się zdjąć z listy ograniczonej ani z uczestników; wyjście z grupy nie odbierało dostępu do list;
--  #12 limity prób dołączenia liczone bez blokady (równoległe próby je omijały).

-- ───────────────────────── #7 (audyt 8.10.2026): znacznik usunięcia ustawia serwer ─────────────────────────
-- Zastępuje wersję z 20261006120000_core.sql. GRANT update(deleted_at) zostaje (apply_op działa jako SECURITY INVOKER),
-- ale wartość z żądania klienta jest ignorowana: przejście null → data dostaje clock_timestamp(), a zmiana daty już
-- usuniętego wiersza jest odrzucana. Bez zmian: kaskady (zapisy z wnętrza wyzwalaczy, pg_trigger_depth() > 1 — muszą
-- przenieść dokładnie znacznik rodzica, bo po nim przywraca się razem usunięte) i kontekst serwerowy bez auth.uid().
create or replace function private.stamp_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.group_id is distinct from old.group_id then
      raise exception 'immutable_column:group_id' using errcode = 'P0001';
    end if;
    if (select auth.uid()) is not null and pg_trigger_depth() = 1 then
      if old.deleted_at is null and new.deleted_at is not null then
        new.deleted_at := clock_timestamp();
      elsif old.deleted_at is not null and new.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
        raise exception 'immutable_column:deleted_at' using errcode = 'P0001';
      end if;
    end if;
  end if;
  new.version := private.bump_group_version(new.group_id);
  return new;
end $$;

-- ───────────────────────── #1 (audyt 8.10.2026): przywrócenie pod usuniętym rodzicem ─────────────────────────
-- Zastępuje wersję z 20261008225000_shopping_items_fix.sql. Nowe: przywrócenie zadania, którego rodzic jest usunięty,
-- jest odrzucane ('deleted:parent', jak przy tworzeniu) — inaczej żywe dziecko blokowało czyszczenie rodzica.
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

-- ───────────────────────── #2 (audyt 8.10.2026): głębokość zadań ─────────────────────────
-- Zastępuje wersję z 20261007100000_move_task.sql. Wysokość poddrzewa liczona po WSZYSTKICH potomkach, także usuniętych:
-- przenoszeni są wszyscy (przywrócenie z kosza wraca na swoje miejsce), więc wszyscy muszą zmieścić się w MAX_TASK_DEPTH.
-- Odrzucona alternatywa: przenosić tylko żywych — usunięci zostaliby pod rodzicem z innej listy.
create or replace function private.move_task(tid uuid, new_parent uuid, new_list uuid, new_sort text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  p public.tasks;
  target_list uuid;
  height int;
  new_depth int;
  r record;
begin
  select * into t from public.tasks where id = tid;
  if t.id is null or not private.can_see_list(t.list_id) then raise exception 'not_found' using errcode = 'P0001'; end if;
  -- Blokada wiersza grupy (ta sama co przy podbijaniu wersji, D32): przeniesienia w grupie idą po kolei.
  perform 1 from public.groups where id = t.group_id for update;
  select * into t from public.tasks where id = tid; -- stan po uzyskaniu blokady
  if coalesce(private.my_role(t.group_id), '') not in ('owner', 'admin', 'member') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if t.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;

  if new_parent is not null then
    select * into p from public.tasks where id = new_parent;
    if p.id is null or p.group_id <> t.group_id or not private.can_see_list(p.list_id) then
      raise exception 'invalid_parent' using errcode = 'P0001';
    end if;
    if p.deleted_at is not null then raise exception 'deleted:parent' using errcode = 'P0001'; end if;
    if new_list is not null and new_list <> p.list_id then raise exception 'invalid_parent' using errcode = 'P0001'; end if;
    target_list := p.list_id;
    -- Cykl: nowy rodzic nie może być tym zadaniem ani jego potomkiem.
    if exists (
      with recursive anc as (
        select id, parent_id from public.tasks where id = new_parent
        union all select x.id, x.parent_id from public.tasks x join anc on x.id = anc.parent_id
      ) select 1 from anc where id = tid
    ) then raise exception 'cycle' using errcode = 'P0001'; end if;
    new_depth := p.depth + 1;
  else
    target_list := coalesce(new_list, t.list_id);
    new_depth := 0;
  end if;

  -- Wysokość poddrzewa (0 = bez dzieci), po wszystkich potomkach (audyt 8.10.2026, #2).
  with recursive sub as (
    select id, 0 as h from public.tasks where id = tid
    union all select x.id, sub.h + 1 from public.tasks x join sub on x.parent_id = sub.id
  ) select max(h) into height from sub;
  if new_depth + height > private.max_task_depth() then raise exception 'depth_exceeded' using errcode = 'P0001'; end if;

  -- Korzeń: rodzic, lista, głębokość (i opcjonalnie kolejność); potem potomkowie: lista i głębokość.
  perform set_config('organizer.moving_task', tid::text, true);
  update public.tasks set parent_id = new_parent, list_id = target_list, depth = new_depth,
                          sort_key = coalesce(new_sort, sort_key)
    where id = tid;
  for r in
    with recursive sub as (
      select x.id, new_depth + 1 as d from public.tasks x where x.parent_id = tid
      union all select x.id, sub.d + 1 from public.tasks x join sub on x.parent_id = sub.id
    ) select id, d from sub order by d
  loop
    perform set_config('organizer.moving_task', r.id::text, true);
    update public.tasks set list_id = target_list, depth = r.d where id = r.id;
  end loop;
  perform set_config('organizer.moving_task', '', true);
  return t.group_id;
end $$;

-- Naprawa danych sprzed poprawki: zadanie głębiej niż MAX_TASK_DEPTH przechodzi pod przodka z poziomu MAX_TASK_DEPTH − 1
-- (spłaszczenie najgłębszych poziomów; nic nie ginie). Kontekst serwerowy, więc strażnicy przepuszczają, a wersje rosną
-- (telefony pobiorą poprawione wiersze); organizer.trash_ok — także w grupach w koszu. Zwraca liczbę poprawionych.
create function private.repair_task_depth() returns int
language plpgsql security definer set search_path = '' as $$
declare m int := private.max_task_depth(); n int;
begin
  perform set_config('organizer.trash_ok', 'on', true);
  with recursive anc as (
    select t.id as tid, t.parent_id as aid from public.tasks t where t.depth > m
    union all
    select anc.tid, x.parent_id from anc join public.tasks x on x.id = anc.aid where x.depth > m - 1
  ), target as (
    select anc.tid, anc.aid from anc join public.tasks a on a.id = anc.aid where a.depth = m - 1
  )
  update public.tasks t set parent_id = target.aid, depth = m from target where t.id = target.tid;
  get diagnostics n = row_count;
  perform set_config('organizer.trash_ok', '', true);
  return n;
end $$;

-- Ograniczenie głębokości w samej tabeli. Najpierw NOT VALID (dodanie nie skanuje tabeli, a w produkcji mogą być wiersze
-- z błędu #2), potem naprawa i walidacja — po naprawie żaden wiersz nie łamie warunku, więc VALIDATE przechodzi.
alter table public.tasks add constraint tasks_depth_range check (depth >= 0 and depth <= private.max_task_depth()) not valid;
select private.repair_task_depth();
alter table public.tasks validate constraint tasks_depth_range;

-- ───────────────────────── #1, #2 (audyt 8.10.2026): czyszczenie kosza ─────────────────────────
-- Zastępuje wersję z 20261008270000_event_rsvps.sql. Zmiany:
--  * każda grupa we własnej podtransakcji: błąd jednej (np. stare dane) nie blokuje pozostałych; zostaje ostrzeżenie
--    w logu bazy (raise warning — widoczne w Supabase Logs / cron.job_run_details);
--  * zadania jednym poleceniem, bez pętli po głębokości (klucz obcy parent_id sprawdza się na końcu polecenia), i tylko
--    takie, pod którymi nie ma wiersza, który zostaje (żywego albo usuniętego później) — klucz obcy zawsze przejdzie.
create or replace function private.purge_tombstones() returns int
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  total int := 0;
  n int;
  k int;
  g uuid;
  ids uuid[];
begin
  for g in select id from public.groups order by id loop
    begin
      perform 1 from public.groups where id = g for update;
      n := 0;
      with recursive keep as (
        select t.id, t.parent_id from public.tasks t
        where t.group_id = g and (t.deleted_at is null or t.deleted_at >= horizon)
        union
        select x.id, x.parent_id from public.tasks x join keep on x.id = keep.parent_id
      )
      select coalesce(array_agg(t.id), '{}') into ids from public.tasks t
      where t.group_id = g and t.deleted_at < horizon and t.id not in (select keep.id from keep);
      delete from public.activity a where a.entity = 'tasks' and a.entity_id = any (ids);
      delete from public.tasks where id = any (ids);
      get diagnostics k = row_count; n := n + k;
      delete from public.object_members where group_id = g and deleted_at < horizon;
      get diagnostics k = row_count; n := n + k;
      -- Definicje stałych zadań: usunięte i bez kopii (kopia wskazuje definicję kluczem obcym).
      delete from public.event_task_series s where s.group_id = g and s.deleted_at < horizon
        and not exists (select 1 from public.tasks t where t.series_id = s.id);
      get diagnostics k = row_count; n := n + k;
      delete from public.lists l where l.group_id = g and l.deleted_at < horizon
        and not exists (select 1 from public.tasks t where t.list_id = l.id)
        and not exists (select 1 from public.event_task_series s where s.list_id = l.id);
      get diagnostics k = row_count; n := n + k;
      delete from public.event_overrides o where o.group_id = g
        and (o.deleted_at < horizon or exists (select 1 from public.events e where e.id = o.event_id and e.deleted_at < horizon));
      get diagnostics k = row_count; n := n + k;
      -- Odpowiedzi (D124): usunięte albo przy wydarzeniu z kosza.
      delete from public.event_rsvps r where r.group_id = g
        and (r.deleted_at < horizon or exists (select 1 from public.events e where e.id = r.event_id and e.deleted_at < horizon));
      get diagnostics k = row_count; n := n + k;
      delete from public.event_participants p where p.group_id = g
        and (p.deleted_at < horizon or exists (select 1 from public.events e where e.id = p.event_id and e.deleted_at < horizon));
      get diagnostics k = row_count; n := n + k;
      delete from public.activity a using public.events e
        where a.entity = 'events' and a.entity_id = e.id and e.group_id = g and e.deleted_at < horizon
        and not exists (select 1 from public.tasks t where t.event_id = e.id)
        and not exists (select 1 from public.event_task_series s where s.event_id = e.id);
      -- Seria zostaje, dopóki wskazuje na nią zadanie albo definicja (klucze obce); zniknie, gdy one znikną.
      delete from public.events e where e.group_id = g and e.deleted_at < horizon
        and not exists (select 1 from public.event_overrides o where o.event_id = e.id)
        and not exists (select 1 from public.event_participants p where p.event_id = e.id)
        and not exists (select 1 from public.event_rsvps r where r.event_id = e.id)
        and not exists (select 1 from public.tasks t where t.event_id = e.id)
        and not exists (select 1 from public.event_task_series s where s.event_id = e.id);
      get diagnostics k = row_count; n := n + k;
      if n > 0 then update public.groups set purged_version = version where id = g; end if;
      total := total + n;
    exception when others then
      raise warning 'purge_tombstones: grupa % pominięta: % (%)', g, sqlerrm, sqlstate;
    end;
  end loop;
  return total;
end $$;

-- Zastępuje wersję z 20261008270000_event_rsvps.sql: zadania jednym poleceniem zamiast pętli po głębokości (#2).
create or replace function private.hard_delete_group(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups where id = g for update;
  delete from public.activity where group_id = g;
  delete from public.handoffs where group_id = g;
  -- Jedno polecenie: klucz obcy parent_id (NO ACTION) sprawdza się na końcu polecenia, więc głębokość nie ma znaczenia.
  delete from public.tasks where group_id = g;
  delete from public.object_members where group_id = g;
  delete from public.event_task_series where group_id = g;
  delete from public.event_rsvps where group_id = g;
  delete from public.event_overrides where group_id = g;
  delete from public.event_participants where group_id = g;
  delete from public.events where group_id = g;
  delete from public.invites where group_id = g;
  delete from public.lists where group_id = g;
  delete from public.group_members where group_id = g;
  delete from public.groups where id = g;
end $$;

-- Zastępuje wersję z 20261007110000_account_deletion.sql: każda grupa z kosza we własnej podtransakcji (jak purge_tombstones).
create or replace function private.purge_deleted_groups() returns int
language plpgsql security definer set search_path = '' as $$
declare g uuid; n int := 0;
begin
  for g in
    select id from public.groups
    where deleted_at < now() - make_interval(days => private.tombstone_days())
    order by id
  loop
    begin
      perform private.hard_delete_group(g);
      n := n + 1;
    exception when others then
      raise warning 'purge_deleted_groups: grupa % pominięta: % (%)', g, sqlerrm, sqlstate;
    end;
  end loop;
  return n;
end $$;

-- ───────────────────────── #3 (audyt 8.10.2026): osoba odpowiedzialna za zakupy widzi listę ─────────────────────────
-- Zastępuje wersję z 20261008160000_shopping_trip.sql. Przed zapisem zostaje tylko „aktywny dorosły tej grupy”;
-- widoczność sprawdza wyzwalacz PO zapisie, na nowym stanie wiersza (przy wstawieniu wiersz już istnieje, a zmiana
-- widoczności i osoby w jednym patchu jest oceniana po zmianie). Lista ograniczona: najpierw dostęp (grant_scope), potem osoba.
create or replace function private.list_responsible_guard() returns trigger
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

create function private.list_responsible_visible() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.responsible_member_id is not null
     and (new.responsible_member_id is distinct from (case when tg_op = 'UPDATE' then old.responsible_member_id end)
          or new.visibility is distinct from (case when tg_op = 'UPDATE' then old.visibility end))
     and not private.member_can_see_list(new.responsible_member_id, new.id) then
    raise exception 'invalid_member' using errcode = 'P0001';
  end if;
  return null;
end $$;

create trigger lists_e_responsible_visible after insert or update on public.lists
  for each row execute function private.list_responsible_visible();

-- Zastępuje wersję z 20261008240000_event_push.sql. Nowe: zadanie i zakupy — tylko gdy odbiorca widzi listę (#3).
create or replace function private.assignment_push_claim(p_activity uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.activity;
  col text;
  target_member uuid;
  target uuid;
  actor_name text;
  title text;
  body text;
begin
  select * into a from public.activity where id = p_activity;
  if a.id is null or a.created_at < now() - make_interval(hours => p_max_age_h) then return null; end if;
  col := case a.entity when 'tasks' then 'assignee_member_id' when 'lists' then 'responsible_member_id'
                       when 'events' then 'responsible_member_id' when 'event_overrides' then 'responsible_member_id' end;
  if col is null or not (a.changes ? col) then return null; end if;
  target_member := nullif(a.changes -> col ->> 1, '')::uuid;
  if target_member is null then return null; end if;
  if not exists (select 1 from public.group_members where member_id = a.actor_member_id and user_id = p_user) then return null; end if;
  select user_id into target from public.group_members where member_id = target_member and deleted_at is null;
  if target is null or target = p_user then return null; end if;
  -- Audyt 8.10.2026 (#3): treść powiadomienia (tytuł zadania, nazwa listy) tylko dla osoby, która widzi listę.
  if a.entity = 'tasks' and not exists (select 1 from public.tasks t where t.id = a.entity_id
                                         and private.member_can_see_list(target_member, t.list_id)) then
    return null;
  end if;
  if a.entity = 'lists' and not private.member_can_see_list(target_member, a.entity_id) then return null; end if;
  if exists (select 1 from public.push_mutes where user_id = target and group_id = a.group_id) then return null; end if;
  insert into private.push_log (key) values ('assign|' || a.id) on conflict do nothing;
  if not found then return null; end if;
  select display_name into actor_name from public.group_members where member_id = a.actor_member_id;
  if a.entity = 'tasks' then
    title := coalesce(actor_name, '') || ' przypisuje Ci zadanie';
    body := (select t.title from public.tasks t where t.id = a.entity_id);
  elsif a.entity = 'lists' then
    title := coalesce(actor_name, '') || ' prosi Cię o zakupy';
    body := 'Zakupy: ' || (select l.name from public.lists l where l.id = a.entity_id);
  elsif a.entity = 'events' then
    -- Cała seria albo pojedyncze wydarzenie: nazwa, przy jednorazowym także dzień.
    title := coalesce(actor_name, '') || ': odpowiadasz za wydarzenie';
    body := (select e.title || case when e.rrule is null then ' · ' || to_char(e.start_date, 'DD.MM') else '' end
             from public.events e where e.id = a.entity_id);
  else
    -- Jeden termin serii (wyjątek): nazwa (zmieniona albo z serii) i dzień tego terminu.
    title := coalesce(actor_name, '') || ': odpowiadasz za wydarzenie';
    body := (select coalesce(o.title, e.title) || ' · ' || to_char(coalesce(o.start_date, o.occurrence_date), 'DD.MM')
             from public.event_overrides o join public.events e on e.id = o.event_id where o.id = a.entity_id);
  end if;
  return jsonb_build_object(
    'title', title,
    'body', coalesce(body, ''),
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb));
end $$;

-- Zastępuje wersję z 20261008170000_push.sql. Nowe: przekazanie zadania / zakupów — tylko gdy adresat widzi listę (#3).
create or replace function private.handoff_push_claim(p_handoff uuid, p_user uuid, p_max_age_h int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h public.handoffs;
  caller uuid;
  target_member uuid;
  target uuid;
  other_name text;
  item text;
  title text;
  body text;
begin
  select * into h from public.handoffs where id = p_handoff for update;
  if h.id is null or h.status = 'cancelled' or h.push_sent_status is not distinct from h.status
     or coalesce(h.decided_at, h.created_at) < now() - make_interval(hours => p_max_age_h) then
    return null;
  end if;
  caller := case when h.status = 'pending' then h.from_member else h.to_member end;
  if not exists (select 1 from public.group_members where member_id = caller and user_id = p_user) then return null; end if;
  target_member := case when h.status = 'pending' then h.to_member else h.from_member end;
  -- Audyt 8.10.2026 (#3): lista mogła od tamtej pory stać się ukryta dla adresata.
  if h.entity = 'tasks' and not exists (select 1 from public.tasks t where t.id = h.entity_id
                                         and private.member_can_see_list(target_member, t.list_id)) then
    return null;
  end if;
  if h.entity = 'lists' and not private.member_can_see_list(target_member, h.entity_id) then return null; end if;
  select user_id into target from public.group_members where member_id = target_member and deleted_at is null;
  select display_name into other_name from public.group_members where member_id = caller;
  item := case h.entity
    when 'tasks' then (select t.title from public.tasks t where t.id = h.entity_id)
    when 'events' then (select e.title from public.events e where e.id = h.entity_id)
    else 'Zakupy: ' || (select l.name from public.lists l where l.id = h.entity_id) end;
  if h.occurrence_date is not null then item := item || ' (' || to_char(h.occurrence_date, 'DD.MM') || ')'; end if;
  title := case h.status when 'pending' then other_name || ' przekazuje Ci' when 'accepted' then other_name || ' przyjmuje' else other_name || ' nie przyjmuje' end;
  body := case h.status when 'pending' then coalesce(item, '') || '. Otwórz Organizer, żeby przyjąć albo odrzucić.' else coalesce(item, '') end;
  update public.handoffs set push_sent_status = h.status where id = h.id;
  return jsonb_build_object(
    'title', title,
    'body', body,
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', p.token, 'env', p.env) order by p.token) from public.push_tokens p where p.user_id = target), '[]'::jsonb));
end $$;

-- ───────────────────────── #5 (audyt 8.10.2026): powrót konta tylko przez zaproszenie ─────────────────────────
-- Zastępuje wersję z 20261008090000_groups_edit.sql. Nowe: przywrócenie (deleted_at → null) członkostwa z kontem
-- poza private.accept_invite jest odrzucane ('forbidden:user_requires_invite', ten sam kod co przy dodawaniu konta).
-- Droga zaproszenia kończy się wcześniej (gałąź organizer.invite_hash), kontekst serwerowy — na samym początku.
-- Profile dzieci bez konta owner/admin nadal przywraca.
create or replace function private.group_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- coalesce: brak roli (osoba spoza grupy) to '' — „NULL not in (…)” daje NULL i przepuszczałby warunek odmowy.
  actor_role text := coalesce(private.my_role(new.group_id), '');
  me uuid := (select auth.uid());
  is_self boolean := tg_op = 'UPDATE' and old.user_id is not null and old.user_id = me;
  inv public.invites;
begin
  if me is null then return new; end if;
  -- Przekazanie własności (private.transfer_ownership): jedyna droga nadania roli owner.
  if current_setting('organizer.ownership_transfer', true) = new.group_id::text then return new; end if;

  -- Dołączenie przez zaproszenie: flagę ustawia wyłącznie private.accept_invite; nawet ustawiona ręcznie
  -- nic nie daje bez ważnego tokenu (sprawdzanego tu ponownie) dla tej grupy i tej roli.
  if nullif(current_setting('organizer.invite_hash', true), '') is not null then
    inv := private.valid_invite(decode(current_setting('organizer.invite_hash', true), 'hex'));
    if inv.id is not null and new.group_id = inv.group_id and new.user_id = me and new.role = inv.role
       and new.deleted_at is null and (tg_op = 'INSERT' or old.user_id = me) then
      return new;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and new.user_id = me
       and not exists (select 1 from public.group_members m where m.group_id = new.group_id) then
      return new;
    end if;
    if actor_role not in ('owner', 'admin') then raise exception 'forbidden' using errcode = 'P0001'; end if;
    if new.user_id is not null then raise exception 'forbidden:user_requires_invite' using errcode = 'P0001'; end if;
    if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'immutable_column:user_id' using errcode = 'P0001'; end if;
  if new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
  -- Audyt 8.10.2026 (#5): konto wraca do grupy wyłącznie samo, przez zaproszenie (zgoda tej osoby).
  if old.deleted_at is not null and new.deleted_at is null and old.user_id is not null then
    raise exception 'forbidden:user_requires_invite' using errcode = 'P0001';
  end if;

  if new.role is distinct from old.role or new.deleted_at is distinct from old.deleted_at then
    if is_self and old.deleted_at is null and new.deleted_at is not null and new.role = old.role and old.role <> 'owner' then
      null; -- wyjście z grupy (każdy poza ownerem; owner najpierw przekazuje grupę — Etap 1, usuwanie konta)
    elsif actor_role = 'owner' then
      if old.role = 'owner' and old.user_id = me then
        raise exception 'forbidden:owner_cannot_demote_self' using errcode = 'P0001';
      end if;
      if new.role = 'owner' then raise exception 'forbidden:role' using errcode = 'P0001'; end if;
    elsif actor_role = 'admin' then
      if old.role in ('owner', 'admin') or new.role in ('owner', 'admin') then
        raise exception 'forbidden:role' using errcode = 'P0001';
      end if;
    else
      raise exception 'forbidden:role' using errcode = 'P0001';
    end if;
  end if;

  if (new.display_name, new.color) is distinct from (old.display_name, old.color)
     and actor_role not in ('owner', 'admin') and not is_self then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ───────────────────────── #10 (audyt 8.10.2026): sprzątanie po byłych członkach ─────────────────────────
-- Zastępuje wersję z 20261006120100_lists_tasks.sql. Zdjęcie wpisu (deleted_at null → data) nie wymaga aktywnego członka
-- (inaczej byłego członka nie dało się zdjąć z listy, a po powrocie linkiem od razu ją widział). Zapis z wnętrza
-- wyzwalacza (odebranie dostępu przy wyjściu z grupy, niżej) pomija sprawdzenie właściciela listy — robi go serwer.
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
  if (select auth.uid()) is not null and pg_trigger_depth() = 1
     and l.owner_member_id is distinct from private.my_member_id(l.group_id) then
    raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.scope_id, new.member_id, new.scope_entity) is distinct from (old.scope_id, old.member_id, old.scope_entity) then
    raise exception 'immutable_column:scope' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Wyjście z grupy (samemu, usunięcie przez owner/admin, usunięcie konta) odbiera dostęp do list ograniczonych;
-- powrót przez zaproszenie go nie przywraca (właściciel listy nadaje go ponownie).
create function private.group_members_leave_scopes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.object_members set deleted_at = new.deleted_at
    where member_id = new.member_id and deleted_at is null;
  end if;
  return null;
end $$;

create trigger group_members_y_leave_scopes after update of deleted_at on public.group_members
  for each row execute function private.group_members_leave_scopes();

-- Zastępuje wersję z 20261008100000_events.sql. Nowe: usunięcie uczestnika, który wyszedł z grupy (#10).
create or replace function private.events_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  my_role text;
  removing boolean := case when tg_op = 'UPDATE' then old.deleted_at is null and new.deleted_at is not null else false end;
begin
  if (select auth.uid()) is null then return new; end if;
  me := private.my_member_id(new.group_id);
  my_role := coalesce(private.my_role(new.group_id), '');
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if my_role = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and new.group_id is distinct from old.group_id then raise exception 'immutable_column:group_id' using errcode = 'P0001'; end if;
  if tg_table_name = 'events' then
    if tg_op = 'INSERT' then new.created_by := me; else new.created_by := old.created_by; end if;
  else
    if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then raise exception 'immutable_column:event_id' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.events e where e.id = new.event_id and e.group_id = new.group_id) then
      raise exception 'invalid_event' using errcode = 'P0001';
    end if;
    if tg_table_name = 'event_participants' then
      if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then raise exception 'immutable_column:member_id' using errcode = 'P0001'; end if;
      if not removing and not exists (select 1 from public.group_members m where m.member_id = new.member_id
                                      and m.group_id = new.group_id and m.deleted_at is null) then
        raise exception 'invalid_member' using errcode = 'P0001';
      end if;
    elsif tg_op = 'UPDATE' and new.occurrence_date is distinct from old.occurrence_date then
      raise exception 'immutable_column:occurrence_date' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- ───────────────────────── #8 (audyt 8.10.2026): przyjęcie nieaktualnego przekazania ─────────────────────────
-- Zastępuje wersję z 20261008160000_shopping_trip.sql. Nowe: przyjęcie wymaga, żeby nadawca nadal był osobą przypisaną /
-- odpowiedzialną (jak przy tworzeniu); inaczej 'stale' i przekazanie zostaje oczekujące (odbiorca może je odrzucić,
-- nadawca anulować). Odrzucona alternatywa: samoczynne anulowanie przy zmianie przypisania — wymagałoby wyzwalaczy
-- na trzech tabelach, a stan „pending” po cichu znikałby u odbiorcy.
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

-- ───────────────────────── #12 (audyt 8.10.2026): limity prób dołączenia pod blokadą ─────────────────────────
-- Zastępuje wersję z 20261008250000_join_codes.sql. Blokady doradcze (do końca transakcji) na osobę i na ID grupy, zawsze
-- w tej kolejności (bez zakleszczeń): równoległe próby liczą się po kolei, więc limit nie przepuszcza nadmiarowych
-- (https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
create or replace function private.join_group(p_join_id text, p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  jid text := regexp_replace(coalesce(p_join_id, ''), '\D', '', 'g');
  code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  res jsonb;
  err text;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('organizer.join_user'), hashtext(me::text));
  perform pg_advisory_xact_lock(hashtext('organizer.join_id'), hashtext(jid));
  if (select count(*) from private.join_attempts where user_id = me and at > now() - interval '1 hour') >= private.join_fails_per_user()
     or (select count(*) from private.join_attempts where join_id = jid and at > now() - interval '1 hour') >= private.join_fails_per_group() then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  -- Tylko bieżące ID grupy (po zmianie ID stare nie prowadzi nigdzie).
  if not exists (select 1 from public.groups where join_id = jid and deleted_at is null) then
    err := 'invite_invalid';
  else
    begin
      perform set_config('organizer.join_code', '1', true);
      res := private.accept_invite(jid || ':' || code, p_display_name);
      perform set_config('organizer.join_code', '', true);
    exception when sqlstate 'P0001' then
      err := sqlerrm;
    end;
  end if;
  if err is null then return res; end if;
  insert into private.join_attempts (user_id, join_id) values (me, jid);
  -- Na zewnątrz jeden kod błędu: nie zdradzamy, czy istnieje grupa o tym ID.
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up') then err else 'invite_invalid' end);
end $$;

revoke all on all functions in schema private from public, anon;
revoke all on function private.repair_task_depth() from authenticated;
grant execute on function private.rrule_ok(text) to authenticated;
