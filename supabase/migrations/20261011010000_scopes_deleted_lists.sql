-- „scopes” w sync_pull także z ukrytymi listami z kosza (symulator synchronizacji, src/domain/__tests__/sync-sim.test.ts,
-- seed -694076517; regresje „usunięcie ukrytej listy…” i „dostęp do ukrytej listy, którą zaraz usunięto…”). Testy:
-- supabase/tests/scopes_deleted_lists.test.sql.
--
-- Dotąd „scopes” podawało tylko żywe ukryte listy (warunek deleted_at is null z Etapu 1, sprzed kosza D151). Telefon
-- używa tego zbioru na dwa sposoby i oba zawodziły przy liście usuniętej, którą nadal widzę (jest w koszu i w „lists”):
--  1. lista, która zniknęła ze „scopes”, to dla telefonu utracony dostęp — czyścił wszystkie jej wiersze, a wracały tylko
--     te z nową wersją (lista i zadania usunięte razem z nią). Nagrobki zadań usuniętych wcześniej osobno, wpisy dostępu
--     i historia listy (wersja ≤ kursor) znikały z telefonu, choć serwer nadal je pokazuje;
--  2. nowy zakres pobiera się przez sync_fetch_scope tylko z „scopes” — osoba, która dostała dostęp do listy usuniętej,
--     zanim telefon się o nim dowiedział, nie pobierała jej zawartości nigdy (wiersze ze starymi wersjami).
-- Teraz „scopes” = wszystkie ukryte listy moich grup, które widzę, także z kosza (aż do czyszczenia kosza — wtedy lista
-- znika z „scopes” i z „lists”, a telefon słusznie czyści jej wiersze). Telefony w buildzie 23 naprawiają się same:
-- usunięta lista wraca do „scopes”, więc telefon pobiera jej zawartość przez sync_fetch_scope (raz na listę).
-- Telefon od tej wersji dodatkowo uznaje zakres za utracony tylko wtedy, gdy listy nie ma też w „lists” grupy
-- (src/domain/sync-engine/client.ts) — dzięki temu (1) nie wraca także przy serwerze sprzed tej migracji ani przy liście poszerzonej (D139).
-- Odrzucone: tylko poprawka w telefonie — naprawia (1), nie (2), i nie pomaga buildowi 23.
-- Zastępuje: public.sync_pull (20261008484000_sync_perf) — poza warunkiem „scopes” bez zmian. Sygnatura i uprawnienia bez zmian.
create or replace function public.sync_pull(cursors jsonb, lim int default 1000, schema_version int default 1, entities jsonb default null)
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
  -- Pełna lista grup i ukrytych list, które widzę (także z kosza): klient usuwa lokalnie wszystko spoza niej
  -- (utrata dostępu), a nowe zakresy pobiera przez sync_fetch_scope (wiersze mogą mieć stare wersje).
  return jsonb_build_object(
    'groups', out_groups,
    -- M-73: tylko listy moich grup; RLS (security invoker) zostawia listy, które widzę.
    'scopes', coalesce((select jsonb_agg(li.id order by li.id) from public.lists li
                        where li.group_id in (select private.my_group_ids())
                          and li.visibility <> 'group'), '[]'::jsonb));
end $$;
