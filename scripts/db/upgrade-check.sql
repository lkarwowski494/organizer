-- Po wszystkich migracjach na bazie z danymi: dane przetrwały, a nowe kolumny są wypełnione.
do $$
begin
  if (select count(*) from public.groups where id = 'f0f00000-0000-7000-8000-000000000001') <> 1 then raise exception 'upgrade: grupa zniknęła'; end if;
  if (select count(*) from public.tasks where id = 'f0f00000-0000-7000-8000-0000000004d1') <> 1 then raise exception 'upgrade: zadanie zniknęło'; end if;
  if exists (select 1 from public.groups where kind = 'shared' and join_id is null) then raise exception 'upgrade: grupa wspólna bez ID (D92)'; end if;
end $$;
