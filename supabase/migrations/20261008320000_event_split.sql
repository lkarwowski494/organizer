-- Audyt 2 (8.10.2026), wydarzenia. Testy: supabase/tests/event_split.test.sql; zgodność z telefonem (ten sam algorytm
-- w src/domain/event-split.ts): tests/db/event-split.test.ts.
--  * M-3, M-12, M-96: „to i następne” jako jedno polecenie split_event — w jednej transakcji (wcześniej paczka osobnych
--    operacji: odrzucenie nowej serii ucinało starą i znikały wszystkie następne terminy u wszystkich). Nowa seria wskazuje
--    poprzedniczkę (events.split_from); z terminów od dnia podziału przechodzą do niej wyjątki, odpowiedzi o obecności
--    wszystkich osób (wcześniej odpowiedzi innych dorosłych serwer odrzucał), przekazania, zadania (także zrobione) i stałe
--    zadania serii. Identyfikator nowej serii liczy telefon z serii i dnia (UUIDv5), więc dwa telefony dzielące ten sam
--    termin nie zdublują serii. Telefony z buildem 21 dalej dzielą po staremu (ich operacje działają bez zmian).
--  * M-94: event_overrides.responsible_cleared — „nikt konkretny” w jednym terminie serii, która ma osobę odpowiedzialną
--    (pusta osoba w wyjątku znaczy „jak w serii”; osoba wskazana wygrywa ze znacznikiem). Czyta telefon; strażnik
--    przekazań (handoffs_guard) znacznika jeszcze nie zna — telefon i tak nie proponuje przekazania takiego terminu.
--  * M-95 (PW-33, decyzja właściciela z 8.10.2026, wariant A): wyjątek ma własne godziny tylko wtedy, gdy różnią się od
--    godzin serii w chwili zapisu — termin ze zmienioną samą nazwą, osobą albo dniem dalej idzie za godziną serii.
-- Polecenie split_event wpina do private.apply_op migracja 20261008379900_event_split_apply_op (po
-- 20261008370000_staple_commands, która też zastępuje apply_op).

-- ───────────────────────── Kolumny ─────────────────────────
-- Poprzedniczka po „to i następne”. Ustawia tylko private.split_event (bez GRANT i bez sync_entities). Po twardym
-- usunięciu poprzedniczki (czyszczenie kosza) następczyni zostaje — powiązanie znika.
alter table public.events add column split_from uuid references public.events (id) on delete set null;
create index events_split_from_idx on public.events (split_from) where split_from is not null;

alter table public.event_overrides add column responsible_cleared boolean not null default false;
grant insert (responsible_cleared), update (responsible_cleared) on public.event_overrides to authenticated;
update private.sync_entities
   set insert_cols = insert_cols || '{responsible_cleared}', patch_cols = patch_cols || '{responsible_cleared}'
 where entity = 'event_overrides';

-- ───────────────────────── Pomocnicze ─────────────────────────
-- Ostatni dzień serii z reguły (UNTIL) albo null. Tak samo ruleUntil w src/domain/event-split.ts.
create function private.rrule_until(r text) returns date
language sql immutable set search_path = '' as $$
  select to_date(substring(r from '(?:^|;)UNTIL=(\d{8})(?:;|$)'), 'YYYYMMDD')
$$;

-- Reguła kończąca się najpóźniej w dniu d: bez COUNT i UNTIL, potem UNTIL = wcześniejszy z dwóch końców. Bez reguły albo
-- bez dnia — bez zmian. Tak samo capUntil w src/domain/event-split.ts (tekstowo, żeby oba dawały ten sam napis).
create function private.rrule_cap(r text, d date) returns text
language sql immutable set search_path = '' as $$
  select case when r is null or d is null then r
              else regexp_replace(r, ';(COUNT|UNTIL)=[^;]*', '', 'g') || ';UNTIL='
                   || to_char(least(d, coalesce(private.rrule_until(r), d)), 'YYYYMMDD') end
$$;

-- Uczestnicy nowej serii: brakujący dopisani (identyfikatory z telefonu), usunięci przywróceni, zbędni do kosza. Tylko
-- osoby, które są w grupie (usunięta osoba nie przechodzi — D132).
create function private.split_participants(sid uuid, g uuid, parts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.event_participants p set deleted_at = clock_timestamp()
    where p.event_id = sid and p.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(parts) x where (x ->> 'member_id')::uuid = p.member_id);
  update public.event_participants p set deleted_at = null
    where p.event_id = sid and p.deleted_at is not null
      and exists (select 1 from jsonb_array_elements(parts) x where (x ->> 'member_id')::uuid = p.member_id)
      and exists (select 1 from public.group_members m where m.member_id = p.member_id and m.group_id = g and m.deleted_at is null);
  insert into public.event_participants (id, event_id, member_id, group_id)
    select (x ->> 'id')::uuid, sid, (x ->> 'member_id')::uuid, g
    from jsonb_array_elements(parts) x
    where exists (select 1 from public.group_members m where m.member_id = (x ->> 'member_id')::uuid and m.group_id = g and m.deleted_at is null)
      and not exists (select 1 from public.event_participants p where p.event_id = sid and p.member_id = (x ->> 'member_id')::uuid)
      and not exists (select 1 from public.event_participants p where p.id = (x ->> 'id')::uuid);
end $$;

-- ───────────────────────── split_event ─────────────────────────
-- Polecenie sync_push {kind: cmd, cmd: split_event, args: {id, event_id, date, set, participants, drop_overrides, tasks}}.
-- Kroki (tak samo applySplit w src/domain/event-split.ts):
--  1. Polecenie powtórzone (nowa seria już jest — drugi telefon zmienił ten sam termin): nowe wartości jak zmiana całej
--     nowej serii (ostatni zapis wygrywa), bez ponownego dzielenia.
--  2. Gdy dzielona seria kończy się przed tym dniem, a ma następczynię (ktoś podzielił ją wcześniej) — dzielimy następczynię.
--  3. Nowa seria (split_from = dzielona; rodzaj i notatka z dzielonej), dzielona kończy się dzień wcześniej. Gdy dzielona
--     miała już następczynię od późniejszego dnia, nowa seria kończy się tam, gdzie kończyła się dzielona, i staje się
--     poprzedniczką tamtej (bez dubli terminów).
--  4. Z terminów od tego dnia (do końca dzielonej części) do nowej serii przechodzą, z tymi samymi identyfikatorami:
--     wyjątki (te z drop_overrides — terminy, których nowa seria nie ma — do kosza), odpowiedzi o obecności wszystkich osób,
--     przekazania (i oczekujące przekazanie całej serii, gdy nowa seria jest najnowsza), zadania, które widzę (także
--     zrobione), a definicje stałych zadań, gdy nowa seria jest najnowsza.
--  5. Decyzje z podglądu skutków dla zadań z terminów, których nowa seria nie ma: relink (najbliższy termin), unlink,
--     delete (kopia stałego zadania).
-- Osoba odpowiedzialna spoza grupy (albo dziecko) i usunięci uczestnicy nie przechodzą (D132) — zamiast odrzucenia całości.
-- Kody odrzucenia: invalid_value (brak pól), not_found, forbidden:child, deleted, invalid_value:id, invalid_value:rrule,
-- invalid_value:start_date, deleted:group (grupa w koszu) i naruszenia ograniczeń tabeli (invalid:23514 — np. tytuł).
create function private.split_event(a jsonb) returns uuid
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
      location = nullif(s ->> 'location', '')
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
                             location, kind, split_from)
  values (sid, g, s ->> 'title', t.note, (s ->> 'start_date')::date, (s ->> 'start_time')::time, (s ->> 'end_time')::time,
          private.rrule_cap(s ->> 'rrule', hi), coalesce(s ->> 'audience', 'group'), resp, nullif(s ->> 'location', ''), t.kind, t.id);
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

-- ───────────────────────── M-95 (PW-33, wariant A): godziny wyjątku ─────────────────────────
-- Godziny wyjątku równe godzinom serii w chwili zapisu znaczą „jak w serii” (null): przy wstawieniu i przy zmianie
-- godzin. Telefony z nową wersją wysyłają wtedy null same; ten wyzwalacz obsługuje build 21, który zapisuje w wyjątku
-- zawsze pełne godziny. Zapis innych pól (np. nazwy) nie rusza już zapisanych godzin.
create function private.override_series_time() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  if new.start_time is null
     or (tg_op = 'UPDATE' and (new.start_time, new.end_time) is not distinct from (old.start_time, old.end_time)) then
    return new;
  end if;
  select * into e from public.events where id = new.event_id;
  if new.start_time = e.start_time and new.end_time is not distinct from e.end_time then
    new.start_time := null;
    new.end_time := null;
  end if;
  return new;
end $$;

create trigger event_overrides_a_series_time before insert or update on public.event_overrides
  for each row execute function private.override_series_time();

-- Naprawa wyjątków sprzed decyzji: godziny wyjątku równe godzinom serii w chwili ostatniego zapisu godzin wyjątku → null
-- (termin dalej idzie za godziną serii, także jeśli serię przesunięto później — wtedy pokaże godzinę serii). Godziny serii
-- w tamtej chwili z historii (activity: każdy zapis wydarzeń i wyjątków z numerem wersji; historii żywych wydarzeń nic nie
-- usuwa). Bez wpisu w historii — wyjątek zostaje bez zmian. Kontekst serwerowy (strażnicy przepuszczają, wersje rosną,
-- więc telefony pobiorą zmiany). Zwraca liczbę poprawionych.
create function private.repair_override_times() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with o as (
    select x.id, x.event_id, x.start_time, x.end_time,
           (select a.version from public.activity a
             where a.entity = 'event_overrides' and a.entity_id = x.id and (a.changes ? 'start_time' or a.changes ? 'end_time')
             order by a.version desc limit 1) as v
    from public.event_overrides x
    where x.start_time is not null
  ), s as (
    select o.id, o.start_time, o.end_time,
           (select (a.changes -> 'start_time' ->> 1)::time from public.activity a
             where a.entity = 'events' and a.entity_id = o.event_id and a.version < o.v and a.changes ? 'start_time'
             order by a.version desc limit 1) as series_start,
           (select (a.changes -> 'end_time' ->> 1)::time from public.activity a
             where a.entity = 'events' and a.entity_id = o.event_id and a.version < o.v and a.changes ? 'end_time'
             order by a.version desc limit 1) as series_end
    from o where o.v is not null
  )
  update public.event_overrides x set start_time = null, end_time = null
    from s
    where x.id = s.id and s.start_time = s.series_start and s.end_time is not distinct from s.series_end;
  get diagnostics n = row_count;
  return n;
end $$;

select private.repair_override_times();

revoke all on all functions in schema private from public, anon;
revoke all on function private.repair_override_times(), private.split_participants(uuid, uuid, jsonb) from authenticated;
grant execute on function private.split_event(jsonb) to authenticated;
grant execute on function private.rrule_ok(text) to authenticated;
