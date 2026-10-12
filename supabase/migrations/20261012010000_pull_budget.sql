-- Audyt 3, PK-02: pobieranie (sync_pull, sync_fetch_scope). Testy: supabase/tests/pull_budget.test.sql,
-- tests/db/list-scoped.test.ts (kontrakt klient–serwer), src/config/__tests__/sql.contract.test.ts.
--  N-88  (A3-05-4) zrobione zakupy (shopping_trips) są zależne od listy jak zadania: poszerzenie widoczności listy podbija
--        ich wersje, a sync_fetch_scope (dostęp do ukrytej listy) je zwraca. Jedna lista tabel zależnych od listy
--        (private.list_scoped_entities()) dla obu miejsc — ta sama luka była już przy event_task_series; test schematu
--        pilnuje, że każda tabela z kolumną list_id jest na liście.
--  N-101 (A3-20-5) budżet wierszy na całą odpowiedź sync_pull (dotąd lim na każdą grupę: do 50 × 1000 wierszy, 17,5 MB
--        i 4,5 s przy 50 grupach), wynik bez kopiowania całej tablicy grup przy każdej grupie.
--  N-102 (A3-20-6) grupa bez zmian od kursora nie jest przeglądana (bez group_rows_since i bez listy jej list).
--  N-96  (A3-06-7) limit częstości sync_pull i sync_fetch_scope na konto (jak sync_push).
-- Zgodność: build 21 (protokół 1) dostaje te same pola co dotąd; grupa odłożona z braku budżetu wygląda dla niego jak
-- porcja bez wierszy z has_more (pobiera dalej, tak jak przy porcjach). Gałąź „cała grupa w jednej porcji” (M-1) zostaje.
-- Nowe: private.list_scoped_entities(), private.sync_pull_per_minute(), private.sync_rate_check(text).
-- Zastępuje: private.lists_widen_bump() (20261008300000_owner_decisions), public.sync_fetch_scope(uuid)
-- (20261008130000_event_task_series; teraz plpgsql i VOLATILE — liczy wywołania), public.sync_pull(jsonb, int, int, jsonb)
-- (20261011010000_scopes_deleted_lists; „scopes” z ukrytymi listami z kosza bez zmian). private.tasks_moved_out
-- i private.group_rows_since bez zmian.
-- Numer migracji: gałąź PK-02 miała 20261010020000, ale main wdrożył już późniejsze migracje (w tym
-- 20261011010000_scopes_deleted_lists, która też zastępuje sync_pull) — migracja musi iść po nich, inaczej od zera
-- późniejsza definicja nadpisałaby budżet, a `db push` odrzuca migracje starsze niż ostatnia wgrana.

-- ───────────────────────── N-88: tabele zależne od listy ─────────────────────────
-- Tabele, których wiersz należy do listy przez kolumnę list_id (widoczność: private.can_see_list(list_id)). Wpisy dostępu
-- (object_members) i historia (activity) należą do listy przez scope_id — obsługiwane osobno tam, gdzie trzeba.
-- Ten sam zbiór ma telefon i atrapa serwera: src/domain/sync-engine/list-scoped.ts (test kontraktowy).
create function private.list_scoped_entities() returns text[] language sql immutable as $$
  select array['tasks', 'event_task_series', 'shopping_trips']
$$;

-- Lista poszerzona do „cała grupa” (D139): podbijamy wersje wierszy listy, żeby zwykłe pobranie grupy je dowiozło.
-- Jak dotąd, plus zrobione zakupy (N-88) — przez wspólną listę tabel.
create or replace function private.lists_widen_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if old.visibility <> 'group' and new.visibility = 'group' then
    foreach t in array private.list_scoped_entities() loop
      execute format('update public.%I set version = version where list_id = $1', t) using new.id;
    end loop;
    update public.object_members om set version = om.version
      where om.scope_entity = 'lists' and om.scope_id = new.id and om.deleted_at is null
        and exists (select 1 from public.group_members m where m.member_id = om.member_id and m.deleted_at is null);
    update public.activity set version = private.bump_group_version(group_id) where scope_id = new.id;
  end if;
  return null;
end $$;

-- ───────────────────────── N-96: limit częstości pobierania ─────────────────────────
-- Wywołania sync_pull i (osobno) sync_fetch_scope na konto na minutę. Liczba: src/config quotas.SYNC_PULL_PER_MINUTE.
create function private.sync_pull_per_minute() returns int language sql immutable as $$ select 120 $$;

-- SECURITY DEFINER, bo licznik (private.rate_counters) jest niedostępny dla konta; konto zawsze własne (auth.uid()),
-- a rodzaj tylko z dwóch — nie da się zużyć cudzego limitu ani zakładać dowolnych liczników.
create function private.sync_rate_check(k text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if k not in ('sync_pull', 'sync_fetch_scope') then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  -- Ponad limit telefon traktuje to jak chwilowy błąd serwera i ponawia z opóźnieniem (src/sync/supabase.ts, classify).
  if not private.rate_hit(me, k, interval '1 minute', private.sync_pull_per_minute()) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── sync_fetch_scope ─────────────────────────
-- Pełna zawartość listy po uzyskaniu dostępu: wiersz listy, wiersze tabel zależnych (także zakupy, N-88), wpisy dostępu
-- i historia listy. RLS jak dotąd (SECURITY INVOKER) — lista, której nie widzę, daje pusty wynik.
create or replace function public.sync_fetch_scope(list_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  t text;
  part jsonb[];
  out_rows jsonb[] := '{}';
begin
  perform private.sync_rate_check('sync_fetch_scope');
  select coalesce(array_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r)), '{}') into out_rows from (
    select 'lists' e, l.version v, to_jsonb(l) r from public.lists l where l.id = sync_fetch_scope.list_id
    union all select 'object_members', o.version, to_jsonb(o) from public.object_members o where o.scope_id = sync_fetch_scope.list_id
    union all select 'activity', a.version, to_jsonb(a) from public.activity a where a.scope_id = sync_fetch_scope.list_id
  ) x;
  foreach t in array private.list_scoped_entities() loop
    execute format('select coalesce(array_agg(jsonb_build_object(''e'', %L, ''v'', r.version, ''row'', to_jsonb(r))), ''{}'') from public.%I r where r.list_id = $1', t, t)
      into part using sync_fetch_scope.list_id;
    out_rows := out_rows || part;
  end loop;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(x order by (x ->> 'v')::bigint) from unnest(out_rows) x), '[]'::jsonb));
end $$;

-- ───────────────────────── sync_pull ─────────────────────────
-- Jak w 20261011010000_scopes_deleted_lists (kursor z epoką, resync, „cała grupa” dla protokołu 1, filtr encji, lists,
-- gone, scopes także z kosza),
-- z trzema zmianami:
--  N-102: grupa bez zmian (wersja grupy ≤ kursor, bez resync) — od razu wpis z kursorem, bez wierszy i bez „lists”.
--         Wersja grupy to licznik wszystkich jej wierszy (private.bump_group_version), więc nic nowego tam nie ma; telefon
--         bez „lists” niczego nie usuwa (client.ts, listsOf). Dotąd każde puste pobranie przeglądało 14 tabel z RLS na
--         każdej grupie i zwracało id wszystkich list.
--  N-101: lim to budżet wierszy całej odpowiedzi, nie każdej grupy. Grupy po wyczerpaniu budżetu wracają odłożone:
--         rows [], has_more true, kursor z zapytania, bez resync, bez epoki i „lists” — telefon zostawia ich wiersze
--         i kursor (także epokę) bez zmian i pobiera dalej (needMore); następne pobranie zaczyna od nich (grupy, które
--         skończyły, są już bez zmian). Pierwsza grupa ze zmianami zawsze dostaje porcję, więc pobieranie się kończy.
--         Porcja może przekroczyć budżet o wiersze z tą samą wersją co ostatni (jak dotąd w jednej grupie), a gałąź
--         „cała grupa” protokołu 1 — o resztę grupy (rozmiar grupy ogranicza private.max_group_rows()).
--         Wynik składany w tablicy (array_append) i zamieniany na JSON raz — dotąd `out_groups || one` kopiował całą
--         odpowiedź przy każdej grupie.
--  N-96:  limit częstości (private.sync_rate_check).
create or replace function public.sync_pull(cursors jsonb, lim int default 1000, schema_version int default 1, entities jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  ver int := coalesce(schema_version, 1);
  ents text[];
  m record;
  c jsonb;
  asked bigint;
  since bigint;
  known_p bigint;
  resync boolean;
  whole boolean;
  rows jsonb;
  n int;
  top bigint;
  got_group boolean;
  one jsonb;
  out_groups jsonb[] := '{}';
  l int := least(greatest(coalesce(lim, 1000), 1), private.pull_limit_max());
  budget int := l;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if ver < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if ver >= 2 and entities is not null then
    if jsonb_typeof(entities) <> 'array' then raise exception 'invalid_entities' using errcode = 'P0001'; end if;
    ents := array(select jsonb_array_elements_text(entities));
  else
    ents := private.legacy_entities();
  end if;
  perform private.sync_rate_check('sync_pull');
  for m in
    select gm.group_id, gm.member_id, gm.role, gr.version, gr.purged_version
    from public.group_members gm join public.groups gr on gr.id = gm.group_id
    where gm.user_id = me and gm.deleted_at is null
    order by gm.group_id
  loop
    -- Kursor protokołu 2: {v, p} — wersja i epoka (purged_version z ostatniej odpowiedzi); protokołu 1: sama wersja.
    c := cursors -> m.group_id::text;
    if jsonb_typeof(c) = 'object' then
      asked := coalesce((c ->> 'v')::bigint, 0);
      known_p := (c ->> 'p')::bigint;
    else
      asked := coalesce((c #>> '{}')::bigint, 0);
      known_p := null;
    end if;
    since := asked;
    -- Resync: kursor sprzed czyszczenia — telefon mógł nie dostać nagrobka wiersza, którego już nie ma (M-1).
    resync := since > 0 and since < m.purged_version and (ver < 2 or known_p is distinct from m.purged_version);
    if resync then since := 0; end if;

    if not resync and m.version <= since then
      -- N-102: bez zmian. Pola jak dotąd przy pustej porcji, tylko bez „lists”.
      one := jsonb_build_object('group_id', m.group_id, 'member_id', m.member_id, 'role', m.role,
                                'cursor', since, 'has_more', false, 'resync', false, 'rows', '[]'::jsonb);
      if ver >= 2 then one := one || jsonb_build_object('purged', m.purged_version, 'gone', '[]'::jsonb); end if;
    elsif budget <= 0 then
      -- N-101: odłożona do następnego pobrania; kursor i epoka telefonu zostają.
      one := jsonb_build_object('group_id', m.group_id, 'member_id', m.member_id, 'role', m.role,
                                'cursor', asked, 'has_more', true, 'resync', false, 'rows', '[]'::jsonb);
      if ver >= 2 then one := one || jsonb_build_object('gone', '[]'::jsonb); end if;
    else
      -- Zgodność z buildem 21: pobranie od zera w grupie po czyszczeniu dostaje całą grupę w jednej porcji (M-1).
      whole := ver < 2 and since = 0 and m.purged_version > 0;
      select coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v) filter (where x.e = any (ents)), '[]'::jsonb),
             max(x.v), coalesce(bool_or(x.e = 'groups'), false), count(*)
        into rows, top, got_group, n
        from private.group_rows_since(m.group_id, since, case when whole then 2147483647 else least(l, budget) end) x;
      budget := budget - n;
      -- Wiersz grupy ma najwyższą wersję; jeśli go nie ma, a wiersze są, wynik został ucięty limitem. Kursor przechodzi też
      -- nad wierszami encji, których telefon nie zna (M-58).
      one := jsonb_build_object(
        'group_id', m.group_id, 'member_id', m.member_id, 'role', m.role,
        'cursor', coalesce(top, since), 'has_more', top is not null and not got_group,
        'resync', resync, 'rows', rows);
      if ver >= 2 then
        one := one || jsonb_build_object(
          -- Epoka do odesłania w następnym kursorze (M-1).
          'purged', m.purged_version,
          -- Wszystkie listy grupy, które widzę (także z kosza): telefon usuwa listy spoza zbioru z ich zawartością (M-54).
          'lists', (select coalesce(jsonb_agg(li.id order by li.id), '[]'::jsonb) from public.lists li where li.group_id = m.group_id),
          -- Zadania przeniesione do listy, której nie widzę. Przy pobraniu od zera zbędne: telefon czyści grupę.
          'gone', case when since > 0 and top is not null
                       then coalesce((select jsonb_agg(x order by x) from private.tasks_moved_out(m.group_id, since, top) x), '[]'::jsonb)
                       else '[]'::jsonb end);
      end if;
    end if;
    out_groups := array_append(out_groups, one);
  end loop;
  -- Pełna lista grup i ukrytych list, które widzę (także z kosza): klient usuwa lokalnie wszystko spoza niej
  -- (utrata dostępu), a nowe zakresy pobiera przez sync_fetch_scope (wiersze mogą mieć stare wersje).
  return jsonb_build_object(
    'groups', to_jsonb(out_groups),
    -- M-73: tylko listy moich grup; RLS (security invoker) zostawia listy, które widzę.
    'scopes', coalesce((select jsonb_agg(li.id order by li.id) from public.lists li
                        where li.group_id in (select private.my_group_ids())
                          and li.visibility <> 'group'), '[]'::jsonb));
end $$;

revoke all on function private.list_scoped_entities(), private.sync_pull_per_minute(), private.sync_rate_check(text) from public, anon;
grant execute on function private.list_scoped_entities(), private.sync_rate_check(text) to authenticated;
revoke all on function private.sync_pull_per_minute() from authenticated;
revoke all on function public.sync_pull(jsonb, int, int, jsonb), public.sync_fetch_scope(uuid) from public, anon;
grant execute on function public.sync_pull(jsonb, int, int, jsonb), public.sync_fetch_scope(uuid) to authenticated;
