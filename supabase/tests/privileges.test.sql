-- Uprawnienia ról (D41): dokładna lista — nic więcej, niezależnie od uprawnień domyślnych projektu.
-- Nakładka lokalna włącza „otwarte” uprawnienia domyślne starszych projektów Supabase, więc ten test
-- sprawdza, że migracje same je zamykają.
begin;
select plan(17);

select table_privs_are('public', t, 'anon', array[]::text[], 'anon: brak dostępu do ' || t)
  from unnest(array['groups', 'group_members', 'profiles', 'lists', 'object_members', 'tasks', 'activity']) t;

select table_privs_are('public', 'groups', 'authenticated', array['SELECT'], 'groups: tylko odczyt tabeli (UPDATE kolumny name osobno)');
select table_privs_are('public', 'tasks', 'authenticated', array['SELECT'], 'tasks: bez INSERT/UPDATE/DELETE na całej tabeli');
select table_privs_are('public', 'activity', 'authenticated', array['SELECT'], 'activity: tylko odczyt');
select is((select count(*)::int from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('DELETE', 'TRUNCATE')), 0,
  'nikt z aplikacji nie usuwa twardo');
select is((select array_agg(column_name::text order by column_name) from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and table_name = 'tasks' and privilege_type = 'UPDATE'),
  array['assignee_member_id', 'completed_at', 'deadline_mode', 'deleted_at', 'due_date', 'due_time', 'note', 'sort_key', 'start_date', 'title'],
  'tasks: UPDATE tylko na kolumnach z białej listy');
select is((select count(*)::int from information_schema.column_privileges
           where grantee = 'authenticated' and table_schema = 'public' and column_name in ('version', 'group_id', 'depth', 'created_by', 'completed_by', 'owner_member_id', 'user_id')
             and privilege_type = 'UPDATE'), 0, 'kolumny serwerowe niezmienialne przez klienta');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
             -- bez funkcji rozszerzeń (pgTAP, pgcrypto) — w Supabase leżą w schemacie extensions
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), 0, 'anon nie wywołuje żadnej naszej funkcji public');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon nie wywołuje żadnej funkcji private');
select ok(not has_function_privilege('authenticated', 'private.purge_tombstones()', 'execute'), 'czyszczenie tylko dla service_role');
select ok(not has_function_privilege('authenticated', 'private.bump_group_version(uuid)', 'execute'), 'licznik wersji nie do wywołania z aplikacji');

select * from finish();
rollback;
