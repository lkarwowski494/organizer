-- Audyt 3, PK-01, N-1 (A3-06-1): daty i godziny tylko z zakresu, który telefon umie pokazać. Dotąd serwer przyjmował
-- i rozsyłał np. 'infinity', '-infinity', '0044-03-15 BC', '5000000-01-01' i godzinę '24:00'; telefon (parseIsoDate,
-- src/domain/format.ts: RRRR-MM-DD) rzucał wyjątek w widoku i aplikacja padała przy każdym starcie u całej grupy.
-- Zakres: config.dates (src/config) — dzień od MIN do MAX, godzina przed 24:00, chwila (completed_at, done_at) od
-- MIN 00:00 UTC do dnia po MAX. Kontrakt z bazą: tests/db/config-sql.test.ts; każda kolumna date/time w public ma
-- ograniczenie <tabela>_<kolumna>_range (supabase/tests/server_limits.test.sql — także dla kolumn dodanych później).
-- Istniejące wiersze najpierw naprawiamy (wartość dosuwana do granicy; godzina 24:00 → 23:59; week_a poza zakresem →
-- brak tygodnia A/B), zmiana podbija wersję grupy, więc telefony dostają naprawiony wiersz przy najbliższym pobraniu.
-- Nowe obiekty: ograniczenia CHECK *_range na kolumnach dat i godzin. Kod odrzucenia zapisu: invalid:23514.

do $$
declare
  c record;
  lo constant date := '1900-01-01';
  hi constant date := '2199-12-31';
begin
  for c in
    select cl.relname as tab, a.attname as col, a.atttypid::regtype::text as typ
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid
    where cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and (a.atttypid in ('date'::regtype, 'time'::regtype)
           or (cl.relname, a.attname) in (('tasks', 'completed_at'), ('shopping_trips', 'done_at')))
    order by 1, 2
  loop
    if c.typ = 'date' then
      if c.tab = 'group_members' and c.col = 'week_a' then
        execute format('update public.%I set %I = null where %I not between %L and %L', c.tab, c.col, c.col, lo, hi);
      else
        execute format('update public.%I set %I = greatest(least(%I, %L::date), %L::date) where %I not between %L and %L',
                       c.tab, c.col, c.col, hi, lo, c.col, lo, hi);
      end if;
      execute format('alter table public.%I add constraint %I check (%I >= %L::date and %I <= %L::date)',
                     c.tab, c.tab || '_' || c.col || '_range', c.col, lo, c.col, hi);
    elsif c.typ like 'time%' and c.typ not like 'timestamp%' then
      execute format('update public.%I set %I = %L where %I >= %L', c.tab, c.col, '23:59', c.col, '24:00');
      execute format('alter table public.%I add constraint %I check (%I < %L::time)',
                     c.tab, c.tab || '_' || c.col || '_range', c.col, '24:00');
    else
      execute format('update public.%I set %I = greatest(least(%I, %L::timestamptz), %L::timestamptz) where %I < %L::timestamptz or %I >= %L::timestamptz',
                     c.tab, c.col, c.col, '2199-12-31 23:59:59+00', '1900-01-01 00:00:00+00', c.col, '1900-01-01 00:00:00+00', c.col, '2200-01-01 00:00:00+00');
      execute format('alter table public.%I add constraint %I check (%I >= %L::timestamptz and %I < %L::timestamptz)',
                     c.tab, c.tab || '_' || c.col || '_range', c.col, '1900-01-01 00:00:00+00', c.col, '2200-01-01 00:00:00+00');
    end if;
  end loop;
end $$;
