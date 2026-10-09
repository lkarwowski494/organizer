-- Audyt 3, PK-01, N-2 (A3-06-2) i decyzja Q12 część 3 (A): jedno konto nie zapełni darmowej bazy (500 MB — projekt
-- przechodzi wtedy w tryb tylko do odczytu dla wszystkich: „Free Plan projects enter read-only mode when your database
-- size exceeds 500 MB.”, https://supabase.com/docs/guides/platform/database-size), a jedna porcja pobrania nie urośnie
-- do dziesiątek MB. Dotąd limit częstości był tylko w sync_push (private.claim_client), a kolumnowe GRANT INSERT/UPDATE
-- pozwalały pisać do tabel z pominięciem go; sort_key nie miał limitu długości.
--  1. Klucz kolejności (tasks.sort_key, lists.sort_key) najwyżej config.lengths.SORT_KEY znaków; dłuższe istniejące
--     klucze skracamy (początek klucza zachowuje kolejność).
--  2. Limit grupy (Q12 część 3 A): najwyżej max_group_rows() żywych (nieusuniętych) wierszy wszystkich spraw grupy
--     (zadania, listy, wydarzenia, uczestnicy, wyjątki terminów, serie, przekazania, odpowiedzi, zakupy, członkowie…)
--     i max_group_bytes() ich łącznego rozmiaru (JSON wiersza, tak jak go pobiera telefon). Zapis, który zwiększa liczbę
--     albo rozmiar ponad limit, serwer odrzuca kodem limit:group_rows / limit:group_size (telefon: „Odrzucone zmiany”
--     z wyjaśnieniem). Usuwanie zawsze przechodzi i od razu zwalnia miejsce.
--  3. Limit zapisów konta wspólny dla obu dróg (sync_push i bezpośredni zapis do tabel): najwyżej write_bytes_per_day()
--     bajtów zapisanych żywych wierszy na dobę. Ponad limit całe wywołanie kończy się błędem przejściowym 'rate_limited'
--     (SQLSTATE 53300 — sync_push go nie łapie per operacja, więc nic nie zostaje odrzucone na stałe; telefon ponawia
--     z opóźnieniem jak przy każdym błędzie serwera, kolejka zostaje). Usunięcia się nie liczą.
-- Liczby: src/config (quotas.GROUP_ROWS, GROUP_BYTES, WRITE_BYTES_PER_DAY, lengths.SORT_KEY; test kontraktowy).
-- Zapisy serwera bez konta (sprzątanie, migracje) tylko aktualizują liczniki.
-- Nowe obiekty: private.max_group_rows(), private.max_group_bytes(), private.write_bytes_per_day(),
-- private.rate_take(uuid, text, interval, int, int), tabela private.group_usage, private.group_usage_add(uuid, bigint, bigint, boolean),
-- private.group_usage_track() i wyzwalacze
-- <tabela>_z_usage_ins/_upd/_del na 12 tabelach spraw, ograniczenia tasks_sort_key_length, lists_sort_key_length.
-- Testy: supabase/tests/server_limits.test.sql.

create function private.max_group_rows() returns int language sql immutable as $$ select 20000 $$;
create function private.max_group_bytes() returns int language sql immutable as $$ select 26214400 $$;
create function private.write_bytes_per_day() returns int language sql immutable as $$ select 20971520 $$;

-- ───────────────────────── 1. Klucz kolejności ─────────────────────────
update public.tasks set sort_key = left(sort_key, 128) where char_length(sort_key) > 128;
update public.lists set sort_key = left(sort_key, 128) where char_length(sort_key) > 128;
alter table public.tasks add constraint tasks_sort_key_length check (char_length(sort_key) <= 128);
alter table public.lists add constraint lists_sort_key_length check (char_length(sort_key) <= 128);

-- ───────────────────────── 3. Licznik z wagą ─────────────────────────
-- Jak private.rate_hit (to samo okno stałe od pierwszego zapisu w oknie), ale wywołanie zużywa `amount` jednostek.
-- false = ponad limit (nic nie zużyte).
create function private.rate_take(uid uuid, k text, win interval, lim int, amount int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c private.rate_counters; t timestamptz := clock_timestamp();
begin
  insert into private.rate_counters (user_id, kind, window_start, n) values (uid, k, t, 0) on conflict do nothing;
  select * into c from private.rate_counters where user_id = uid and kind = k for update;
  if c.window_start <= t - win then c.window_start := t; c.n := 0; end if;
  if c.n::bigint + amount > lim then return false; end if;
  update private.rate_counters set window_start = c.window_start, n = c.n + amount where user_id = uid and kind = k;
  return true;
end $$;

-- ───────────────────────── 2. Liczniki grupy ─────────────────────────
create table private.group_usage (
  group_id uuid primary key references public.groups (id) on delete cascade,
  live_rows bigint not null default 0,
  live_bytes bigint not null default 0
);

-- Wyzwalacz na poziomie polecenia (tabele przejściowe): jeden wpis na grupę na polecenie, także przy wstawieniu tysięcy
-- wierszy naraz. Usunięcie (DELETE) tylko odejmuje — przy usuwaniu całej grupy jej licznik może już nie istnieć.
-- Zmiana licznika jednej grupy o (rows, bytes); przy wzroście ponad limit — odrzucenie (tylko zapis osoby, nie serwera).
create function private.group_usage_add(gid uuid, rows bigint, bytes bigint, removing boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u private.group_usage;
begin
  if removing then
    update private.group_usage set live_rows = live_rows + rows, live_bytes = live_bytes + bytes where group_id = gid;
    return;
  end if;
  insert into private.group_usage as g (group_id, live_rows, live_bytes) values (gid, rows, bytes)
    on conflict (group_id) do update set live_rows = g.live_rows + excluded.live_rows, live_bytes = g.live_bytes + excluded.live_bytes
    returning * into u;
  if (select auth.uid()) is null then return; end if;
  if rows > 0 and u.live_rows > private.max_group_rows() then raise exception 'limit:group_rows' using errcode = 'P0001'; end if;
  if bytes > 0 and u.live_bytes > private.max_group_bytes() then raise exception 'limit:group_size' using errcode = 'P0001'; end if;
end $$;

-- Wyzwalacz na poziomie polecenia (tabele przejściowe): jeden wpis na grupę na polecenie, także przy wstawieniu tysięcy
-- wierszy naraz. Liczą się wiersze żywe (deleted_at is null), rozmiar = JSON wiersza. Usunięcie (DELETE) tylko odejmuje —
-- przy usuwaniu całej grupy jej licznik może już nie istnieć. Każda gałąź czyta tylko tabele przejściowe swojego zdarzenia.
create function private.group_usage_track() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  d record;
  spent bigint := 0;
begin
  if tg_op = 'INSERT' then
    for d in select n.group_id, count(*) as rows, sum(octet_length(to_jsonb(n)::text)) as bytes
             from new_rows n where n.deleted_at is null group by n.group_id order by n.group_id loop
      perform private.group_usage_add(d.group_id, d.rows, d.bytes, false);
      spent := spent + d.bytes;
    end loop;
  elsif tg_op = 'UPDATE' then
    for d in select x.group_id, sum(x.live) as rows, sum(x.bytes) as bytes, sum(x.spent) as spent from (
               select n.group_id, 1 as live, octet_length(to_jsonb(n)::text) as bytes, octet_length(to_jsonb(n)::text) as spent
                 from new_rows n where n.deleted_at is null
               union all
               select o.group_id, -1, -octet_length(to_jsonb(o)::text), 0 from old_rows o where o.deleted_at is null
             ) x group by x.group_id order by x.group_id loop
      perform private.group_usage_add(d.group_id, d.rows, d.bytes, false);
      spent := spent + d.spent;
    end loop;
  else
    for d in select o.group_id, count(*) as rows, sum(octet_length(to_jsonb(o)::text)) as bytes
             from old_rows o where o.deleted_at is null group by o.group_id order by o.group_id loop
      perform private.group_usage_add(d.group_id, -d.rows, -d.bytes, true);
    end loop;
  end if;
  if me is not null and spent > 0
     and not private.rate_take(me, 'write_bytes', interval '1 day', private.write_bytes_per_day(), least(spent, 2147483647)::int) then
    raise exception 'rate_limited' using errcode = '53300';
  end if;
  return null;
end $$;

-- Wyzwalacze i stan początkowy liczników (z istniejących wierszy).
do $$
declare t text;
begin
  foreach t in array array['group_members', 'lists', 'object_members', 'tasks', 'events', 'event_participants', 'event_overrides',
                           'event_task_series', 'handoffs', 'event_rsvps', 'my_day_scopes', 'shopping_trips'] loop
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function private.group_usage_track()', t || '_z_usage_ins', t);
    execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function private.group_usage_track()', t || '_z_usage_upd', t);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function private.group_usage_track()', t || '_z_usage_del', t);
    execute format('insert into private.group_usage as g (group_id, live_rows, live_bytes)
                    select r.group_id, count(*), sum(octet_length(to_jsonb(r)::text)) from public.%I r where r.deleted_at is null group by r.group_id
                    on conflict (group_id) do update set live_rows = g.live_rows + excluded.live_rows, live_bytes = g.live_bytes + excluded.live_bytes', t);
  end loop;
end $$;

revoke all on function private.group_usage_track(), private.group_usage_add(uuid, bigint, bigint, boolean), private.rate_take(uuid, text, interval, int, int) from public, anon, authenticated;
revoke all on table private.group_usage from public, anon, authenticated;
revoke all on all functions in schema private from public, anon;
