-- Audyt 3 (PK-06): „Przenieś do grupy” jako jedno polecenie serwera i znacznik przeniesienia.
-- Testy: supabase/tests/move_task_to_group.test.sql; telefon: src/domain/task-move-cmd.ts (kroki polecenia, wspólne dla
-- skutku na telefonie w client.ts i modelu serwera w server-rules.ts).
--
-- N-12: dotąd przeniesienie było paczką zwykłych operacji (lista, kopie, usunięcie oryginału), które sync_push stosuje
--   niezależnie — odrzucona kopia (lista w nowej grupie usunięta, rola dziecka, usunięcie z grupy) i tak zostawiała
--   oryginał w koszu: zadanie znikało z obu grup. Teraz {kind: cmd, cmd: move_task_to_group, args: {task_id, group_id,
--   list: {id, set} | null, tasks: [{id, from, set}]}} wykonuje te same zapisy (przez private.apply_op, z RLS i strażnikami)
--   w jednym wywołaniu — błąd któregokolwiek cofa całość (sync_push: begin … exception na jedno polecenie).
-- N-131: oryginał dostaje znacznik public.tasks.moved_to (id kopii); kopie zapisuje private.task_moves (kopia → źródło).
--   Kosz pomija przeniesione, ekran oryginału mówi „Przeniesiono do …”, a przywrócenie oryginału, którego kopia żyje,
--   serwer odrzuca kodem „moved” (wyzwalacz tasks_a_guard_moved — także dla starych telefonów, które przywracają z kosza).
--   Przypisanie przeniesionej kopii tej samej osobie (to samo konto) nie wysyła „X przypisuje Ci zadanie”
--   (private.assignment_carried_over).
-- „Cofnij” przeniesienia: {kind: cmd, cmd: unmove_task, args: {task_id, copy_id, title}} — kopia do kosza ze znacznikiem
--   moved_to = oryginał (nie stoi w koszu nowej grupy), oryginał wraca (z podzadaniami, tasks_cascade). Ogólna lista
--   założona dla przeniesienia zostaje (pusta lista ogólna to zwykły stan grupy).
--
-- Obiekty: kolumna public.tasks.moved_to (bez uprawnień zapisu dla authenticated — ustawia ją tylko private.task_moved),
-- tabela private.task_moves, funkcje private.move_task_to_group, private.unmove_task, private.task_moved,
-- private.tasks_moved_guard i wyzwalacz tasks_a_guard_moved (BEFORE UPDATE OF deleted_at — po tasks_a_guard*),
-- private.assignment_carried_over (zastępuje 20261008350000_push_fixes.sql), private.apply_op (zastępuje
-- 20261010050000_series_chain.sql — bez zmian poza gałęziami move_task_to_group i unmove_task).
-- Stare telefony (build 21) przenoszą dalej zwykłymi operacjami (bez znacznika) — działa jak dotąd.

alter table public.tasks add column moved_to uuid;

create table private.task_moves (
  copy_id uuid primary key references public.tasks (id) on delete cascade,
  source_id uuid not null references public.tasks (id) on delete cascade
);
create index task_moves_source_idx on private.task_moves (source_id);

-- Znacznik przeniesienia: zadanie główne `src` (już w koszu) przeniesiono do `dst` (zadanie główne w innej grupie).
-- `pairs` — [{id: kopia, from: źródło}] dla private.task_moves. Wołają tylko move_task_to_group i unmove_task (po
-- zapisach przez apply_op, które sprawdziły prawa); tu jeszcze raz członkostwo, rola i kształt.
create function private.task_moved(src uuid, dst uuid, pairs jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.tasks;
  d public.tasks;
begin
  select * into s from public.tasks where id = src;
  select * into d from public.tasks where id = dst;
  if s.id is null or d.id is null or private.my_member_id(s.group_id) is null or private.my_member_id(d.group_id) is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if coalesce(private.my_role(s.group_id), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if s.deleted_at is null or s.parent_id is not null or d.parent_id is not null or s.group_id = d.group_id then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  update public.tasks set moved_to = dst where id = src;
  insert into private.task_moves (copy_id, source_id)
    select (p ->> 'id')::uuid, (p ->> 'from')::uuid from jsonb_array_elements(coalesce(pairs, '[]'::jsonb)) p
    on conflict (copy_id) do nothing;
end $$;

-- N-12: przeniesienie w jednej transakcji. Uprawnienia jak przy zwykłych operacjach (apply_op: RLS i strażnicy); źródła
-- kopii muszą należeć do przenoszonego zadania (kopia → źródło dla powiadomień).
create function private.move_task_to_group(a jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  src public.tasks;
  g uuid := nullif(a ->> 'group_id', '')::uuid;
  root uuid;
  x jsonb;
begin
  if a ->> 'task_id' is null or g is null or jsonb_typeof(a -> 'tasks') is distinct from 'array'
     or jsonb_array_length(a -> 'tasks') = 0 then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select * into src from public.tasks where id = (a ->> 'task_id')::uuid;
  if src.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coalesce(private.my_role(src.group_id), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  if src.parent_id is not null or src.group_id = g then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  perform private.lock_groups(array[src.group_id, g]);
  select * into src from public.tasks where id = src.id;
  if src.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;
  root := (a -> 'tasks' -> 0 ->> 'id')::uuid;
  if a -> 'tasks' -> 0 ->> 'from' is distinct from src.id::text or a -> 'tasks' -> 0 -> 'set' ->> 'parent_id' is not null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  if jsonb_typeof(a -> 'list') = 'object' then
    perform private.apply_op(jsonb_build_object('kind', 'create', 'entity', 'lists', 'id', a -> 'list' ->> 'id', 'group_id', g,
                                                'set', coalesce(a -> 'list' -> 'set', '{}'::jsonb)));
  end if;
  for x in select value from jsonb_array_elements(a -> 'tasks') loop
    if not exists (with recursive sub as (select t.id from public.tasks t where t.id = src.id
                                          union all select t.id from public.tasks t join sub on t.parent_id = sub.id)
                   select 1 from sub where sub.id::text = x ->> 'from') then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    perform private.apply_op(jsonb_build_object('kind', 'create', 'entity', 'tasks', 'id', x ->> 'id', 'group_id', g,
                                                'set', coalesce(x -> 'set', '{}'::jsonb)));
  end loop;
  if not exists (select 1 from public.tasks t where t.id = root and t.group_id = g and t.parent_id is null and t.deleted_at is null) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  perform private.apply_op(jsonb_build_object('kind', 'delete', 'entity', 'tasks', 'id', src.id));
  perform private.task_moved(src.id, root, (select jsonb_agg(jsonb_build_object('id', t ->> 'id', 'from', t ->> 'from'))
                                             from jsonb_array_elements(a -> 'tasks') t));
  perform private.poke_groups(array[g]);
  return src.group_id;
end $$;

-- „Cofnij” przeniesienia: kopia do kosza (jeśli żyje) ze znacznikiem powrotu, oryginał z kosza. Oryginał już przywrócony
-- (powtórzenie) — bez zmian.
create function private.unmove_task(a jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  src public.tasks;
  cp public.tasks;
begin
  if a ->> 'task_id' is null or a ->> 'copy_id' is null then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  select * into src from public.tasks where id = (a ->> 'task_id')::uuid;
  if src.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coalesce(private.my_role(src.group_id), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  select * into cp from public.tasks where id = (a ->> 'copy_id')::uuid;
  perform private.lock_groups(array[src.group_id, cp.group_id]);
  select * into src from public.tasks where id = src.id;
  if src.deleted_at is null then return src.group_id; end if;
  if src.moved_to is distinct from (a ->> 'copy_id')::uuid then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  if cp.id is not null then
    perform private.apply_op(jsonb_build_object('kind', 'delete', 'entity', 'tasks', 'id', cp.id));
    perform private.task_moved(cp.id, src.id, '[]'::jsonb);
    perform private.poke_groups(array[cp.group_id]);
  end if;
  -- Kopia, której nie widzę (np. nie należę już do tamtej grupy), a która żyje: przywrócenie odrzuci tasks_a_guard_moved.
  perform private.apply_op(jsonb_build_object('kind', 'restore', 'entity', 'tasks', 'id', src.id));
  return src.group_id;
end $$;

-- N-131: przeniesione zadanie nie wraca z kosza, dopóki żyje jego kopia (inaczej to samo zadanie byłoby w dwóch grupach);
-- przywrócone traci znacznik. Telefon: applyOp (restore) w client.ts, model: server-rules.ts.
create function private.tasks_moved_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null and new.deleted_at is null and old.moved_to is not null then
    if exists (select 1 from public.tasks x where x.id = old.moved_to and x.deleted_at is null) then
      raise exception 'moved' using errcode = 'P0001';
    end if;
    new.moved_to := null;
  end if;
  return new;
end $$;

create trigger tasks_a_guard_moved before update of deleted_at on public.tasks
  for each row execute function private.tasks_moved_guard();

-- Zastępuje wersję z 20261008350000_push_fixes.sql. Nowe: kopia przeniesionego zadania (private.task_moves), której
-- źródło miało osobę z tym samym kontem — to nie przypisanie.
create or replace function private.assignment_carried_over(p_entity text, p_id uuid, p_member uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  src uuid;
begin
  if p_entity = 'tasks' then
    return private.task_repeat_source(p_id) is not null
      or exists (select 1 from private.task_moves m
                   join public.tasks s on s.id = m.source_id
                   join public.group_members a on a.member_id = s.assignee_member_id
                   join public.group_members b on b.member_id = p_member
                 where m.copy_id = p_id and a.user_id is not null and a.user_id = b.user_id);
  elsif p_entity = 'events' then
    src := private.event_split_source(p_id);
    return src is not null and exists (select 1 from public.events e where e.id = src and e.responsible_member_id = p_member);
  elsif p_entity = 'event_overrides' then
    select private.event_split_source(o.event_id) into src from public.event_overrides o where o.id = p_id;
    return src is not null and exists (select 1 from public.event_overrides o join public.event_overrides p
                                         on p.event_id = src and p.occurrence_date = o.occurrence_date
                                       where o.id = p_id and p.responsible_member_id = p_member);
  end if;
  return false;
end $$;

-- ───────────────────────── apply_op ─────────────────────────
-- Ostatnia definicja: 20261010050000_series_chain.sql — bez zmian poza gałęziami move_task_to_group i unmove_task.
create or replace function private.apply_op(op jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  kind text := op ->> 'kind';
  ent text := op ->> 'entity';
  e private.sync_entities;
  vals jsonb := coalesce(op -> 'set', '{}'::jsonb);
  cols text[];
  bad text;
  n int;
  gid uuid;
  args jsonb := coalesce(op -> 'args', '{}'::jsonb);
begin
  if kind = 'cmd' then
    case op ->> 'cmd'
      when 'create_group' then
        if exists (select 1 from public.groups where id = (args ->> 'id')::uuid) then
          return (args ->> 'id')::uuid; -- powtórzona komenda: grupa już jest i ją widzę
        end if;
        perform private.create_group_with_owner((args ->> 'id')::uuid, args ->> 'name', 'shared',
                (args ->> 'owner_member_id')::uuid, args ->> 'owner_display_name');
        return (args ->> 'id')::uuid;
      when 'grant_scope', 'revoke_scope' then
        select l.group_id into gid from public.lists l where l.id = (args ->> 'list_id')::uuid;
        if gid is null then raise exception 'not_found' using errcode = 'P0001'; end if;
        if op ->> 'cmd' = 'grant_scope' then
          insert into public.object_members (scope_entity, scope_id, member_id, group_id)
            values ('lists', (args ->> 'list_id')::uuid, (args ->> 'member_id')::uuid, gid)
            on conflict (scope_entity, scope_id, member_id) do update set deleted_at = null;
        else
          -- Cofnięcie tylko aktualizuje istniejący wpis. (Błąd znaleziony testem różnicowym: wcześniejsze
          -- „wstaw albo zaktualizuj” przy braku wpisu WSTAWIAŁO aktywny wpis, czyli dawało dostęp.)
          -- Uprawnienie (tylko właściciel listy) sprawdza wyzwalacz object_members_guard także przy UPDATE.
          update public.object_members set deleted_at = clock_timestamp()
            where scope_entity = 'lists' and scope_id = (args ->> 'list_id')::uuid
              and member_id = (args ->> 'member_id')::uuid and deleted_at is null;
          if not found and private.my_member_id(gid) is distinct from (select owner_member_id from public.lists where id = (args ->> 'list_id')::uuid) then
            raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
          end if;
        end if;
        return gid;
      when 'move_task' then
        return private.move_task((args ->> 'id')::uuid, nullif(args ->> 'parent_id', '')::uuid,
                                 nullif(args ->> 'list_id', '')::uuid, args ->> 'sort_key');
      when 'staple_add', 'staple_remove' then
        return private.staple_cmd(op ->> 'cmd', args);
      when 'split_event' then
        -- Audyt 2 (M-3): „to i następne” w jednej transakcji (20261008320000_event_split).
        return private.split_event(args);
      when 'end_series' then
        -- Audyt 3 (N-3, N-117): koniec serii na całym łańcuchu (20261010050000_series_chain).
        return private.end_series(args);
      when 'restore_series' then
        return private.restore_series(args);
      when 'move_task_to_group' then
        -- Audyt 3 (N-12): przeniesienie zadania do innej grupy w jednej transakcji (20261010060000_move_task_to_group).
        return private.move_task_to_group(args);
      when 'unmove_task' then
        return private.unmove_task(args);
      else
        raise exception 'unknown_cmd' using errcode = 'P0001';
    end case;
  end if;

  select * into e from private.sync_entities where entity = ent;
  if e.entity is null then raise exception 'unknown_entity' using errcode = 'P0001'; end if;
  if op ->> 'id' is null then raise exception 'invalid_value:id' using errcode = 'P0001'; end if;

  if kind = 'create' then
    vals := vals || jsonb_build_object(e.pk, op ->> 'id');
    if op ? 'group_id' then vals := vals || jsonb_build_object('group_id', op ->> 'group_id'); end if;
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.insert_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    -- Identyfikatory nadaje klient (UUIDv7), więc istniejący obiekt to powtórzenie tej samej operacji.
    -- (Bez ON CONFLICT: przy nim Postgres sprawdza politykę SELECT na wierszu, którego jeszcze nie ma.)
    execute format('select group_id from public.%I where %I = $1', ent, e.pk) into gid using (op ->> 'id')::uuid;
    if gid is not null then return gid; end if;
    -- Wartości rzutowane na typy kolumn przez jsonb_populate_record; nazwy kolumn z białej listy.
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                   ent, (select string_agg(format('%I', c), ',') from unnest(cols) c),
                   (select string_agg(format('%I', c), ',') from unnest(cols) c), ent)
      using vals;
  elsif kind = 'patch' then
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.patch_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    if vals = '{}'::jsonb then return null; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) v where t.%I = $2 %s',
                   ent, (select string_agg(format('%I = v.%I', c, c), ',') from unnest(cols) c), ent, e.pk,
                   case when e.soft_delete then 'and t.deleted_at is null' else '' end)
      using vals, (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      -- Widzę wiersz, ale go nie zmieniłem: usunięty (usunięcie wygrywa z edycją) albo brak prawa zapisu.
      execute format('select case when deleted_at is not null then ''deleted'' else ''forbidden'' end from public.%I where %I = $1', ent, e.pk)
        into bad using (op ->> 'id')::uuid;
      raise exception '%', coalesce(bad, 'not_found') using errcode = 'P0001';
    end if;
  elsif kind in ('delete', 'restore') then
    if not e.soft_delete then raise exception 'unsupported' using errcode = 'P0001'; end if;
    -- clock_timestamp(), nie now(): now() jest stałe w transakcji, więc dwa usunięcia w jednej paczce
    -- dostałyby ten sam znacznik i przywrócenie listy przywróciłoby zadanie usunięte wcześniej osobno.
    execute format('update public.%I set deleted_at = %s where %I = $1 and deleted_at is %s',
                   ent, case when kind = 'delete' then 'clock_timestamp()' else 'null' end, e.pk,
                   case when kind = 'delete' then 'null' else 'not null' end)
      using (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      execute format('select 1 from public.%I where %I = $1', ent, e.pk) into n using (op ->> 'id')::uuid;
      if n is null then raise exception 'not_found' using errcode = 'P0001'; end if;
      -- Już usunięte / już przywrócone: operacja idempotentna.
    end if;
  else
    raise exception 'unknown_kind' using errcode = 'P0001';
  end if;

  -- Grupa nie ma kolumny group_id — jej identyfikatorem jest id (błąd wykryty testem groups_edit: zmiana nazwy
  -- grupy przez sync_push zawsze kończyła się odrzuceniem „error:42703”).
  execute format('select %s from public.%I where %I = $1', case when ent = 'groups' then 'id' else 'group_id' end, ent, e.pk)
    into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

revoke all on table private.task_moves from public, anon, authenticated;
revoke all on function private.task_moved(uuid, uuid, jsonb), private.move_task_to_group(jsonb), private.unmove_task(jsonb),
  private.tasks_moved_guard(), private.assignment_carried_over(text, uuid, uuid), private.apply_op(jsonb) from public, anon;
-- SECURITY INVOKER (apply_op, polecenia) i to, co wołają, wykonuje rola authenticated (lista: server_limits.test.sql).
grant execute on function private.task_moved(uuid, uuid, jsonb), private.move_task_to_group(jsonb), private.unmove_task(jsonb),
  private.apply_op(jsonb) to authenticated;
revoke execute on function private.tasks_moved_guard(), private.assignment_carried_over(text, uuid, uuid) from authenticated;
