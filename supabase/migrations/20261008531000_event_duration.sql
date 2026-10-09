-- D199, część 2 (decyzja koordynatora 8.10.2026): wydarzenia z godziną przez więcej niż jedną noc (wyjazd pt. 18:00 –
-- nd. 16:00). Długość jak RFC 5545 §3.8.2.5 DURATION („In a "VEVENT" calendar component the property may be used to
-- specify a duration of the event, instead of an explicit end DATE-TIME”; dla dat „dur-day” — events.days z 20261008530000,
-- dla godzin „dur-time” — tu w minutach): events.duration_min i event_overrides.duration_min.
--  * null = długość z godzin (koniec po początku — ten sam dzień, koniec nie później niż początek — następny dzień);
--    zapisana tylko wtedy, gdy jest dłuższa. Godzina końca zostaje w wierszu (build 21 ją pokazuje) i musi się zgadzać
--    z początkiem + długością: zmiana godzin z buildu 21 (nie zna długości) daje niezgodność, a wtedy długość jest zerowana
--    — wydarzenie wraca do znaczenia z samych godzin, jak je widział build 21. Wydarzenie z długością równą tej z godzin
--    zapisuje null (jedna postać); wyjątek terminu zachowuje ją (godziny jak w serii, inna długość — patrz niżej).
--  * Limit: config.events.MAX_DAYS dni (private.event_max_days()) w minutach.
-- Telefon liczy to samo: storedDuration w src/domain/span.ts. Testy: supabase/tests/event_duration.test.sql.

create function private.minute_of(t time) returns int language sql immutable set search_path = '' as $$
  select (extract(hour from t) * 60 + extract(minute from t))::int
$$;

-- Długość z samych godzin: koniec po początku — ten sam dzień, inaczej z dobą.
create function private.clock_minutes(s time, e time) returns int language sql immutable set search_path = '' as $$
  select case when s is null or e is null then null
              when private.minute_of(e) > private.minute_of(s) then private.minute_of(e) - private.minute_of(s)
              else private.minute_of(e) - private.minute_of(s) + 1440 end
$$;

-- Zapisana długość zgodna z godzinami albo null (bez godzin, bez długości, niezgodna).
create function private.event_duration(s time, e time, d int) returns int language sql immutable set search_path = '' as $$
  select case when s is null or e is null or d is null then null
              when (private.minute_of(s) + d) % 1440 <> private.minute_of(e) then null
              else d end
$$;

alter table public.events add column duration_min int;
alter table public.events add constraint events_duration check (duration_min is null or (duration_min between 1 and private.event_max_days() * 1440 and start_time is not null and end_time is not null));
alter table public.event_overrides add column duration_min int;
alter table public.event_overrides add constraint event_overrides_duration check (duration_min is null or (duration_min between 1 and private.event_max_days() * 1440 and start_time is not null and end_time is not null));

grant insert (duration_min), update (duration_min) on public.events to authenticated;
grant insert (duration_min), update (duration_min) on public.event_overrides to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{duration_min}', patch_cols = patch_cols || '{duration_min}' where entity in ('events', 'event_overrides');

-- Wydarzenie: z godziną days = 1 (jak dotąd); długość zgodna z godzinami, a równa tej z godzin — null.
create or replace function private.events_days() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.start_time is not null then new.days := 1; end if;
  new.duration_min := private.event_duration(new.start_time, new.end_time, new.duration_min);
  if new.duration_min = private.clock_minutes(new.start_time, new.end_time) then new.duration_min := null; end if;
  return new;
end $$;

-- Wyjątek: tylko zgodność z godzinami (długość równa tej z godzin zostaje — znaczy „inna niż w serii”).
create function private.override_duration() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.duration_min := private.event_duration(new.start_time, new.end_time, new.duration_min);
  return new;
end $$;

-- Po event_overrides_a_series_time (kolejność wyzwalaczy: alfabetycznie), przed sprawdzeniem ograniczeń.
create trigger event_overrides_a_times_duration before insert or update on public.event_overrides
  for each row execute function private.override_duration();

-- M-95 (PW-33) z długością: godziny wyjątku równe godzinom serii znaczą „jak w serii” tylko przy tej samej długości (albo
-- bez długości — build 21 i starsze telefony zapisują w wyjątku pełne godziny serii). Ostatnia definicja:
-- 20261008320000_event_split.sql — bez zmian poza długością.
create or replace function private.override_series_time() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  if new.start_time is null
     or (tg_op = 'UPDATE' and (new.start_time, new.end_time, new.duration_min) is not distinct from (old.start_time, old.end_time, old.duration_min)) then
    return new;
  end if;
  select * into e from public.events where id = new.event_id;
  if new.start_time = e.start_time and new.end_time is not distinct from e.end_time
     and (new.duration_min is null or new.duration_min = coalesce(e.duration_min, private.clock_minutes(e.start_time, e.end_time))) then
    new.start_time := null;
    new.end_time := null;
    new.duration_min := null;
  end if;
  return new;
end $$;

-- split_event z długością: ostatnia definicja 20261008530000_event_days.sql — bez zmian poza duration_min: z polecenia
-- (także null), a gdy go nie ma (starsza wersja telefonu) — jak w dzielonej serii; wyzwalacz uzgadnia ją z godzinami.
create or replace function private.split_event(a jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := (a ->> 'id')::uuid;
  d date := (a ->> 'date')::date;
  s jsonb := coalesce(a -> 'set', '{}'::jsonb);
  parts jsonb := coalesce(a -> 'participants', '[]'::jsonb);
  t public.events;
  nxt public.events;
  ex public.events;
  g uuid;
  hi date;
  resp uuid;
  seen uuid[];
  x jsonb;
  claims text;
  sub text;
begin
  if sid is null or d is null or a ->> 'event_id' is null or s ->> 'start_date' is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  select * into t from public.events where id = (a ->> 'event_id')::uuid;
  if t.id is null or private.my_member_id(t.group_id) is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  g := t.group_id;
  if coalesce(private.my_role(g), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  -- Blokada wiersza grupy (jak move_task): podziały w grupie idą po kolei; potem stan po blokadzie.
  perform 1 from public.groups where id = g for update;
  select * into t from public.events where id = t.id;
  if t.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;
  if (s ->> 'start_date')::date < d then raise exception 'invalid_value:start_date' using errcode = 'P0001'; end if;
  resp := nullif(s ->> 'responsible_member_id', '')::uuid;
  if resp is not null and not exists (select 1 from public.group_members m where m.member_id = resp and m.group_id = g
                                      and m.deleted_at is null and m.role <> 'child') then
    resp := null;
  end if;

  -- 1. Polecenie powtórzone.
  select * into ex from public.events where id = sid;
  if ex.id is not null then
    if ex.group_id <> g or ex.split_from is null then raise exception 'invalid_value:id' using errcode = 'P0001'; end if;
    if ex.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;
    update public.events set
      title = s ->> 'title',
      start_date = (s ->> 'start_date')::date,
      start_time = (s ->> 'start_time')::time,
      end_time = (s ->> 'end_time')::time,
      rrule = private.rrule_cap(s ->> 'rrule', case when exists (select 1 from public.events n where n.split_from = sid and n.deleted_at is null)
                                                    then private.rrule_until(ex.rrule) end),
      audience = coalesce(s ->> 'audience', 'group'),
      responsible_member_id = resp,
      location = nullif(s ->> 'location', ''),
      days = coalesce((s ->> 'days')::int, ex.days),
      duration_min = case when s ? 'duration_min' then (s ->> 'duration_min')::int else ex.duration_min end
    where id = sid;
    perform private.split_participants(sid, g, parts);
    return g;
  end if;

  -- 2. Termin należy do następczyni, gdy dzielona kończy się przed nim (odwiedzone — bezpiecznik na zapętlony łańcuch).
  seen := array[t.id];
  loop
    select * into nxt from public.events n where n.split_from = t.id and n.deleted_at is null order by n.start_date, n.id limit 1;
    exit when nxt.id is null or nxt.id = any (seen) or coalesce(private.rrule_until(t.rrule), d) >= d;
    seen := seen || nxt.id;
    t := nxt;
  end loop;
  if t.rrule is null then raise exception 'invalid_value:rrule' using errcode = 'P0001'; end if;
  hi := case when nxt.id is not null then private.rrule_until(t.rrule) end;

  -- 3. Nowa seria i koniec dzielonej.
  insert into public.events (id, group_id, title, note, start_date, start_time, end_time, rrule, audience, responsible_member_id,
                             location, kind, split_from, days, duration_min)
  values (sid, g, s ->> 'title', t.note, (s ->> 'start_date')::date, (s ->> 'start_time')::time, (s ->> 'end_time')::time,
          private.rrule_cap(s ->> 'rrule', hi), coalesce(s ->> 'audience', 'group'), resp, nullif(s ->> 'location', ''), t.kind, t.id,
          coalesce((s ->> 'days')::int, t.days),
          case when s ? 'duration_min' then (s ->> 'duration_min')::int else t.duration_min end);
  if nxt.id is not null then update public.events set split_from = sid where id = nxt.id; end if;
  update public.events set rrule = private.rrule_cap(t.rrule, d - 1) where id = t.id;
  perform private.split_participants(sid, g, parts);

  -- 4. Terminy od dnia podziału.
  update public.event_overrides o set deleted_at = clock_timestamp()
    where o.event_id = t.id and o.deleted_at is null and o.occurrence_date >= d and (hi is null or o.occurrence_date <= hi)
      and exists (select 1 from jsonb_array_elements(coalesce(a -> 'drop_overrides', '[]'::jsonb)) v where (v #>> '{}')::uuid = o.id);
  -- Przepięcie wierszy, których strażnicy nie pozwalają zmienić z telefonu (event_id wyjątku i odpowiedzi, entity_id
  -- przekazania, odpowiedzi innych osób): w kontekście serwera — strażnicy przepuszczają zapisy bez auth.uid(), jak przy
  -- czyszczeniu kosza — tylko na czas tych trzech poleceń z warunkami niżej; wersje rosną jak zwykle. Bez przedefiniowania
  -- strażników (events_guard, event_rsvps_guard, handoffs_guard zostają bez zmian). Błąd w środku cofa też ustawienia.
  claims := current_setting('request.jwt.claims', true);
  sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  -- Nowa seria jest pusta, a dni z dzielonej są unikalne, więc przeniesienie nie łamie unikalności (seria, dzień[, osoba]).
  update public.event_overrides o set event_id = sid
    where o.event_id = t.id and o.occurrence_date >= d and (hi is null or o.occurrence_date <= hi);
  update public.event_rsvps r set event_id = sid
    where r.event_id = t.id and r.occurrence_date >= d and (hi is null or r.occurrence_date <= hi);
  update public.handoffs h set entity_id = sid
    where h.entity = 'events' and h.entity_id = t.id
      and ((h.occurrence_date >= d and (hi is null or h.occurrence_date <= hi)) or (h.occurrence_date is null and h.status = 'pending' and nxt.id is null));
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  update public.tasks k set event_id = sid
    where k.event_id = t.id and k.occurrence_date >= d and (hi is null or k.occurrence_date <= hi) and private.can_see_list(k.list_id);
  if nxt.id is null then
    update public.event_task_series z set event_id = sid where z.event_id = t.id;
  end if;

  -- 5. Decyzje z podglądu skutków.
  for x in select value from jsonb_array_elements(coalesce(a -> 'tasks', '[]'::jsonb)) loop
    if x ->> 'action' = 'relink' then
      update public.tasks set occurrence_date = (x ->> 'date')::date
        where id = (x ->> 'id')::uuid and event_id = sid and private.can_see_list(list_id);
    elsif x ->> 'action' = 'unlink' then
      update public.tasks set event_id = null, occurrence_date = null,
                              deadline_mode = case when deadline_mode = 'event' then 'none' else deadline_mode end
        where id = (x ->> 'id')::uuid and event_id = sid and private.can_see_list(list_id);
    elsif x ->> 'action' = 'delete' then
      update public.tasks set deleted_at = clock_timestamp()
        where id = (x ->> 'id')::uuid and event_id = sid and series_id is not null and deleted_at is null and private.can_see_list(list_id);
    end if;
  end loop;
  return g;
end $$;


revoke all on function private.events_days(), private.override_duration(), private.override_series_time() from public, anon, authenticated;
revoke all on function private.minute_of(time), private.clock_minutes(time, time), private.event_duration(time, time, int) from public, anon;
grant execute on function private.minute_of(time), private.clock_minutes(time, time), private.event_duration(time, time, int) to authenticated;
revoke all on function private.split_event(jsonb) from public, anon;
grant execute on function private.split_event(jsonb) to authenticated;
