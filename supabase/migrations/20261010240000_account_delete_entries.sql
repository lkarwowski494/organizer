-- Audyt 3, PK-24, N-71 (decyzja Q5 C, 9.10.2026): przy usuwaniu konta osoba wybiera „Usuń też moje wpisy w grupach”.
-- Bez wyboru (domyślnie, także build 21) wpisy w grupach wspólnych zostają z podpisem „Usunięty użytkownik”, jak dotąd.
-- Z wyborem: zadania i rzeczy na listach zakupów, które dodała ta osoba (z podzadaniami), jej wydarzenia, stałe zadania
-- (definicje i niezrobione kopie od dziś — jak „Zakończ” na telefonie, src/domain/views/series-tasks.ts stopOps) i jej
-- odpowiedzi o obecności idą do kosza grupy tak samo, jak przy usunięciu w aplikacji: telefony innych pobierają usunięcie
-- przy następnej synchronizacji, a nocne sprzątanie (private.purge_tombstones) usuwa je na stałe po
-- private.tombstone_days() dniach. Twarde usunięcie od razu odpada: telefony innych nie dowiedziałyby się o nim i dalej
-- pokazywały te sprawy. Listy (także założone przez tę osobę) zostają — są w nich wpisy innych. Kopie stałych zadań
-- zrobione przez tę osobę na cudzych definicjach należą do serii (zostają), odpowiedzi dorosłego za dziecko są
-- odpowiedziami dziecka (zostają).
-- Wybór zapisuje funkcja serwerowa delete-account (prepare_account_deletion, z JWT użytkownika) tuż przed usunięciem
-- użytkownika w Auth; wykonuje go wyzwalacz przed usunięciem wiersza auth.users w tej samej transakcji co reszta
-- sprzątania (private.delete_account_data — nie zmieniane tutaj). Nazwa wyzwalacza zaczyna się od „on_auth_user_a_”, bo
-- wyzwalacze tego samego zdarzenia Postgres uruchamia w kolejności nazw („If more than one trigger is defined for the same
-- event on the same relation, the triggers will be fired in alphabetical order by trigger name”,
-- https://www.postgresql.org/docs/16/sql-createtrigger.html): wpisy idą do kosza, póki członkostwo jeszcze trwa, a wpisy
-- „usuwa” w historii dostają potem podpis „Usunięty użytkownik” razem z resztą historii.
-- Nowe: tabela private.account_deletion_options, funkcje public.prepare_account_deletion(boolean),
-- private.delete_account_entries(uuid), private.on_auth_user_delete_entries(), wyzwalacz on_auth_user_a_entries.

create table private.account_deletion_options (
  user_id uuid primary key references auth.users (id) on delete cascade,
  delete_entries boolean not null,
  updated_at timestamptz not null default now()
);
revoke all on private.account_deletion_options from public, anon, authenticated;

create function public.prepare_account_deletion(delete_entries boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  insert into private.account_deletion_options (user_id, delete_entries) values (me, coalesce(delete_entries, false))
    on conflict (user_id) do update set delete_entries = excluded.delete_entries, updated_at = now();
end $$;

create function private.delete_account_entries(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  members uuid[];
  groups_ uuid[];
  evs uuid[];
  defs uuid[];
  today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  if not coalesce((select o.delete_entries from private.account_deletion_options o where o.user_id = uid), false) then return; end if;
  select coalesce(array_agg(gm.member_id), '{}'), coalesce(array_agg(gm.group_id), '{}') into members, groups_
    from public.group_members gm join public.groups g on g.id = gm.group_id
    where gm.user_id = uid and gm.deleted_at is null and g.kind = 'shared';
  if cardinality(members) = 0 then return; end if;
  -- Grupy w koszu też (po przywróceniu przez następcę wpisy nie mogą wrócić); blokady w stałej kolejności jak w sync_push.
  perform set_config('organizer.trash_ok', 'on', true);
  perform 1 from public.groups where id = any (groups_) order by id for update;

  select coalesce(array_agg(e.id), '{}') into evs from public.events e
    where e.group_id = any (groups_) and e.created_by = any (members) and e.deleted_at is null;
  select coalesce(array_agg(s.id), '{}') into defs from public.event_task_series s
    where s.group_id = any (groups_) and s.deleted_at is null and (s.created_by = any (members) or s.event_id = any (evs));

  update public.tasks set deleted_at = now()
    where group_id = any (groups_) and deleted_at is null
      and ((created_by = any (members) and series_id is null)
        or (series_id = any (defs) and completed_at is null and occurrence_date >= today));
  update public.event_task_series set deleted_at = now() where id = any (defs) and deleted_at is null;
  update public.events set deleted_at = now() where id = any (evs) and deleted_at is null;
  update public.event_rsvps set deleted_at = now()
    where group_id = any (groups_) and member_id = any (members) and deleted_at is null;

  -- Wpisy „usuwa” w historii: wyzwalacz aktywności nie zna wykonawcy (brak sesji użytkownika), więc to ta osoba;
  -- private.delete_account_data zaraz zamieni jej podpis na „Usunięty użytkownik”.
  update public.activity a set actor_member_id = gm.member_id
    from public.group_members gm
    where gm.member_id = any (members) and gm.group_id = a.group_id
      and a.group_id = any (groups_) and a.actor_member_id is null and a.verb = 'delete' and a.created_at = now();
end $$;

create function private.on_auth_user_delete_entries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.delete_account_entries(old.id);
  return old;
end $$;

create trigger on_auth_user_a_entries before delete on auth.users
  for each row execute function private.on_auth_user_delete_entries();

revoke all on function public.prepare_account_deletion(boolean) from public, anon;
grant execute on function public.prepare_account_deletion(boolean) to authenticated;
revoke all on function private.delete_account_entries(uuid), private.on_auth_user_delete_entries() from public, anon, authenticated;
