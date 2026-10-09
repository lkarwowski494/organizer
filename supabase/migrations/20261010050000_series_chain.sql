-- Audyt 3, paczka PK-05: seria po „to i następne” to łańcuch części (events.split_from, 20261008320000_event_split), a dla
-- użytkownika jedna seria. Dotąd „Usuń całą serię”, „Odwołaj ten i następne”, „Zmień wszystkie” i przyjęcie przekazania
-- całej serii działały tylko na jednej części (N-3, N-113), „ten i następne” przed wcześniejszym podziałem nie zmieniało
-- późniejszych części (N-22), a zapis z telefonu, który jeszcze nie pobrał podziału, trafiał do części, która tego dnia
-- już nie ma (N-23). Ten sam algorytm na telefonie: src/domain/event-chain.ts i src/domain/event-split.ts; zgodność
-- sprawdza test różnicowy tests/db/event-split.test.ts. Testy: supabase/tests/series_chain.test.sql.
--
-- Nowe: private.event_chain, private.chain_owner, private.chain_repoint (+ 4 wyzwalacze), private.end_series,
-- private.restore_series. Zastępuje: private.split_event (ostatnia definicja 20261008531000_event_duration.sql),
-- private.handoffs_guard (20261008486000_join_handoff_fixes.sql), private.apply_op (20261008379900_event_split_apply_op.sql).
-- Build 21 nie zna poleceń — jego zwykłe operacje działają jak dotąd (wyzwalacze tylko przepinają spóźnione zapisy).

-- Wszystkie części łańcucha (także w koszu) połączone z eid przez split_from w obie strony — z nią samą.
create function private.event_chain(eid uuid) returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  with recursive c(id) as (
    select eid
    union
    select x.id from c, lateral (
      select e.id from public.events e where e.split_from = c.id
      union all
      select e.split_from from public.events e where e.id = c.id and e.split_from is not null
    ) x
  )
  select c.id from c
$$;

-- Część łańcucha, do której należy dzień d (krok 2 split_event): dopóki część kończy się przed nim, a ma żywą
-- następczynię — następczyni. Usunięta albo nieznana część — bez zmian. Telefon: chainOwner (src/domain/event-chain.ts).
create function private.chain_owner(eid uuid, d date) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.events;
  nxt public.events;
  seen uuid[];
begin
  select * into t from public.events where id = eid;
  if t.id is null or t.deleted_at is not null or d is null then return eid; end if;
  seen := array[t.id];
  loop
    select * into nxt from public.events n where n.split_from = t.id and n.deleted_at is null order by n.start_date, n.id limit 1;
    exit when nxt.id is null or nxt.id = any (seen) or coalesce(private.rrule_until(t.rrule), d) >= d;
    seen := seen || nxt.id;
    t := nxt;
  end loop;
  return t.id;
end $$;

-- N-23: spóźniony zapis terminu (odpowiedź o obecności, odwołanie albo zmiana terminu, zadanie na termin, przekazanie
-- terminu) przechodzi do części, która ma ten dzień. Wyjątek i odpowiedź: po strażniku identyfikatora (id wyliczone na
-- telefonie ze starej części), przed resztą; przekazanie: przed strażnikiem (osoba odpowiedzialna z właściwej części).
create function private.chain_repoint() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'handoffs' then
    if new.entity = 'events' and new.occurrence_date is not null then
      new.entity_id := private.chain_owner(new.entity_id, new.occurrence_date);
    end if;
  elsif new.event_id is not null and new.occurrence_date is not null then
    new.event_id := private.chain_owner(new.event_id, new.occurrence_date);
  end if;
  return new;
end $$;

create trigger event_overrides_a_id_chain before insert on public.event_overrides
  for each row execute function private.chain_repoint();
create trigger event_rsvps_a_id_chain before insert on public.event_rsvps
  for each row execute function private.chain_repoint();
create trigger tasks_a_guard_id_chain before insert or update of event_id, occurrence_date on public.tasks
  for each row execute function private.chain_repoint();
create trigger handoffs_0_chain before insert on public.handoffs
  for each row execute function private.chain_repoint();

-- ───────────────────────── end_series ─────────────────────────
-- Polecenie {kind: cmd, cmd: end_series, args: {event_id, date|null, title}} (N-3, N-117), jedna transakcja. Na całym
-- łańcuchu: bez dnia — wszystkie części do kosza („Usuń całą serię”); z dniem („Odwołaj ten i następne”) — części od tego
-- dnia do kosza (ich stałe zadania przechodzą do ostatniej części, która zostaje), część z tym dniem kończy się dzień
-- wcześniej, a jej wyjątki i odpowiedzi o obecności od tego dnia (także innych osób — w kontekście serwera, jak w
-- split_event) do kosza z tym samym znacznikiem: po przedłużeniu serii nie ożyją. Telefon: applyEndSeries.
create function private.end_series(a jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d date := nullif(a ->> 'date', '')::date;
  t public.events;
  p public.events;
  g uuid;
  keep uuid;
  ts timestamptz;
  claims text;
  sub text;
begin
  if a ->> 'event_id' is null then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  select * into t from public.events where id = (a ->> 'event_id')::uuid;
  if t.id is null or private.my_member_id(t.group_id) is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  g := t.group_id;
  if coalesce(private.my_role(g), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  perform 1 from public.groups where id = g for update;
  select * into t from public.events where id = t.id;
  if t.deleted_at is not null then raise exception 'deleted' using errcode = 'P0001'; end if;
  if d is not null then
    select e.id into keep from public.events e
      where e.id in (select c.id from private.event_chain(t.id) c) and e.group_id = g and e.deleted_at is null and e.start_date < d
      order by e.start_date desc, e.id desc limit 1;
  end if;
  ts := clock_timestamp();
  for p in select e.* from public.events e
             where e.id in (select c.id from private.event_chain(t.id) c) and e.group_id = g and e.deleted_at is null
             order by e.start_date, e.id loop
    if d is null or p.start_date >= d then
      if keep is not null then
        update public.event_task_series z set event_id = keep where z.event_id = p.id and z.deleted_at is null;
      end if;
      update public.events set deleted_at = ts where id = p.id;
    elsif p.rrule is not null and coalesce(private.rrule_until(p.rrule), d) >= d then
      update public.events set rrule = private.rrule_cap(p.rrule, d - 1) where id = p.id;
      claims := current_setting('request.jwt.claims', true);
      sub := current_setting('request.jwt.claim.sub', true);
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      update public.event_overrides set deleted_at = ts where event_id = p.id and deleted_at is null and occurrence_date >= d;
      update public.event_rsvps set deleted_at = ts where event_id = p.id and deleted_at is null and occurrence_date >= d;
      perform set_config('request.jwt.claims', coalesce(claims, ''), true);
      perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
    end if;
  end loop;
  return g;
end $$;

-- ───────────────────────── restore_series ─────────────────────────
-- „Cofnij” po end_series: {event_id, title, events: [id], parts: [{id, rrule}], overrides: [id], rsvps: [id]} — tylko
-- wiersze łańcucha event_id w tej grupie: części z kosza (z nimi ich stałe zadania, events_series_cascade), reguły części
-- sprzed ucięcia, wyjątki i odpowiedzi żywych części (odpowiedzi innych osób w kontekście serwera, jak przy usunięciu).
-- Telefon liczy listy z własnych tabel (endSeriesEffects) i wykonuje to samo u siebie (applyRestoreSeries).
create function private.restore_series(a jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.events;
  g uuid;
  x jsonb;
  claims text;
  sub text;
begin
  if a ->> 'event_id' is null then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  select * into t from public.events where id = (a ->> 'event_id')::uuid;
  if t.id is null or private.my_member_id(t.group_id) is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  g := t.group_id;
  if coalesce(private.my_role(g), '') = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;
  perform 1 from public.groups where id = g for update;
  for x in select value from jsonb_array_elements(coalesce(a -> 'events', '[]'::jsonb)) loop
    update public.events e set deleted_at = null
      where e.id = (x #>> '{}')::uuid and e.group_id = g and e.deleted_at is not null
        and e.id in (select c.id from private.event_chain(t.id) c);
  end loop;
  for x in select value from jsonb_array_elements(coalesce(a -> 'parts', '[]'::jsonb)) loop
    update public.events e set rrule = x ->> 'rrule'
      where e.id = (x ->> 'id')::uuid and e.group_id = g and e.deleted_at is null
        and e.id in (select c.id from private.event_chain(t.id) c);
  end loop;
  claims := current_setting('request.jwt.claims', true);
  sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  update public.event_overrides o set deleted_at = null
    where o.deleted_at is not null
      and o.id in (select (v #>> '{}')::uuid from jsonb_array_elements(coalesce(a -> 'overrides', '[]'::jsonb)) v)
      and o.event_id in (select e.id from public.events e where e.id in (select c.id from private.event_chain(t.id) c)
                         and e.group_id = g and e.deleted_at is null);
  update public.event_rsvps r set deleted_at = null
    where r.deleted_at is not null
      and r.id in (select (v #>> '{}')::uuid from jsonb_array_elements(coalesce(a -> 'rsvps', '[]'::jsonb)) v)
      and r.event_id in (select e.id from public.events e where e.id in (select c.id from private.event_chain(t.id) c)
                         and e.group_id = g and e.deleted_at is null);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  return g;
end $$;

-- ───────────────────────── split_event ─────────────────────────
-- Ostatnia definicja: 20261008531000_event_duration.sql — bez zmian poza krokiem 4b (N-22) i decyzjami z podglądu także
-- dla zmienionych późniejszych części (krok 5). follow: [{id, delete?, set?, participants?, drop_overrides?}] — tylko żywe
-- części tego łańcucha w tej grupie, które zaczynają się po dniu podziału (inne pomijane, jak na telefonie).
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
  targets uuid[];
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
  resp := private.split_responsible(g, s ->> 'responsible_member_id');

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
    perform private.split_follow(sid, g, d, coalesce(a -> 'follow', '[]'::jsonb));
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

  -- 4b. Późniejsze części łańcucha (N-22).
  targets := private.split_follow(sid, g, d, coalesce(a -> 'follow', '[]'::jsonb));

  -- 5. Decyzje z podglądu skutków (nowa seria i zmienione późniejsze części).
  for x in select value from jsonb_array_elements(coalesce(a -> 'tasks', '[]'::jsonb)) loop
    if x ->> 'action' = 'relink' then
      update public.tasks set occurrence_date = (x ->> 'date')::date
        where id = (x ->> 'id')::uuid and event_id = any (targets) and private.can_see_list(list_id);
    elsif x ->> 'action' = 'unlink' then
      update public.tasks set event_id = null, occurrence_date = null,
                              deadline_mode = case when deadline_mode = 'event' then 'none' else deadline_mode end
        where id = (x ->> 'id')::uuid and event_id = any (targets) and private.can_see_list(list_id);
    elsif x ->> 'action' = 'delete' then
      update public.tasks set deleted_at = clock_timestamp()
        where id = (x ->> 'id')::uuid and event_id = any (targets) and series_id is not null and deleted_at is null and private.can_see_list(list_id);
    end if;
  end loop;
  return g;
end $$;

-- Osoba odpowiedzialna z polecenia: dorosły w grupie albo nikt (D132) — jak validResp w applySplit.
create function private.split_responsible(g uuid, r text) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.member_id from public.group_members m
    where m.member_id = nullif(r, '')::uuid and m.group_id = g and m.deleted_at is null and m.role <> 'child'
$$;

-- Krok 4b split_event: późniejsze części — zmienione pola, uczestnicy, wyjątki do kosza albo cała część do kosza (jej
-- stałe zadania przechodzą do nowej serii). Zwraca nową serię i części, których dotyczą decyzje z podglądu.
create function private.split_follow(sid uuid, g uuid, d date, follow jsonb) returns uuid[]
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  f jsonb;
  p public.events;
  out uuid[] := array[sid];
begin
  for x in select value from jsonb_array_elements(follow) loop
    select * into p from public.events e where e.id = (x ->> 'id')::uuid;
    continue when p.id is null or p.deleted_at is not null or p.id = sid or p.group_id <> g or p.start_date <= d
      or p.id not in (select c.id from private.event_chain(sid) c);
    if coalesce((x ->> 'delete')::boolean, false) then
      update public.event_task_series z set event_id = sid where z.event_id = p.id and z.deleted_at is null;
      update public.events set deleted_at = clock_timestamp() where id = p.id;
      out := out || p.id;
      continue;
    end if;
    f := coalesce(x -> 'set', '{}'::jsonb);
    update public.events set
      title = case when f ? 'title' then f ->> 'title' else title end,
      start_date = case when f ? 'start_date' then (f ->> 'start_date')::date else start_date end,
      start_time = case when f ? 'start_time' then (f ->> 'start_time')::time else start_time end,
      end_time = case when f ? 'end_time' then (f ->> 'end_time')::time else end_time end,
      rrule = case when f ? 'rrule' then f ->> 'rrule' else rrule end,
      audience = case when f ? 'audience' then f ->> 'audience' else audience end,
      responsible_member_id = case when f ? 'responsible_member_id' then private.split_responsible(g, f ->> 'responsible_member_id') else responsible_member_id end,
      location = case when f ? 'location' then nullif(f ->> 'location', '') else location end,
      days = case when f ? 'days' then (f ->> 'days')::int else days end,
      duration_min = case when f ? 'duration_min' then (f ->> 'duration_min')::int else duration_min end
    where id = p.id;
    if x ? 'participants' then perform private.split_participants(p.id, g, x -> 'participants'); end if;
    update public.event_overrides o set deleted_at = clock_timestamp()
      where o.event_id = p.id and o.deleted_at is null
        and exists (select 1 from jsonb_array_elements(coalesce(x -> 'drop_overrides', '[]'::jsonb)) v where (v #>> '{}')::uuid = o.id);
    out := out || p.id;
  end loop;
  return out;
end $$;

-- ───────────────────────── handoffs_guard ─────────────────────────
-- Ostatnia definicja: 20261008486000_join_handoff_fixes.sql — bez zmian poza przyjęciem przekazania wydarzenia:
--  * cała seria (N-113): osoba zmienia się w każdej części łańcucha, która jeszcze trwa (bez końca albo koniec od dziś,
--    Europe/Warsaw — config.TIME_ZONE; jednorazowe — zawsze) i za którą wciąż odpowiada nadawca; nic do przejęcia — stale;
--  * jeden termin (N-115): termin odwołany, poza regułą (przed początkiem, po końcu) albo w usuniętej serii — stale.
create or replace function private.handoffs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  t public.tasks;
  e public.events;
  l public.lists;
  current_responsible uuid;
  tid uuid;
  moved int := 0;
  n int;
  today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  if (select auth.uid()) is null then return new; end if;
  -- Sprzątanie po osobie, która wyszła albo wróciła (private.group_members_departure, migracja 20261008361000).
  if current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
  me := private.my_member_id(new.group_id);
  if me is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if private.my_role(new.group_id) = 'child' then raise exception 'forbidden:child' using errcode = 'P0001'; end if;

  if tg_op = 'INSERT' then
    new.from_member := me;
    new.status := 'pending';
    new.closed := false;
    new.decided_at := null;
    if new.to_member = me then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.group_members m where m.member_id = new.to_member and m.group_id = new.group_id
                   and m.deleted_at is null and m.role <> 'child' and m.user_id is not null) then
      raise exception 'invalid_member' using errcode = 'P0001';
    end if;
    if new.entity = 'tasks' then
      select * into t from public.tasks where id = new.entity_id;
      if t.id is null or t.group_id <> new.group_id or t.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      if t.assignee_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, t.list_id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    elsif new.entity = 'lists' then
      select * into l from public.lists where id = new.entity_id;
      if l.id is null or l.group_id <> new.group_id or l.deleted_at is not null or l.kind <> 'shopping' then
        raise exception 'invalid_entity' using errcode = 'P0001';
      end if;
      if l.responsible_member_id is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
      if not private.member_can_see_list(new.to_member, l.id) then raise exception 'invalid_member' using errcode = 'P0001'; end if;
    else
      select * into e from public.events where id = new.entity_id;
      if e.id is null or e.group_id <> new.group_id or e.deleted_at is not null then raise exception 'invalid_entity' using errcode = 'P0001'; end if;
      current_responsible := private.occurrence_responsible(e, new.occurrence_date);
      if current_responsible is distinct from me then raise exception 'forbidden:not_responsible' using errcode = 'P0001'; end if;
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array['status', 'closed', 'decided_at', 'version']) is distinct from (to_jsonb(old) - array['status', 'closed', 'decided_at', 'version']) then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  if new.closed is distinct from old.closed and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status is not distinct from old.status then return new; end if;
  if old.status <> 'pending' then raise exception 'invalid_value:status' using errcode = 'P0001'; end if;
  if new.status in ('accepted', 'declined') and me <> old.to_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  if new.status = 'cancelled' and me <> old.from_member then raise exception 'forbidden' using errcode = 'P0001'; end if;
  new.decided_at := now();

  if new.status = 'accepted' then
    -- Audyt 8.10.2026 (#8): odpowiedzialność nadal u nadawcy? (ta sama reguła co przy tworzeniu)
    if old.entity = 'tasks' then
      select assignee_member_id into current_responsible from public.tasks where id = old.entity_id;
    elsif old.entity = 'lists' then
      select responsible_member_id into current_responsible from public.lists where id = old.entity_id;
    elsif old.occurrence_date is null then
      -- Cała seria: sprawdzane niżej, część po części.
      current_responsible := old.from_member;
    else
      select * into e from public.events where id = old.entity_id;
      current_responsible := private.occurrence_responsible(e, old.occurrence_date);
      -- N-115: termin, którego nie ma (odwołany, poza regułą, seria w koszu), nie ma czego przyjąć.
      if e.deleted_at is not null or old.occurrence_date < e.start_date
         or old.occurrence_date > coalesce(private.rrule_until(e.rrule), case when e.rrule is null then e.start_date else old.occurrence_date end)
         or exists (select 1 from public.event_overrides o where o.event_id = e.id and o.occurrence_date = old.occurrence_date
                    and o.deleted_at is null and o.cancelled) then
        raise exception 'stale' using errcode = 'P0001';
      end if;
    end if;
    if current_responsible is distinct from old.from_member then raise exception 'stale' using errcode = 'P0001'; end if;

    if old.entity = 'tasks' then
      -- PW-31: niezrobione terminy łańcucha (ten i kolejne kopie), które wciąż są u nadawcy; zrobionych nie ruszamy.
      -- Łańcuch kończy się na pierwszym id, którego nie ma (kolejne id wynika z poprzedniego, więc cyklu nie ma).
      tid := old.entity_id;
      while tid is not null loop
        update public.tasks set assignee_member_id = old.to_member
          where id = tid and group_id = old.group_id and deleted_at is null and completed_at is null
            and assignee_member_id is not distinct from old.from_member;
        get diagnostics n = row_count;
        moved := moved + n;
        tid := private.next_task_id(tid);
        if not exists (select 1 from public.tasks where id = tid) then tid := null; end if;
      end loop;
      -- Nic do przejęcia (zadanie już zrobione, bez następnego terminu u nadawcy): przekazanie nieaktualne, zostaje
      -- oczekujące — odbiorca może je odrzucić, nadawca anulować (jak przy zmianie osoby, #8).
      if moved = 0 then raise exception 'stale' using errcode = 'P0001'; end if;
    elsif old.entity = 'lists' then
      update public.lists set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    elsif old.occurrence_date is null then
      -- N-113: cała seria = łańcuch części po „to i następne”.
      update public.events x set responsible_member_id = old.to_member
        where x.id in (select c.id from private.event_chain(old.entity_id) c) and x.group_id = old.group_id and x.deleted_at is null
          and x.responsible_member_id is not distinct from old.from_member
          and (x.rrule is null or coalesce(private.rrule_until(x.rrule), today) >= today);
      get diagnostics n = row_count;
      if n = 0 then raise exception 'stale' using errcode = 'P0001'; end if;
    else
      -- Id jak na telefonie (overrideId, src/domain/views/events.ts): telefon zapisujący ten sam termin naraz trafia w ten
      -- sam wiersz, a nie w błąd 23505; istniejący wiersz (także z kosza) dostaje osobę i traci „nikt konkretny”.
      insert into public.event_overrides (id, event_id, group_id, occurrence_date, responsible_member_id)
        values (private.uuid_v5('507f935e-7343-5bf0-a46c-cedc524fb294'::uuid, old.entity_id::text || '|' || to_char(old.occurrence_date, 'YYYY-MM-DD')),
                old.entity_id, old.group_id, old.occurrence_date, old.to_member)
        on conflict (event_id, occurrence_date) do update
          set responsible_member_id = excluded.responsible_member_id, responsible_cleared = false, deleted_at = null;
    end if;
  end if;
  return new;
end $$;

-- ───────────────────────── apply_op ─────────────────────────
-- Ostatnia definicja: 20261008379900_event_split_apply_op.sql — bez zmian poza gałęziami end_series i restore_series.
create or replace function private.apply_op(op jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  kind text := op ->> 'kind';
  ent text := op ->> 'entity';
  e private.sync_entities;
  vals jsonb := coalesce(op -> 'set', '{}'::jsonb);
  cols text[];
  bad text;
  n int;
  gid uuid;
  args jsonb := coalesce(op -> 'args', '{}'::jsonb);
begin
  if kind = 'cmd' then
    case op ->> 'cmd'
      when 'create_group' then
        if exists (select 1 from public.groups where id = (args ->> 'id')::uuid) then
          return (args ->> 'id')::uuid; -- powtórzona komenda: grupa już jest i ją widzę
        end if;
        perform private.create_group_with_owner((args ->> 'id')::uuid, args ->> 'name', 'shared',
                (args ->> 'owner_member_id')::uuid, args ->> 'owner_display_name');
        return (args ->> 'id')::uuid;
      when 'grant_scope', 'revoke_scope' then
        select l.group_id into gid from public.lists l where l.id = (args ->> 'list_id')::uuid;
        if gid is null then raise exception 'not_found' using errcode = 'P0001'; end if;
        if op ->> 'cmd' = 'grant_scope' then
          insert into public.object_members (scope_entity, scope_id, member_id, group_id)
            values ('lists', (args ->> 'list_id')::uuid, (args ->> 'member_id')::uuid, gid)
            on conflict (scope_entity, scope_id, member_id) do update set deleted_at = null;
        else
          -- Cofnięcie tylko aktualizuje istniejący wpis. (Błąd znaleziony testem różnicowym: wcześniejsze
          -- „wstaw albo zaktualizuj” przy braku wpisu WSTAWIAŁO aktywny wpis, czyli dawało dostęp.)
          -- Uprawnienie (tylko właściciel listy) sprawdza wyzwalacz object_members_guard także przy UPDATE.
          update public.object_members set deleted_at = clock_timestamp()
            where scope_entity = 'lists' and scope_id = (args ->> 'list_id')::uuid
              and member_id = (args ->> 'member_id')::uuid and deleted_at is null;
          if not found and private.my_member_id(gid) is distinct from (select owner_member_id from public.lists where id = (args ->> 'list_id')::uuid) then
            raise exception 'forbidden:not_list_owner' using errcode = 'P0001';
          end if;
        end if;
        return gid;
      when 'move_task' then
        return private.move_task((args ->> 'id')::uuid, nullif(args ->> 'parent_id', '')::uuid,
                                 nullif(args ->> 'list_id', '')::uuid, args ->> 'sort_key');
      when 'staple_add', 'staple_remove' then
        return private.staple_cmd(op ->> 'cmd', args);
      when 'split_event' then
        -- Audyt 2 (M-3): „to i następne” w jednej transakcji (20261008320000_event_split).
        return private.split_event(args);
      when 'end_series' then
        -- Audyt 3 (N-3, N-117): koniec serii na całym łańcuchu (20261010050000_series_chain).
        return private.end_series(args);
      when 'restore_series' then
        return private.restore_series(args);
      else
        raise exception 'unknown_cmd' using errcode = 'P0001';
    end case;
  end if;

  select * into e from private.sync_entities where entity = ent;
  if e.entity is null then raise exception 'unknown_entity' using errcode = 'P0001'; end if;
  if op ->> 'id' is null then raise exception 'invalid_value:id' using errcode = 'P0001'; end if;

  if kind = 'create' then
    vals := vals || jsonb_build_object(e.pk, op ->> 'id');
    if op ? 'group_id' then vals := vals || jsonb_build_object('group_id', op ->> 'group_id'); end if;
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.insert_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    -- Identyfikatory nadaje klient (UUIDv7), więc istniejący obiekt to powtórzenie tej samej operacji.
    -- (Bez ON CONFLICT: przy nim Postgres sprawdza politykę SELECT na wierszu, którego jeszcze nie ma.)
    execute format('select group_id from public.%I where %I = $1', ent, e.pk) into gid using (op ->> 'id')::uuid;
    if gid is not null then return gid; end if;
    -- Wartości rzutowane na typy kolumn przez jsonb_populate_record; nazwy kolumn z białej listy.
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
                   ent, (select string_agg(format('%I', c), ',') from unnest(cols) c),
                   (select string_agg(format('%I', c), ',') from unnest(cols) c), ent)
      using vals;
  elsif kind = 'patch' then
    select k into bad from jsonb_object_keys(vals) k where k <> all (e.patch_cols) limit 1;
    if bad is not null then raise exception 'invalid_field:%', bad using errcode = 'P0001'; end if;
    if vals = '{}'::jsonb then return null; end if;
    select array_agg(k) into cols from jsonb_object_keys(vals) k;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) v where t.%I = $2 %s',
                   ent, (select string_agg(format('%I = v.%I', c, c), ',') from unnest(cols) c), ent, e.pk,
                   case when e.soft_delete then 'and t.deleted_at is null' else '' end)
      using vals, (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      -- Widzę wiersz, ale go nie zmieniłem: usunięty (usunięcie wygrywa z edycją) albo brak prawa zapisu.
      execute format('select case when deleted_at is not null then ''deleted'' else ''forbidden'' end from public.%I where %I = $1', ent, e.pk)
        into bad using (op ->> 'id')::uuid;
      raise exception '%', coalesce(bad, 'not_found') using errcode = 'P0001';
    end if;
  elsif kind in ('delete', 'restore') then
    if not e.soft_delete then raise exception 'unsupported' using errcode = 'P0001'; end if;
    -- clock_timestamp(), nie now(): now() jest stałe w transakcji, więc dwa usunięcia w jednej paczce
    -- dostałyby ten sam znacznik i przywrócenie listy przywróciłoby zadanie usunięte wcześniej osobno.
    execute format('update public.%I set deleted_at = %s where %I = $1 and deleted_at is %s',
                   ent, case when kind = 'delete' then 'clock_timestamp()' else 'null' end, e.pk,
                   case when kind = 'delete' then 'null' else 'not null' end)
      using (op ->> 'id')::uuid;
    get diagnostics n = row_count;
    if n = 0 then
      execute format('select 1 from public.%I where %I = $1', ent, e.pk) into n using (op ->> 'id')::uuid;
      if n is null then raise exception 'not_found' using errcode = 'P0001'; end if;
      -- Już usunięte / już przywrócone: operacja idempotentna.
    end if;
  else
    raise exception 'unknown_kind' using errcode = 'P0001';
  end if;

  -- Grupa nie ma kolumny group_id — jej identyfikatorem jest id (błąd wykryty testem groups_edit: zmiana nazwy
  -- grupy przez sync_push zawsze kończyła się odrzuceniem „error:42703”).
  execute format('select %s from public.%I where %I = $1', case when ent = 'groups' then 'id' else 'group_id' end, ent, e.pk)
    into gid using (op ->> 'id')::uuid;
  return gid;
end $$;

revoke all on function private.event_chain(uuid), private.chain_owner(uuid, date), private.chain_repoint(),
  private.split_responsible(uuid, text), private.split_follow(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function private.end_series(jsonb), private.restore_series(jsonb), private.split_event(jsonb), private.apply_op(jsonb) from public, anon;
grant execute on function private.end_series(jsonb), private.restore_series(jsonb), private.split_event(jsonb), private.apply_op(jsonb) to authenticated;
