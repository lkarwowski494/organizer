-- Audyt 3 (PK-07): powtarzanie zadań. Testy: supabase/tests/task_repeat_chain.test.sql; model telefonu:
-- src/domain/server-rules.ts (tests/db/rules-vs-sql).
--
-- 1. N-25: kolumna public.tasks.cycle_date — pierwotny dzień terminu zadania powtarzanego przeniesionego „Tylko ten raz”
--    na wcześniej (D137, D181). Telefon liczy następny termin od późniejszego z (termin, cycle_date, dzień wykonania),
--    więc przeniesiony termin zastępuje swój dzień cyklu (RFC 5545 §3.8.4.4, RECURRENCE-ID), zamiast wracać drugi raz.
--    Kopia (następne) zaczyna bez niego. Zwykła kolumna zadania: te same uprawnienia co termin (tasks_guard bez zmian
--    dla dorosłych; dziecko — patrz 20261010120500). Build 21 jej nie wysyła i nie czyta (dodatkowe pole wiersza w
--    pobraniu) — liczy jak dotąd.
-- 2. Q16 A (N-123): funkcje pomocnicze wyjątku dla dziecka z kontem w tasks_guard (sam strażnik — 20261010120500, po
--    PK-12): private.repeat_source — poprzednie zadanie, którego następnym terminem jest wiersz; private.child_repeat_copy
--    — czy wiersz jest następnym terminem (albo jego podzadaniem) własnego zadania powtarzanego dziecka.
--
-- Obiekty: kolumna public.tasks.cycle_date (z ograniczeniem tasks_cycle_date_range), GRANT insert/update (cycle_date), wpis private.sync_entities (insert_cols,
-- patch_cols); funkcje private.repeat_source, private.child_repeat_copy, private.task_root, private.child_repeat_insert_ok,
-- private.child_repeat_update_ok — tylko dla funkcji SECURITY DEFINER (bez EXECUTE dla authenticated).

alter table public.tasks add column cycle_date date;
-- Zakres dni jak każda kolumna daty (config.dates, 20261010010000_date_ranges).
alter table public.tasks add constraint tasks_cycle_date_range check (cycle_date >= '1900-01-01'::date and cycle_date <= '2199-12-31'::date);
grant insert (cycle_date), update (cycle_date) on public.tasks to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{cycle_date}', patch_cols = patch_cols || '{cycle_date}' where entity = 'tasks';

-- Poprzednie zadanie łańcucha: id wiersza `cid` = next_task_id(poprzedniego) na tej samej liście (tasks_id_guard,
-- 20261008483000). Zadanie główne — wśród zadań głównych z powtarzaniem (od najpóźniejszego terminu, zwykle pierwsze
-- trafienie); podzadanie kopii — wśród podzadań poprzedniego zadania rodzica (kopie podzadań: copyOps w
-- src/domain/views/task-repeat.ts). Głębokość ograniczona jak podzadania (MAX_TASK_DEPTH), więc rekurencja jest krótka.
create function private.repeat_source(cid uuid, list uuid, parent uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  s uuid;
  sp uuid;
begin
  if not private.is_uuid_v5(cid) then return null; end if;
  if parent is null then
    for s in select x.id from public.tasks x where x.list_id = list and x.parent_id is null and x.repeat is not null and x.id <> cid
             order by x.due_date desc nulls last loop
      if private.next_task_id(s) = cid then return s; end if;
    end loop;
    return null;
  end if;
  sp := private.repeat_source(parent, list, (select p.parent_id from public.tasks p where p.id = parent));
  if sp is null then return null; end if;
  for s in select x.id from public.tasks x where x.parent_id = sp loop
    if private.next_task_id(s) = cid then return s; end if;
  end loop;
  return null;
end $$;

-- Q16 A: wiersz `r` (zadanie główne) jest następnym terminem zadania powtarzanego, które jest sprawą dziecka `me`
-- (private.child_owns_task: przypisane do niego itd.). Zwraca id poprzedniego albo null.
create function private.child_repeat_copy(r public.tasks, me uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  src uuid;
begin
  if r.parent_id is not null then return null; end if;
  src := private.repeat_source(r.id, r.list_id, null);
  if src is null or not private.child_owns_task(src, me) then return null; end if;
  return src;
end $$;

-- Zadanie główne nad wierszem (sam wiersz, gdy jest główny); kroki ograniczone jak w child_owns_task.
create function private.task_root(r public.tasks) returns public.tasks
language plpgsql stable security definer set search_path = '' as $$
declare
  cur public.tasks := r;
begin
  for step in 1 .. 8 loop
    exit when cur.parent_id is null;
    select * into cur from public.tasks where id = cur.parent_id;
    if cur.id is null then return null; end if;
  end loop;
  return cur;
end $$;

-- Q16 A: dziecko zakłada następny termin swojego zadania powtarzanego albo kopię jego podzadania — tylko taki wiersz,
-- jaki robi telefon (copyOps): ta sama nazwa, notatka, kolejność i „tylko tego dnia”, osoba poprzedniego albo nikt,
-- bez wydarzenia, serii, działu, odhaczenia, „widoczne od” i pierwotnego dnia; zadanie główne z własnym terminem
-- i powtarzaniem, podzadanie bez powtarzania.
create function private.child_repeat_insert_ok(r public.tasks, me uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.tasks;
  root public.tasks;
begin
  if r.parent_id is null then
    select * into s from public.tasks where id = private.child_repeat_copy(r, me);
  else
    root := private.task_root((select p from public.tasks p where p.id = r.parent_id));
    if root.id is null or private.child_repeat_copy(root, me) is null then return false; end if;
    select * into s from public.tasks where id = private.repeat_source(r.id, r.list_id, r.parent_id);
  end if;
  if s.id is null then return false; end if;
  return r.title = s.title and r.note is not distinct from s.note and r.sort_key = s.sort_key
     and (r.assignee_member_id is null or r.assignee_member_id = s.assignee_member_id)
     and r.rollover = s.rollover and r.start_date is null and r.completed_at is null and r.event_id is null
     and r.occurrence_date is null and r.series_id is null and r.category is null and r.cycle_date is null
     and case when r.parent_id is null
              then r.deadline_mode = 'own' and r.due_date is not null and r.due_time is not distinct from s.due_time and r.repeat is not null
              else r.repeat is null and r.deadline_mode in ('own', 'inherit', 'none') and (r.due_time is null or r.due_time = s.due_time) end;
end $$;

-- Q16 A: zmiana następnego terminu (albo wiersza pod nim) przez dziecko — tylko to, co robi telefon przy cofnięciu
-- i ponownym odhaczeniu (repeatOps): usunięcie i przywrócenie (podzadania — kaskada tasks_cascade albo telefon), a samego
-- następnego jeszcze nieodhaczonego — także termin i pierwotny dzień (kopia wraca z kosza z nowym terminem, T-1).
-- Odhaczenie sprawdza tasks_guard osobno (forbidden:not_own).
create function private.child_repeat_update_ok(n public.tasks, o public.tasks, me uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  changed text[];
  allowed text[] := case when o.parent_id is null then array['deleted_at', 'due_date', 'due_time', 'cycle_date'] else array['deleted_at'] end;
  root public.tasks;
begin
  select coalesce(array_agg(k), '{}') into changed from jsonb_each(to_jsonb(n)) x(k, v)
    where k <> all (array['completed_at', 'completed_by', 'version']) and v is distinct from to_jsonb(o) -> k;
  -- Samo następne — tylko nietknięte (jak cofnięcie na telefonie); wiersze pod nim idą z nim w kaskadzie, jakiekolwiek są.
  if not changed <@ allowed or (o.parent_id is null and o.completed_at is not null) then return false; end if;
  root := private.task_root(o);
  return root.id is not null and private.child_repeat_copy(root, me) is not null;
end $$;

revoke all on function private.repeat_source(uuid, uuid, uuid), private.child_repeat_copy(public.tasks, uuid), private.task_root(public.tasks),
  private.child_repeat_insert_ok(public.tasks, uuid), private.child_repeat_update_ok(public.tasks, public.tasks, uuid) from public, anon, authenticated;
