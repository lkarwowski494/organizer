-- Statyczna kontrola funkcji (regresja błędu z 7.10.2026): w funkcjach plpgsql warunek odmowy
-- „rola not in (…)” albo „rola <> …” na wyniku private.my_role() bez coalesce przepuszcza osobę spoza
-- grupy (NULL). Ten test przegląda kod wszystkich funkcji w schematach public i private.
begin;
select plan(2);
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
    and pg_get_functiondef(p.oid) ~* 'my_role\([^)]*\)\s*(not\s+in|<>|!=)'
$$, 'brak „my_role(…) not in / <>” bez coalesce');
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
    and pg_get_functiondef(p.oid) ~* 'actor_role text := private\.my_role'
$$, 'zmienna actor_role zawsze z coalesce');
select * from finish();
rollback;
