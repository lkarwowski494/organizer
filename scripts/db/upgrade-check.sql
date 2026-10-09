-- Po wszystkich migracjach na bazie z danymi: dane przetrwały, a nowe kolumny są wypełnione.
do $$
begin
  if (select count(*) from public.groups where id = 'f0f00000-0000-7000-8000-000000000001') <> 1 then raise exception 'upgrade: grupa zniknęła'; end if;
  if (select count(*) from public.tasks where id = 'f0f00000-0000-7000-8000-0000000004d1') <> 1 then raise exception 'upgrade: zadanie zniknęło'; end if;
  if exists (select 1 from public.groups where kind = 'shared' and join_id is null) then raise exception 'upgrade: grupa wspólna bez ID (D92)'; end if;
  -- Audyt 3, N-1, N-2 (20261010010000_date_ranges, 20261010011000_write_limits): złe daty i za długie klucze naprawione,
  -- wiersze zostały, a wersja grupy poszła w górę (telefony pobiorą naprawiony wiersz).
  if (select count(*) from public.tasks where id in ('f0f00000-0000-7000-8000-0000000004e1', 'f0f00000-0000-7000-8000-0000000004e2')) <> 2
     or (select count(*) from public.events where id = 'f0f00000-0000-7000-8000-0000000001e1') <> 1 then raise exception 'upgrade: wiersz ze złą datą zniknął'; end if;
  if (select (due_date, due_time, start_date, completed_at, char_length(sort_key) < 5000)::text from public.tasks where id = 'f0f00000-0000-7000-8000-0000000004e1')
     <> ('2199-12-31'::date, '23:59'::time, '1900-01-01'::date, '1900-01-01 00:00:00+00'::timestamptz, true)::text then raise exception 'upgrade: zadanie nienaprawione'; end if;
  if (select (due_date, completed_at)::text from public.tasks where id = 'f0f00000-0000-7000-8000-0000000004e2')
     <> ('2199-12-31'::date, '2199-12-31 23:59:59+00'::timestamptz)::text then raise exception 'upgrade: daleki termin nienaprawiony'; end if;
  if (select (start_date, start_time, end_time)::text from public.events where id = 'f0f00000-0000-7000-8000-0000000001e1')
     <> ('1900-01-01'::date, '23:30'::time, '23:59'::time)::text then raise exception 'upgrade: wydarzenie nienaprawione'; end if;
  if (select week_a from public.group_members where member_id = 'f0f00000-0000-7000-8000-0000000000b1') is not null then raise exception 'upgrade: week_a nienaprawiony'; end if;
  if (select t.version from public.tasks t where t.id = 'f0f00000-0000-7000-8000-0000000004e2') <= (select b.version from upgrade_probe.before b)
    then raise exception 'upgrade: naprawa bez nowej wersji'; end if;
  -- Liczniki grupy (N-2, Q12 część 3) policzone z istniejących wierszy.
  if (select live_rows from private.group_usage where group_id = 'f0f00000-0000-7000-8000-000000000001')
     <> (select count(*) from public.tasks where group_id = 'f0f00000-0000-7000-8000-000000000001' and deleted_at is null)
      + (select count(*) from public.lists where group_id = 'f0f00000-0000-7000-8000-000000000001' and deleted_at is null)
      + (select count(*) from public.events where group_id = 'f0f00000-0000-7000-8000-000000000001' and deleted_at is null)
      + (select count(*) from public.group_members where group_id = 'f0f00000-0000-7000-8000-000000000001' and deleted_at is null)
    then raise exception 'upgrade: licznik wierszy grupy'; end if;
end $$;
