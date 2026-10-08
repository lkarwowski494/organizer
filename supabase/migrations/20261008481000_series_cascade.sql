-- Audyt 2, paczka P16, M-74 (B-12): usunięcie listy albo wydarzenia usuwa definicje stałych zadań (event_task_series)
-- z tym samym znacznikiem kosza, a przywrócenie przywraca je razem (jak zadania listy, lists_cascade). Definicji nie da
-- się założyć ani przywrócić na usuniętej liście albo wydarzeniu. Dotąd definicja żyła dalej: telefony próbowały
-- dokładać kopie (odrzucane deleted:list), a lista z definicją nigdy nie znikała z kosza. Testy:
-- supabase/tests/series_cascade.test.sql.

create function private.lists_series_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.event_task_series set deleted_at = new.deleted_at where list_id = new.id and deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    -- Tylko te, które usunięto razem z listą, i tylko przy żywym wydarzeniu (inaczej strażnik odrzuci przywrócenie).
    update public.event_task_series s set deleted_at = null
      where s.list_id = new.id and s.deleted_at = old.deleted_at
        and exists (select 1 from public.events e where e.id = s.event_id and e.deleted_at is null);
  end if;
  return null;
end $$;

create trigger lists_d_series_cascade after update of deleted_at on public.lists
  for each row execute function private.lists_series_cascade();

create function private.events_series_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.event_task_series set deleted_at = new.deleted_at where event_id = new.id and deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.event_task_series s set deleted_at = null
      where s.event_id = new.id and s.deleted_at = old.deleted_at
        and exists (select 1 from public.lists l where l.id = s.list_id and l.deleted_at is null);
  end if;
  return null;
end $$;

create trigger events_d_series_cascade after update of deleted_at on public.events
  for each row execute function private.events_series_cascade();

-- Strażnik: nowa albo przywracana definicja (także przepięta na inne wydarzenie) — lista i wydarzenie muszą żyć.
-- Osobny wyzwalacz, żeby nie powielać strażnika z 20261008130000_event_task_series.sql.
create function private.event_task_series_parent_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'INSERT' or old.deleted_at is not null or new.list_id is distinct from old.list_id then
    if exists (select 1 from public.lists l where l.id = new.list_id and l.deleted_at is not null) then
      raise exception 'deleted:list' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or old.deleted_at is not null or new.event_id is distinct from old.event_id then
    if exists (select 1 from public.events e where e.id = new.event_id and e.deleted_at is not null) then
      raise exception 'deleted:event' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger event_task_series_a_parent before insert or update on public.event_task_series
  for each row execute function private.event_task_series_parent_guard();

-- Dane sprzed migracji: żywe definicje na usuniętej liście albo wydarzeniu idą do kosza ze znacznikiem rodzica (przywrócenie
-- rodzica je przywróci); grupy w koszu też (organizer.trash_ok).
do $$
begin
  perform set_config('organizer.trash_ok', 'on', true);
  update public.event_task_series s set deleted_at = coalesce(l.deleted_at, e.deleted_at)
    from public.lists l, public.events e
    where l.id = s.list_id and e.id = s.event_id and s.deleted_at is null
      and (l.deleted_at is not null or e.deleted_at is not null);
  perform set_config('organizer.trash_ok', '', true);
end $$;

revoke all on function private.lists_series_cascade(), private.events_series_cascade(), private.event_task_series_parent_guard()
  from public, anon, authenticated;
