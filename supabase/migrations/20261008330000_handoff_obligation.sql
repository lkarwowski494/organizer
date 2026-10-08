-- Audyt 2 (T-5) i decyzja właściciela z 8.10.2026 (PW-31, wariant A): przekazanie zadania powtarzanego przekazuje
-- obowiązek, nie jeden termin. Przyjęcie przenosi na odbiorcę niezrobione terminy łańcucha — przekazany i kolejne kopie
-- (id następnego jak na telefonie: UUIDv5(REPEAT_NAMESPACE, id || '|next'), src/domain/views/task-repeat.ts), które wciąż
-- są u nadawcy. Zrobionych terminów nie rusza (historia zostaje). Gdy w łańcuchu nie ma już nic niezrobionego u nadawcy
-- (zadanie zrobione, bez następnego terminu) — 'stale', przekazanie zostaje oczekujące (jak przy zmianie osoby, #8).
-- Telefon pokazuje takie przekazanie w „Do potwierdzenia” tylko wtedy, gdy w łańcuchu jest niezrobiony termin.
-- Odrzucone: przepinanie przekazania na kopię przez telefon nadawcy (działa tylko, gdy to on odhacza — inni nie widzą
-- wiersza przekazania, RLS), przypisanie zrobionego terminu (przepisywałoby historię), kolumna „poprzedni termin”
-- (kopie robione przez build 21 by jej nie miały).

-- SHA-1 (FIPS 180-4, https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf, sekcja 6.1) — tylko do UUIDv5, który
-- RFC 9562 definiuje na SHA-1 (identyfikator, nie zabezpieczenie). Bez rozszerzeń: pgcrypto jest w Supabase w schemacie
-- extensions, a w lokalnej nakładce testów w public, więc jedna ścieżka wywołania nie działałaby w obu; uuid-ossp nakładka
-- nie ma. Słowa 32-bitowe w bigint z maską.
create or replace function private.sha1(msg bytea) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  mask constant bigint := 4294967295;
  len int := pg_catalog.length(msg);
  total int := ((len + 9 + 63) / 64) * 64;
  m bytea := msg || pg_catalog.decode('80' || pg_catalog.repeat('00', total - len - 9), 'hex') || pg_catalog.int8send(len::bigint * 8);
  h bigint[] := array[1732584193, 4023233417, 2562383102, 271733878, 3285377520]::bigint[];
  w bigint[];
  a bigint; b bigint; c bigint; d bigint; e bigint; f bigint; k bigint; t bigint;
  off int := 0;
  res bytea := ''::bytea;
begin
  while off < total loop
    w := pg_catalog.array_fill(0::bigint, array[80]);
    for i in 0..15 loop
      w[i + 1] := (pg_catalog.get_byte(m, off + i * 4)::bigint << 24) | (pg_catalog.get_byte(m, off + i * 4 + 1)::bigint << 16)
                | (pg_catalog.get_byte(m, off + i * 4 + 2)::bigint << 8) | pg_catalog.get_byte(m, off + i * 4 + 3)::bigint;
    end loop;
    for i in 16..79 loop
      t := w[i - 2] # w[i - 7] # w[i - 13] # w[i - 15];
      w[i + 1] := ((t << 1) | (t >> 31)) & mask;
    end loop;
    a := h[1]; b := h[2]; c := h[3]; d := h[4]; e := h[5];
    for i in 0..79 loop
      if i < 20 then f := (b & c) | ((~b) & mask & d); k := 1518500249;
      elsif i < 40 then f := b # c # d; k := 1859775393;
      elsif i < 60 then f := (b & c) | (b & d) | (c & d); k := 2400959708;
      else f := b # c # d; k := 3395469782;
      end if;
      t := ((((a << 5) | (a >> 27)) & mask) + f + e + k + w[i + 1]) & mask;
      e := d; d := c; c := ((b << 30) | (b >> 2)) & mask; b := a; a := t;
    end loop;
    h[1] := (h[1] + a) & mask; h[2] := (h[2] + b) & mask; h[3] := (h[3] + c) & mask; h[4] := (h[4] + d) & mask; h[5] := (h[5] + e) & mask;
    off := off + 64;
  end loop;
  for i in 1..5 loop
    res := res || pg_catalog.substr(pg_catalog.int8send(h[i]), 5, 4);
  end loop;
  return res;
end $$;

-- UUIDv5 (RFC 9562, sekcja 5.5): SHA-1 z bajtów przestrzeni nazw i nazwy (UTF-8), wersja 5, wariant RFC — jak uuidv5()
-- w src/domain/ids.ts.
create or replace function private.uuid_v5(ns uuid, name text) returns uuid
language sql immutable strict set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.set_byte(pg_catalog.set_byte(d, 6, (pg_catalog.get_byte(d, 6) & 15) | 80), 8, (pg_catalog.get_byte(d, 8) & 63) | 128), 'hex')::uuid
  from (select pg_catalog.substr(private.sha1(pg_catalog.uuid_send(ns) || pg_catalog.convert_to(name, 'UTF8')), 1, 16) as d) x
$$;

-- Id następnego terminu zadania powtarzanego — nextId() z src/domain/views/task-repeat.ts (ta sama przestrzeń nazw;
-- zgodność pilnuje test kontraktowy w src/config/__tests__ i pgTAP handoff_obligation).
create or replace function private.next_task_id(id uuid) returns uuid
language sql immutable strict set search_path = '' as $$
  select private.uuid_v5('e21c312a-9090-47c5-9490-c54305c7ddd1'::uuid, id::text || '|next')
$$;

-- Zastępuje wersję z 20261008280000_audit_fixes.sql. Zmiana tylko w przyjęciu przekazania zadania (łańcuch terminów).
create or replace function private.handoffs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid;
  t public.tasks;
  e public.events;
  l public.lists;
  current_responsible uuid;
  o_id uuid;
  tid uuid;
  moved int := 0;
  n int;
begin
  if (select auth.uid()) is null then return new; end if;
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
      current_responsible := e.responsible_member_id;
      if new.occurrence_date is not null then
        select coalesce(o.responsible_member_id, e.responsible_member_id) into current_responsible
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = new.occurrence_date and o.deleted_at is null;
        current_responsible := coalesce(current_responsible, e.responsible_member_id);
      end if;
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
    else
      select * into e from public.events where id = old.entity_id;
      current_responsible := e.responsible_member_id;
      if old.occurrence_date is not null then
        select coalesce(o.responsible_member_id, e.responsible_member_id) into current_responsible
          from public.event_overrides o where o.event_id = e.id and o.occurrence_date = old.occurrence_date and o.deleted_at is null;
        current_responsible := coalesce(current_responsible, e.responsible_member_id);
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
      update public.events set responsible_member_id = old.to_member where id = old.entity_id and deleted_at is null;
    else
      select id into o_id from public.event_overrides where event_id = old.entity_id and occurrence_date = old.occurrence_date;
      if o_id is null then
        insert into public.event_overrides (id, event_id, group_id, occurrence_date, responsible_member_id)
          values (gen_random_uuid(), old.entity_id, old.group_id, old.occurrence_date, old.to_member);
      else
        update public.event_overrides set responsible_member_id = old.to_member, deleted_at = null where id = o_id;
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on all functions in schema private from public, anon;
