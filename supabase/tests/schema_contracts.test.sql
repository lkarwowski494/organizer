-- Kontrakty schematu (audyt 2, M-154 / B-29): to, co dziś jest zgodne, ale niczym niepilnowane — każda nowa tabela albo
-- kolumna musi przejść te same reguły, zanim trafi na produkcję.
--  1. GRANT na kolumny = private.sync_entities (wstawienie = insert_cols, zmiana = patch_cols + deleted_at przy
--     miękkim usuwaniu); poza synchronizacją kolumny do zapisu mają tylko object_members (polecenia zakresu list)
--     i profiles (własne imię).
--  2. anon nie ma żadnych uprawnień do tabel ani kolumn public.
--  3. Każda tabela z group_id znika z grupą (hard_delete_group albo klucz obcy ON DELETE CASCADE); każda encja
--     synchronizacji z group_id jest w pobieraniu (group_rows_since) i ma znacznik wersji (stamp_version; groups —
--     groups_stamp); każda tabela z group_id i deleted_at jest czyszczona z kosza (purge_group) — wyjątki jawnie niżej.
--  4. Funkcje public tylko dla funkcji serwera (service_role) — dokładnie te; telefon (authenticated) ich nie wywoła.
begin;
select plan(10);

create function pg_temp.cols(t text, p text) returns text[] language sql as $$
  select coalesce(array_agg(column_name::text order by column_name), '{}') from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and table_name = t and privilege_type = p
$$;
create function pg_temp.sorted(a text[]) returns text[] language sql as $$ select coalesce(array_agg(x order by x), '{}') from unnest(a) x $$;
create function pg_temp.src(f text) returns text language sql as $$
  select string_agg(prosrc, E'\n') from pg_proc where pronamespace = 'private'::regnamespace and proname = f
$$;
create function pg_temp.grouped() returns setof text language sql as $$
  select c.table_name::text from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and c.column_name = 'group_id' and t.table_type = 'BASE TABLE'
$$;

select is_empty($$ select entity || ': wstawienie ' || pg_temp.cols(entity, 'INSERT')::text || ' ≠ ' || pg_temp.sorted(insert_cols)::text
  from private.sync_entities where pg_temp.cols(entity, 'INSERT') <> pg_temp.sorted(insert_cols) $$,
  'GRANT INSERT na kolumnach = insert_cols każdej encji synchronizacji');
select is_empty($$ select entity || ': zmiana ' || pg_temp.cols(entity, 'UPDATE')::text || ' ≠ ' || pg_temp.sorted(patch_cols || case when soft_delete then '{deleted_at}'::text[] else '{}' end)::text
  from private.sync_entities where pg_temp.cols(entity, 'UPDATE') <> pg_temp.sorted(patch_cols || case when soft_delete then '{deleted_at}'::text[] else '{}' end) $$,
  'GRANT UPDATE na kolumnach = patch_cols (+ deleted_at przy miękkim usuwaniu)');
select is((select array_agg(distinct table_name::text order by table_name::text) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')
             and table_name not in (select entity from private.sync_entities)),
  array['object_members', 'profiles'], 'poza synchronizacją zapis kolumn tylko w object_members i profiles');
select is(pg_temp.cols('profiles', 'UPDATE') || pg_temp.cols('profiles', 'INSERT'), array['display_name'], 'profiles: tylko własne imię');

select is((select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')
        + (select count(*)::int from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public'), 0,
  'anon: żadnych uprawnień do tabel i kolumn public (wszystkie tabele)');

select is_empty($$ select t from pg_temp.grouped() t
  where pg_temp.src('hard_delete_group') !~ ('public\.' || t || '\M')
    and not exists (select 1 from pg_constraint k where k.contype = 'f' and k.conrelid = ('public.' || t)::regclass
                    and k.confrelid = 'public.groups'::regclass and k.confdeltype = 'c') $$,
  'każda tabela z group_id znika z grupą (hard_delete_group albo ON DELETE CASCADE)');
-- Zaproszenia i wyciszenia nie są encjami synchronizacji (czyta je RPC), więc nie ma ich w pobieraniu.
select is_empty($$ select entity from private.sync_entities where entity <> 'groups' and pg_temp.src('group_rows_since') !~ ('public\.' || entity || '\M') $$,
  'każda encja synchronizacji jest w pobieraniu (group_rows_since)');
select is_empty($$ select entity from private.sync_entities e where entity <> 'groups'
  and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || e.entity)::regclass and g.tgfoid = 'private.stamp_version'::regproc) $$,
  'każda encja synchronizacji ma znacznik wersji (stamp_version; groups — groups_stamp)');
-- Wyjątek (stan 8.10.2026, purge_group z 20261008480000_retention.sql): usunięte członkostwa zostają w bazie.
select is_empty($$ select t from pg_temp.grouped() t
  where t <> 'group_members'
    and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'deleted_at')
    and pg_temp.src('purge_group') !~ ('public\.' || t || '\M') $$,
  'każda tabela z group_id i deleted_at jest czyszczona z kosza (purge_group), poza jawnymi wyjątkami');

select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and not has_function_privilege('authenticated', p.oid, 'execute')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['assignment_push_claim', 'drop_push_token', 'handoff_push_claim', 'notify_rate_hit', 'push_claim_release', 'wake_push_claim', 'wake_push_release'],
  'funkcje public tylko dla service_role: dokładnie te (telefon ich nie wywoła — każda nowa otwarta funkcja potrzebuje testu RLS)');

select * from finish();
rollback;
