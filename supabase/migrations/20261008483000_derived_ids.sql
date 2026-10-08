-- Audyt 2, paczka P16, M-72 (B-10): identyfikatory wyliczane na telefonie (UUIDv5, RFC 9562) — odpowiedź o obecności,
-- wyjątek terminu, kopia stałego zadania serii, następny termin zadania powtarzanego — nie mogą być „zajęte” z wyprzedzeniem
-- przez innego członka grupy. Dotąd ktoś mógł założyć wiersz o id, które wyliczy telefon innej osoby (np. odpowiedź
-- „będę” za siebie pod jej id albo zadanie pod id jej następnego terminu we własnej liście prywatnej), i zablokować jej
-- zapis: serwer uznawał jej utworzenie za powtórzenie albo odrzucał je (23505).
-- Reguła: id w wersji 5 musi wynikać z treści wiersza tak samo jak na telefonie; inne id (UUIDv7 z telefonu, dawne losowe)
-- przechodzą bez zmian — także ze starszych wersji aplikacji, które nadawały losowe id wyjątkom i odpowiedziom.
-- Przestrzenie nazw = stałe z src/domain/views (rsvp.ts, events.ts, series-tasks.ts, task-repeat.ts; test kontraktowy
-- w src/config/__tests__/sql.contract.test.ts). Kod odrzucenia: invalid_id. Testy: supabase/tests/derived_ids.test.sql.

create function private.is_uuid_v5(id uuid) returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.substr(id::text, 15, 1) = '5'
$$;

create function private.event_rsvps_id_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and private.is_uuid_v5(new.id) and new.id <> private.uuid_v5('25e69e19-ed6c-5137-b6a6-d2fd2ff0a0e5'::uuid,
       new.event_id::text || '|' || pg_catalog.to_char(new.occurrence_date, 'YYYY-MM-DD') || '|' || new.member_id::text) then
    raise exception 'invalid_id' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger event_rsvps_a_id before insert on public.event_rsvps
  for each row execute function private.event_rsvps_id_guard();

create function private.event_overrides_id_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and private.is_uuid_v5(new.id) and new.id <> private.uuid_v5('507f935e-7343-5bf0-a46c-cedc524fb294'::uuid,
       new.event_id::text || '|' || pg_catalog.to_char(new.occurrence_date, 'YYYY-MM-DD')) then
    raise exception 'invalid_id' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger event_overrides_a_id before insert on public.event_overrides
  for each row execute function private.event_overrides_id_guard();

-- Zadanie z id w wersji 5 to kopia stałego zadania serii (id z definicji i daty, na liście definicji) albo następny termin
-- (id = next_task_id(poprzedniego) dla zadania z tej samej listy — kopia ląduje tam, gdzie poprzednie, więc widzą ją te
-- same osoby). Szukamy poprzedniego tylko na tej liście.
create function private.tasks_id_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_uuid_v5(new.id) then return new; end if;
  if new.series_id is not null and new.occurrence_date is not null
     and new.id = private.uuid_v5('6a7d3795-bf51-52d9-a13e-cf7ef1c121af'::uuid, new.series_id::text || '|' || pg_catalog.to_char(new.occurrence_date, 'YYYY-MM-DD'))
     and exists (select 1 from public.event_task_series s where s.id = new.series_id and s.list_id = new.list_id) then
    return new;
  end if;
  if exists (select 1 from public.tasks p where p.list_id = new.list_id and p.id <> new.id and private.next_task_id(p.id) = new.id) then
    return new;
  end if;
  raise exception 'invalid_id' using errcode = 'P0001';
end $$;

create trigger tasks_a_guard_id before insert on public.tasks
  for each row execute function private.tasks_id_guard();

revoke all on function private.event_rsvps_id_guard(), private.event_overrides_id_guard(), private.tasks_id_guard() from public, anon, authenticated;
grant execute on function private.is_uuid_v5(uuid) to authenticated;
