-- Protokół synchronizacji v2 (audyt 2, paczka P1). Testy: supabase/tests/sync_protocol_v2.test.sql.
--  M-1  pętla resync: pobieranie porcjami po czyszczeniu kosza wracało w kółko do pierwszej porcji;
--  M-4  purged_version tylko do wersji usuniętych wierszy (dotąd bieżąca wersja grupy — resync prawie u każdego);
--  M-54 telefon dowiaduje się o zawężeniu widoczności listy i o zadaniu przeniesionym do listy, której nie widzi;
--  M-56 odrzucenie zapamiętane do potwierdzenia — po zgubionej odpowiedzi powtórka dostaje to samo odrzucenie;
--  M-57 upgrade_required także przy pobieraniu (minimalna wersja protokołu: private.schema_version());
--  M-58 serwer wysyła tylko encje, które telefon zna.
-- Zgodność: build 21 (protokół 1: kursor-liczba, bez listy encji) dostaje odpowiedzi jak dotąd — te same pola,
-- ten sam zestaw encji — z dwiema poprawkami, które działają bez zmiany telefonu: koniec pętli resync (pobranie od zera
-- po czyszczeniu = cała grupa w jednej porcji) i odrzucenie zamiast „duplicate” po zgubionej odpowiedzi.
-- Zastępuje: public.sync_pull i public.sync_push (20261006120200_sync.sql), private.purge_tombstones
-- (20261008280000_audit_fixes.sql).

-- ───────────────────────── M-58: encje protokołu 1 ─────────────────────────
-- Telefon bez listy encji (build 21) dostaje dokładnie dzisiejszy zestaw. Nowe tabele dostają tylko telefony, które
-- je wymienią w „entities” (src/domain/sync-engine/client.ts, ENTITIES) — stary telefon nie przesuwa już kursora nad
-- wierszami, których nie umie zapisać.
create function private.legacy_entities() returns text[] language sql immutable as $$
  select array['groups', 'group_members', 'lists', 'object_members', 'tasks', 'activity', 'events', 'event_participants',
               'event_overrides', 'event_task_series', 'handoffs', 'event_rsvps']
$$;

-- ───────────────────────── M-54: zadania przeniesione poza mój wzrok ─────────────────────────
-- Zadania, które w zakresie wersji (since, upto] przeszły (move_task) z listy, którą widzę, do listy, której nie widzę —
-- telefon usuwa je u siebie. Ślad przeniesienia: wpis aktywności z changes.list_id = [stara, nowa] (log_activity).
-- SECURITY DEFINER, bo wpis i zadanie mają już zakres nowej listy (RLS je ukrywa). Nic nie wycieka: zwracamy tylko
-- identyfikatory zadań, których historię w starej liście i tak widzę (wpisy aktywności z zakresem starej listy).
create function private.tasks_moved_out(g uuid, since bigint, upto bigint) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct a.entity_id from public.activity a
  where a.group_id = g and a.version > since and a.version <= upto
    and a.entity = 'tasks' and a.changes ? 'list_id'
    and private.can_see_list((a.changes -> 'list_id' ->> 0)::uuid)
    and not exists (select 1 from public.tasks t where t.id = a.entity_id and private.can_see_list(t.list_id))
$$;

-- ───────────────────────── M-1, M-54, M-57, M-58: pobieranie ─────────────────────────
-- Nowe parametry z wartościami domyślnymi, więc wywołanie buildu 21 ({cursors, lim}) trafia w tę samą funkcję.
-- Starą sygnaturę usuwamy: dwie przeciążone sync_pull z tymi samymi nazwami parametrów PostgREST uznaje za
-- niejednoznaczne (błąd PGRST203).
drop function public.sync_pull(jsonb, int);

create function public.sync_pull(cursors jsonb, lim int default 1000, schema_version int default 1, entities jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  ver int := coalesce(schema_version, 1);
  ents text[];
  m record;
  c jsonb;
  since bigint;
  known_p bigint;
  resync boolean;
  whole boolean;
  rows jsonb;
  top bigint;
  got_group boolean;
  one jsonb;
  out_groups jsonb := '[]'::jsonb;
  l int := least(greatest(coalesce(lim, 1000), 1), private.pull_limit_max());
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if ver < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if ver >= 2 and entities is not null then
    if jsonb_typeof(entities) <> 'array' then raise exception 'invalid_entities' using errcode = 'P0001'; end if;
    ents := array(select jsonb_array_elements_text(entities));
  else
    ents := private.legacy_entities();
  end if;
  for m in
    select gm.group_id, gm.member_id, gm.role, gr.version, gr.purged_version
    from public.group_members gm join public.groups gr on gr.id = gm.group_id
    where gm.user_id = me and gm.deleted_at is null
    order by gm.group_id
  loop
    -- Kursor protokołu 2: {v, p} — wersja i epoka (purged_version z ostatniej odpowiedzi); protokołu 1: sama wersja.
    c := cursors -> m.group_id::text;
    if jsonb_typeof(c) = 'object' then
      since := coalesce((c ->> 'v')::bigint, 0);
      known_p := (c ->> 'p')::bigint;
    else
      since := coalesce((c #>> '{}')::bigint, 0);
      known_p := null;
    end if;
    -- Resync: kursor sprzed czyszczenia — telefon mógł nie dostać nagrobka wiersza, którego już nie ma. Telefon z epoką
    -- równą bieżącej pobiera dalej porcjami to samo pobranie (od jego początku nic nie wyczyszczono), więc dalsze porcje
    -- nie cofają się do zera (M-1). Bez epoki (protokół 1) — jak dotąd.
    resync := since > 0 and since < m.purged_version and (ver < 2 or known_p is distinct from m.purged_version);
    if resync then since := 0; end if;
    -- Zgodność z buildem 21: pobranie od zera w grupie po czyszczeniu dostaje całą grupę w jednej porcji. W porcjach
    -- następna miałaby kursor < purged_version, czyli znowu resync — pętla bez końca (M-1).
    whole := ver < 2 and since = 0 and m.purged_version > 0;
    select coalesce(jsonb_agg(jsonb_build_object('e', x.e, 'v', x.v, 'row', x.r) order by x.v) filter (where x.e = any (ents)), '[]'::jsonb),
           max(x.v), coalesce(bool_or(x.e = 'groups'), false)
      into rows, top, got_group
      from private.group_rows_since(m.group_id, since, case when whole then 2147483647 else l end) x;
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
    out_groups := out_groups || one;
  end loop;
  -- Pełna lista grup i ukrytych list, które widzę: klient usuwa lokalnie wszystko spoza niej
  -- (utrata dostępu), a nowe zakresy pobiera przez sync_fetch_scope (wiersze mogą mieć stare wersje).
  return jsonb_build_object(
    'groups', out_groups,
    'scopes', coalesce((select jsonb_agg(li.id order by li.id) from public.lists li
                        where li.visibility <> 'group' and li.deleted_at is null), '[]'::jsonb));
end $$;

-- ───────────────────────── M-56: odrzucenia do potwierdzenia ─────────────────────────
-- Wynik odrzuconej operacji, dopóki telefon go nie odebrał. Telefon wysyła paczkę od najmniejszego niepotwierdzonego
-- numeru, więc wpisy o numerach poniżej pierwszej operacji paczki są już odebrane i znikają (bez osobnego sprzątania).
-- op_id: inna operacja pod tym samym numerem (np. telefon odtworzony z kopii) nie dziedziczy cudzego odrzucenia.
create table private.sync_rejections (
  client_id uuid not null references private.sync_clients (client_id) on delete cascade,
  seq bigint not null,
  op_id text,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, seq)
);

-- Tylko dla instalacji bieżącego użytkownika (sync_push sprawdza to już w claim_client — tu drugi raz, bo funkcje są
-- SECURITY DEFINER).
create function private.remember_rejection(cid uuid, s bigint, oid text, code text) returns void
language sql security definer set search_path = '' as $$
  insert into private.sync_rejections (client_id, seq, op_id, code)
  select cid, s, oid, code where exists (select 1 from private.sync_clients c where c.client_id = cid and c.user_id = (select auth.uid()))
  on conflict (client_id, seq) do update set op_id = excluded.op_id, code = excluded.code, created_at = now()
$$;

create function private.recall_rejection(cid uuid, s bigint, oid text) returns text
language sql stable security definer set search_path = '' as $$
  select r.code from private.sync_rejections r join private.sync_clients c on c.client_id = r.client_id
  where r.client_id = cid and r.seq = s and r.op_id is not distinct from oid and c.user_id = (select auth.uid())
$$;

create function private.forget_rejections(cid uuid, below bigint) returns void
language sql security definer set search_path = '' as $$
  delete from private.sync_rejections r using private.sync_clients c
  where r.client_id = cid and r.seq < below and c.client_id = r.client_id and c.user_id = (select auth.uid())
$$;

-- Zastępuje wersję z 20261006120200_sync.sql. Nowe tylko: zapamiętanie odrzucenia i jego zwrot przy powtórce (M-56).
create or replace function public.sync_push(client_id uuid, schema_version int, ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  last bigint;
  op jsonb;
  seq bigint;
  results jsonb := '[]'::jsonb;
  touched uuid[] := '{}';
  g uuid;
  code text;
  st text;
begin
  if schema_version < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(ops) <> 'array' then raise exception 'invalid_batch' using errcode = 'P0001'; end if;
  if jsonb_array_length(ops) > private.push_batch_max() then raise exception 'batch_too_large' using errcode = 'P0001'; end if;
  last := private.claim_client(client_id);
  perform private.forget_rejections(client_id, (select min((x ->> 'seq')::bigint) from jsonb_array_elements(ops) x));

  for op in select value from jsonb_array_elements(ops) loop
    seq := (op ->> 'seq')::bigint;
    if seq is null then raise exception 'invalid_batch:seq' using errcode = 'P0001'; end if;
    if seq <= last then
      -- Już przetworzona (np. odpowiedź zginęła w sieci i klient ponawia): nic nie robimy drugi raz. Odrzucenie
      -- zwracamy jeszcze raz (M-56) — inaczej zmiana znikała z telefonu bez wpisu w „Odrzuconych zmianach”.
      code := private.recall_rejection(client_id, seq, op ->> 'op_id');
      results := results || case when code is null then jsonb_build_object('seq', seq, 'status', 'duplicate')
                                 else jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code) end;
      continue;
    end if;
    last := seq;
    perform set_config('organizer.op_id', coalesce(op ->> 'op_id', ''), true);
    begin
      g := private.apply_op(op);
      if g is not null then touched := touched || g; end if;
      results := results || jsonb_build_object('seq', seq, 'status', 'ok');
    exception
      -- Błędy przejściowe przerywają całe wywołanie — klient ponowi z opóźnieniem, nic nie zostało zapisane.
      when serialization_failure or deadlock_detected or lock_not_available or query_canceled
           or admin_shutdown or crash_shutdown or cannot_connect_now or too_many_connections then
        raise;
      when others then
        get stacked diagnostics st = returned_sqlstate;
        code := case
          when st = 'P0001' then sqlerrm
          when st = '42501' then 'forbidden'
          when st like '23%' then 'invalid:' || st
          when st like '22%' then 'invalid_value'
          else 'error:' || st end;
        results := results || jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code);
        perform private.remember_rejection(client_id, seq, op ->> 'op_id', code);
    end;
  end loop;
  perform set_config('organizer.op_id', '', true);
  perform private.set_client_seq(client_id, last);
  perform private.poke_groups(touched);
  return jsonb_build_object('last_seq', last, 'results', results);
end $$;

-- ───────────────────────── M-4: czyszczenie kosza ─────────────────────────
-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Jedyna zmiana: purged_version = najwyższa wersja usuniętych
-- wierszy (wszystkich tabel, także aktywności), a nie bieżąca wersja grupy. Telefon, który widział nagrobek (kursor ≥
-- jego wersji), nie potrzebuje resync; dotąd dostawał go każdy telefon, który nie pobrał ostatniej zmiany przed
-- sprzątaniem. Wartość tylko rośnie (greatest), więc kolejne sprzątania nie cofają epoki.
create or replace function private.purge_tombstones() returns int
language plpgsql security definer set search_path = '' as $$
declare
  horizon timestamptz := now() - make_interval(days => private.tombstone_days());
  total int := 0;
  n int;
  k int;
  v bigint;
  top bigint;
  g uuid;
  ids uuid[];
begin
  for g in select id from public.groups order by id loop
    begin
      perform 1 from public.groups where id = g for update;
      n := 0;
      top := 0;
      with recursive keep as (
        select t.id, t.parent_id from public.tasks t
        where t.group_id = g and (t.deleted_at is null or t.deleted_at >= horizon)
        union
        select x.id, x.parent_id from public.tasks x join keep on x.id = keep.parent_id
      )
      select coalesce(array_agg(t.id), '{}') into ids from public.tasks t
      where t.group_id = g and t.deleted_at < horizon and t.id not in (select keep.id from keep);
      with d as (delete from public.activity a where a.entity = 'tasks' and a.entity_id = any (ids) returning a.version)
        select coalesce(max(d.version), 0) into v from d;
      top := greatest(top, v);
      with d as (delete from public.tasks where id = any (ids) returning version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      with d as (delete from public.object_members where group_id = g and deleted_at < horizon returning version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      -- Definicje stałych zadań: usunięte i bez kopii (kopia wskazuje definicję kluczem obcym).
      with d as (delete from public.event_task_series s where s.group_id = g and s.deleted_at < horizon
                   and not exists (select 1 from public.tasks t where t.series_id = s.id) returning s.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      with d as (delete from public.lists l where l.group_id = g and l.deleted_at < horizon
                   and not exists (select 1 from public.tasks t where t.list_id = l.id)
                   and not exists (select 1 from public.event_task_series s where s.list_id = l.id) returning l.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      with d as (delete from public.event_overrides o where o.group_id = g
                   and (o.deleted_at < horizon or exists (select 1 from public.events e where e.id = o.event_id and e.deleted_at < horizon))
                 returning o.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      -- Odpowiedzi (D124): usunięte albo przy wydarzeniu z kosza.
      with d as (delete from public.event_rsvps r where r.group_id = g
                   and (r.deleted_at < horizon or exists (select 1 from public.events e where e.id = r.event_id and e.deleted_at < horizon))
                 returning r.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      with d as (delete from public.event_participants p where p.group_id = g
                   and (p.deleted_at < horizon or exists (select 1 from public.events e where e.id = p.event_id and e.deleted_at < horizon))
                 returning p.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      with d as (delete from public.activity a using public.events e
                   where a.entity = 'events' and a.entity_id = e.id and e.group_id = g and e.deleted_at < horizon
                   and not exists (select 1 from public.tasks t where t.event_id = e.id)
                   and not exists (select 1 from public.event_task_series s where s.event_id = e.id)
                 returning a.version)
        select coalesce(max(d.version), 0) into v from d;
      top := greatest(top, v);
      -- Seria zostaje, dopóki wskazuje na nią zadanie albo definicja (klucze obce); zniknie, gdy one znikną.
      with d as (delete from public.events e where e.group_id = g and e.deleted_at < horizon
                   and not exists (select 1 from public.event_overrides o where o.event_id = e.id)
                   and not exists (select 1 from public.event_participants p where p.event_id = e.id)
                   and not exists (select 1 from public.event_rsvps r where r.event_id = e.id)
                   and not exists (select 1 from public.tasks t where t.event_id = e.id)
                   and not exists (select 1 from public.event_task_series s where s.event_id = e.id)
                 returning e.version)
        select count(*), coalesce(max(d.version), 0) into k, v from d;
      n := n + k; top := greatest(top, v);
      if top > 0 then update public.groups set purged_version = greatest(purged_version, top) where id = g; end if;
      total := total + n;
    exception when others then
      raise warning 'purge_tombstones: grupa % pominięta: % (%)', g, sqlerrm, sqlstate;
    end;
  end loop;
  return total;
end $$;

revoke all on function private.purge_tombstones() from public, authenticated;
grant execute on function private.purge_tombstones() to service_role;
revoke all on function public.sync_pull(jsonb, int, int, jsonb), public.sync_push(uuid, int, jsonb) from public, anon;
grant execute on function public.sync_pull(jsonb, int, int, jsonb), public.sync_push(uuid, int, jsonb) to authenticated;
grant execute on function private.legacy_entities(), private.tasks_moved_out(uuid, bigint, bigint),
  private.remember_rejection(uuid, bigint, text, text), private.recall_rejection(uuid, bigint, text),
  private.forget_rejections(uuid, bigint) to authenticated;

-- Funkcje w private nie są dla nikogo poza jawnie wymienionymi wyżej (domyślnie Postgres daje EXECUTE roli PUBLIC).
revoke all on all functions in schema private from public, anon;
grant execute on function private.rrule_ok(text) to authenticated;
