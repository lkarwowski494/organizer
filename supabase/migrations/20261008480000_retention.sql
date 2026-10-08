-- Audyt 2, paczka P16: retencja i codzienne sprzątanie. Testy: supabase/tests/retention.test.sql,
-- tests/db/maintenance.test.ts (procedura z COMMIT po każdej grupie na prawdziwym połączeniu).
--  M-62 (D184, PW-47 A) historia zmian 90 dni (private.activity_days(), config.retention.ACTIVITY_DAYS) — telefon czyści
--       u siebie tak samo (src/domain/sync-engine/retention.ts);
--  M-66 sprzątanie jako procedura z COMMIT po każdej grupie (blokada grupy tylko na czas jej sprzątania, nie całego
--       zadania) i tylko po grupach, w których jest coś do zrobienia; brakujące indeksy;
--  M-67 kasowanie historii każdej usuwanej rzeczy (listy, definicje, wyjątki, odpowiedzi, uczestnicy, wpisy dostępu);
--       D182 (PW-42 A): usunięte wydarzenie z przypiętymi zadaniami po 30 dniach w koszu znika, a zadania dostają datę
--       terminu jako własny termin;
--  M-68 retencja: rozstrzygnięte przekazania, stare zaproszenia, dziennik dostępu, nieużywane instalacje (z odrzuceniami),
--       próby dołączenia (także przy usunięciu konta);
--  M-183 usunięcie konta ownera grupy w koszu: grupę przejmuje dorosły z najdłuższym stażem, osoba wychodzi z grupy;
--  M-194 dziennik przebiegów (private.maintenance_runs) i wpis diagnostyczny w client_errors przy błędzie.
-- Zastępuje: private.purge_tombstones (20261008310000 — reguła P1 „purged_version = najwyższa wersja usuniętych wierszy”
-- zostaje, teraz także dla historii i przekazań), private.daily_maintenance (20261008250000). Harmonogram pg_cron woła
-- teraz procedurę private.run_daily_maintenance().

-- ───────────────────────── Liczby (src/config: retention.*; test kontraktowy) ─────────────────────────
create function private.activity_days() returns int language sql immutable as $$ select 90 $$;
create function private.handoff_days() returns int language sql immutable as $$ select 90 $$;
create function private.invite_days() returns int language sql immutable as $$ select 30 $$;
create function private.access_event_days() returns int language sql immutable as $$ select 30 $$;
create function private.sync_client_days() returns int language sql immutable as $$ select 180 $$;
create function private.join_attempt_days() returns int language sql immutable as $$ select 1 $$;
create function private.maintenance_run_days() returns int language sql immutable as $$ select 90 $$;

-- ───────────────────────── Indeksy (M-66, M-73) ─────────────────────────
-- Historia: zakres listy (sync_fetch_scope, poszerzenie widoczności), encja (sprzątanie), autor (usunięcie konta), wiek.
create index activity_scope_idx on public.activity (scope_id) where scope_id is not null;
create index activity_entity_idx on public.activity (entity, entity_id);
create index activity_actor_idx on public.activity (actor_member_id) where actor_member_id is not null;
create index activity_created_idx on public.activity (created_at);
create index object_members_scope_idx on public.object_members (scope_id) where deleted_at is null;
create index tasks_series_idx on public.tasks (series_id) where series_id is not null;
create index event_task_series_list_idx on public.event_task_series (list_id);
create index event_task_series_event_idx on public.event_task_series (event_id);
-- Kosz: częściowe indeksy tylko na usuniętych wierszach — wybór grup do sprzątania bez przeglądania żywych.
create index tasks_trash_idx on public.tasks (deleted_at) where deleted_at is not null;
create index lists_trash_idx on public.lists (deleted_at) where deleted_at is not null;
create index object_members_trash_idx on public.object_members (deleted_at) where deleted_at is not null;
create index event_task_series_trash_idx on public.event_task_series (deleted_at) where deleted_at is not null;
create index events_trash_idx on public.events (deleted_at) where deleted_at is not null;
create index event_overrides_trash_idx on public.event_overrides (deleted_at) where deleted_at is not null;
create index event_rsvps_trash_idx on public.event_rsvps (deleted_at) where deleted_at is not null;
create index event_participants_trash_idx on public.event_participants (deleted_at) where deleted_at is not null;
create index handoffs_decided_idx on public.handoffs (decided_at) where status <> 'pending';
create index invites_expires_idx on public.invites (expires_at);
create index access_events_created_idx on private.access_events (created_at);
create index sync_clients_user_idx on private.sync_clients (user_id, last_seen_at);

-- ───────────────────────── Sprzątanie jednej grupy ─────────────────────────
-- Wszystko pod blokadą wiersza grupy (zapisy telefonów do tej grupy czekają tylko na tę grupę). Kolejność usuwania
-- wynika z kluczy obcych: zadania → definicje → listy; wyjątki, odpowiedzi, uczestnicy, definicje → wydarzenia.
-- Przy każdej usuniętej rzeczy znika jej historia (M-67). purged_version = najwyższa wersja usuniętych wierszy (P1, M-4):
-- telefon, którego kursor jest za nimi, ma już ich ostatni stan, a telefon sprzed nich pobiera grupę od nowa.
-- Zmiany wierszy, które zostają (odpięcie zadań, D182), podbijają wersję zwyczajnie — telefony pobiorą je jak każdą zmianę.
-- organizer.trash_ok: grupa w koszu też jest sprzątana (bump_group_version inaczej odrzuca zapis).
create function private.purge_group(g uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  act_horizon timestamptz := now() - make_interval(days => private.activity_days());
  handoff_horizon timestamptz := now() - make_interval(days => private.handoff_days());
  n int := 0;
  k int;
  v bigint;
  top bigint := 0;
  acts int := 0;
  handoffs int := 0;
  unpinned int := 0;
  ev uuid[];
  ser uuid[];
  ids uuid[];
  lst uuid[];
begin
  perform 1 from public.groups where id = g for update;
  perform set_config('organizer.trash_ok', 'on', true);

  -- M-62: historia starsza niż activity_days().
  with d as (delete from public.activity a where a.group_id = g and a.created_at < act_horizon returning a.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  acts := acts + k; top := greatest(top, v);
  -- M-68: rozstrzygnięte przekazania po handoff_days() od decyzji.
  with d as (delete from public.handoffs h where h.group_id = g and h.status <> 'pending' and h.decided_at < handoff_horizon
             returning h.version)
    select count(*), coalesce(max(d.version), 0) into k, v from d;
  handoffs := k; top := greatest(top, v);

  -- Wydarzenia po terminie w koszu (D182). Przypięte zadania (żywe i w koszu) zostają: odpinamy je, a zadanie z terminem
  -- „jak spotkanie” dostaje datę tego terminu (przeniesionego wyjątkiem — datę po przeniesieniu) jako własny termin.
  select coalesce(array_agg(e.id), '{}') into ev from public.events e where e.group_id = g and e.deleted_at < horizon;
  if cardinality(ev) > 0 then
    update public.tasks t set
      deadline_mode = case when t.deadline_mode = 'event' then 'own' else t.deadline_mode end,
      due_date = case when t.deadline_mode = 'event'
                      then coalesce((select o.start_date from public.event_overrides o
                                     where o.event_id = t.event_id and o.occurrence_date = t.occurrence_date
                                       and o.deleted_at is null and not o.cancelled), t.occurrence_date)
                      else t.due_date end,
      event_id = null, occurrence_date = null
    where t.group_id = g and t.event_id = any (ev);
    get diagnostics unpinned = row_count;
  end if;

  -- Definicje stałych zadań do usunięcia: po terminie w koszu, na wydarzeniu albo liście po terminie w koszu. Kopie
  -- (zwykłe zadania) zostają — tracą tylko wskazanie definicji, której już nie ma.
  select coalesce(array_agg(s.id), '{}') into ser from public.event_task_series s
    where s.group_id = g and (s.deleted_at < horizon or s.event_id = any (ev)
      or exists (select 1 from public.lists l where l.id = s.list_id and l.deleted_at < horizon));
  if cardinality(ser) > 0 then
    update public.tasks set series_id = null where group_id = g and series_id = any (ser);
  end if;

  -- Zadania: tylko takie, pod którymi nie ma wiersza, który zostaje (klucz obcy parent_id zawsze przejdzie).
  with recursive keep as (
    select t.id, t.parent_id from public.tasks t
    where t.group_id = g and (t.deleted_at is null or t.deleted_at >= horizon)
    union
    select x.id, x.parent_id from public.tasks x join keep on x.id = keep.parent_id
  )
  select coalesce(array_agg(t.id), '{}') into ids from public.tasks t
  where t.group_id = g and t.deleted_at < horizon and t.id not in (select keep.id from keep);
  if cardinality(ids) > 0 then
    with d as (delete from public.activity a where a.entity = 'tasks' and a.entity_id = any (ids) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.tasks where id = any (ids) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wpisy dostępu do list (historia wpisu: entity_id = osoba, zakres = lista).
  with d as (delete from public.object_members o where o.group_id = g and o.deleted_at < horizon returning o.scope_id, o.member_id, o.version),
       h as (delete from public.activity a using d where a.entity = 'object_members' and a.entity_id = d.member_id and a.scope_id = d.scope_id
             returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ser) > 0 then
    with d as (delete from public.activity a where a.entity = 'event_task_series' and a.entity_id = any (ser) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.event_task_series where id = any (ser) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Listy: po terminie w koszu i bez zadań (zadania listy trafiają do kosza razem z nią, lists_cascade).
  select coalesce(array_agg(l.id), '{}') into lst from public.lists l
    where l.group_id = g and l.deleted_at < horizon
      and not exists (select 1 from public.tasks t where t.list_id = l.id)
      and not exists (select 1 from public.event_task_series s where s.list_id = l.id);
  if cardinality(lst) > 0 then
    with d as (delete from public.activity a where (a.entity = 'lists' and a.entity_id = any (lst)) or a.scope_id = any (lst)
               returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    with d as (delete from public.lists where id = any (lst) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  -- Wyjątki terminów, odpowiedzi (D124) i uczestnicy: usunięte albo przy wydarzeniu po terminie w koszu.
  with d as (delete from public.event_overrides o where o.group_id = g and (o.deleted_at < horizon or o.event_id = any (ev))
             returning o.id, o.version),
       h as (delete from public.activity a using d where a.entity = 'event_overrides' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_rsvps r where r.group_id = g and (r.deleted_at < horizon or r.event_id = any (ev))
             returning r.id, r.version),
       h as (delete from public.activity a using d where a.entity = 'event_rsvps' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);
  with d as (delete from public.event_participants p where p.group_id = g and (p.deleted_at < horizon or p.event_id = any (ev))
             returning p.id, p.version),
       h as (delete from public.activity a using d where a.entity = 'event_participants' and a.entity_id = d.id returning a.version)
    select (select count(*) from d), greatest((select coalesce(max(version), 0) from d), (select coalesce(max(version), 0) from h)) into k, v;
  n := n + k; top := greatest(top, v);

  if cardinality(ev) > 0 then
    with d as (delete from public.activity a where a.entity = 'events' and a.entity_id = any (ev) returning a.version)
      select coalesce(max(d.version), 0) into v from d;
    top := greatest(top, v);
    -- Seria podzielona „to i następne” wskazuje źródło (split_from, ON DELETE SET NULL) — zostaje bez wskazania.
    with d as (delete from public.events where id = any (ev) returning version)
      select count(*), coalesce(max(d.version), 0) into k, v from d;
    n := n + k; top := greatest(top, v);
  end if;

  if top > 0 then update public.groups set purged_version = greatest(purged_version, top) where id = g; end if;
  perform set_config('organizer.trash_ok', '', true);
  return jsonb_build_object('tombstones', n, 'activity', acts, 'handoffs', handoffs, 'unpinned', unpinned);
end $$;

-- Grupy, w których jest coś do sprzątania (częściowe indeksy wyżej) — reszta nie jest nawet blokowana (M-66).
create function private.purge_candidates() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with h as (select now() - make_interval(days => private.tombstone_days()) as t,
                    now() - make_interval(days => private.activity_days()) as a,
                    now() - make_interval(days => private.handoff_days()) as d)
  select x.group_id from (
    select group_id from public.tasks, h where deleted_at < h.t
    union select group_id from public.lists, h where deleted_at < h.t
    union select group_id from public.object_members, h where deleted_at < h.t
    union select group_id from public.event_task_series, h where deleted_at < h.t
    union select group_id from public.events, h where deleted_at < h.t
    union select group_id from public.event_overrides, h where deleted_at < h.t
    union select group_id from public.event_rsvps, h where deleted_at < h.t
    union select group_id from public.event_participants, h where deleted_at < h.t
    union select group_id from public.activity, h where created_at < h.a
    union select group_id from public.handoffs, h where status <> 'pending' and decided_at < h.d
  ) x order by x.group_id
$$;

-- Jedna grupa we własnej podtransakcji: błąd (np. stare dane) nie zatrzymuje pozostałych, tylko trafia do wyniku.
create function private.purge_group_safe(g uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return private.purge_group(g);
exception when others then
  raise warning 'purge_group: grupa % pominięta: % (%)', g, sqlerrm, sqlstate;
  return jsonb_build_object('error', sqlstate || ': ' || sqlerrm);
end $$;

create function private.hard_delete_group_safe(g uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.hard_delete_group(g);
  return null;
exception when others then
  raise warning 'purge_deleted_groups: grupa % pominięta: % (%)', g, sqlerrm, sqlstate;
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Zastępuje wersję z 20261008310000_sync_protocol_v2.sql (całość w jednej transakcji — dla testów i ręcznego użycia;
-- harmonogram woła procedurę niżej). Zwraca liczbę usuniętych wierszy z kosza, jak dotąd.
create or replace function private.purge_tombstones() returns int
language plpgsql security definer set search_path = '' as $$
declare g uuid; r jsonb; total int := 0;
begin
  for g in select private.purge_candidates() loop
    r := private.purge_group_safe(g);
    total := total + coalesce((r ->> 'tombstones')::int, 0);
  end loop;
  return total;
end $$;

-- ───────────────────────── Retencja poza grupami (M-68) ─────────────────────────
create function private.purge_logs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare errors int; feedback int; pushes int; attempts int; invites int; access int; clients int; runs int;
begin
  delete from public.client_errors where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics errors = row_count;
  delete from public.app_feedback where created_at < now() - make_interval(days => private.feedback_retention_days());
  get diagnostics feedback = row_count;
  delete from private.push_log where created_at < now() - make_interval(days => private.push_log_retention_days());
  get diagnostics pushes = row_count;
  delete from private.join_attempts where at < now() - make_interval(days => private.join_attempt_days());
  get diagnostics attempts = row_count;
  -- Zaproszenia, których nikt już nie użyje: wygasłe albo unieważnione od invite_days() dni (wyczerpane — gdy wygasną).
  delete from public.invites i where i.expires_at < now() - make_interval(days => private.invite_days())
    or i.revoked_at < now() - make_interval(days => private.invite_days());
  get diagnostics invites = row_count;
  delete from private.access_events where created_at < now() - make_interval(days => private.access_event_days());
  get diagnostics access = row_count;
  -- Nieużywane instalacje razem z zapamiętanymi odrzuceniami (private.sync_rejections, ON DELETE CASCADE).
  delete from private.sync_clients where last_seen_at < now() - make_interval(days => private.sync_client_days());
  get diagnostics clients = row_count;
  delete from private.maintenance_runs where started_at < now() - make_interval(days => private.maintenance_run_days());
  get diagnostics runs = row_count;
  return jsonb_build_object('client_errors', errors, 'app_feedback', feedback, 'push_log', pushes, 'join_attempts', attempts,
                            'invites', invites, 'access_events', access, 'sync_clients', clients, 'maintenance_runs', runs);
end $$;

-- ───────────────────────── Dziennik przebiegów (M-194) ─────────────────────────
-- Log Drains są płatne, a cron.job_run_details nikt nie czyta: wynik każdego przebiegu zostaje tu, a problem (pominięta
-- grupa, przebieg, który się nie skończył) trafia do public.client_errors jako wpis diagnostyczny — tam, gdzie właściciel
-- już przegląda zgłoszenia (panel Supabase).
create table private.maintenance_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  result jsonb
);

create function private.maintenance_begin() returns bigint
language plpgsql security definer set search_path = '' as $$
declare rid bigint; stuck timestamptz;
begin
  -- Poprzedni przebieg zaczął się, ale nie skończył (przerwany limitem czasu albo błędem poza grupami).
  select r.started_at into stuck from private.maintenance_runs r where r.finished_at is null order by r.id desc limit 1;
  if stuck is not null then
    insert into public.client_errors (kind, message, screen)
      values ('diagnostic', left('Sprzątanie bazy z ' || stuck::text || ' nie zakończyło się', 500), 'daily_maintenance');
    update private.maintenance_runs set finished_at = clock_timestamp(), result = '{"error":"unfinished"}' where finished_at is null;
  end if;
  insert into private.maintenance_runs default values returning maintenance_runs.id into rid;
  return rid;
end $$;

create function private.maintenance_end(run bigint, res jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update private.maintenance_runs set finished_at = clock_timestamp(), result = res where id = run;
  if jsonb_array_length(res -> 'skipped') > 0 then
    insert into public.client_errors (kind, message, stack, screen)
      values ('diagnostic', left('Sprzątanie bazy pominęło grupy: ' || jsonb_array_length(res -> 'skipped'), 500),
              left((res -> 'skipped')::text, 4000), 'daily_maintenance');
  end if;
  return res;
end $$;

-- Wspólne liczniki wyniku.
create function private.maintenance_add(acc jsonb, r jsonb) returns jsonb language sql immutable set search_path = '' as $$
  select acc || jsonb_build_object(
    'tombstones', (acc ->> 'tombstones')::int + coalesce((r ->> 'tombstones')::int, 0),
    'activity', (acc ->> 'activity')::int + coalesce((r ->> 'activity')::int, 0),
    'handoffs', (acc ->> 'handoffs')::int + coalesce((r ->> 'handoffs')::int, 0),
    'unpinned', (acc ->> 'unpinned')::int + coalesce((r ->> 'unpinned')::int, 0))
$$;

-- Zastępuje wersję z 20261008250000_join_codes.sql: wszystko w jednej transakcji (testy, ręczne wywołanie w panelu).
create or replace function private.daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run bigint := private.maintenance_begin();
  acc jsonb := '{"tombstones":0,"activity":0,"handoffs":0,"unpinned":0,"groups":0,"skipped":[]}';
  g uuid;
  r jsonb;
  err text;
begin
  for g in select private.purge_candidates() loop
    r := private.purge_group_safe(g);
    if r ? 'error' then acc := jsonb_set(acc, '{skipped}', (acc -> 'skipped') || jsonb_build_object('group', g, 'error', r ->> 'error'));
    else acc := private.maintenance_add(acc, r); end if;
  end loop;
  for g in select id from public.groups where deleted_at < now() - make_interval(days => private.tombstone_days()) order by id loop
    err := private.hard_delete_group_safe(g);
    if err is null then acc := jsonb_set(acc, '{groups}', to_jsonb((acc ->> 'groups')::int + 1));
    else acc := jsonb_set(acc, '{skipped}', (acc -> 'skipped') || jsonb_build_object('group', g, 'error', err)); end if;
  end loop;
  return private.maintenance_end(run, acc || private.purge_logs());
end $$;

-- To samo z COMMIT po każdej grupie (M-66): blokada grupy trwa tylko jej sprzątanie, a przerwany przebieg zachowuje
-- to, co już zrobił. pg_cron wykonuje „call …” jako osobne polecenie najwyższego poziomu, więc COMMIT w procedurze działa
-- (PostgreSQL: „Transaction control is only possible in CALL or DO invocations from the top level”,
-- https://www.postgresql.org/docs/16/plpgsql-transactions.html; sprawdzone na pg_cron 1.6 w obu trybach: połączenie libpq
-- i cron.use_background_workers = on). Bez SECURITY DEFINER i SET: procedura z nimi nie może wykonać COMMIT
-- („invalid transaction termination”); pg_cron i tak uruchamia ją jako właściciel bazy, a nazwy są pełne.
create procedure private.run_daily_maintenance()
language plpgsql as $$
declare
  run bigint;
  acc jsonb := '{"tombstones":0,"activity":0,"handoffs":0,"unpinned":0,"groups":0,"skipped":[]}';
  g uuid;
  r jsonb;
  err text;
begin
  run := private.maintenance_begin();
  commit;
  for g in select x from private.purge_candidates() x loop
    r := private.purge_group_safe(g);
    if r ? 'error' then acc := jsonb_set(acc, '{skipped}', (acc -> 'skipped') || jsonb_build_object('group', g, 'error', r ->> 'error'));
    else acc := private.maintenance_add(acc, r); end if;
    commit;
  end loop;
  for g in select id from public.groups where deleted_at < now() - make_interval(days => private.tombstone_days()) order by id loop
    err := private.hard_delete_group_safe(g);
    if err is null then acc := jsonb_set(acc, '{groups}', to_jsonb((acc ->> 'groups')::int + 1));
    else acc := jsonb_set(acc, '{skipped}', (acc -> 'skipped') || jsonb_build_object('group', g, 'error', err)); end if;
    commit;
  end loop;
  perform private.maintenance_end(run, acc || private.purge_logs());
  commit;
end $$;

-- ───────────────────────── Usunięcie konta (M-68, M-183) ─────────────────────────
-- Uzupełnia private.delete_account_data (20261007110000), które obsługuje grupy poza koszem. Tu: (1) grupy w koszu —
-- owner przekazuje własność dorosłemu z najdłuższym stażem (najpierw admin; ta sama reguła D49), grupa zostaje w koszu
-- z tą samą datą, więc nowy owner może ją przywrócić; osoba wychodzi z grupy jak przy zwykłym usunięciu konta;
-- (2) nieudane próby dołączenia znikają razem z kontem (polityka prywatności: „dane usuwane z kontem”).
create function private.delete_account_trash(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m record; heir uuid;
begin
  perform set_config('organizer.trash_ok', 'on', true);
  for m in
    select gm.member_id, gm.group_id, gm.role from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and gm.deleted_at is null and g.deleted_at is not null and g.kind = 'shared'
    order by gm.group_id
  loop
    perform 1 from public.groups where id = m.group_id for update;
    if m.role = 'owner' then
      select gm.member_id into heir from public.group_members gm
      where gm.group_id = m.group_id and gm.deleted_at is null and gm.user_id is not null
        and gm.user_id <> uid and gm.role in ('admin', 'member')
      order by (gm.role = 'admin') desc, gm.created_at, gm.member_id
      limit 1;
      if heir is not null then update public.group_members set role = 'owner' where member_id = heir; end if;
    end if;
    update public.group_members set deleted_at = now(), role = case when role = 'owner' then 'member' else role end
      where member_id = m.member_id;
  end loop;
  delete from private.join_attempts where user_id = uid;
end $$;

create function private.on_auth_user_deleted_trash() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.delete_account_trash(old.id);
  return old;
end $$;

create trigger on_auth_user_deleted_trash before delete on auth.users
  for each row execute function private.on_auth_user_deleted_trash();

-- ───────────────────────── Harmonogram ─────────────────────────
select cron.schedule('organizer-daily-maintenance', '17 3 * * *', 'call private.run_daily_maintenance()');

revoke all on function private.purge_group(uuid), private.purge_candidates(), private.purge_group_safe(uuid),
  private.hard_delete_group_safe(uuid), private.purge_logs(), private.maintenance_begin(), private.maintenance_end(bigint, jsonb),
  private.maintenance_add(jsonb, jsonb), private.delete_account_trash(uuid), private.on_auth_user_deleted_trash()
  from public, anon, authenticated;
revoke all on procedure private.run_daily_maintenance() from public, anon, authenticated;
revoke all on function private.daily_maintenance(), private.purge_tombstones() from public, anon, authenticated;
grant execute on function private.purge_tombstones() to service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
