-- D199 (audyt 2, M-99 / PW-53, decyzja: wariant A): wydarzenia przez kilka dni (obóz: cały dzień od A do B) i przez
-- północ (nocny dyżur 22:00–06:00). Model jak RFC 5545 (https://www.rfc-editor.org/rfc/rfc5545), opis w src/domain/span.ts:
--  * całodniowe: events.days = liczba dni (1 = jeden dzień). §3.6.1: „The "DTEND" property for a "VEVENT" calendar
--    component specifies the non-inclusive end of the event” — koniec wyłączny = start_date + days. Długość zamiast daty
--    końca, bo w serii każde wystąpienie trwa tyle samo (§3.8.5.3: „the same exact duration will apply to all the members of
--    the generated recurrence set”); wyjątek może ją zmienić („The duration of a specific recurrence may be modified in an
--    exception component”) — event_overrides.days, null = jak w serii;
--  * z godziną: end_time nie później niż start_time = koniec następnego dnia (bez nowej kolumny). Dotychczasowe
--    ograniczenie „end_time > start_time” zostaje zastąpione przez „koniec tylko z początkiem”.
-- Build 21 (nie zna days) widzi wielodniowe w dniu startu, a nocny dyżur z godzinami „22:00–06:00”. Jego zapis godziny
-- w wielodniowym (zmiana na „o godzinie”) nie jest odrzucany: wyzwalacz ustawia wtedy days = 1 (z godziną długość mówią
-- godziny). Limit = config.events.MAX_DAYS (test kontraktowy). Testy: supabase/tests/event_days.test.sql.

create function private.event_max_days() returns int language sql immutable as $$ select 31 $$;

-- ───────────────────────── Kolumny i ograniczenia ─────────────────────────
alter table public.events add column days int not null default 1;
alter table public.events add constraint events_days check (days between 1 and private.event_max_days() and (days = 1 or start_time is null));
alter table public.events drop constraint events_end_after_start;
alter table public.events add constraint events_end_needs_start check (end_time is null or start_time is not null);

alter table public.event_overrides add column days int;
alter table public.event_overrides add constraint event_overrides_days check (days is null or days between 1 and private.event_max_days());
alter table public.event_overrides drop constraint event_overrides_end_after_start;
alter table public.event_overrides add constraint event_overrides_end_needs_start check (end_time is null or start_time is not null);

grant insert (days), update (days) on public.events to authenticated;
grant insert (days), update (days) on public.event_overrides to authenticated;
update private.sync_entities set insert_cols = insert_cols || '{days}', patch_cols = patch_cols || '{days}' where entity in ('events', 'event_overrides');

-- Z godziną długość mówią godziny: days = 1 (build 21 zmienia całodniowe wielodniowe na „o godzinie” bez days).
create function private.events_days() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.start_time is not null then new.days := 1; end if;
  return new;
end $$;

create trigger events_c_days before insert or update on public.events
  for each row execute function private.events_days();

-- ───────────────────────── split_event: z długością ─────────────────────────
-- Ostatnia definicja: 20261008320000_event_split.sql — bez zmian poza days: z polecenia (set.days), a gdy go nie ma
-- (starsza wersja telefonu) — jak w dzielonej serii (krok 3) albo w nowej serii (krok 1). Z godziną wyzwalacz daje 1.
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
      days = coalesce((s ->> 'days')::int, ex.days)
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
                             location, kind, split_from, days)
  values (sid, g, s ->> 'title', t.note, (s ->> 'start_date')::date, (s ->> 'start_time')::time, (s ->> 'end_time')::time,
          private.rrule_cap(s ->> 'rrule', hi), coalesce(s ->> 'audience', 'group'), resp, nullif(s ->> 'location', ''), t.kind, t.id,
          coalesce((s ->> 'days')::int, t.days));
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


revoke all on function private.events_days() from public, anon, authenticated;
revoke all on function private.event_max_days() from public, anon;
grant execute on function private.event_max_days() to authenticated;
revoke all on function private.split_event(jsonb) from public, anon;
grant execute on function private.split_event(jsonb) to authenticated;
