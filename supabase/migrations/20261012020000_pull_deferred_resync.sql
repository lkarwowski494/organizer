-- Seed 1482257602 (sync-sim): grupa odłożona przez budżet porcji (N-101, 20261012010000_pull_budget) przy pobraniu od zera
-- wraca z kursorem 0 i bez wierszy. Telefon (protokół 2) zapisuje ten kursor, a pustej porcji w toku (staged) jego baza
-- nie przechowuje — po ponownym uruchomieniu aplikacji grupa nie była już „od zera” (jest w kursorach), więc telefon
-- dokładał wiersze do starych zamiast je podmienić na komplecie. Wiersze, których serwer już nie ma (nagrobki wyczyszczone
-- z kosza), zostawały na telefonie na zawsze, np. usunięte zadanie jako niezrobione.
-- Poprawka: porcja dla kursora 0 przychodzi z resync = true — telefon (client.ts, fromScratch) zbiera grupę od nowa
-- i podmienia jej wiersze po ostatniej porcji. Działa w zainstalowanych buildach (bez nowej wersji aplikacji) i naprawia
-- telefony, które już zapisały kursor 0. Kursor 0 w zapytaniu znaczy zawsze, że telefon nie ma żadnego wiersza grupy
-- (wersje grup zaczynają się od 1), więc porcja w toku jest pusta i nic nie ginie. Protokół 1 bez zmian.
-- Test: supabase/tests/pull_deferred_resync.test.sql; atrapa: src/domain/__tests__/support/fake-server.ts.
-- Zastępuje: public.sync_pull(jsonb, int, int, jsonb) z 20261012010000_pull_budget (poza tym bez zmian).

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
  from_zero boolean;
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
    -- Kursor 0 w zapytaniu (protokół 2): telefon nie ma jeszcze żadnej porcji tej grupy — wróciła odłożona (N-101) przy
    -- pobraniu od zera. Porcja od zera idzie z resync, żeby telefon zebrał grupę w całości i podmienił jej wiersze.
    from_zero := ver >= 2 and jsonb_typeof(c) = 'object' and asked = 0;

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
        'resync', resync or from_zero, 'rows', rows);
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

revoke all on function public.sync_pull(jsonb, int, int, jsonb) from public, anon;
grant execute on function public.sync_pull(jsonb, int, int, jsonb) to authenticated;
